import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTileModel, setModelNightBlend, setModelWet, getModelFootprint, createFacilityActors, updateFacilityActors } from './models';
import { previewBuild, getFootprint, isBuildingAnchor } from './simulation';
import { createWeatherEffects } from './weather-graphics';
import { createFireEffects } from './fire-effects';
import { createCitizens } from './citizens';
import { createDrivingController, getVehicleDimensions, type VehicleCollision } from './driving';
import { findVehicleContact, type VehicleContactBody } from './vehicle-contacts';
import { createDetailedCar, type VehicleKind } from './vehicle-model';
import { createAnimalSystem } from './animals';
import { createStreetlights, removeLegacyStreetlight } from './streetlights';
import { applyStableShadowFiltering, createCityLighting } from './lighting';
import { sampleRoadHeight, warpRoadModel } from './road-graphics';
import { getPowerLayout, powerLayoutSignature } from './power-layout';
import { createPowerGridModel } from './power-model';
import { createRegionContext, getRegionMargin } from './region-context';
import { buildTerrainChunk, buildTerrainSkirt, createTerrainMaterials, terrainChunkSignature, sampleGroundHeight } from './terrain-graphics';
import type { CityState, CitySceneApi, SceneCallbacks, Point, Tool, Overlay, Tile, Weather, BuildOptions } from './types';
import { tr } from './i18n';

type GraphicsQuality='performance'|'balanced'|'ultra';

/** The switch controls building illumination independently of the sun or clock. */
export function buildingLightIntensity(nightBlend:number,enabled:boolean):number {
  return enabled ? .18 + .82 * THREE.MathUtils.clamp(Number.isFinite(nightBlend)?nightBlend:0,0,1) : 0;
}

const CHUNK = 16;
const SINGLE_TILE_TOOLS = new Set<Tool>(['inspect', 'pan', 'citizen', 'road', 'rail', 'pipe', 'powerline']);
const TERRAIN_TOOLS = new Set<Tool>(['raise', 'lower', 'level']);
const LINE_TOOLS = new Set<Tool>(['road', 'rail', 'pipe', 'powerline']);
const FACILITY_TOOLS = new Set<Tool>(['power','waterpump','police','fire','hospital','school','stadium','airport','seaport','wind','solar','university','recycling']);
const TOOL_COLORS: Partial<Record<Tool, number>> = {
  residential: 0x8dcc7a, commercial: 0x68bde4, industrial: 0xe8c66d,
  road: 0xf3ead6, rail: 0xd6c7b5, bulldoze: 0xed8373, waterpump: 0x73d3df,
  park: 0x8bcc81, tree: 0x8bcc81, power: 0xf2c26f, inspect: 0xf7e5ae,
};

function noise(x: number, z: number, seed = 1) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 17.77) * 43758.5453;
  return n - Math.floor(n);
}

/** Merge each chunk by shared material; primitive source geometry remains reusable. */
function batchGroup(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    geometry.applyMatrix4(object.matrixWorld);
    geometry.clearGroups();
    const list = batches.get(material) ?? [];
    list.push(geometry);
    batches.set(material, list);
  });
  const result = new THREE.Group();
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    for (const primitive of geometries) primitive.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    result.add(mesh);
  }
  return result;
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
  });
  group.removeFromParent();
}

interface Car {
  model: THREE.Group;
  from: Point;
  to: Point;
  previous: Point;
  progress: number;
  speed: number;
  turn: number;
}

export function createCityScene(container: HTMLElement, initialState: CityState, callbacks: SceneCallbacks): CitySceneApi {
  let state = initialState;
  let tool: Tool = 'inspect';
  let brush = 1;
  let rotation: 0 | 1 | 2 | 3 = 0;
  let targetElevation: number | undefined;
  let pointerScreen = {x:0,y:0};
  let weather: Weather = initialState.settings.weather;
  let wetGround = weather === 'rain';
  const pressedKeys = new Set<string>();
  let overlay: Overlay = 'none';
  let timeOfDay = initialState.settings.timeOfDay ?? 14;
  let dayNightCycle = initialState.settings.dayNightCycle ?? true;
  let lastLitHour = -1;
  let baseSunIntensity = 3.05;
  let graphicsQuality: GraphicsQuality = 'balanced';
  let buildingLights=initialState.settings.buildingLights??true;
  let currentNightBlend=0;
  let disposed = false;
  let gridVisible = false;
  let previousTime = 0;
  let elapsed = 0;
  let simulationElapsed = 0;
  let frame = 0;
  let terrainKey = '';
  let forestKey = '';
  let latestEvent = initialState.events[0]?.id ?? 0;
  let disasterFlash = 0;
  let shakeRemaining = 0;
  let currentHover: Point | null = null;
  let selected: Point | null = null;
  let dragging = false;
  let spacePan = false;
  let lastPainted: Point | null = null;
  const stroke = new Map<string, Point>();
  const size = state.size;
  const half = size / 2;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcbded8);
  scene.fog = new THREE.Fog(0xcbded8, Math.max(220, size * 2.9), Math.max(450, size * 5.2));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  renderer.transmissionResolutionScale=.5;
  renderer.domElement.className = 'city-canvas';
  function refreshCanvasLabel():void {
    renderer.domElement.setAttribute('aria-label',tr('Interaktive 3D-Stadt. Links bauen, rechts drehen, mit dem Mausrad zoomen.','Interactive 3D city. Left-click to build, right-drag to rotate, and use the mouse wheel to zoom.'));
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
    type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const composer = new EffectComposer(renderer, postTarget);
  const renderPass = new RenderPass(scene, camera);
  const ambientOcclusion = new SSAOPass(scene, camera, 1, 1, 16);
  ambientOcclusion.kernelRadius = 0.34;
  ambientOcclusion.minDistance = 0.000035;
  ambientOcclusion.maxDistance = 0.004;
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  // Light pools contribute color, not solid surfaces in the AO depth pass.
  const renderOcclusion=ambientOcclusion.render.bind(ambientOcclusion);
  ambientOcclusion.render=(...args)=>{
    const hidden:THREE.Object3D[]=[];
    scene.traverseVisible(object=>{if(object.userData.ambientOcclusionExclude){hidden.push(object);object.visible=false;}});
    try{return renderOcclusion(...args);}finally{for(const object of hidden)object.visible=true;}
  };
  composer.addPass(ambientOcclusion);
  composer.addPass(outputPass);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minZoom = Math.min(0.48, 20 / size);
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
  Object.assign(sunlight.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: Math.max(200,size*3) });
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
  backdrop.position.y = -5.5;
  backdrop.receiveShadow = false;
  scene.add(backdrop);

  const terrain = new THREE.Group();
  const city = new THREE.Group();
  const live = new THREE.Group();
  scene.add(terrain, city, live);
  const citizens = createCitizens(state, incident => callbacks.onCitizenIncident?.(incident),{container,getCamera:()=>driving.active?driving.camera:camera});
  scene.add(citizens.group);
  const animals=createAnimalSystem(state);
  const streetlights=createStreetlights(state);
  scene.add(animals.group,streetlights.group);
  const chunks = new Map<string, { signature: string; group: THREE.Group }>();
  const terrainChunks = new Map<string, {signature:string;group:THREE.Group}>();
  const actorChunks = new Map<string,THREE.Group[]>();
  const terrainMaterials = createTerrainMaterials();
  const rockMaterial = terrainMaterials.rock;
  const forests = new THREE.Group();
  const utilities = new THREE.Group();
  const pipeLayer = new THREE.Group();
  pipeLayer.userData.raytracingExclude = true;
  pipeLayer.visible = false;
  scene.add(forests, utilities, pipeLayer);
  let skirt: THREE.Group | null = null;
  let regionContext:THREE.Group|null=null;
  const waterMaterial = new THREE.ShaderMaterial({
    fog:true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uNight: { value: 0 }, uRain: {value: 0} },
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
  const oceanSize=size+getRegionMargin(size)*2;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(oceanSize,oceanSize), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.08;
  scene.add(water);
  // One ocean surface covers the playable coastline and its exterior context.
  // No coplanar top faces or opaque administrative water walls interrupt it.
  water.userData.waterSurface = true;
  const lighting = createCityLighting({scene,renderer,sunlight,ambient,fill,worldSize:size});

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const dummy = new THREE.Object3D();
  let grid: THREE.LineSegments | null = null;
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x55614c, transparent: true, opacity: 0.19, depthWrite: false });
  const overlayMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide });
  const overlayMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.96, 0.96), overlayMaterial, size * size);
  overlayMesh.geometry.rotateX(-Math.PI / 2);
  overlayMesh.frustumCulled = false;
  overlayMesh.visible = false;
  overlayMesh.renderOrder = 2;
  scene.add(overlayMesh);
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.36, depthWrite: false, depthTest:false, side: THREE.DoubleSide, polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3 });
  const ghost = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94), ghostMaterial, size * size);
  ghost.geometry.rotateX(-Math.PI / 2);
  ghost.frustumCulled = false;
  ghost.renderOrder = 4;
  ghost.count = 0;
  scene.add(ghost);
  const ghostEdges = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color:0xa8ffed,transparent:true,opacity:0.96,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  ghostEdges.renderOrder=8;
  scene.add(ghostEdges);
  const ghostVolume = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x7dedd2,transparent:true,opacity:0.13,depthWrite:false}));
  ghostVolume.visible=false;
  scene.add(ghostVolume);
  const cursorMaterial = new THREE.LineBasicMaterial({ color: 0xf6e4aa, transparent: true, opacity: 0.98, depthTest: false });
  const cursor = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.98, 0.045, 0.98)), cursorMaterial);
  cursor.visible = false;
  cursor.renderOrder = 10;
  scene.add(cursor);
  const selectionMaterial = new THREE.MeshBasicMaterial({ color: 0xffd577, transparent: true, opacity: 0.65, depthTest: false, side: THREE.DoubleSide });
  const selection = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.49, 4), selectionMaterial);
  selection.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  selection.visible = false;
  selection.renderOrder = 9;
  scene.add(selection);
  for (const helper of [overlayMesh, ghost, ghostEdges, ghostVolume, cursor, selection]) {helper.userData.raytracingExclude = true;helper.userData.ambientOcclusionExclude=true;}

  const weatherEffects=createWeatherEffects(scene,state);
  const fireEffects=createFireEffects(state);
  live.add(fireEffects.group);
  const cars: Car[] = [];
  const collisions:VehicleCollision[]=[];
  let trafficSeed=state.seed;
  let fleetSequence=0;
  let nextAnimalObservation=0;
  const driving=createDrivingController(state,()=>cars,{
    onHover:info=>callbacks.onVehicleHover?.(info),
    onStatus:info=>{
      if(!info.active&&!disposed){controls.enabled=!dragging&&!citizens.holding;citizens.setEnabled(tool==='citizen');lighting.setDriving(false);lighting.invalidateReflections();}
      callbacks.onDriveStatus?.(info);
    },
    onVehicleSweep:event=>citizens.sweepVehicleImpact(event),
    onCollision:event=>{
      collisions.push({...event,point:{...event.point},normal:{...event.normal}});if(collisions.length>24)collisions.shift();
      citizens.notifyObservation({topic:'carCrash',position:event.point,id:`collision-${event.vehicleId}-${event.otherId??'world'}-${Math.floor(elapsed)}`});
    },
  });
  scene.add(driving.group);
  let roadCells: Point[] = [];
  let roadKey = '';
  const boats: { group: THREE.Group; x: number; z: number; phase: number }[] = [];

  function tileAt(x: number, z: number): Tile | undefined {
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) return undefined;
    return state.tiles[z * state.size + x];
  }

  function makeTerrain() {
    let changed=false;
    for(let cz=0;cz<size;cz+=CHUNK) for(let cx=0;cx<size;cx+=CHUNK) {
      const key=`${cx}:${cz}`;
      const signature=terrainChunkSignature(state,cx,cz,CHUNK);
      const previous=terrainChunks.get(key);
      if(previous?.signature===signature) continue;
      if(previous) disposeGroup(previous.group);
      const group=buildTerrainChunk(state,cx,cz,CHUNK,terrainMaterials);
      terrain.add(group); terrainChunks.set(key,{signature,group}); changed=true;
    }
    if (!changed) return;
    
    if(skirt) disposeGroup(skirt);
    skirt=buildTerrainSkirt(state,terrainMaterials.earth);terrain.add(skirt);
    if(regionContext){
      for(const material of regionContext.userData.ownedMaterials??[])material.dispose();
      disposeGroup(regionContext);
    }
    regionContext=createRegionContext(state,terrainMaterials);terrain.add(regionContext);

    if (grid) { disposeGroup(grid); grid = null; }
    const vertices:number[]=[];
    for(let z=0;z<=size;z++) for(let x=0;x<=size;x++) {
      const wx=x-half,wz=z-half;
      const y=sampleGroundHeight(state,wx+.001,wz+.001)+.035;
      if(x<size) vertices.push(wx,y,wz,wx+1,sampleGroundHeight(state,wx+.999,wz+.001)+.035,wz);
      if(z<size) vertices.push(wx,y,wz,wx,sampleGroundHeight(state,wx+.001,wz+.999)+.035,wz+1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    grid=new THREE.LineSegments(geometry,gridMaterial);grid.visible=gridVisible;grid.userData.raytracingExclude=true;scene.add(grid);
    const nextKey=`${state.seed}:${state.tiles.filter(t=>t.elevation<0).length}`;
    if(terrainKey!==nextKey) { terrainKey=nextKey; setupBoats(); }
  }

  function chunkSignature(cx: number, cz: number) {
    let signature = '';
    for (let z = cz; z < Math.min(cz + CHUNK, size); z++) {
      for (let x = cx; x < Math.min(cx + CHUNK, size); x++) {
        const tile = tileAt(x, z)!;
        signature += `${tile.kind}:${tile.level}:${tile.variation}:${tile.elevation}:${tile.anchor}:${tile.rotation}:${tile.hasPipe}:${tile.hasPowerLine};`;
        if (tile.kind === 'road' || tile.kind === 'rail') {
          for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const neighbor=tileAt(x+dx,z+dz);signature+=`${neighbor?.kind}:${neighbor?.elevation};`;}
        }
      }
    }
    return signature;
  }

  function updateBuildings() {
    for (let cz = 0; cz < size; cz += CHUNK) {
      for (let cx = 0; cx < size; cx += CHUNK) {
        const key = `${cx}:${cz}`;
        const signature = chunkSignature(cx, cz);
        const previous = chunks.get(key);
        if (previous?.signature === signature) continue;
        
        if (previous) disposeGroup(previous.group);
        for(const actor of actorChunks.get(key)??[]) { actor.removeFromParent(); }
        const chunkActors:THREE.Group[]=[];
        const source = new THREE.Group();
        for (let z = cz; z < Math.min(cz + CHUNK, size); z++) {
          for (let x = cx; x < Math.min(cx + CHUNK, size); x++) {
            const tile = tileAt(x, z)!;
            if (tile.kind === 'empty' || tile.kind === 'water' || tile.kind === 'tree' || !isBuildingAnchor(state,tile)) continue;
            const model = createTileModel(tile, state);
            if(tile.kind==='road')removeLegacyStreetlight(model,tile);
            if(tile.kind==='road'||tile.kind==='rail')warpRoadModel(model,tile,state);
            model.position.x += x - half + 0.5;
            model.position.z += z - half + 0.5;
            model.position.y += Math.max(0,tile.elevation);
            source.add(model);
            const actor=createFacilityActors(tile,state);
            if(actor) { actor.position.set(x-half+.5,Math.max(0,tile.elevation),z-half+.5); live.add(actor);chunkActors.push(actor); }
            if (tile.elevation < 0 && (tile.kind === 'road' || tile.kind === 'rail')) {
              for (const offset of [-0.3, 0.3]) {
                const pier = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.64, 0.14), rockMaterial);
                pier.position.set(x - half + 0.5 + offset, -0.3, z - half + 0.5);
                source.add(pier);
              }
            }
          }
        }
        const group = batchGroup(source);
        city.add(group);
        chunks.set(key, { signature, group });
        actorChunks.set(key,chunkActors);
      }
    }
  }

  function updateForests() {
    const trees=state.tiles.filter(t=>t.kind==='tree');
    const key=trees.map(t=>`${t.x}:${t.z}:${t.elevation}:${t.variation}`).join(';');
    if(key===forestKey)return;forestKey=key;
    for(const child of [...forests.children])disposeGroup(child);
    for(let variant=0;variant<6;variant++) {
      const list=trees.filter(t=>Math.abs(t.variation)%6===variant);
      if(!list.length)continue;
      const template=createTileModel({...list[0],variation:variant,fire:0},state);
      const prototype=batchGroup(template);
      for(const child of prototype.children) {
        if(!(child instanceof THREE.Mesh))continue;
        const mesh=new THREE.InstancedMesh(child.geometry,child.material,list.length);
        for(let i=0;i<list.length;i++) {
          const t=list[i],wx=t.x-half+.5,wz=t.z-half+.5;
          dummy.position.set(wx,sampleGroundHeight(state,wx,wz),wz);
          dummy.rotation.set(0,noise(t.x,t.z,state.seed)*Math.PI*2,0);
          const scale=.8+noise(t.z,t.x,state.seed)*.38;dummy.scale.setScalar(scale);dummy.updateMatrix();
          mesh.setMatrixAt(i,dummy.matrix);
        }
        mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();forests.add(mesh);
      }
    }
    
  }

  let powerVisualKey='';
  let pipesVisualKey='';
  const pipeMaterial=new THREE.MeshBasicMaterial({color:0x41d4ff,transparent:true,opacity:.98,depthTest:false,depthWrite:false});
  function updateUtilities() {
    const powerKey=powerLayoutSignature(state);
    if(powerKey!==powerVisualKey){
      powerVisualKey=powerKey;
      for(const child of [...utilities.children])disposeGroup(child);
      const layout=getPowerLayout(state);
      utilities.add(createPowerGridModel(state,layout));
      renderer.domElement.dataset.powerPoles=`${layout.poles.length}`;
      renderer.domElement.dataset.powerServices=`${layout.services.length}`;
      lighting.invalidateReflections();
    }
    const cells=state.tiles.filter(t=>t.hasPipe);
    const pipeKey=cells.map(t=>`${t.x}:${t.z}:${t.kind}:${t.elevation}`).join(';');
    if(pipeKey===pipesVisualKey)return;pipesVisualKey=pipeKey;
    for(const child of [...pipeLayer.children])disposeGroup(child);
    const waterSource=new THREE.Group();
    const pipeJoint=new THREE.SphereGeometry(.065,6,4);
    for(const t of cells) {
      const wx=t.x-half+.5,wz=t.z-half+.5,ground=t.kind==='road'?sampleRoadHeight(state,wx,wz):Math.max(0,t.elevation);
      const joint=new THREE.Mesh(pipeJoint,pipeMaterial);joint.position.set(wx,ground+.135,wz);waterSource.add(joint);
      for(const [dx,dz]of [[1,0],[0,1]]) {
        const n=tileAt(t.x+dx,t.z+dz);if(!n?.hasPipe)continue;
        const nGround=n.kind==='road'?sampleRoadHeight(state,wx+dx,wz+dz):Math.max(0,n.elevation);
        const start=new THREE.Vector3(wx,ground+.135,wz),end=new THREE.Vector3(wx+dx,nGround+.135,wz+dz);
        const tube=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,start.distanceTo(end),6),pipeMaterial);
        tube.position.copy(start).lerp(end,.5);tube.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize());waterSource.add(tube);
      }
    }
    if(waterSource.children.length){const group=batchGroup(waterSource);group.traverse(o=>{if(o instanceof THREE.Mesh){o.renderOrder=5;o.castShadow=false;o.receiveShadow=false;}});pipeLayer.add(group);}
    waterSource.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry!==pipeJoint)o.geometry.dispose();});
    pipeJoint.dispose();
  }

  function moveCamera(dt:number) {
    if(driving.active||inputBlocked()||dragging||!pressedKeys.size)return;
    let right=0,forward=0;
    if(pressedKeys.has('KeyW')||pressedKeys.has('ArrowUp'))forward++;
    if(pressedKeys.has('KeyS')||pressedKeys.has('ArrowDown'))forward--;
    if(pressedKeys.has('KeyD')||pressedKeys.has('ArrowRight'))right++;
    if(pressedKeys.has('KeyA')||pressedKeys.has('ArrowLeft'))right--;
    const view=controls.target.clone().sub(camera.position);view.y=0;view.normalize();
    const side=new THREE.Vector3(-view.z,0,view.x);
    const delta=view.multiplyScalar(forward).addScaledVector(side,right).normalize().multiplyScalar(dt*14/Math.max(camera.zoom,.35));
    controls.target.add(delta);camera.position.add(delta);
  }
  function updateSunShadow() {
    const target=driving.active?driving.selectedCar?.model.position??controls.target:controls.target;
    const clampX=THREE.MathUtils.clamp(target.x,-half,half),clampZ=THREE.MathUtils.clamp(target.z,-half,half);
    const sizeVisible=driving.active?22:Math.min(size,Math.max(12,Math.ceil((30/camera.zoom+6)/4)*4));
    const shadowCam=sunlight.shadow.camera;
    if(Math.abs(shadowCam.right-sizeVisible)>1){Object.assign(shadowCam,{left:-sizeVisible,right:sizeVisible,top:sizeVisible,bottom:-sizeVisible,far:Math.max(160,size*3)});shadowCam.updateProjectionMatrix();}
    lighting.updateAnchor(new THREE.Vector3(clampX,target.y,clampZ));
    const limit=half+4;
    const cx=THREE.MathUtils.clamp(target.x,-limit,limit),cz=THREE.MathUtils.clamp(target.z,-limit,limit);
    if(!driving.active){camera.position.x+=cx-target.x;camera.position.z+=cz-target.z;target.x=cx;target.z=cz;}
    if(shakeRemaining>0&&!driving.active){camera.position.x+=Math.sin(elapsed*47)*shakeRemaining*.018;camera.position.z+=Math.sin(elapsed*37)*shakeRemaining*.018;shakeRemaining=Math.max(0,shakeRemaining-.016);}
    if(disasterFlash>0){sunlight.intensity=baseSunIntensity+(Math.sin(elapsed*45)>.25?disasterFlash*4:0);disasterFlash=Math.max(0,disasterFlash-.025);if(disasterFlash===0)sunlight.intensity=baseSunIntensity;}
  }

  function updateOverlay() {
    overlayMesh.visible = overlay !== 'none';
    pipeLayer.visible = overlay === 'water';
    if (overlay === 'none') return;
    let index = 0;
    for (const tile of state.tiles) {
      if (tile.kind === 'water') continue;
      if((overlay==='power'||overlay==='water')&&['empty','tree'].includes(tile.kind)&&!tile.hasPipe&&!tile.hasPowerLine)continue;
      matrix.makeTranslation(tile.x-half+.5,Math.max(-.07,tile.elevation)+.065,tile.z-half+.5);
      overlayMesh.setMatrixAt(index, matrix);
      if (overlay === 'power') color.set(tile.powered ? 0xa4d982 : 0xe99084);
      else if (overlay === 'water') color.set(tile.watered ? 0x66c8df : 0xe5a184);
      else if(overlay==='terrain') color.setHSL(.36-Math.min(1,Math.max(0,tile.elevation)/10)*.25,.45,.55);
      else {
        let value = overlay === 'landvalue' ? (tile.landValue / 100) : overlay === 'pollution' ? (1 - tile.pollution / 100) : (1 - tile.traffic / 100);
        value = THREE.MathUtils.clamp(value, 0, 1);
        color.setHSL(value * 0.31, 0.60, 0.61);
      }
      overlayMesh.setColorAt(index++, color);
    }
    overlayMesh.count = index;
    overlayMesh.instanceMatrix.needsUpdate = true;
    if (overlayMesh.instanceColor) overlayMesh.instanceColor.needsUpdate = true;
  }

  function neighbors(point: Point): Point[] {
    return [{ x: point.x + 1, z: point.z }, { x: point.x - 1, z: point.z }, { x: point.x, z: point.z + 1 }, { x: point.x, z: point.z - 1 }]
      .filter(point => tileAt(point.x, point.z)?.kind === 'road');
  }

  function updateRoads() {
    const nextRoads=state.tiles.filter(tile=>tile.kind==='road').map(tile=>({x:tile.x,z:tile.z}));
    const nextKey=`${state.seed}:`+nextRoads.map(tile=>`${tile.x},${tile.z}`).join(';');
    if(roadKey===nextKey)return;
    roadKey=nextKey;roadCells=nextRoads.filter(point=>neighbors(point).length>0);
    if(trafficSeed!==state.seed){driving.exit();for(const car of cars)car.model.removeFromParent();cars.length=0;trafficSeed=state.seed;collisions.length=0;}
    // Road edits do not reset surviving cars or erase collision/recovery motion.
    for(let i=cars.length-1;i>=0;i--){
      const car=cars[i];if(driving.controlsCar(car))continue;
      if(tileAt(car.from.x,car.from.z)?.kind!=='road'||tileAt(car.to.x,car.to.z)?.kind!=='road'){car.model.removeFromParent();cars.splice(i,1);}
    }
    const count=Math.min(40,Math.floor(roadCells.length/5));
    while(cars.length>count){let index=cars.length-1;while(index>=0&&driving.controlsCar(cars[index]))index--;if(index<0)break;cars[index].model.removeFromParent();cars.splice(index,1);}
    const colors=[0xe5b34d,0xc4d2cd,0x537c9b,0xbc6e58,0x698c7c,0xeee3c5,0x6885ad,0x994b49];
    const kinds:VehicleKind[]=['sedan','taxi','sedan','van','sedan','truck','sedan','van'];
    const used=new Set(cars.map(car=>`${car.from.x}:${car.from.z}`));
    while(cars.length<count){
      const serial=fleetSequence++,index=Math.floor(noise(serial,12,state.seed)*roadCells.length);
      let from=roadCells[index];
      for(let step=0;step<roadCells.length&&used.has(`${from.x}:${from.z}`);step++)from=roadCells[(index+step+1)%roadCells.length];
      used.add(`${from.x}:${from.z}`);
      const choices=neighbors(from),to=choices[serial%choices.length],kind=kinds[serial%kinds.length];
      const model=createDetailedCar(kind==='taxi'?0xeac45b:colors[serial%colors.length],kind);
      model.userData.vehicleLabel=`${model.userData.vehicleLabel??kind} ${String(serial+1).padStart(2,'0')}`;
      const dx=to.x-from.x,dz=to.z-from.z,wx=from.x-half+.5-dz*.13,wz=from.z-half+.5+dx*.13;
      model.position.set(wx,sampleRoadHeight(state,wx,wz)+.057,wz);model.rotation.set(0,Math.atan2(dx,dz),0,'YXZ');
      live.add(model);
      cars.push({model,from,to,previous:from,progress:0,speed:(kind==='truck'?.25:.34)+noise(serial,8)*.29,turn:serial});
    }
  }

  function carBody(car:Car,x=car.model.position.x,y=car.model.position.y,z=car.model.position.z,yaw=car.model.rotation.y):VehicleContactBody {
    const dimensions=getVehicleDimensions(car.model);
    return {x,y,z,yaw,vx:0,vz:0,angularVelocity:0,mass:dimensions.mass,halfWidth:dimensions.width/2+.014,halfLength:dimensions.length/2+.024,height:dimensions.height};
  }

  function setupBoats() {
    for (const boat of boats) disposeGroup(boat.group);
    boats.length = 0;
    const cells = state.tiles.filter(tile => tile.kind === 'water' && neighborsWater(tile));
    if (cells.length < 4) return;
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f1dd, roughness: 0.7 });
    const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x457a92, roughness: 0.5 });
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xcec5ac, roughness: 0.8 });
    for (let index = 0; index < Math.min(5, Math.floor(cells.length / 70)); index++) {
      const tile = cells[Math.floor(noise(index + 8, 77, state.seed) * cells.length)];
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
      sailShape.moveTo(0, 0); sailShape.lineTo(0, 0.52); sailShape.lineTo(0.28, 0.04); sailShape.closePath();
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), new THREE.MeshStandardMaterial({ color: index % 2 ? 0xf1e5cc : 0xe4a87a, side: THREE.DoubleSide, roughness: 1 }));
      sail.position.set(0.01, 0.07, -0.035);
      group.add(sail);
      group.rotation.y = noise(index, 12) * Math.PI * 2;
      group.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
      live.add(group);
      boats.push({ group, x: tile.x - half + 0.5, z: tile.z - half + 0.5, phase: index * 1.76 });
    }
  }

  function neighborsWater(tile: Tile) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => tileAt(tile.x + dx, tile.z + dz)?.kind === 'water');
  }

  function animateLive(dt: number) {
    for (const car of cars) {
      if(driving.controlsCar(car))continue;
      const previousPosition=car.model.position.clone(),previousYaw=car.model.rotation.y;
      const routeBefore={from:car.from,to:car.to,previous:car.previous,progress:car.progress,turn:car.turn};
      car.progress += dt * car.speed * (state.speed === 0 ? 0 : 1);
      if (car.progress >= 1) {
        car.progress %= 1;
        car.previous = car.from;
        car.from = car.to;
        const all = neighbors(car.from);
        const forward = all.filter(point => point.x !== car.previous.x || point.z !== car.previous.z);
        const choices = forward.length ? forward : all;
        car.to = choices[Math.floor(noise(++car.turn, car.from.x + car.from.z) * choices.length)] ?? car.previous;
      }
      const dx = car.to.x - car.from.x, dz = car.to.z - car.from.z;
      const wx=car.from.x+dx*car.progress-half+.5-dz*.13,wz=car.from.z+dz*car.progress-half+.5+dx*.13;
      const y=sampleRoadHeight(state,wx,wz)+.057,yaw=Math.atan2(dx,dz),desired=carBody(car,wx,y,wz,yaw);
      const blocked=cars.some(other=>{
        if(other===car||other.model.position.distanceToSquared(previousPosition)>2.25)return false;
        const contact=findVehicleContact(desired,carBody(other));if(!contact)return false;
        const before=findVehicleContact(carBody(car),carBody(other));return !before||contact.penetration>before.penetration+.00001;
      });
      if(blocked){Object.assign(car,routeBefore);car.model.userData.trafficWaiting=true;continue;}
      car.model.userData.trafficWaiting=false;
      car.model.position.set(wx,y,wz);
      const forwardSlope=(sampleRoadHeight(state,wx+dx*.12,wz+dz*.12)-sampleRoadHeight(state,wx-dx*.12,wz-dz*.12))/.24;
      const rightSlope=(sampleRoadHeight(state,wx+dz*.12,wz-dx*.12)-sampleRoadHeight(state,wx-dz*.12,wz+dx*.12))/.24;
      car.model.rotation.set(-Math.atan(forwardSlope),yaw,Math.atan(rightSlope),'YXZ');
      const dimensions=getVehicleDimensions(car.model),velocity=car.model.position.clone().sub(previousPosition).multiplyScalar(dt>0?1/dt:0);
      citizens.sweepVehicleImpact({previous:previousPosition,current:car.model.position,previousYaw,yaw,width:dimensions.width,length:dimensions.length,height:dimensions.height,velocity,vehicleId:car.model.id,trafficOnly:true});
    }
    for (const boat of boats) {
      boat.group.position.set(boat.x + Math.sin(elapsed * 0.06 + boat.phase) * 0.22, Math.sin(elapsed * 1.1 + boat.phase) * 0.012, boat.z + Math.cos(elapsed * 0.06 + boat.phase) * 0.22);
      boat.group.rotation.z = Math.sin(elapsed * 0.7 + boat.phase) * 0.035;
    }
    fireEffects.animate(elapsed,driving.active?driving.selectedCar?.model.position??controls.target:controls.target);
    for(const actors of actorChunks.values()) for(const actor of actors) updateFacilityActors(actor,simulationElapsed,state);
    weatherEffects.animate(dt,elapsed,driving.active?driving.selectedCar?.model.position??controls.target:controls.target);
    if (selection.visible) selectionMaterial.opacity = 0.58 + Math.sin(elapsed * 2.8) * 0.14;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const intersection = new THREE.Vector3();
  let pointerOcclusionDistance=Infinity;
  function pointFromEvent(event: PointerEvent): Point | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerScreen={x:event.clientX-rect.left,y:event.clientY-rect.top};
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,driving.active?driving.camera:camera);
    const targets:THREE.Object3D[]=[...terrain.children,water];
    if(tool==='inspect') targets.push(...city.children);
    const hit=raycaster.intersectObjects(targets,true)[0];
    pointerOcclusionDistance=hit?.distance??Infinity;
    if(!hit) return null;
    intersection.copy(hit.point);
    const x=Math.floor(intersection.x+half),z=Math.floor(intersection.z+half);
    return x>=0&&z>=0&&x<size&&z<size?{x,z}:null;
  }

  function footprint(point:Point):Point[] {
    if(FACILITY_TOOLS.has(tool)) return [point];
    const points:Point[]=[];
    const width=SINGLE_TILE_TOOLS.has(tool)?1:brush;
    const offset=Math.floor((width-1)/2);
    for(let dz=0;dz<width;dz++) for(let dx=0;dx<width;dx++) {
      const x=point.x-offset+dx,z=point.z-offset+dz;
      if(x>=0&&z>=0&&x<size&&z<size) points.push({x,z});
    }
    return points;
  }
  function buildOptions():BuildOptions { return {rotation,targetElevation:targetElevation??(tool==='level'&&currentHover?tileAt(currentHover.x,currentHover.z)?.elevation:undefined)}; }
  function refreshGhost() {
    if(tool==='citizen'||driving.active) {
      ghost.count=0;ghostEdges.visible=false;cursor.visible=false;ghostVolume.visible=false;
      callbacks.onPreview?.(null);return;
    }
    ghostEdges.visible=true;
    const input=new Map(stroke);
    if(currentHover && tool!=='inspect'&&tool!=='pan') {
      if(!FACILITY_TOOLS.has(tool)||!input.size) for(const point of footprint(currentHover)) input.set(`${point.x}:${point.z}`,point);
    }
    const points=[...input.values()];
    const result=points.length?previewBuild(state,points,tool,buildOptions()):null;
    const valid=new Map((result?.valid??[]).map(p=>[`${p.x}:${p.z}`,p]));
    const invalid=new Map((result?.invalid??[]).map(p=>[`${p.x}:${p.z}`,p]));
    const display=new Map([...valid,...invalid]);
    if(FACILITY_TOOLS.has(tool)&&points.length) {
      const [w,d]=getModelFootprint(tool,rotation),anchor=points[0];
      for(let z=anchor.z;z<anchor.z+d;z++) for(let x=anchor.x;x<anchor.x+w;x++) display.set(`${x}:${z}`,{x,z});
    }
    let index=0;const edges:number[]=[];
    for(const [key,point] of display) {
      if(index>=ghost.instanceMatrix.count)break;
      const tile=tileAt(point.x,point.z);
      let h=Math.max(-.065,tile?.elevation??0)+.065;
      if(tool==='raise'||tool==='lower')h=Math.max(-.065,(tile?.elevation??0)+(tool==='raise'?.5:-.5))+.075;
      if(tool==='level')h=Math.max(-.065,targetElevation??tile?.elevation??0)+.075;
      const wx=point.x-half+.5,wz=point.z-half+.5;
      matrix.makeTranslation(wx,h,wz);ghost.setMatrixAt(index,matrix);
      const bad=invalid.has(key)||!tile ||!!(result&&result.cost>state.money)||(FACILITY_TOOLS.has(tool)&&!!result?.invalid.length);
      color.set(bad?0xf07d77:LINE_TOOLS.has(tool)?0x57e6eb:TOOL_COLORS[tool]??0x99edc5);
      ghost.setColorAt(index++,color);
      const xa=wx-.47,xb=wx+.47,za=wz-.47,zb=wz+.47;
      for(const [dx,dz,ax,az,bx,bz]of [[0,-1,xa,za,xb,za],[0,1,xa,zb,xb,zb],[-1,0,xa,za,xa,zb],[1,0,xb,za,xb,zb]]) {
        if(!display.has(`${point.x+dx}:${point.z+dz}`))edges.push(ax,h+.02,az,bx,h+.02,bz);
      }
      if(LINE_TOOLS.has(tool)) {edges.push(wx-.15,h+.025,wz,wx+.15,h+.025,wz,wx,h+.025,wz-.15,wx,h+.025,wz+.15);}
    }
    ghost.count=index;ghost.instanceMatrix.needsUpdate=true;
    if(ghost.instanceColor)ghost.instanceColor.needsUpdate=true;
    ghostEdges.geometry.dispose();ghostEdges.geometry=new THREE.BufferGeometry();
    const borderTriangles:number[]=[];
    for(let i=0;i<edges.length;i+=6){
      const ax=edges[i],ay=edges[i+1],az=edges[i+2],bx=edges[i+3],by=edges[i+4],bz=edges[i+5];
      const length=Math.hypot(bx-ax,bz-az)||1,ox=-(bz-az)/length*.024,oz=(bx-ax)/length*.024;
      borderTriangles.push(ax-ox,ay,az-oz,bx-ox,by,bz-oz,bx+ox,by,bz+oz,ax-ox,ay,az-oz,bx+ox,by,bz+oz,ax+ox,ay,az+oz);
    }
    ghostEdges.geometry.setAttribute('position',new THREE.Float32BufferAttribute(borderTriangles,3));
    (ghostEdges.material as THREE.MeshBasicMaterial).color.set((result?.invalid.length||result&&result.cost>state.money)?0xffa199:0xadfff0);
    cursor.visible=!!currentHover && tool!=='pan';
    ghostVolume.visible=false;
    if(currentHover) {
      const fixed=FACILITY_TOOLS.has(tool);
      const anchor=fixed&&points.length?points[0]:currentHover;
      const [w,d]=fixed?getModelFootprint(tool,rotation):[SINGLE_TILE_TOOLS.has(tool)?1:brush,SINGLE_TILE_TOOLS.has(tool)?1:brush];
      const offset=fixed?0:Math.floor((w-1)/2);
      const ground=Math.max(-.06,tileAt(anchor.x,anchor.z)?.elevation??0);
      cursor.scale.set(w,1,d);cursor.position.set(anchor.x-half+w/2-offset,ground+.13,anchor.z-half+d/2-offset);
      cursorMaterial.color.set((result?.invalid.length||result&&result.cost>state.money)?0xff9c91:0xb3fff0);
      if(fixed&&result) {ghostVolume.visible=true;ghostVolume.scale.set(w-.08,.35,d-.08);ghostVolume.position.copy(cursor.position);ghostVolume.position.y+=.12;(ghostVolume.material as THREE.MeshBasicMaterial).color.copy(cursorMaterial.color);}
      callbacks.onPreview?.(result?{...result,screenX:pointerScreen.x,screenY:pointerScreen.y,tool,footprint:fixed?[w,d]:undefined,elevation:targetElevation??tileAt(anchor.x,anchor.z)?.elevation}:null);
    } else callbacks.onPreview?.(null);
  }

  function addStroke(point: Point) {
    if(FACILITY_TOOLS.has(tool)&&stroke.size)return;
    for (const item of footprint(point)) stroke.set(`${item.x}:${item.z}`, item);
  }

  function interpolateStroke(from: Point, to: Point) {
    const dx = to.x - from.x, dz = to.z - from.z;
    // Transport strokes use orthogonal steps so every segment is traversable.
    if (LINE_TOOLS.has(tool)) {
      let x = from.x, z = from.z;
      let ix = 0, iz = 0;
      const ax = Math.abs(dx), az = Math.abs(dz);
      while (ix < ax || iz < az) {
        if (ix < ax && (iz >= az || (ix + 0.5) / Math.max(ax, 1) <= (iz + 0.5) / Math.max(az, 1))) { x += Math.sign(dx); ix++; }
        else { z += Math.sign(dz); iz++; }
        addStroke({ x, z });
      }
    } else {
      const steps = Math.max(Math.abs(dx), Math.abs(dz));
      for (let step = 1; step <= steps; step++) addStroke({ x: Math.round(from.x + dx * step / steps), z: Math.round(from.z + dz * step / steps) });
    }
  }

  function onPointerDown(event: PointerEvent) {
    if(driving.active){event.preventDefault();event.stopImmediatePropagation();return;}
    if (tool === 'pan' || event.button !== 0 || spacePan || event.altKey || event.ctrlKey || event.metaKey) return;
    const point = pointFromEvent(event);
    if(tool==='citizen') {
      if(citizens.pointerDown(raycaster.ray,camera.getWorldDirection(new THREE.Vector3()),event.timeStamp)) {
        event.preventDefault();event.stopImmediatePropagation();controls.enabled=false;
        renderer.domElement.setPointerCapture(event.pointerId);renderer.domElement.style.cursor=citizens.cursor;
      }
      return;
    }
    if (!point) return;
    if (tool === 'inspect') {
      selected = point;
      const anchor=tileAt(point.x,point.z)!;
      const cells=getFootprint(state,anchor);
      const selectedTile=anchor.anchor>=0?state.tiles[anchor.anchor]:anchor;
      const bounds=cells.length?cells:[point];
      selection.scale.set(Math.max(...bounds.map(p=>p.x))-Math.min(...bounds.map(p=>p.x))+1,Math.max(...bounds.map(p=>p.z))-Math.min(...bounds.map(p=>p.z))+1,1);
      selection.position.set((Math.min(...bounds.map(p=>p.x))+Math.max(...bounds.map(p=>p.x))+1)/2-half,Math.max(-.05,selectedTile.elevation)+.13,(Math.min(...bounds.map(p=>p.z))+Math.max(...bounds.map(p=>p.z))+1)/2-half);
      selection.visible = true;
      callbacks.onSelect(point);
      return;
    }
    event.preventDefault();
    controls.enabled = false;
    dragging = true;
    targetElevation=tileAt(point.x,point.z)?.elevation;
    lastPainted = point;
    stroke.clear();
    addStroke(point);
    currentHover = point;
    renderer.domElement.setPointerCapture(event.pointerId);
    refreshGhost();
  }

  function onPointerMove(event: PointerEvent) {
    if (driving.active) return;
    const point = pointFromEvent(event);
    if(tool==='citizen') {
      citizens.pointerMove(raycaster.ray,event.timeStamp);renderer.domElement.style.cursor=citizens.cursor;
      if(currentHover){currentHover=null;callbacks.onHover(null);}refreshGhost();return;
    }
    if(tool==='inspect'||tool==='pan'){raycaster.far=pointerOcclusionDistance+.15;driving.hover(raycaster,camera,renderer.domElement.getBoundingClientRect());raycaster.far=Infinity;}
    if (point?.x !== currentHover?.x || point?.z !== currentHover?.z) callbacks.onHover(point);
    currentHover = point;
    if (dragging && point) {
      if (lastPainted) interpolateStroke(lastPainted, point);
      else addStroke(point);
      lastPainted = point;
    }
    refreshGhost();
  }

  function finishStroke(event?: PointerEvent) {
    if(citizens.holding) {
      citizens.pointerUp(event?.timeStamp??performance.now());controls.enabled=!driving.active;
      if(event&&renderer.domElement.hasPointerCapture(event.pointerId))renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor=citizens.cursor;return;
    }
    if (!dragging) return;
    dragging = false;
    controls.enabled = !driving.active;
    if (event && renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    const points = [...stroke.values()];
    stroke.clear();
    lastPainted = null;
    refreshGhost();
    if (points.length) callbacks.onPaint(points,buildOptions());
    targetElevation=undefined;
  }

  function cancelStroke() {
    citizens.cancel();
    dragging = false;
    controls.enabled = !driving.active;
    stroke.clear();
    lastPainted = null;
    targetElevation=undefined;
    refreshGhost();
  }

  function onPointerLeave() {
    driving.leaveHover();
    if(citizens.holding)return;
    citizens.clearHover();
    if (dragging) return;
    currentHover = null;
    refreshGhost();
    callbacks.onHover(null);
  }

  function inputBlocked(event?:KeyboardEvent) {
    return !!(event?.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]') || !!document.querySelector('dialog[open],.modal.open');
  }
  function onKeyDown(event:KeyboardEvent) {
    if(inputBlocked(event))return;
    if(driving.active){if(event.code==='Escape'){exitDrive();event.preventDefault();event.stopImmediatePropagation();return;}if(driving.keyDown(event.code)){event.preventDefault();event.stopImmediatePropagation();}return;}
    if(['AltLeft','AltRight'].includes(event.code)){spacePan=true;controls.mouseButtons.LEFT=THREE.MOUSE.PAN;}
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)){pressedKeys.add(event.code);event.preventDefault();}
  }
  function onKeyUp(event:KeyboardEvent) {
    driving.keyUp(event.code);
    pressedKeys.delete(event.code);
    if(['AltLeft','AltRight'].includes(event.code)){spacePan=false;controls.mouseButtons.LEFT=tool==='pan'?THREE.MOUSE.PAN:null;}
  }
  function onBlur(){for(const code of ['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'])driving.keyUp(code);pressedKeys.clear();spacePan=false;controls.mouseButtons.LEFT=tool==='pan'?THREE.MOUSE.PAN:null;cancelStroke();}
  function onContextMenu(event: Event) { event.preventDefault(); }
  renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', finishStroke);
  renderer.domElement.addEventListener('pointercancel', cancelStroke);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange',onBlur);

  function resize() {
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    driving.resize(width,height);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    const aoScale = graphicsQuality === 'ultra' ? 0.85 : 0.5;
    ambientOcclusion.setSize(Math.ceil(width * renderer.getPixelRatio() * aoScale), Math.ceil(height * renderer.getPixelRatio() * aoScale));
    const viewHeight = 34;
    const viewWidth = viewHeight * width / height;
    const shift = width > 900 ? 0.085 : 0;
    camera.left = -viewWidth * (0.5 + shift);
    camera.right = viewWidth * (0.5 - shift);
    camera.top = viewHeight * 0.47;
    camera.bottom = -viewHeight * 0.53;
    camera.updateProjectionMatrix();
  }

  function resetCamera() {
    if(driving.active)exitDrive();
    const occupied=state.tiles.filter(t=>['residential','commercial','industrial'].includes(t.kind)&&t.level>0);
    const x=occupied.length?occupied.reduce((n,t)=>n+t.x,0)/occupied.length:size*.38;
    const z=occupied.length?occupied.reduce((n,t)=>n+t.z,0)/occupied.length:size*.44;
    const tx=x-half+.5,tz=z-half+.5,ty=Math.max(0,tileAt(Math.round(x),Math.round(z))?.elevation??0);
    controls.target.set(tx,ty,tz);camera.position.set(tx-42,ty+42,tz+48);
    camera.zoom=1.05;camera.updateProjectionMatrix();controls.update();
  }
  function overview(){
    if(driving.active)exitDrive();
    controls.target.set(0,0,0);camera.position.set(-size,size,size*1.14);
    const width=container.clientWidth/Math.max(1,container.clientHeight);
    camera.zoom=Math.max(controls.minZoom,Math.min(30/(size*1.3),30*width/(size*1.5)));
    camera.updateProjectionMatrix();controls.update();
  }

  function applyDaylight(force=false) {
    if(!force&&Math.abs(timeOfDay-lastLitHour)<.02)return;
    lastLitHour=timeOfDay;
    const profile=lighting.setTime(timeOfDay);
    baseSunIntensity=sunlight.intensity;
    backdropMaterial.color.copy(profile.background);
    waterMaterial.uniforms.uNight.value=profile.nightBlend;
    renderer.toneMappingExposure=profile.exposure;
    currentNightBlend=profile.nightBlend;
    setModelNightBlend(buildingLightIntensity(currentNightBlend,buildingLights));
    streetlights.setLighting(currentNightBlend,buildingLights);
  }
  function setTimeOfDay(hour:number){
    timeOfDay=((Number.isFinite(hour)?hour:14)%24+24)%24;
    state.settings.timeOfDay=timeOfDay;applyDaylight(true);
  }
  function setBuildingLights(enabled:boolean){buildingLights=enabled;state.settings.buildingLights=enabled;setModelNightBlend(buildingLightIntensity(currentNightBlend,enabled));streetlights.setLighting(currentNightBlend,enabled);}
  function setDayNightCycle(enabled:boolean){dayNightCycle=enabled;state.settings.dayNightCycle=enabled;}
  function setNight(value:boolean){setDayNightCycle(false);setTimeOfDay(value?21:14);}
  function enterDrive(id:number):boolean {
    if(disposed)return false;
    cancelStroke();driving.clearHover();pressedKeys.clear();
    if(!driving.enter(id))return false;
    citizens.setEnabled(false);currentHover=null;selection.visible=false;controls.enabled=false;
    renderer.domElement.style.cursor='default';callbacks.onHover(null);callbacks.onPreview?.(null);
    lighting.setDriving(true);lighting.invalidateReflections();refreshGhost();renderer.domElement.focus();return true;
  }
  function exitDrive(){
    if(!driving.active)return;
    driving.exit();controls.enabled=true;citizens.setEnabled(tool==='citizen');pressedKeys.clear();
    lighting.setDriving(false);lighting.invalidateReflections();refreshGhost();
  }

  function setWeather(value:Weather) {
    weather=value;
    if(value==='rain')wetGround=true;
    setModelWet(wetGround);
    waterMaterial.uniforms.uRain.value=value==='rain'?1:0;
    weatherEffects.setWeather(value);
    lighting.invalidateReflections();
    
  }

  function setGraphicsQuality(value: GraphicsQuality) {
    graphicsQuality = value;
    renderer.transmissionResolutionScale=value==='ultra'?.75:value==='performance'?.25:.5;
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
    applyStableShadowFiltering(scene);
    if(driving.active)renderer.render(scene,driving.camera);
    else if (graphicsQuality === 'performance') renderer.render(scene, camera);
    else composer.render();
  }

  function update(next: CityState) {
    state = next;
    citizens.update(state);
    animals.update(state);
    streetlights.update(state);
    makeTerrain();
    updateBuildings();
    updateForests();
    updateUtilities();
    updateRoads();
    driving.setState(state);
    if(!driving.active&&!dragging&&!citizens.holding)controls.enabled=true;
    lighting.invalidateReflections();
    dayNightCycle=state.settings.dayNightCycle;
    if(buildingLights!==state.settings.buildingLights)setBuildingLights(state.settings.buildingLights);
    if(Math.abs(timeOfDay-state.settings.timeOfDay)>.025){timeOfDay=state.settings.timeOfDay;applyDaylight(true);}
    weatherEffects.update(state);
    fireEffects.update(state);
    const event=state.events[0];
    if(event&&event.id!==latestEvent){latestEvent=event.id;if(/Erdbeben|Erdstoß/i.test(event.title))shakeRemaining=1.3;if(/Sturm|Gewitter/i.test(event.title))disasterFlash=1.1;}
    if(weather!==state.settings.weather)setWeather(state.settings.weather);
    updateOverlay();
    refreshGhost();
    if (selected && !tileAt(selected.x, selected.z)) selection.visible = false;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  resetCamera();
  setModelWet(wetGround);
  applyDaylight(true);
  update(state);

  let requestId = 0;
  function animate(timestamp: number) {
    if (disposed) return;
    renderer.info.reset();
    const dt = Math.min((timestamp - previousTime) / 1000 || 0, 0.05);
    previousTime = timestamp;
    {
      elapsed += dt;
      if(state.speed>0){simulationElapsed+=dt;if(dayNightCycle){timeOfDay=(timeOfDay+dt*.1)%24;state.settings.timeOfDay=timeOfDay;applyDaylight();}}
      waterMaterial.uniforms.uTime.value = elapsed;
      animateLive(dt);
      if(inputBlocked())for(const code of ['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'])driving.keyUp(code);
      driving.update(dt);
      citizens.animate(dt,state.speed>0);
      const driven=driving.selectedCar,driveSpeed=Math.abs(driving.getStatus().speed)/36;
      animals.setVehicle(driven?{x:driven.model.position.x,z:driven.model.position.z,speed:driveSpeed}:null);
      const focus=driven?.model.position??controls.target;
      animals.animate(dt,elapsed,focus);streetlights.animate(dt,focus);
      if(elapsed>=nextAnimalObservation){
        nextAnimalObservation=elapsed+7;
        for(const animal of animals.getObservations())citizens.notifyObservation({topic:animal.species==='cat'||animal.species==='dog'?'pets':'wildlife',position:{x:animal.x,y:sampleGroundHeight(state,animal.x,animal.z),z:animal.z},id:`${animal.species}-${Math.round(animal.x*10)}-${Math.round(animal.z*10)}`});
      }
    }
    moveCamera(dt);
    if(!driving.active)controls.update();
    updateSunShadow();
    renderRealtime();
    // Keep optional sky-environment filtering behind the normal shadow render.
    lighting.refreshReflections(driving.active?driving.selectedCar?.model.position??controls.target:controls.target);
    if (++frame % 120 === 0) {
      renderer.domElement.dataset.drawCalls = `${renderer.info.render.calls}`;
      renderer.domElement.dataset.triangles = `${renderer.info.render.triangles}`;
      const crowd=citizens.getDebug();renderer.domElement.dataset.citizens=`${crowd.count}`;
      renderer.domElement.dataset.ragdolls=`${crowd.ragdolls}`;
      renderer.domElement.dataset.animals=`${animals.getDebug().count}`;renderer.domElement.dataset.streetlights=`${streetlights.getDebug().litCount}`;
    }
    requestId = requestAnimationFrame(animate);
  }
  requestId = requestAnimationFrame(animate);

  return {
    getDiagnostics(){
      return {cars:cars.map(car=>({id:car.model.id,x:car.model.position.x,y:car.model.position.y,z:car.model.position.z,yaw:car.model.rotation.y,kind:car.model.userData.vehicleKind,label:car.model.userData.vehicleLabel,dimensions:getVehicleDimensions(car.model),controlled:driving.controlsCar(car),waiting:!!car.model.userData.trafficWaiting})),citizens:citizens.getDebug(),animals:animals.getDebug(),streetlights:streetlights.getDebug(),fires:fireEffects.getDebug(),driving:driving.getStatus(),collisions:collisions.map(event=>({...event,point:{...event.point},normal:{...event.normal}}))};
    },
    getInteractionTargets(){
      const activeCamera=driving.active?driving.camera:camera;
      activeCamera.updateMatrixWorld();
      const rect=renderer.domElement.getBoundingClientRect();
      function projected(id:number,x:number,y:number,z:number){
        const p=new THREE.Vector3(x,y,z).project(activeCamera);
        if(!Number.isFinite(p.x)||p.x< -1||p.x>1||p.y< -1||p.y>1||p.z< -1||p.z>1)return null;
        return {id,screenX:rect.left+(p.x+1)*rect.width/2,screenY:rect.top+(1-p.y)*rect.height/2};
      }
      return {
        cars:cars.map(c=>projected(c.model.id,c.model.position.x,c.model.position.y+.08,c.model.position.z)).filter((p):p is NonNullable<typeof p>=>p!==null),
        citizens:citizens.getDebug().positions.map(c=>projected(c.id,c.x,c.y+.1,c.z)).filter((p):p is NonNullable<typeof p>=>p!==null),
      };
    },
    update,
    refreshLocale() {
      refreshCanvasLabel();driving.refreshLocale();citizens.refreshLocale();
      callbacks.onHover(currentHover);refreshGhost();
    },
    setTool(nextTool, nextBrush,nextRotation=0) {
      if(driving.active)exitDrive();
      driving.clearHover();
      cancelStroke();
      tool = nextTool;
      citizens.setEnabled(nextTool==='citizen');
      brush = Math.max(1, Math.min(12, Math.floor(nextBrush)));
      rotation=nextRotation;
      controls.mouseButtons.LEFT=nextTool==='pan'?THREE.MOUSE.PAN:null;
      renderer.domElement.style.cursor = nextTool==='pan'?'grab':nextTool === 'inspect'||nextTool==='citizen' ? 'default' : 'crosshair';
      refreshGhost();
    },
    setOverlay(value) { overlay = value; updateOverlay(); },
    setNight,
    setTimeOfDay,
    setDayNightCycle,
    setBuildingLights,
    getTimeOfDay:()=>timeOfDay,
    enterDrive,exitDrive,getDrivingStatus:()=>driving.getStatus(),
    setWeather,
    setGraphicsQuality,
    setGrid(show) { gridVisible = show; if (grid) grid.visible = show; },
    zoom(direction) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (direction > 0 ? 1.22 : 1 / 1.22), controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
    },
    rotate(direction) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 4);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    resetCamera,
    overview,
    focus(x, z) {
      if(driving.active)exitDrive();
      x=THREE.MathUtils.clamp(Math.floor(x),0,size-1);z=THREE.MathUtils.clamp(Math.floor(z),0,size-1);
      const target = new THREE.Vector3(x-half+.5,Math.max(0,tileAt(x,z)?.elevation??0),z-half+.5);
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      camera.zoom = Math.max(camera.zoom, 1.8);
      camera.updateProjectionMatrix();
      controls.update();
      selected = { x, z };
      selection.scale.set(1,1,1);
      selection.position.set(target.x, target.y+.13, target.z);
      selection.visible = true;
    },
    screenshot() { renderRealtime(); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(requestId);
      observer.disconnect();
      controls.dispose();
      ambientOcclusion.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', finishStroke);
      renderer.domElement.removeEventListener('pointercancel', cancelStroke);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange',onBlur);
      citizens.dispose();animals.dispose();streetlights.dispose();fireEffects.dispose();
      driving.dispose();lighting.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      weatherEffects.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
