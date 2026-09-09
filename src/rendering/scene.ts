import { createWaterRecreation } from './world/recreation';
import { routeForWaterBody, sampleWaterRoute } from './world/water-routes';
import { createWorldChunks } from './scene/world-chunks';
import * as THREE from 'three';
import { createFrameLimiter } from './frame-limit';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { batchGroup, disposeGroup, getBatchTriangleOwner } from './scene/geometry';
import { createBuildingChunks } from './scene/building-chunks';
import { createSceneMetrics } from './scene/metrics';
import { createGpuTiming } from './scene/gpu-timing';
import { createLiveInstances } from './scene/live-instances';
import { createGroundOutline, selectionBounds } from './scene/ground-outline';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import {
  createTileModel,
  setModelNightBlend,
  setModelWet,
  getModelFootprint,
  updateFacilityActors,
  createFacilityServiceVehicle,
} from './buildings/models';
import { previewBuild, getFootprint, isBuildingAnchor } from '../simulation/city-simulation';
import { createWeatherEffects } from './effects/weather';
import { createFireEffects } from './effects/fire';
import { createCitizens } from '../citizens/system';
import { createMountedHero } from '../citizens/mounted-hero';
import {
  createDrivingController,
  getVehicleDimensions,
  drivingSurfaceHeight,
  type VehicleCollision,
} from '../vehicles/driving';
import { findVehicleContact, type VehicleContactBody } from '../vehicles/contacts';
import { createDetailedCar, type VehicleKind } from './vehicles/model';
import { lanePose } from '../traffic/lanes';
import {
  buildRoadNetwork,
  roadPointKey,
  sameRoadPoint,
  planExternalMovement,
  type JunctionMovement,
} from '../traffic/network';
import { createTrafficController, type TrafficVehicle } from '../traffic/controller';
import {
  advanceTrafficRoute,
  chooseTrafficExit,
  prepareTrafficRoute,
  type TrafficRouteState,
} from '../traffic/flow';
import { createTrafficSignals } from './infrastructure/signals';
import { listFacilityServiceRoutes, type FacilityServiceRoute } from '../buildings/facility-access';
import { createAnimalSystem } from '../wildlife/animals';
import { createStreetlights } from './lighting/streetlights';
import { applyStableShadowFiltering, createCityLighting } from './lighting/environment';
import { sampleRoadHeight } from './infrastructure/roads';
import { routeRoad } from '../construction/road-routing';
import { getPowerLayout, powerLayoutSignature } from '../infrastructure/power-layout';
import { createPowerGridModel } from './infrastructure/power';
import { getRegionMargin } from './world/surroundings';
import {
  createTerrainMaterials,
  sampleGroundHeight,
  getTerrainPlateFloor,
  TERRAIN_WATER_LEVEL,
} from './world/terrain';
import {
  brushFootprint,
  ConstructionStroke,
  PointerInteraction,
  ZONE_TOOLS,
  LINE_TOOLS,
  FACILITY_TOOLS,
  SINGLE_TILE_TOOLS,
} from '../construction/gesture';
import type { AudioSceneState } from '../audio/soundscape';
import type {
  CityState,
  CitySceneApi,
  SceneCallbacks,
  Point,
  Tool,
  Overlay,
  Tile,
  Weather,
  BuildOptions,
  PreviewInfo,
  ZoneDensity,
} from '../domain/types';
import { tr } from '../i18n/index';

type GraphicsQuality = 'performance' | 'balanced' | 'ultra';

/** The switch controls building illumination independently of the sun or clock. */
export function buildingLightIntensity(nightBlend: number, enabled: boolean): number {
  return enabled
    ? 0.18 + 0.82 * THREE.MathUtils.clamp(Number.isFinite(nightBlend) ? nightBlend : 0, 0, 1)
    : 0;
}

/** Suspension support for an autonomous service vehicle, using the same wheel
 * contacts and visible driving surface as the player-controlled vehicle. */
export function serviceVehicleSupportPose(
  sampleHeight: (x: number, z: number) => number,
  x: number,
  z: number,
  yaw: number,
  wheelBase: number,
  width: number,
): { y: number; pitch: number; roll: number } {
  const halfLength = wheelBase / 2,
    halfWidth = width * 0.38,
    fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    rx = Math.cos(yaw),
    rz = -Math.sin(yaw);
  const front = sampleHeight(x + fx * halfLength, z + fz * halfLength),
    back = sampleHeight(x - fx * halfLength, z - fz * halfLength);
  const right = sampleHeight(x + rx * halfWidth, z + rz * halfWidth),
    left = sampleHeight(x - rx * halfWidth, z - rz * halfWidth);
  return {
    y: Math.max(sampleHeight(x, z), (front + back) / 2, (right + left) / 2),
    pitch: -Math.atan2(front - back, wheelBase),
    roll: Math.atan2(right - left, halfWidth * 2),
  };
}

const TOOL_COLORS: Partial<Record<Tool, number>> = {
  residential: 0x8dcc7a,
  commercial: 0x68bde4,
  industrial: 0xe8c66d,
  road: 0xf3ead6,
  rail: 0xd6c7b5,
  bulldoze: 0xed8373,
  waterpump: 0x73d3df,
  park: 0x8bcc81,
  tree: 0x8bcc81,
  power: 0xf2c26f,
  inspect: 0xf7e5ae,
};

function noise(x: number, z: number, seed = 1) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 17.77) * 43758.5453;
  return n - Math.floor(n);
}

interface Car extends TrafficRouteState {
  model: THREE.Group;
  from: Point;
  to: Point;
  previous: Point;
  progress: number;
  speed: number;
  turn: number;
  wasControlled?: boolean;
  service?: {
    id: string;
    route: FacilityServiceRoute;
    index: number;
    departed: boolean;
    wait: number;
    merge?: JunctionMovement;
  };
}

export function createCityScene(
  container: HTMLElement,
  initialState: CityState,
  callbacks: SceneCallbacks,
): CitySceneApi {
  let state = initialState;
  let tool: Tool = 'inspect';
  let brush = 1;
  let rotation: 0 | 1 | 2 | 3 = 0;
  let density: ZoneDensity = 'low';
  let targetElevation: number | undefined;
  let pointerScreen = { x: 0, y: 0 };
  let weather: Weather = initialState.settings.weather;
  let wetGround = weather === 'rain';
  const pressedKeys = new Set<string>();
  let overlay: Overlay = 'none';
  let timeOfDay = initialState.settings.timeOfDay ?? 14;
  let dayNightCycle = initialState.settings.dayNightCycle ?? true;
  let lastLitHour = -1;
  let baseSunIntensity = 3.05;
  let graphicsQuality: GraphicsQuality = 'balanced';
  let buildingLights = initialState.settings.buildingLights ?? true;
  let currentNightBlend = 0;
  let disposed = false;
  let gridVisible = false;
  let previousTime = 0;
  let elapsed = 0;
  let simulationElapsed = 0;
  let frame = 0;
  let terrainKey = '';
  let latestEvent = initialState.events[0]?.id ?? 0;
  let disasterFlash = 0;
  let shakeRemaining = 0;
  let currentHover: Point | null = null;
  let selected: Point | null = null;
  let dragging = false;
  let spacePan = false;
  let stroke: ConstructionStroke | null = null;
  const interaction = new PointerInteraction();
  let suppressedPointer: number | null = null;
  const size = state.size;
  const half = size / 2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcbded8);
  scene.fog = new THREE.Fog(0xcbded8, Math.max(220, size * 2.9), Math.max(450, size * 5.2));
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Shadow depth belongs to the primary color frame; reflection captures reuse it.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  renderer.transmissionResolutionScale = 0.5;
  const gpuTiming = createGpuTiming(renderer);
  renderer.domElement.className = 'city-canvas';
  function refreshCanvasLabel(): void {
    renderer.domElement.setAttribute(
      'aria-label',
      tr(
        'Interaktive 3D-Stadt. Links bauen, rechts drehen, mit dem Mausrad zoomen.',
        'Interactive 3D city. Left-click to build, right-drag to rotate, and use the mouse wheel to zoom.',
      ),
    );
  }
  refreshCanvasLabel();
  renderer.domElement.setAttribute('tabindex', '0');
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-25, 25, 20, -20, 0.1, Math.max(500, size * 5));
  const postTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: renderer.extensions.has('EXT_color_buffer_float')
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const composer = new EffectComposer(renderer, postTarget);
  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();
  // MSAA covers geometry edges; SMAA also resolves thin facade/roof patterns.
  // r186's SMAA operates in linear color and must precede OutputPass.
  const antialiasPass = renderer.extensions.has('EXT_color_buffer_float') ? new SMAAPass() : null;
  const renderStages = {
    primary: { calls: 0, triangles: 0 },
    occlusion: { calls: 0, triangles: 0 },
  };
  const renderPrimary = renderPass.render.bind(renderPass);
  renderPass.render = (...args) => {
    const calls = renderer.info.render.calls,
      triangles = renderer.info.render.triangles;
    try {
      return metrics.measure('renderPrimary', () => renderPrimary(...args));
    } finally {
      renderStages.primary = {
        calls: renderer.info.render.calls - calls,
        triangles: renderer.info.render.triangles - triangles,
      };
    }
  };
  composer.addPass(renderPass);
  // No screen-space occlusion: it previously produced dark silhouette bands.
  if (antialiasPass) composer.addPass(antialiasPass);
  composer.addPass(outputPass);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.18;
  controls.minZoom = 0.2;
  controls.maxZoom = 7;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.screenSpacePanning = false;
  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.7;
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

  const ambient = new THREE.HemisphereLight(0xe9f5ff, 0x969473, 1.1);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xffedce, 3.05);
  sunlight.position.set(-30, 52, 25);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, {
    left: -34,
    right: 34,
    top: 34,
    bottom: -34,
    near: 1,
    far: Math.max(200, size * 3),
  });
  sunlight.shadow.normalBias = 0.008;
  sunlight.shadow.bias = -0.00005;
  sunlight.shadow.radius = 1.15;
  scene.add(sunlight, sunlight.target);
  const fill = new THREE.DirectionalLight(0xc6e4ff, 0.45);
  fill.position.set(30, 18, -25);
  scene.add(fill);

  const backdropMaterial = new THREE.MeshStandardMaterial({ color: 0xbdd3c9, roughness: 1 });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(size * 5, size * 5), backdropMaterial);
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.y = getTerrainPlateFloor(state) - 0.08;
  backdrop.receiveShadow = false;
  scene.add(backdrop);

  const terrain = new THREE.Group();
  const city = new THREE.Group();
  const live = new THREE.Group();
  scene.add(terrain, city, live);
  const liveInstances = createLiveInstances(live);

  function viewCamera(): THREE.Camera {
    return driving.active ? driving.camera : camera;
  }
  function viewFocus(): THREE.Vector3 {
    return driving.active
      ? (driving.selectedCar?.model.position ?? controls.target)
      : controls.target;
  }

  const citizens = createCitizens(state, (incident) => callbacks.onCitizenIncident?.(incident), {
    container,
    getCamera: () => viewCamera(),
  });
  scene.add(citizens.group);
  const mountedHero = createMountedHero(state);
  scene.add(mountedHero.group);
  const animals = createAnimalSystem(state);
  const streetlights = createStreetlights(state);
  scene.add(animals.group, streetlights.group);
  const metrics = createSceneMetrics();

  const terrainMaterials = createTerrainMaterials();
  const buildingChunks = createBuildingChunks(city, live, terrainMaterials.rock);
  const forests = new THREE.Group();
  const utilities = new THREE.Group();
  const pipeLayer = new THREE.Group();
  pipeLayer.userData.raytracingExclude = true;
  pipeLayer.visible = false;
  scene.add(forests, utilities, pipeLayer);
  const worldChunks = createWorldChunks(terrain, forests, terrainMaterials);
  const waterMaterial = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uNight: { value: 0 },
      uRain: { value: 0 },
    },
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime; uniform float uNight; uniform float uRain; varying vec3 vWorld;
      void main(){
        vec2 p=vWorld.xz;
        float swell=sin(p.x*.65+p.y*.41+uTime*.22)*.5+.5;
        float lines=sin(p.x*4.8+p.y*2.1+sin(p.y*.9+uTime*.3)*.65-uTime*.52);
        float ripple=smoothstep(.93,1.,lines)*.07;
        float glint=pow(max(0.,sin(p.x*2.2+uTime*.31)*sin(p.y*3.8-uTime*.27)),18.)*.20;
        vec3 color=mix(vec3(.11,.37,.44),vec3(.20,.49,.53),swell*.35+.3);
        color+=ripple+glint; color=mix(color,color*vec3(.78,.86,.98),uRain*.35);
        color=mix(color,color*vec3(.22,.36,.53),uNight);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const oceanSize = size + getRegionMargin(size) * 2;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(oceanSize, oceanSize), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = TERRAIN_WATER_LEVEL;
  scene.add(water);
  // One ocean surface covers the playable coastline and its exterior context.
  // No coplanar top faces or opaque administrative water walls interrupt it.
  water.userData.waterSurface = true;
  const lighting = createCityLighting({
    scene,
    renderer,
    sunlight,
    ambient,
    fill,
    worldSize: size,
  });

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let grid: THREE.LineSegments | null = null;
  const gridMaterial = new THREE.LineBasicMaterial({
    color: 0x55614c,
    transparent: true,
    opacity: 0.19,
    depthWrite: false,
  });
  const overlayMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const overlayMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.96, 0.96),
    overlayMaterial,
    size * size,
  );
  overlayMesh.geometry.rotateX(-Math.PI / 2);
  overlayMesh.frustumCulled = false;
  overlayMesh.visible = false;
  overlayMesh.renderOrder = 2;
  scene.add(overlayMesh);
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const ghost = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.94, 0.94),
    ghostMaterial,
    size * size,
  );
  ghost.geometry.rotateX(-Math.PI / 2);
  ghost.frustumCulled = false;
  ghost.renderOrder = 4;
  ghost.count = 0;
  scene.add(ghost);
  const ghostEdges = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xa8ffed,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ghostEdges.renderOrder = 8;
  scene.add(ghostEdges);
  const ghostVolume = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x7dedd2,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
    }),
  );
  ghostVolume.visible = false;
  scene.add(ghostVolume);
  const cursorMaterial = new THREE.MeshBasicMaterial({
    color: 0xf6e4aa,
    transparent: true,
    opacity: 0.98,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cursor = new THREE.Mesh(new THREE.BufferGeometry(), cursorMaterial);
  cursor.visible = false;
  cursor.renderOrder = 10;
  scene.add(cursor);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd577,
    transparent: true,
    opacity: 0.65,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selection = new THREE.Mesh(new THREE.BufferGeometry(), selectionMaterial);
  selection.name = 'selected-ground-outline';
  cursor.name = 'hover-ground-outline';
  selection.visible = false;
  selection.renderOrder = 9;
  scene.add(selection);
  let selectionKey = '';
  function refreshSelection(): void {
    const bounds = selected && selectionBounds(state, selected);
    if (!bounds) {
      selection.visible = false;
      selectionKey = '';
      return;
    }
    const key = `${state.revision}:${bounds.x}:${bounds.z}:${bounds.width}:${bounds.depth}`;
    if (key !== selectionKey) {
      selection.geometry.dispose();
      selection.geometry = createGroundOutline(state, bounds);
      selectionKey = key;
    }
    selection.visible = true;
  }
  for (const helper of [overlayMesh, ghost, ghostEdges, ghostVolume, cursor, selection]) {
    helper.userData.raytracingExclude = true;
    helper.userData.ambientOcclusionExclude = true;
  }

  const weatherEffects = createWeatherEffects(scene, state);
  const recreation = createWaterRecreation(state);
  scene.add(recreation.group);
  const fireEffects = createFireEffects(state);
  live.add(fireEffects.group);
  const cars: Car[] = [];
  let roadNetwork = buildRoadNetwork(state);
  const trafficController = createTrafficController(roadNetwork);
  const trafficSignals = createTrafficSignals(state, roadNetwork.junctions);
  live.add(trafficSignals.group);
  const collisions: VehicleCollision[] = [];
  let trafficSeed = state.seed;
  let fleetSequence = 0;
  let nextAnimalObservation = 0;
  const driving = createDrivingController(state, () => cars, {
    onHover: (info) => callbacks.onVehicleHover?.(info),
    onStatus: (info) => {
      if (!info.active && !disposed) {
        controls.enabled = !dragging && !citizens.holding && suppressedPointer === null;
        citizens.setEnabled(tool === 'citizen');
        lighting.setDriving(false);
        lighting.invalidateReflections();
      }
      callbacks.onDriveStatus?.(info);
    },
    onVehicleSweep: (event) => citizens.sweepVehicleImpact(event),
    onCollision: (event) => {
      collisions.push({ ...event, point: { ...event.point }, normal: { ...event.normal } });
      if (collisions.length > 24) collisions.shift();
      citizens.notifyObservation({
        topic: 'carCrash',
        position: event.point,
        id: `collision-${event.vehicleId}-${event.otherId ?? 'world'}-${Math.floor(elapsed)}`,
      });
    },
  });
  scene.add(driving.group);

  let roadCells: Point[] = [];
  let roadKey = '';
  const boats: { group: THREE.Group; route: Point[]; distance: number; phase: number }[] = [];

  function tileAt(x: number, z: number): Tile | undefined {
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) return undefined;
    return state.tiles[z * state.size + x];
  }

  function makeTerrain() {
    backdrop.position.y = getTerrainPlateFloor(state) - 0.08;
    if (!worldChunks.updateTerrain(state)) return;

    if (grid) {
      disposeGroup(grid);
      grid = null;
    }
    const vertices: number[] = [];
    for (let z = 0; z <= size; z++)
      for (let x = 0; x <= size; x++) {
        const wx = x - half,
          wz = z - half;
        const y = sampleGroundHeight(state, wx + 0.001, wz + 0.001) + 0.035;
        if (x < size)
          vertices.push(
            wx,
            y,
            wz,
            wx + 1,
            sampleGroundHeight(state, wx + 0.999, wz + 0.001) + 0.035,
            wz,
          );
        if (z < size)
          vertices.push(
            wx,
            y,
            wz,
            wx,
            sampleGroundHeight(state, wx + 0.001, wz + 0.999) + 0.035,
            wz + 1,
          );
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    grid = new THREE.LineSegments(geometry, gridMaterial);
    grid.visible = gridVisible;
    grid.userData.raytracingExclude = true;
    scene.add(grid);
    // Same-size shoreline edits and bridges must invalidate cached boat routes too.
    const nextKey = `${state.seed}:${state.size}:${state.tiles.map((t) => (t.kind === 'water' && t.elevation < 0 ? 'w' : '.')).join('')}`;
    if (terrainKey !== nextKey) {
      terrainKey = nextKey;
      setupBoats();
    }
  }

  let powerVisualKey = '';
  let pipesVisualKey = '';
  const pipeMaterial = new THREE.MeshBasicMaterial({
    color: 0x41d4ff,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });
  function updateUtilities() {
    const powerKey = powerLayoutSignature(state);
    if (powerKey !== powerVisualKey) {
      powerVisualKey = powerKey;
      for (const child of [...utilities.children]) disposeGroup(child);
      const layout = getPowerLayout(state);
      utilities.add(createPowerGridModel(state, layout));
      renderer.domElement.dataset.powerPoles = `${layout.poles.length}`;
      renderer.domElement.dataset.powerServices = `${layout.services.length}`;
      lighting.invalidateReflections();
    }
    const cells = state.tiles.filter((t) => t.hasPipe);
    const pipeKey = cells.map((t) => `${t.x}:${t.z}:${t.kind}:${t.elevation}`).join(';');
    if (pipeKey === pipesVisualKey) return;
    pipesVisualKey = pipeKey;
    for (const child of [...pipeLayer.children]) disposeGroup(child);
    const waterSource = new THREE.Group();
    const pipeJoint = new THREE.SphereGeometry(0.065, 6, 4);
    for (const t of cells) {
      const wx = t.x - half + 0.5,
        wz = t.z - half + 0.5,
        ground = t.kind === 'road' ? sampleRoadHeight(state, wx, wz) : Math.max(0, t.elevation);
      const joint = new THREE.Mesh(pipeJoint, pipeMaterial);
      joint.position.set(wx, ground + 0.135, wz);
      waterSource.add(joint);
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        const n = tileAt(t.x + dx, t.z + dz);
        if (!n?.hasPipe) continue;
        const nGround =
          n.kind === 'road' ? sampleRoadHeight(state, wx + dx, wz + dz) : Math.max(0, n.elevation);
        const start = new THREE.Vector3(wx, ground + 0.135, wz),
          end = new THREE.Vector3(wx + dx, nGround + 0.135, wz + dz);
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, start.distanceTo(end), 6),
          pipeMaterial,
        );
        tube.position.copy(start).lerp(end, 0.5);
        tube.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          end.clone().sub(start).normalize(),
        );
        waterSource.add(tube);
      }
    }
    if (waterSource.children.length) {
      const group = batchGroup(waterSource);
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.renderOrder = 5;
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      pipeLayer.add(group);
    }
    waterSource.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== pipeJoint) o.geometry.dispose();
    });
    pipeJoint.dispose();
  }

  function moveCamera(dt: number) {
    if (driving.active || inputBlocked() || dragging || !pressedKeys.size) return;
    let right = 0,
      forward = 0;
    if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) forward++;
    if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) forward--;
    if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) right++;
    if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) right--;
    const view = controls.target.clone().sub(camera.position);
    view.y = 0;
    view.normalize();
    const side = new THREE.Vector3(-view.z, 0, view.x);
    const delta = view
      .multiplyScalar(forward)
      .addScaledVector(side, right)
      .normalize()
      .multiplyScalar((dt * 14) / Math.max(camera.zoom, 0.35));
    controls.target.add(delta);
    camera.position.add(delta);
  }
  function updateSunShadow() {
    const target = viewFocus();
    const clampX = THREE.MathUtils.clamp(target.x, -half, half),
      clampZ = THREE.MathUtils.clamp(target.z, -half, half);
    const sizeVisible = driving.active
      ? 22
      : Math.min(size, Math.max(12, Math.ceil((30 / camera.zoom + 6) / 4) * 4));
    const shadowCam = sunlight.shadow.camera;
    if (Math.abs(shadowCam.right - sizeVisible) > 1) {
      Object.assign(shadowCam, {
        left: -sizeVisible,
        right: sizeVisible,
        top: sizeVisible,
        bottom: -sizeVisible,
        far: Math.max(160, size * 3),
      });
      shadowCam.updateProjectionMatrix();
    }
    lighting.updateAnchor(new THREE.Vector3(clampX, target.y, clampZ));
    const limit = half + 4;
    const cx = THREE.MathUtils.clamp(target.x, -limit, limit),
      cz = THREE.MathUtils.clamp(target.z, -limit, limit);
    if (!driving.active) {
      camera.position.x += cx - target.x;
      camera.position.z += cz - target.z;
      target.x = cx;
      target.z = cz;
    }
    if (shakeRemaining > 0 && !driving.active) {
      camera.position.x += Math.sin(elapsed * 47) * shakeRemaining * 0.018;
      camera.position.z += Math.sin(elapsed * 37) * shakeRemaining * 0.018;
      shakeRemaining = Math.max(0, shakeRemaining - 0.016);
    }
    if (disasterFlash > 0) {
      sunlight.intensity =
        baseSunIntensity + (Math.sin(elapsed * 45) > 0.25 ? disasterFlash * 4 : 0);
      disasterFlash = Math.max(0, disasterFlash - 0.025);
      if (disasterFlash === 0) sunlight.intensity = baseSunIntensity;
    }
  }

  function updateOverlay() {
    overlayMesh.visible = overlay !== 'none';
    pipeLayer.visible = overlay === 'water';
    if (overlay === 'none') return;
    let index = 0;
    for (const tile of state.tiles) {
      if (tile.kind === 'water') continue;
      if (
        (overlay === 'power' || overlay === 'water') &&
        ['empty', 'tree'].includes(tile.kind) &&
        !tile.hasPipe &&
        !tile.hasPowerLine
      )
        continue;
      matrix.makeTranslation(
        tile.x - half + 0.5,
        Math.max(-0.07, tile.elevation) + 0.065,
        tile.z - half + 0.5,
      );
      overlayMesh.setMatrixAt(index, matrix);
      if (overlay === 'power') color.set(tile.powered ? 0xa4d982 : 0xe99084);
      else if (overlay === 'water') color.set(tile.watered ? 0x66c8df : 0xe5a184);
      else if (overlay === 'terrain')
        color.setHSL(0.36 - Math.min(1, Math.max(0, tile.elevation) / 10) * 0.25, 0.45, 0.55);
      else {
        let value =
          overlay === 'landvalue'
            ? tile.landValue / 100
            : overlay === 'pollution'
              ? 1 - tile.pollution / 100
              : 1 - tile.traffic / 100;
        value = THREE.MathUtils.clamp(value, 0, 1);
        color.setHSL(value * 0.31, 0.6, 0.61);
      }
      overlayMesh.setColorAt(index++, color);
    }
    overlayMesh.count = index;
    overlayMesh.instanceMatrix.needsUpdate = true;
    if (overlayMesh.instanceColor) overlayMesh.instanceColor.needsUpdate = true;
  }

  function neighbors(point: Point): Point[] {
    return [
      { x: point.x + 1, z: point.z },
      { x: point.x - 1, z: point.z },
      { x: point.x, z: point.z + 1 },
      { x: point.x, z: point.z - 1 },
    ].filter((point) => tileAt(point.x, point.z)?.kind === 'road');
  }

  function updateRoads() {
    const nextRoads = state.tiles
      .filter((tile) => tile.kind === 'road')
      .map((tile) => ({ x: tile.x, z: tile.z }));
    const nextKey =
      `${state.seed}:` +
      nextRoads
        .map((tile) => `${tile.x},${tile.z},${tileAt(tile.x, tile.z)?.elevation}`)
        .join(';') +
      '|' +
      state.tiles
        .filter((t) => ['fire', 'hospital', 'police'].includes(t.kind))
        .map((t) => `${t.x},${t.z},${t.kind}`)
        .join(';');
    if (roadKey === nextKey) return;
    roadKey = nextKey;
    roadNetwork = buildRoadNetwork(state);
    trafficController.rebuild(roadNetwork);
    trafficSignals.update(state, roadNetwork.junctions);
    trafficSignals.setSignals(trafficController.signalStates());
    roadCells = nextRoads.filter(
      (point) => neighbors(point).length > 0 && !roadNetwork.junctionAt.has(roadPointKey(point)),
    );
    if (trafficSeed !== state.seed) {
      driving.exit();
      for (const car of cars) {
        trafficController.cancel(car.model.id);
        car.model.removeFromParent();
      }
      cars.length = 0;
      trafficSeed = state.seed;
      collisions.length = 0;
    }
    // A surviving vehicle keeps its physical pose; edited routes are repaired at the next boundary.
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      if (driving.controlsCar(car) || (car.service && !car.service.departed)) continue;
      if (
        tileAt(car.from.x, car.from.z)?.kind !== 'road' ||
        tileAt(car.to.x, car.to.z)?.kind !== 'road'
      ) {
        trafficController.cancel(car.model.id);
        car.model.removeFromParent();
        cars.splice(i, 1);
        continue;
      }
      if (
        car.itinerary?.some((p) => !roadNetwork.roads.has(roadPointKey(p))) ||
        (car.movement &&
          roadNetwork.approaches.get(car.movement.approachId)?.junctionId !==
            car.movement.junctionId)
      ) {
        car.itinerary = [];
        car.movement = undefined;
        trafficController.cancel(car.model.id);
      }
    }
    const count = Math.min(70, Math.floor(nextRoads.length / 5), roadCells.length);
    while (cars.filter((car) => !car.service).length > count) {
      let index = cars.length - 1;
      while (index >= 0 && (driving.controlsCar(cars[index]) || cars[index].service)) index--;
      if (index < 0) break;
      trafficController.cancel(cars[index].model.id);
      cars[index].model.removeFromParent();
      cars.splice(index, 1);
    }
    const colors = [0xe5b34d, 0xc4d2cd, 0x537c9b, 0xbc6e58, 0x698c7c, 0xeee3c5, 0x6885ad, 0x994b49];
    const kinds: VehicleKind[] = [
      'sedan',
      'taxi',
      'sedan',
      'van',
      'sedan',
      'truck',
      'sedan',
      'van',
    ];
    const used = new Set(cars.map((car) => roadPointKey(car.from)));
    let attempts = 0;
    while (cars.filter((car) => !car.service).length < count && attempts++ < roadCells.length * 2) {
      const serial = fleetSequence++,
        index = Math.floor(noise(serial, 12, state.seed) * roadCells.length);
      let from = roadCells[index];
      for (let step = 0; step < roadCells.length && used.has(roadPointKey(from)); step++)
        from = roadCells[(index + step + 1) % roadCells.length];
      if (used.has(roadPointKey(from))) break;
      used.add(roadPointKey(from));
      const choices = neighbors(from),
        to = choices[serial % choices.length],
        previous = choices.find((p) => !sameRoadPoint(p, to)) ?? to,
        kind = kinds[serial % kinds.length];
      const model = createDetailedCar(
        kind === 'taxi' ? 0xeac45b : colors[serial % colors.length],
        kind,
      );
      model.userData.vehicleLabel = `${model.userData.vehicleLabel ?? kind} ${String(serial + 1).padStart(2, '0')}`;
      const pose = lanePose(previous, from, to, 0.5),
        wx = pose.x - half,
        wz = pose.z - half;
      model.position.set(wx, sampleRoadHeight(state, wx, wz) + 0.057, wz);
      model.rotation.set(0, pose.yaw, 0, 'YXZ');
      const car: Car = {
        model,
        from,
        to,
        previous,
        progress: 0.5,
        speed: (kind === 'truck' ? 0.25 : 0.34) + noise(serial, 8) * 0.29,
        turn: serial,
      };
      if (cars.some((other) => !!findVehicleContact(carBody(car), carBody(other)))) continue;
      live.add(model);
      cars.push(car);
      prepareTrafficRoute(car, roadNetwork, trafficController, model.id);
    }
  }

  function updateServiceFleet() {
    const routes = listFacilityServiceRoutes(state),
      active = new Set(routes.map((route) => route.id));
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      if (car.service && !active.has(car.service.id) && !driving.controlsCar(car)) {
        trafficController.cancel(car.model.id);
        car.model.removeFromParent();
        cars.splice(i, 1);
      }
    }
    for (const route of routes) {
      const existing = cars.find((car) => car.service?.id === route.id);
      if (existing) {
        const service = existing.service!;
        if (!service.departed && !driving.controlsCar(existing)) {
          // Reconnect a changed driveway only at the current physical position.
          let nearest = 0,
            best = Infinity;
          for (let i = 0; i < route.points.length; i++) {
            const p = route.points[i],
              d = Math.hypot(p.x - existing.model.position.x, p.z - existing.model.position.z);
            if (d < best) {
              nearest = i;
              best = d;
            }
          }
          service.route = best < 0.12 ? route : { ...route, connected: false };
          service.merge = undefined;
          service.index = Math.min(nearest + 1, route.points.length - 1);
        }
        continue;
      }
      const model = createFacilityServiceVehicle(route.kind),
        serial = fleetSequence++;
      const dimensions = getVehicleDimensions(model),
        support = serviceVehicleSupportPose(
          (x, z) => drivingSurfaceHeight(state, x, z),
          route.spawn.x,
          route.spawn.z,
          route.yaw,
          dimensions.wheelBase,
          dimensions.width,
        );
      model.position.set(route.spawn.x, support.y, route.spawn.z);
      model.rotation.set(support.pitch, route.yaw, support.roll, 'YXZ');
      live.add(model);
      const from = route.road ?? {
        x: Math.floor(route.spawn.x + half),
        z: Math.floor(route.spawn.z + half),
      };
      cars.push({
        model,
        from,
        to: route.to ?? from,
        previous: route.previous ?? from,
        progress: 0,
        speed: route.kind === 'firetruck' ? 0.4 : 0.47,
        turn: serial,
        service: { id: route.id, route, index: 1, departed: false, wait: 2 + (serial % 6) },
      });
    }
  }

  function advanceServiceCar(car: Car, step: number, occupants: TrafficVehicle[]): boolean {
    const service = car.service;
    if (!service || service.departed) return false;
    if (service.wait > 0) {
      service.wait = Math.max(0, service.wait - step);
      return true;
    }
    const route = service.route;
    if (!route.connected || !route.road || !route.to || !route.previous) {
      car.model.userData.trafficWaiting = true;
      car.model.userData.trafficWaitReason = 'access';
      return true;
    }
    const before = car.model.position.clone(),
      own = occupants.find((v) => v.id === car.model.id)!;
    const merge = roadNetwork.junctionAt.get(roadPointKey(route.road)),
      end = route.points[route.points.length - 1];
    if (merge && Math.hypot(end.x - before.x, end.z - before.z) < own.halfLength + 0.38) {
      service.merge ??=
        planExternalMovement(roadNetwork, route.road, route.to, car.model.id) ?? undefined;
      if (
        !service.merge ||
        !trafficController.reserveExternal(car.model.id, merge.id, service.merge)
      ) {
        car.model.userData.trafficWaiting = true;
        car.model.userData.trafficWaitReason = 'junction';
        return true;
      }
    }
    let distance = car.speed * step,
      index = service.index,
      point = { x: before.x, y: before.y, z: before.z };
    while (index < route.points.length && distance > 0) {
      const target = route.points[index],
        length = Math.hypot(target.x - point.x, target.z - point.z);
      if (length < 1e-8) {
        index++;
        continue;
      }
      const fraction = Math.min(1, distance / length);
      point = {
        x: point.x + (target.x - point.x) * fraction,
        y: point.y + (target.y - point.y) * fraction,
        z: point.z + (target.z - point.z) * fraction,
      };
      distance -= length * fraction;
      if (fraction === 1) index++;
    }
    const heading = route.points[Math.min(index + 3, route.points.length - 1)] ?? point;
    const yaw =
      Math.hypot(heading.x - point.x, heading.z - point.z) > 0.0001
        ? Math.atan2(heading.x - point.x, heading.z - point.z)
        : lanePose(route.previous, route.road, route.to, 0).yaw;
    const dimensions = getVehicleDimensions(car.model),
      support = serviceVehicleSupportPose(
        (x, z) => drivingSurfaceHeight(state, x, z),
        point.x,
        point.z,
        yaw,
        dimensions.wheelBase,
        dimensions.width,
      );
    const desired = carBody(car, point.x, support.y, point.z, yaw);
    if (cars.some((other) => other !== car && !!findVehicleContact(desired, carBody(other)))) {
      car.model.userData.trafficWaiting = true;
      car.model.userData.trafficWaitReason = 'vehicle';
      return true;
    }
    const previousYaw = car.model.rotation.y;
    service.index = index;
    car.model.position.set(point.x, support.y, point.z);
    car.model.rotation.set(support.pitch, yaw, support.roll, 'YXZ');
    car.model.userData.trafficWaiting = false;
    car.model.userData.trafficWaitReason = null;
    citizens.sweepVehicleImpact({
      previous: before,
      current: car.model.position,
      previousYaw,
      yaw,
      width: dimensions.width,
      length: dimensions.length,
      height: dimensions.height,
      velocity: car.model.position
        .clone()
        .sub(before)
        .multiplyScalar(1 / step),
      vehicleId: car.model.id,
      trafficOnly: true,
    });
    Object.assign(own, { x: point.x + half, z: point.z + half, y: support.y, yaw });
    car.travelled = (car.travelled ?? 0) + before.distanceTo(car.model.position);
    if (index >= route.points.length) {
      service.departed = true;
      car.from = route.road;
      car.to = route.to;
      car.previous = route.previous;
      car.progress = 0;
      car.itinerary = service.merge?.path.slice(2) ?? [];
      car.movement = undefined;
      prepareTrafficRoute(car, roadNetwork, trafficController, car.model.id);
    }
    return true;
  }

  function carBody(
    car: Car,
    x = car.model.position.x,
    y = car.model.position.y,
    z = car.model.position.z,
    yaw = car.model.rotation.y,
  ): VehicleContactBody {
    const dimensions = getVehicleDimensions(car.model);
    return {
      x,
      y,
      z,
      yaw,
      vx: 0,
      vz: 0,
      angularVelocity: 0,
      mass: dimensions.mass,
      halfWidth: dimensions.width / 2 + 0.014,
      halfLength: dimensions.length / 2 + 0.024,
      height: dimensions.height,
    };
  }

  function setupBoats() {
    for (const boat of boats) disposeGroup(boat.group);
    boats.length = 0;
    const cells = state.tiles.filter((tile) => tile.kind === 'water' && neighborsWater(tile));
    if (cells.length < 4) return;
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f1dd, roughness: 0.7 });
    const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x457a92, roughness: 0.5 });
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xcec5ac, roughness: 0.8 });
    for (let index = 0; index < Math.min(5, Math.floor(cells.length / 70)); index++) {
      const tile = cells[Math.floor(noise(index + 8, 77, state.seed) * cells.length)];
      const route = routeForWaterBody(state, tile.x, tile.z, 64);
      if (route.length < 3) continue;
      const group = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.53, 2, 5), hullMaterial);
      hull.rotation.x = Math.PI / 2;
      hull.scale.z = 0.52;
      hull.position.y = -0.065;
      group.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, 0.3), blueMaterial);
      deck.position.set(0, 0.01, 0.035);
      group.add(deck);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.68, 5), mastMaterial);
      mast.position.set(0, 0.31, -0.03);
      group.add(mast);
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0);
      sailShape.lineTo(0, 0.52);
      sailShape.lineTo(0.28, 0.04);
      sailShape.closePath();
      const sail = new THREE.Mesh(
        new THREE.ShapeGeometry(sailShape),
        new THREE.MeshStandardMaterial({
          color: index % 2 ? 0xf1e5cc : 0xe4a87a,
          side: THREE.DoubleSide,
          roughness: 1,
        }),
      );
      sail.position.set(0.01, 0.07, -0.035);
      group.add(sail);
      const pose = sampleWaterRoute(route, 0);
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.heading;
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = true;
      });
      live.add(group);
      boats.push({ group, route, distance: 0, phase: index * 1.76 });
    }
  }

  function neighborsWater(tile: Tile) {
    return [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].every(([dx, dz]) => tileAt(tile.x + dx, tile.z + dz)?.kind === 'water');
  }

  function animateLive(dt: number) {
    const trafficStarted = performance.now();
    const simDt = dt * state.speed,
      steps = Math.max(1, Math.ceil(simDt / 0.025)),
      step = simDt / steps;
    for (const car of cars) {
      const controlled = driving.controlsCar(car);
      if (controlled || car.wasControlled) {
        trafficController.cancel(car.model.id);
        car.movement = undefined;
        car.itinerary = [];
      }
      if (controlled && car.service) car.service.departed = true;
      car.wasControlled = controlled;
    }
    for (let substep = 0; substep < steps; substep++) {
      const occupants: TrafficVehicle[] = cars.map((car) => {
        const b = carBody(car);
        return {
          id: car.model.id,
          x: b.x + half,
          z: b.z + half,
          y: b.y,
          yaw: b.yaw,
          halfWidth: b.halfWidth,
          halfLength: b.halfLength,
          controlled: driving.controlsCar(car),
        };
      });
      trafficController.update(step, occupants);
      // Existing reservations move first; waiting cars never win space by array accident.
      const ordered = [...cars].sort(
        (a, b) =>
          Number(trafficController.hasReservation(b.model.id)) -
          Number(trafficController.hasReservation(a.model.id)),
      );
      for (const car of ordered) {
        if (driving.controlsCar(car) || step <= 0) continue;
        if (advanceServiceCar(car, step, occupants)) continue;
        const previousPosition = car.model.position.clone(),
          previousYaw = car.model.rotation.y;
        const pose = advanceTrafficRoute(
          car,
          car.model.id,
          car.speed,
          step,
          roadNetwork,
          trafficController,
          occupants,
          (x, z) => sampleRoadHeight(state, x - half, z - half) + 0.057,
        );
        const wx = pose.x - half,
          wz = pose.z - half,
          y = sampleRoadHeight(state, wx, wz) + 0.057,
          dx = pose.tangentX,
          dz = pose.tangentZ;
        car.model.userData.trafficWaiting = !!car.waiting;
        car.model.userData.trafficWaitReason = car.waiting;
        car.model.position.set(wx, y, wz);
        const forwardSlope =
          (sampleRoadHeight(state, wx + dx * 0.12, wz + dz * 0.12) -
            sampleRoadHeight(state, wx - dx * 0.12, wz - dz * 0.12)) /
          0.24;
        const rightSlope =
          (sampleRoadHeight(state, wx + dz * 0.12, wz - dx * 0.12) -
            sampleRoadHeight(state, wx - dz * 0.12, wz + dx * 0.12)) /
          0.24;
        car.model.rotation.set(-Math.atan(forwardSlope), pose.yaw, Math.atan(rightSlope), 'YXZ');
        const dimensions = getVehicleDimensions(car.model),
          velocity = car.model.position
            .clone()
            .sub(previousPosition)
            .multiplyScalar(1 / step);
        citizens.sweepVehicleImpact({
          previous: previousPosition,
          current: car.model.position,
          previousYaw,
          yaw: pose.yaw,
          width: dimensions.width,
          length: dimensions.length,
          height: dimensions.height,
          velocity,
          vehicleId: car.model.id,
          trafficOnly: true,
        });
      }
    }
    metrics.record('animateTraffic', performance.now() - trafficStarted);
    trafficSignals.setSignals(trafficController.signalStates());
    for (const boat of boats) {
      if (state.speed === 0) continue;
      boat.distance += Math.min(dt, 0.1) * (0.24 + boat.phase * 0.009) * state.speed;
      const pose = sampleWaterRoute(boat.route, boat.distance);
      boat.group.position.set(
        pose.x,
        Math.sin(simulationElapsed * 1.1 + boat.phase) * 0.012,
        pose.z,
      );
      const turn = Math.atan2(
        Math.sin(pose.heading - boat.group.rotation.y),
        Math.cos(pose.heading - boat.group.rotation.y),
      );
      boat.group.rotation.y += turn * Math.min(1, dt * state.speed * 4);
      boat.group.rotation.z = Math.sin(simulationElapsed * 0.7 + boat.phase) * 0.035;
    }
    fireEffects.animate(elapsed, viewFocus());
    for (const actors of buildingChunks.actors())
      for (const actor of actors) updateFacilityActors(actor, simulationElapsed, state);
    weatherEffects.animate(dt, elapsed, viewFocus(), viewCamera(), container.clientHeight);
    recreation.animate(dt, simulationElapsed, state.speed);
    const nextWet = weatherEffects.isWet();
    if (wetGround !== nextWet) {
      wetGround = nextWet;
      setModelWet(wetGround);
      lighting.invalidateReflections();
    }
    if (selection.visible) selectionMaterial.opacity = 0.58 + Math.sin(elapsed * 2.8) * 0.14;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const intersection = new THREE.Vector3();
  let pointerOcclusionDistance = Infinity;
  let lastPointerEvent: PointerEvent | null = null;
  const pickCameraMatrix = new THREE.Matrix4(),
    pickProjectionMatrix = new THREE.Matrix4();
  let lastCameraPick = 0;
  function pointFromEvent(event: PointerEvent): Point | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, viewCamera());
    const targets: THREE.Object3D[] = [...terrain.children, water];
    if (tool === 'inspect') targets.push(...city.children);
    const hit = raycaster.intersectObjects(targets, true)[0];
    pointerOcclusionDistance = hit?.distance ?? Infinity;
    if (!hit) return null;
    const owner = getBatchTriangleOwner(hit.object, hit.faceIndex);
    if (owner !== null && state.tiles[owner]) {
      const tile = state.tiles[owner];
      return { x: tile.x, z: tile.z };
    }
    intersection.copy(hit.point);
    const x = Math.floor(intersection.x + half),
      z = Math.floor(intersection.z + half);
    return x >= 0 && z >= 0 && x < size && z < size ? { x, z } : null;
  }

  function footprint(point: Point): Point[] {
    return brushFootprint(point, tool, brush, size);
  }
  function buildOptions(): BuildOptions {
    return {
      rotation,
      density: ZONE_TOOLS.has(tool) ? density : undefined,
      targetElevation:
        targetElevation ??
        (tool === 'level' && currentHover
          ? tileAt(currentHover.x, currentHover.z)?.elevation
          : undefined),
    };
  }
  let lastGhostKey = '';
  let lastGhostStroke: ConstructionStroke | null = null;
  let lastPreview: PreviewInfo | null = null;
  function refreshGhost(force = false) {
    if (tool === 'citizen' || driving.active || modalOpen() || !currentHover) {
      lastGhostKey = '';
      lastPreview = null;
      ghost.count = 0;
      ghostEdges.visible = false;
      cursor.visible = false;
      ghostVolume.visible = false;
      callbacks.onPreview?.(null);
      return;
    }
    const key = `${state.revision}:${state.money}:${tool}:${brush}:${rotation}:${targetElevation}:${currentHover.x}:${currentHover.z}:${stroke?.revision}`;
    if (!force && key === lastGhostKey && stroke === lastGhostStroke) {
      callbacks.onPreview?.(
        lastPreview ? { ...lastPreview, screenX: pointerScreen.x, screenY: pointerScreen.y } : null,
      );
      return;
    }
    lastGhostKey = key;
    lastGhostStroke = stroke;
    ghostEdges.visible = true;
    const points =
      stroke?.points ?? (tool !== 'inspect' && tool !== 'pan' ? footprint(currentHover) : []);
    const existingRoads =
      tool === 'road' ? points.filter((p) => tileAt(p.x, p.z)?.kind === 'road') : [];
    const plannedPoints =
      tool === 'road' ? points.filter((p) => tileAt(p.x, p.z)?.kind !== 'road') : points;
    const result = points.length
      ? previewBuild(state, plannedPoints, tool, buildOptions())
      : stroke && tool === 'road'
        ? {
            valid: [],
            invalid: [currentHover],
            count: 0,
            cost: 0,
            message: tr(
              'Keine sichere Straßenverbindung. Starte auf einem freien Feld oder einer Straße.',
              'No safe road connection. Start on a free tile or an existing road.',
            ),
          }
        : null;
    const valid = new Map((result?.valid ?? []).map((p) => [`${p.x}:${p.z}`, p]));
    for (const p of existingRoads) valid.set(`${p.x}:${p.z}`, p);
    const invalid = new Map((result?.invalid ?? []).map((p) => [`${p.x}:${p.z}`, p]));
    const display = new Map([...valid, ...invalid]);
    if (FACILITY_TOOLS.has(tool) && points.length) {
      const [w, d] = getModelFootprint(tool, rotation),
        anchor = points[0];
      for (let z = anchor.z; z < anchor.z + d; z++)
        for (let x = anchor.x; x < anchor.x + w; x++) display.set(`${x}:${z}`, { x, z });
    }
    let index = 0;
    const edges: number[] = [];
    for (const [key, point] of display) {
      if (index >= ghost.instanceMatrix.count) break;
      const tile = tileAt(point.x, point.z);
      let h = Math.max(-0.065, tile?.elevation ?? 0) + 0.065;
      if (tool === 'raise' || tool === 'lower')
        h = Math.max(-0.065, (tile?.elevation ?? 0) + (tool === 'raise' ? 0.5 : -0.5)) + 0.075;
      if (tool === 'level') h = Math.max(-0.065, targetElevation ?? tile?.elevation ?? 0) + 0.075;
      const wx = point.x - half + 0.5,
        wz = point.z - half + 0.5;
      matrix.makeTranslation(wx, h, wz);
      ghost.setMatrixAt(index, matrix);
      const bad =
        invalid.has(key) ||
        !tile ||
        !!(result && result.cost > state.money) ||
        (FACILITY_TOOLS.has(tool) && !!result?.invalid.length);
      color.set(bad ? 0xf07d77 : LINE_TOOLS.has(tool) ? 0x57e6eb : (TOOL_COLORS[tool] ?? 0x99edc5));
      ghost.setColorAt(index++, color);
      const xa = wx - 0.47,
        xb = wx + 0.47,
        za = wz - 0.47,
        zb = wz + 0.47;
      for (const [dx, dz, ax, az, bx, bz] of [
        [0, -1, xa, za, xb, za],
        [0, 1, xa, zb, xb, zb],
        [-1, 0, xa, za, xa, zb],
        [1, 0, xb, za, xb, zb],
      ]) {
        if (!display.has(`${point.x + dx}:${point.z + dz}`))
          edges.push(ax, h + 0.02, az, bx, h + 0.02, bz);
      }
      if (LINE_TOOLS.has(tool)) {
        edges.push(
          wx - 0.15,
          h + 0.025,
          wz,
          wx + 0.15,
          h + 0.025,
          wz,
          wx,
          h + 0.025,
          wz - 0.15,
          wx,
          h + 0.025,
          wz + 0.15,
        );
      }
    }
    ghost.count = index;
    ghost.instanceMatrix.needsUpdate = true;
    if (ghost.instanceColor) ghost.instanceColor.needsUpdate = true;
    ghostEdges.geometry.dispose();
    ghostEdges.geometry = new THREE.BufferGeometry();
    const borderTriangles: number[] = [];
    for (let i = 0; i < edges.length; i += 6) {
      const ax = edges[i],
        ay = edges[i + 1],
        az = edges[i + 2],
        bx = edges[i + 3],
        by = edges[i + 4],
        bz = edges[i + 5];
      const length = Math.hypot(bx - ax, bz - az) || 1,
        ox = (-(bz - az) / length) * 0.024,
        oz = ((bx - ax) / length) * 0.024;
      borderTriangles.push(
        ax - ox,
        ay,
        az - oz,
        bx - ox,
        by,
        bz - oz,
        bx + ox,
        by,
        bz + oz,
        ax - ox,
        ay,
        az - oz,
        bx + ox,
        by,
        bz + oz,
        ax + ox,
        ay,
        az + oz,
      );
    }
    ghostEdges.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(borderTriangles, 3),
    );
    (ghostEdges.material as THREE.MeshBasicMaterial).color.set(
      result?.invalid.length || (result && result.cost > state.money) ? 0xffa199 : 0xadfff0,
    );
    cursor.visible = !!currentHover && tool !== 'pan';
    ghostVolume.visible = false;
    if (currentHover) {
      const fixed = FACILITY_TOOLS.has(tool);
      const anchor = fixed && points.length ? points[0] : currentHover;
      const [w, d] = fixed
        ? getModelFootprint(tool, rotation)
        : [SINGLE_TILE_TOOLS.has(tool) ? 1 : brush, SINGLE_TILE_TOOLS.has(tool) ? 1 : brush];
      const offset = fixed ? 0 : Math.floor((w - 1) / 2);
      const ground = Math.max(-0.06, tileAt(anchor.x, anchor.z)?.elevation ?? 0);
      cursor.geometry.dispose();
      cursor.geometry = createGroundOutline(state, {
        x: anchor.x - offset,
        z: anchor.z - offset,
        width: w,
        depth: d,
      });
      cursorMaterial.color.set(
        result?.invalid.length || (result && result.cost > state.money) ? 0xff9c91 : 0xb3fff0,
      );
      if (fixed && result) {
        ghostVolume.visible = true;
        ghostVolume.scale.set(w - 0.08, 0.35, d - 0.08);
        ghostVolume.position.set(
          anchor.x - half + w / 2 - offset,
          ground + 0.25,
          anchor.z - half + d / 2 - offset,
        );
        (ghostVolume.material as THREE.MeshBasicMaterial).color.copy(cursorMaterial.color);
      }
      lastPreview = result
        ? {
            ...result,
            screenX: pointerScreen.x,
            screenY: pointerScreen.y,
            tool,
            footprint: fixed ? [w, d] : undefined,
            area: ZONE_TOOLS.has(tool) ? (stroke?.area ?? [1, 1]) : undefined,
            elevation: targetElevation ?? tileAt(anchor.x, anchor.z)?.elevation,
          }
        : null;
      callbacks.onPreview?.(lastPreview);
    } else {
      lastPreview = null;
      callbacks.onPreview?.(null);
    }
  }

  function modalOpen(): boolean {
    return !!document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]');
  }

  function overCanvas(event: MouseEvent): boolean {
    const rect = renderer.domElement.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientY >= rect.top &&
      event.clientX < rect.right &&
      event.clientY < rect.bottom &&
      document.elementFromPoint(event.clientX, event.clientY) === renderer.domElement
    );
  }

  function releaseCapture(pointerId: number | null): void {
    if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
      renderer.domElement.releasePointerCapture(pointerId);
  }

  function clearInteraction(): void {
    dragging = false;
    stroke = null;
    targetElevation = undefined;
    controls.enabled = !driving.active && suppressedPointer === null;
  }

  function cancelInteraction(): boolean {
    const pointerId = interaction.cancel(),
      active = pointerId !== null || dragging || citizens.holding;
    citizens.cancel();
    clearInteraction();
    releaseCapture(pointerId);
    currentHover = null;
    renderer.domElement.style.cursor =
      tool === 'pan' ? 'grab' : tool === 'inspect' || tool === 'citizen' ? 'default' : 'crosshair';
    callbacks.onHover(null);
    refreshGhost();
    return active;
  }

  function suppressCanceledPointer(event: PointerEvent): boolean {
    if (suppressedPointer !== event.pointerId) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.buttons === 0) {
      suppressedPointer = null;
      controls.enabled = !driving.active;
    }
    return true;
  }

  function cancelFromRightButton(event: MouseEvent): void {
    if (!interaction.active) return;
    suppressedPointer = interaction.pointerId;
    cancelInteraction();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPointerDown(event: PointerEvent) {
    if (suppressCanceledPointer(event)) return;
    if (interaction.active) {
      if (event.button === 2 || (event.buttons & 2) !== 0) cancelFromRightButton(event);
      else {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (modalOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (driving.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (
      tool === 'pan' ||
      event.button !== 0 ||
      (event.buttons & 2) !== 0 ||
      spacePan ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const point = pointFromEvent(event);
    if (tool === 'citizen') {
      if (
        citizens.pointerDown(
          raycaster.ray,
          camera.getWorldDirection(new THREE.Vector3()),
          event.timeStamp,
        )
      ) {
        renderer.domElement.focus({ preventScroll: true });
        lastPointerEvent = event;
        pickCameraMatrix.copy(camera.matrixWorld);
        pickProjectionMatrix.copy(camera.projectionMatrix);
        interaction.begin(event.pointerId, event.button);
        event.preventDefault();
        event.stopImmediatePropagation();
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        renderer.domElement.style.cursor = citizens.cursor;
      }
      return;
    }
    if (!point) return;
    if (tool === 'inspect') {
      selected = point;
      refreshSelection();
      callbacks.onSelect(point);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    interaction.begin(event.pointerId, event.button);
    controls.enabled = false;
    dragging = true;
    targetElevation = tileAt(point.x, point.z)?.elevation;
    stroke = new ConstructionStroke(
      tool,
      brush,
      size,
      point,
      tool === 'road' ? (start, end) => routeRoad(state, start, end) : undefined,
    );
    currentHover = point;
    renderer.domElement.setPointerCapture(event.pointerId);
    refreshGhost();
  }

  function onPointerMove(event: PointerEvent) {
    lastPointerEvent = event;
    if (suppressCanceledPointer(event)) return;
    if (driving.active) return;
    if (modalOpen()) {
      if (interaction.active) cancelInteraction();
      return;
    }
    if (interaction.active) {
      // Some browsers emit a zero-button move before pointerup. For a captured
      // hand this is a release, not construction-style cancellation to origin.
      if (citizens.holding && interaction.owns(event.pointerId) && event.buttons === 0) {
        finishStroke(event, 0);
        return;
      }
      const movement = interaction.movement(event.pointerId, event.buttons);
      if (movement === 'ignore') return;
      if (movement === 'cancel') {
        if (event.buttons & 2) cancelFromRightButton(event);
        else cancelInteraction();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (!overCanvas(event) && !citizens.holding) {
      currentHover = null;
      callbacks.onHover(null);
      refreshGhost();
      return;
    }
    const point = pointFromEvent(event);
    if (tool === 'citizen') {
      citizens.pointerMove(raycaster.ray, event.timeStamp);
      renderer.domElement.style.cursor = citizens.cursor;
      if (currentHover) {
        currentHover = null;
        callbacks.onHover(null);
      }
      refreshGhost();
      return;
    }
    if (tool === 'inspect' || tool === 'pan') {
      raycaster.far = pointerOcclusionDistance + 0.15;
      driving.hover(raycaster, camera, renderer.domElement.getBoundingClientRect());
      raycaster.far = Infinity;
    }
    if (point?.x !== currentHover?.x || point?.z !== currentHover?.z) callbacks.onHover(point);
    currentHover = point;
    if (stroke && point) stroke.update(point);
    refreshGhost();
  }

  function finishStroke(event: PointerEvent, releasedButton = event.button) {
    if (suppressCanceledPointer(event)) return;
    if (!interaction.owns(event.pointerId)) return;
    if (releasedButton !== 0) {
      if (releasedButton === 2 || (event.buttons & 2) !== 0) cancelFromRightButton(event);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    // Pointer capture belongs to the held person even over the HUD or outside
    // the canvas. Construction still requires an actual canvas release.
    const allowed =
      !modalOpen() && (citizens.holding || overCanvas(event)) && (event.buttons & 2) === 0;
    const point = allowed ? pointFromEvent(event) : null;
    const outcome = interaction.release(
      event.pointerId,
      releasedButton,
      allowed && (citizens.holding || !!point),
    );
    if (outcome !== 'commit') {
      cancelInteraction();
      releaseCapture(event.pointerId);
      return;
    }
    if (citizens.holding) {
      citizens.pointerMove(raycaster.ray, event.timeStamp);
      citizens.pointerUp(event.timeStamp);
      clearInteraction();
      releaseCapture(event.pointerId);
      renderer.domElement.style.cursor = citizens.cursor;
      return;
    }
    // A fast drag may finish in a tile that has not emitted a pointermove yet.
    if (point) {
      currentHover = point;
      stroke?.update(point);
    }
    const points = stroke?.points ?? [],
      options = buildOptions();
    clearInteraction();
    releaseCapture(event.pointerId);
    if (points.length) callbacks.onPaint(points, options);
    refreshGhost();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (interaction.owns(event.pointerId)) cancelInteraction();
    if (suppressedPointer === event.pointerId) {
      suppressedPointer = null;
      controls.enabled = !driving.active;
    }
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (interaction.owns(event.pointerId)) cancelInteraction();
  }

  function onMouseDown(event: MouseEvent): void {
    // Browsers emit mousedown, not a second pointerdown, for an RMB/LMB chord.
    if (event.button === 2) cancelFromRightButton(event);
  }

  function onPointerLeave() {
    driving.leaveHover();
    if (citizens.holding) return;
    lastPointerEvent = null;
    citizens.clearHover();
    if (dragging) return;
    currentHover = null;
    refreshGhost();
    callbacks.onHover(null);
  }

  function inputBlocked(event?: KeyboardEvent) {
    const target = event?.target ?? document.activeElement;
    return (
      (target instanceof Element &&
        !!target.closest(
          'button,a,[role="button"],input,textarea,select,[contenteditable="true"]',
        )) ||
      modalOpen()
    );
  }
  function onKeyDown(event: KeyboardEvent) {
    if (inputBlocked(event)) return;

    if (driving.active) {
      if (event.code === 'Escape') {
        exitDrive();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (driving.keyDown(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (['AltLeft', 'AltRight'].includes(event.code)) {
      spacePan = true;
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    }
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
        event.code,
      )
    ) {
      pressedKeys.add(event.code);
      event.preventDefault();
    }
  }
  function onKeyUp(event: KeyboardEvent) {
    driving.keyUp(event.code);
    pressedKeys.delete(event.code);
    if (['AltLeft', 'AltRight'].includes(event.code)) {
      spacePan = false;
      controls.mouseButtons.LEFT = tool === 'pan' ? THREE.MOUSE.PAN : null;
    }
  }
  function onBlur() {
    for (const code of [
      'KeyW',
      'KeyS',
      'KeyA',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
    ])
      driving.keyUp(code);
    pressedKeys.clear();
    spacePan = false;
    suppressedPointer = null;
    controls.mouseButtons.LEFT = tool === 'pan' ? THREE.MOUSE.PAN : null;
    cancelInteraction();
  }
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    cancelFromRightButton(event);
  }
  function onHeldWheel(event: WheelEvent) {
    if (!citizens.holding || modalOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pixels =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
    camera.zoom = THREE.MathUtils.clamp(
      camera.zoom * Math.exp(-pixels * 0.001),
      controls.minZoom,
      controls.maxZoom,
    );
    camera.updateProjectionMatrix();
    rebaseHeldCamera();
  }
  function rebaseHeldCamera() {
    if (!citizens.holding || !lastPointerEvent) return;
    pointFromEvent(lastPointerEvent);
    citizens.rebaseHeldCamera(
      raycaster.ray,
      camera.getWorldDirection(new THREE.Vector3()),
      performance.now(),
    );
    pickCameraMatrix.copy(camera.matrixWorld);
    pickProjectionMatrix.copy(camera.projectionMatrix);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
  renderer.domElement.addEventListener('pointermove', onPointerMove, true);
  renderer.domElement.addEventListener('mousedown', onMouseDown, true);
  renderer.domElement.addEventListener('lostpointercapture', onLostPointerCapture);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('contextmenu', onContextMenu, true);
  renderer.domElement.addEventListener('wheel', onHeldWheel, { capture: true, passive: false });
  window.addEventListener('pointerup', finishStroke, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onBlur);

  function resize() {
    const width = Math.max(container.clientWidth, 1),
      height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    driving.resize(width, height);

    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    const viewHeight = 34;
    const viewWidth = (viewHeight * width) / height;
    // Keep the orbit target centred at every zoom and after viewport changes.
    // An asymmetric orthographic frustum shifts its centre independently of zoom.
    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    controls.minZoom = overviewZoom();
    camera.zoom = Math.max(camera.zoom, controls.minZoom);
    camera.updateProjectionMatrix();
  }

  function overviewZoom() {
    const spanX = camera.right - camera.left,
      spanY = camera.top - camera.bottom;
    return Math.min(spanX / (size * 1.52), spanY / (size * 1.16));
  }

  function resetCamera() {
    if (driving.active) exitDrive();
    const occupied = state.tiles.filter(
      (t) => ['residential', 'commercial', 'industrial'].includes(t.kind) && t.level > 0,
    );
    const showcase = state.seed === 6092026 && size === 128;
    const x = showcase
      ? 64
      : occupied.length
        ? occupied.reduce((n, t) => n + t.x, 0) / occupied.length
        : size * 0.38;
    const z = showcase
      ? 51
      : occupied.length
        ? occupied.reduce((n, t) => n + t.z, 0) / occupied.length
        : size * 0.44;
    const tx = x - half + 0.5,
      tz = z - half + 0.5,
      ty = Math.max(0, tileAt(Math.round(x), Math.round(z))?.elevation ?? 0);
    controls.target.set(tx, ty, tz);
    // Orthographic zoom changes the visible span, not the camera distance. Keep
    // the whole region in front of its near plane even after zooming far out.
    const offset = new THREE.Vector3(-42, 42, 48);
    offset.setLength(Math.max(offset.length(), size * 1.75));
    camera.position.copy(controls.target).add(offset);
    camera.zoom = showcase ? 0.62 : 1.05;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function overview() {
    if (driving.active) exitDrive();
    controls.target.set(0, 0, 0);
    camera.position.set(-size, size, size * 1.14);
    camera.zoom = overviewZoom();
    camera.updateProjectionMatrix();
    controls.update();
  }

  function applyDaylight(force = false) {
    if (!force && Math.abs(timeOfDay - lastLitHour) < 0.02) return;
    lastLitHour = timeOfDay;
    const profile = lighting.setTime(timeOfDay);
    baseSunIntensity = sunlight.intensity;
    backdropMaterial.color.copy(profile.background);
    waterMaterial.uniforms.uNight.value = profile.nightBlend;
    renderer.toneMappingExposure = profile.exposure;
    currentNightBlend = profile.nightBlend;
    setModelNightBlend(buildingLightIntensity(currentNightBlend, buildingLights));
    streetlights.setLighting(currentNightBlend, buildingLights);
  }
  function setTimeOfDay(hour: number) {
    timeOfDay = (((Number.isFinite(hour) ? hour : 14) % 24) + 24) % 24;
    state.settings.timeOfDay = timeOfDay;
    applyDaylight(true);
  }
  function setBuildingLights(enabled: boolean) {
    buildingLights = enabled;
    state.settings.buildingLights = enabled;
    setModelNightBlend(buildingLightIntensity(currentNightBlend, enabled));
    streetlights.setLighting(currentNightBlend, enabled);
  }
  function setDayNightCycle(enabled: boolean) {
    dayNightCycle = enabled;
    state.settings.dayNightCycle = enabled;
  }
  function setNight(value: boolean) {
    setDayNightCycle(false);
    setTimeOfDay(value ? 21 : 14);
  }

  function enterDrive(id: number): boolean {
    if (disposed) return false;

    cancelInteraction();
    driving.clearHover();
    pressedKeys.clear();
    if (!driving.enter(id)) return false;
    citizens.setEnabled(false);
    currentHover = null;
    selection.visible = false;
    controls.enabled = false;
    renderer.domElement.style.cursor = 'default';
    callbacks.onHover(null);
    callbacks.onPreview?.(null);
    lighting.setDriving(true);
    lighting.invalidateReflections();
    refreshGhost();
    renderer.domElement.focus();
    return true;
  }
  function exitDrive() {
    if (!driving.active) return;
    driving.exit();
    controls.enabled = true;
    citizens.setEnabled(tool === 'citizen');
    pressedKeys.clear();
    lighting.setDriving(false);
    lighting.invalidateReflections();
    refreshGhost();
  }

  function setWeather(value: Weather) {
    weather = value;
    if (value === 'rain') wetGround = true;
    setModelWet(wetGround);
    waterMaterial.uniforms.uRain.value = value === 'rain' ? 1 : 0;
    weatherEffects.setWeather(value);
    lighting.invalidateReflections();
  }

  function setGraphicsQuality(value: GraphicsQuality) {
    graphicsQuality = value;
    renderer.transmissionResolutionScale =
      value === 'ultra' ? 0.75 : value === 'performance' ? 0.25 : 0.5;
    lighting.setQuality(value);
    streetlights.setQuality(value);
    const ratio = value === 'performance' ? 1 : value === 'ultra' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    const shadowSize = value === 'performance' ? 1024 : value === 'ultra' ? 4096 : 2048;
    if (sunlight.shadow.mapSize.x !== shadowSize) {
      sunlight.shadow.mapSize.set(shadowSize, shadowSize);
      sunlight.shadow.map?.dispose();
      sunlight.shadow.map = null;
      sunlight.shadow.needsUpdate = true;
    }
    resize();
  }

  function renderRealtime() {
    metrics.measure('liveInstances', () => {
      const changed = liveInstances.synchronize([
        ...cars.map((car) => car.model),
        ...buildingChunks.actors().flat(),
      ]);
      if (changed) streetlights.applyTo(liveInstances.group);
    });
    renderer.shadowMap.needsUpdate = true;
    applyStableShadowFiltering(scene);
    if (graphicsQuality === 'performance') renderer.render(scene, viewCamera());
    else {
      renderPass.camera = viewCamera();
      composer.render();
    }
  }

  let chunksInitial = true;
  function update(next: CityState) {
    const updateStarted = performance.now();
    state = next;
    metrics.measure('citizens', () => citizens.update(state));
    metrics.measure('mountedHero', () => mountedHero.update(state));
    metrics.measure('animals', () => animals.update(state));
    metrics.measure('streetlights', () => streetlights.update(state));
    metrics.measure('terrain', () => makeTerrain());
    metrics.measure('buildings', () => buildingChunks.update(state, chunksInitial));
    metrics.measure('forests', () => worldChunks.updateLandscape(state));
    metrics.measure('utilities', () => updateUtilities());
    metrics.measure('roads', () => updateRoads());
    metrics.measure('services', () => updateServiceFleet());
    driving.setState(state);

    if (!driving.active && !dragging && !citizens.holding && suppressedPointer === null)
      controls.enabled = true;
    lighting.invalidateReflections();
    dayNightCycle = state.settings.dayNightCycle;
    if (buildingLights !== state.settings.buildingLights)
      setBuildingLights(state.settings.buildingLights);
    if (Math.abs(timeOfDay - state.settings.timeOfDay) > 0.025) {
      timeOfDay = state.settings.timeOfDay;
      applyDaylight(true);
    }
    weatherEffects.update(state);
    recreation.update(state);
    fireEffects.update(state);
    streetlights.applyTo(scene);
    const event = state.events[0];
    if (event && event.id !== latestEvent) {
      latestEvent = event.id;
      if (/Erdbeben|Erdstoß/i.test(event.title)) shakeRemaining = 1.3;
      if (/Sturm|Gewitter/i.test(event.title)) disasterFlash = 1.1;
    }
    if (weather !== state.settings.weather) setWeather(state.settings.weather);
    updateOverlay();
    refreshGhost();
    refreshSelection();
    chunksInitial = false;
    metrics.record('update', performance.now() - updateStarted);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  resetCamera();
  setModelWet(wetGround);
  applyDaylight(true);
  update(state);

  const audioPosition = new THREE.Vector3(),
    audioRight = new THREE.Vector3();
  let requestId = 0;
  const shouldRenderFrame = createFrameLimiter(60);
  const workFrustum = new THREE.Frustum(),
    workProjection = new THREE.Matrix4();
  function animate(timestamp: number) {
    if (disposed) return;
    if (!shouldRenderFrame(timestamp)) {
      requestId = requestAnimationFrame(animate);
      return;
    }
    const frameStarted = performance.now();
    metrics.record('frameInterval', timestamp - previousTime);
    workFrustum.setFromProjectionMatrix(
      workProjection.multiplyMatrices(
        viewCamera().projectionMatrix,
        viewCamera().matrixWorldInverse,
      ),
    );
    metrics.measure('buildingWork', () => buildingChunks.process(4, viewFocus(), workFrustum));
    renderer.info.reset();
    const dt = Math.min((timestamp - previousTime) / 1000 || 0, 0.05);
    previousTime = timestamp;
    {
      elapsed += dt;
      if (state.speed > 0) {
        simulationElapsed += dt * state.speed;
        if (dayNightCycle) {
          timeOfDay = (timeOfDay + dt * 0.1) % 24;
          state.settings.timeOfDay = timeOfDay;
          applyDaylight();
        }
      }
      waterMaterial.uniforms.uTime.value = elapsed;
      metrics.measure('animateLive', () => animateLive(dt));
      if (inputBlocked())
        for (const code of [
          'KeyW',
          'KeyS',
          'KeyA',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
        ])
          driving.keyUp(code);
      metrics.measure('animateDriving', () => driving.update(dt));

      metrics.measure('animateCitizens', () =>
        citizens.animate(dt, state.speed > 0 && !modalOpen(), timeOfDay),
      );
      const driven = driving.selectedCar,
        driveSpeed = Math.abs(driving.getStatus().speed) / 36;
      animals.setVehicle(
        driven
          ? { x: driven.model.position.x, z: driven.model.position.z, speed: driveSpeed }
          : null,
      );
      const focus = viewFocus();
      metrics.measure('animateAnimals', () => animals.animate(dt, elapsed, focus));
      metrics.measure('animateStreetlights', () => streetlights.animate(dt, focus));
      if (elapsed >= nextAnimalObservation) {
        nextAnimalObservation = elapsed + 7;
        for (const animal of animals.getObservations())
          citizens.notifyObservation({
            topic: animal.species === 'cat' || animal.species === 'dog' ? 'pets' : 'wildlife',
            position: {
              x: animal.x,
              y: sampleGroundHeight(state, animal.x, animal.z),
              z: animal.z,
            },
            id: `${animal.species}-${Math.round(animal.x * 10)}-${Math.round(animal.z * 10)}`,
          });
      }
    }
    mountedHero.animate(dt, state.speed > 0 && !modalOpen());
    moveCamera(dt);
    if (!driving.active) controls.update();
    if (
      citizens.holding &&
      (pickCameraMatrix.elements.some(
        (v, i) => Math.abs(v - camera.matrixWorld.elements[i]) > 1e-7,
      ) ||
        pickProjectionMatrix.elements.some(
          (v, i) => Math.abs(v - camera.projectionMatrix.elements[i]) > 1e-7,
        ))
    )
      rebaseHeldCamera();
    if (
      lastPointerEvent &&
      !interaction.active &&
      !citizens.holding &&
      !modalOpen() &&
      !driving.active &&
      timestamp - lastCameraPick >= 50 &&
      (!pickCameraMatrix.equals(camera.matrixWorld) ||
        !pickProjectionMatrix.equals(camera.projectionMatrix))
    ) {
      pickCameraMatrix.copy(camera.matrixWorld);
      pickProjectionMatrix.copy(camera.projectionMatrix);
      lastCameraPick = timestamp;
      onPointerMove(lastPointerEvent);
    }
    updateSunShadow();
    gpuTiming.begin();
    try {
      metrics.measure('render', () => renderRealtime());
    } finally {
      gpuTiming.end();
    }
    // Keep optional sky-environment filtering behind the normal shadow render.
    lighting.refreshReflections(viewFocus());
    if (++frame % 120 === 0) {
      renderer.domElement.dataset.drawCalls = `${renderer.info.render.calls}`;
      renderer.domElement.dataset.triangles = `${renderer.info.render.triangles}`;
      const crowd = citizens.getDebug();
      renderer.domElement.dataset.citizens = `${crowd.count}`;
      renderer.domElement.dataset.ragdolls = `${crowd.ragdolls}`;
      renderer.domElement.dataset.animals = `${animals.getDebug().count}`;
      renderer.domElement.dataset.streetlights = `${streetlights.getDebug().litCount}`;
    }
    metrics.record('frameWork', performance.now() - frameStarted);
    requestId = requestAnimationFrame(animate);
  }
  requestId = requestAnimationFrame(animate);

  return {
    cancelInteraction,
    getDiagnostics() {
      const activeCamera = viewCamera();
      return {
        camera: {
          mode: driving.active ? 'driving' : 'city',
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
          zoom: camera.zoom,
          frustum: {
            left: camera.left,
            right: camera.right,
            top: camera.top,
            bottom: camera.bottom,
            near: camera.near,
            far: camera.far,
          },
          targetNdc: controls.target.clone().project(camera).toArray(),
          cityCenterNdc: new THREE.Vector3(0, 0, 0).project(camera).toArray(),
          controlsEnabled: controls.enabled,
          polarAngle: controls.getPolarAngle(),
          azimuthalAngle: controls.getAzimuthalAngle(),
          activePosition: activeCamera.position.toArray(),
          activeDirection: activeCamera.getWorldDirection(new THREE.Vector3()).toArray(),
        },
        performance: metrics.snapshot(),
        buildingQueue: buildingChunks.diagnostics(),
        liveInstances: liveInstances.diagnostics(),
        renderStages,
        mountedHero: mountedHero.getDebug(),
        gpu: gpuTiming.snapshot(),
        render: {
          engine: `Three.js r${THREE.REVISION}`,
          antialiasing:
            graphicsQuality === 'performance' ? 'MSAA' : antialiasPass ? 'MSAA + SMAA' : 'MSAA',
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
        },
        cars: cars.map((car) => ({
          id: car.model.id,
          x: car.model.position.x,
          y: car.model.position.y,
          z: car.model.position.z,
          yaw: car.model.rotation.y,
          kind: car.model.userData.vehicleKind,
          label: car.model.userData.vehicleLabel,
          dimensions: getVehicleDimensions(car.model),
          controlled: driving.controlsCar(car),
          waiting: !!car.model.userData.trafficWaiting,
          waitReason: car.waiting,
          travelled: car.travelled ?? 0,
          from: car.from,
          to: car.to,
          progress: car.progress,
          service: car.service
            ? {
                id: car.service.id,
                departed: car.service.departed,
                connected: car.service.route.connected,
              }
            : null,
        })),
        traffic: trafficController.getDebug(),
        trafficSignals: trafficSignals.getDebug(),
        citizens: citizens.getDebug(),
        animals: animals.getDebug(),
        recreation: recreation.getDebug(),
        streetlights: streetlights.getDebug(),
        weather: weatherEffects.getDebug(),
        fires: fireEffects.getDebug(),
        driving: driving.getStatus(),
        collisions: collisions.map((event) => ({
          ...event,
          point: { ...event.point },
          normal: { ...event.normal },
        })),
      };
    },
    getAudioState(): AudioSceneState {
      const activeCamera = viewCamera(),
        listener = viewFocus();
      audioRight.setFromMatrixColumn(activeCamera.matrixWorld, 0);
      const aircraft: { x: number; z: number; altitude: number; active: boolean }[] = [];
      for (const actors of buildingChunks.actors())
        for (const actor of actors) {
          const plane = actor.getObjectByName('aircraft');
          if (plane) {
            plane.getWorldPosition(audioPosition);
            aircraft.push({
              x: audioPosition.x,
              z: audioPosition.z,
              altitude: audioPosition.y,
              active: state.speed > 0,
            });
          }
        }
      const status = driving.getStatus();
      return {
        listener: { x: listener.x, z: listener.z },
        listenerRight: { x: audioRight.x, z: audioRight.z },
        vehicles: cars.map((car) => ({
          id: String(car.model.id),
          x: car.model.position.x,
          z: car.model.position.z,
          speed: driving.controlsCar(car)
            ? Math.abs(status.speed) / 3.6
            : state.speed === 0 ||
                car.model.userData.trafficWaiting ||
                (car.service && !car.service.departed && car.service.wait > 0)
              ? 0
              : car.speed * state.speed,
          siren: car.model.userData.vehicleKind === 'ambulance' && !!car.service?.departed,
        })),
        windTurbines: state.tiles
          .filter((tile) => tile.kind === 'wind' && isBuildingAnchor(state, tile))
          .map((tile) => ({ x: tile.x - half + 0.5, z: tile.z - half + 0.5 })),
        aircraft,
        water: boats.map((boat) => ({ x: boat.group.position.x, z: boat.group.position.z })),
        cityActivity: Math.min(1, state.stats.population / 120000),
        driving: driving.active
          ? {
              speed: Math.abs(status.speed) / 3.6,
              throttle: pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp') ? 1 : 0,
            }
          : undefined,
        rain: weather === 'rain' ? 1 : 0,
        wind: 0.35,
        night: currentNightBlend > 0.5,
        paused: state.speed === 0,
      };
    },
    getInteractionTargets() {
      const activeCamera = viewCamera();
      activeCamera.updateMatrixWorld();
      const rect = renderer.domElement.getBoundingClientRect();
      function projected(id: number, x: number, y: number, z: number) {
        const p = new THREE.Vector3(x, y, z).project(activeCamera);
        if (
          !Number.isFinite(p.x) ||
          p.x < -1 ||
          p.x > 1 ||
          p.y < -1 ||
          p.y > 1 ||
          p.z < -1 ||
          p.z > 1
        )
          return null;
        return {
          id,
          screenX: rect.left + ((p.x + 1) * rect.width) / 2,
          screenY: rect.top + ((1 - p.y) * rect.height) / 2,
        };
      }
      return {
        cars: cars
          .map((c) =>
            projected(
              c.model.id,
              c.model.position.x,
              c.model.position.y + 0.08,
              c.model.position.z,
            ),
          )
          .filter((p): p is NonNullable<typeof p> => p !== null),
        citizens: citizens
          .getDebug()
          .positions.map((c) => projected(c.id, c.x, c.y + 0.1, c.z))
          .filter((p): p is NonNullable<typeof p> => p !== null),
      };
    },
    update,
    refreshLocale() {
      refreshCanvasLabel();
      driving.refreshLocale();
      citizens.refreshLocale();
      callbacks.onHover(currentHover);
      refreshGhost(true);
    },
    setTool(nextTool, nextBrush, nextRotation = 0, nextDensity) {
      if (driving.active) exitDrive();
      driving.clearHover();
      cancelInteraction();
      tool = nextTool;
      citizens.setEnabled(nextTool === 'citizen');
      brush = Math.max(1, Math.min(12, Math.floor(nextBrush)));
      rotation = nextRotation;
      if (nextDensity) density = nextDensity;
      controls.mouseButtons.LEFT = nextTool === 'pan' ? THREE.MOUSE.PAN : null;
      renderer.domElement.style.cursor =
        nextTool === 'pan'
          ? 'grab'
          : nextTool === 'inspect' || nextTool === 'citizen'
            ? 'default'
            : 'crosshair';
      refreshGhost();
    },
    setOverlay(value) {
      overlay = value;
      updateOverlay();
    },
    setNight,
    setTimeOfDay,
    setDayNightCycle,
    setBuildingLights,
    getTimeOfDay: () => timeOfDay,
    enterDrive,
    exitDrive,
    getCitizenLife: () => citizens.getLife(),
    triggerCitizenEvent(kind) {
      const near = selected
        ? { x: selected.x - half + 0.5, z: selected.z - half + 0.5 }
        : controls.target;
      return citizens.triggerEvent(kind, near);
    },
    focusCitizenEvent() {
      const event = citizens.getLife().event;
      if (!event) return;
      if (driving.active) exitDrive();
      const target = new THREE.Vector3(
        event.x,
        sampleGroundHeight(state, event.x, event.z) + 0.12,
        event.z,
      );
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      camera.zoom = Math.min(controls.maxZoom, 5);
      camera.updateProjectionMatrix();
      controls.update();
    },
    stopCitizenEvent: () => citizens.stopEvent(),
    getDrivingStatus: () => driving.getStatus(),
    setWeather,
    setGraphicsQuality,
    setGrid(show) {
      gridVisible = show;
      if (grid) grid.visible = show;
    },
    zoom(direction) {
      camera.zoom = THREE.MathUtils.clamp(
        camera.zoom * (direction > 0 ? 1.22 : 1 / 1.22),
        controls.minZoom,
        controls.maxZoom,
      );
      camera.updateProjectionMatrix();
    },
    rotate(direction) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (direction * Math.PI) / 4);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    resetCamera,
    overview,
    focus(x, z) {
      if (driving.active) exitDrive();
      x = THREE.MathUtils.clamp(Math.floor(x), 0, size - 1);
      z = THREE.MathUtils.clamp(Math.floor(z), 0, size - 1);
      const target = new THREE.Vector3(
        x - half + 0.5,
        Math.max(0, tileAt(x, z)?.elevation ?? 0),
        z - half + 0.5,
      );
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      camera.zoom = Math.max(camera.zoom, 1.8);
      camera.updateProjectionMatrix();
      controls.update();
      selected = { x, z };
      refreshSelection();
    },
    focusBuilding(x, z) {
      if (driving.active) exitDrive();
      const clicked = tileAt(Math.floor(x), Math.floor(z));
      if (!clicked) return;
      const tile = clicked.anchor >= 0 ? state.tiles[clicked.anchor] : clicked;
      if (!tile) return;
      const cells = getFootprint(state, tile),
        bounds = cells.length ? cells : [tile];
      const minX = Math.min(...bounds.map((p) => p.x)),
        minZ = Math.min(...bounds.map((p) => p.z));
      const width = Math.max(...bounds.map((p) => p.x)) - minX + 1,
        depth = Math.max(...bounds.map((p) => p.z)) - minZ + 1;
      const ground = Math.max(0, tile.elevation),
        target = new THREE.Vector3(minX - half + width / 2, ground + 0.55, minZ - half + depth / 2);
      // Keep the office's facade and rooftop visible from its street-facing side.
      controls.minPolarAngle = Math.min(controls.minPolarAngle, 0.035);
      // A short orbit radius clips foreground terrain behind the near plane
      // when the user zooms out after leaving the separate building preview.
      // Distance does not change orthographic framing; zoom still fits the lot.
      const offset = new THREE.Vector3(-5.5, 8, 8)
        .setLength(Math.max(32, size * 1.75))
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), (-tile.rotation * Math.PI) / 2);
      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      camera.zoom = THREE.MathUtils.clamp(
        Math.min(
          (camera.right - camera.left) / (Math.max(width, depth) * 2.1),
          (camera.top - camera.bottom) / (Math.max(width, depth) * 1.75),
        ),
        controls.minZoom,
        controls.maxZoom,
      );
      // The ordinary city view has an asymmetric frustum for its sidebar layout.
      // Its center is NOT divided by zoom by Three.js, so at close-up zoom a point
      // on the orbit target can project beyond the right edge. Center the close-up
      // frustum, keeping the true building center as the orbit pivot.
      const viewWidth = camera.right - camera.left;
      const viewHeight = camera.top - camera.bottom;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      controls.update();
      selected = { x: tile.x, z: tile.z };
      refreshSelection();
      callbacks.onSelect(selected);
    },
    screenshot() {
      renderRealtime();
      return renderer.domElement.toDataURL('image/png');
    },
    dispose() {
      renderer.domElement.removeEventListener('wheel', onHeldWheel, true);
      cancelInteraction();
      disposed = true;
      liveInstances.dispose();
      buildingChunks.dispose();
      cancelAnimationFrame(requestId);
      observer.disconnect();
      controls.dispose();
      outputPass.dispose();
      antialiasPass?.dispose();
      composer.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('pointermove', onPointerMove, true);
      renderer.domElement.removeEventListener('mousedown', onMouseDown, true);
      renderer.domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('pointerup', finishStroke, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      recreation.dispose();
      citizens.dispose();
      mountedHero.dispose();
      animals.dispose();
      streetlights.dispose();
      fireEffects.dispose();
      trafficSignals.dispose();

      driving.dispose();
      lighting.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          if (object instanceof THREE.InstancedMesh) object.dispose();
          materials.forEach((material) => {
            if (!material.userData.easterEggShared) material.dispose();
          });
        }
      });
      weatherEffects.dispose();
      gpuTiming.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
