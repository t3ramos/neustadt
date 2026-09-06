import * as THREE from 'three';
import { sampleGroundHeight } from '../world/terrain';
import { sampleRoadHeight } from '../infrastructure/roads';
import { ROAD_SURFACE_HEIGHT } from '../infrastructure/road-surface';
import type { CityState, Tile, Weather } from '../../domain/types';

const PUDDLE_LIMIT = 160;
export const MAX_RAIN_DROPS = 16384;
const RIPPLE_COUNT = 40;
const hash = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 0.013) * 43758.5453123;
  return n - Math.floor(n);
};

export interface RainCoverage {
  halfExtent: number;
  top: number;
  columns: number;
  count: number;
}
/** Fixed world bounds include the rendered region margin, even at full-map zoom. */
export function rainCoverage(size: number, maximumElevation: number): RainCoverage {
  const safeSize = Number.isFinite(size) ? THREE.MathUtils.clamp(size, 40, 128) : 40;
  const halfExtent = safeSize / 2 + Math.max(12, safeSize * 0.25) + 4;
  const columns = Math.min(
    128,
    Math.max(64, Math.ceil(Math.sqrt(halfExtent * halfExtent * 4 * 0.65))),
  );
  return {
    halfExtent,
    top: Math.max(24, (Number.isFinite(maximumElevation) ? maximumElevation : 0) + 22),
    columns,
    count: columns * columns,
  };
}
export function rainDropSeed(
  index: number,
  seed: number,
  coverage: RainCoverage,
): { x: number; z: number; phase: number; speed: number; length: number } {
  const cell = (coverage.halfExtent * 2) / coverage.columns;
  return {
    x:
      -coverage.halfExtent +
      ((index % coverage.columns) + 0.15 + hash(index, 1, seed) * 0.7) * cell,
    z:
      -coverage.halfExtent +
      (Math.floor(index / coverage.columns) + 0.15 + hash(index, 2, seed) * 0.7) * cell,
    phase: hash(index, 3, seed),
    speed: 9 + hash(index, 4, seed) * 4,
    length: 0.23 + hash(index, 5, seed) * 0.16,
  };
}
/** Zoom only changes streak readability; it never moves the rain volume. */
export function rainLengthScale(camera?: THREE.Camera, viewportHeight = 900): number {
  if (!(camera instanceof THREE.OrthographicCamera)) return 1;
  const height = Math.abs(camera.top - camera.bottom) / Math.max(0.001, camera.zoom);
  return THREE.MathUtils.clamp((height / Math.max(1, viewportHeight)) * 9, 1, 4);
}

/** Shared, mipmapped water microstructure for both rendering paths. */
function waterNormalMap(): THREE.DataTexture {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2,
        v = (z / size) * Math.PI * 2;
      const nx = 0.12 * Math.cos(u * 3 + v * 2) + 0.04 * Math.cos(u * 7 - v * 5);
      const ny = 0.12 * Math.cos(v * 4 - u * 2) + 0.04 * Math.cos(u * 5 + v * 7);
      const normal = new THREE.Vector3(nx, ny, 1).normalize(),
        i = (z * size + x) * 4;
      pixels[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
      pixels[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      pixels[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      pixels[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function puddleShoreMap(): THREE.DataTexture {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1,
        v = ((y + 0.5) / size) * 2 - 1;
      const angle = Math.atan2(v, u);
      const shore = 0.7 + 0.025 * Math.sin(angle * 3) + 0.015 * Math.cos(angle * 5);
      const coverage = 1 - THREE.MathUtils.smoothstep(Math.hypot(u, v), shore - 0.16, shore);
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(coverage * 255);
      pixels[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function puddleGeometry(variant: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(),
    count = 12;
  const points = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.78 + hash(i, variant, 19) * 0.22;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  const first = points[0]
    .clone()
    .add(points[count - 1])
    .multiplyScalar(0.5);
  shape.moveTo(first.x, first.y);
  for (let i = 0; i < count; i++) {
    const current = points[i],
      next = points[(i + 1) % count];
    shape.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2,
    );
  }
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 2);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + 0.5, uv.getY(i) * 0.5 + 0.5);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createWeatherEffects(scene: THREE.Scene, initialState: CityState) {
  let state = initialState;
  let weather: Weather = initialState.settings.weather;
  let wet = weather === 'rain';
  let wetness = wet ? 1 : 0,
    rainStrength = wetness;
  let signature = '';
  let disposed = false;
  const puddles = new THREE.Group();
  puddles.name = 'rainwater-puddles';
  const normalMap = waterNormalMap(),
    shoreMap = puddleShoreMap();
  const material = new THREE.MeshPhysicalMaterial({
    // A dark substrate remains visible through shallow dielectric water. Water
    // has only ~2% normal-incidence reflectance; Fresnel supplies grazing shine.
    color: 0x303c3e,
    roughness: 0.105,
    metalness: 0,
    clearcoat: 0,
    ior: 1.333,
    normalMap,
    normalScale: new THREE.Vector2(0.1, 0.1),
    alphaMap: shoreMap,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    envMapIntensity: 1.35,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const geometries = Array.from({ length: 8 }, (_, i) => puddleGeometry(i));
  const batches = geometries.map((geometry, i) => {
    const mesh = new THREE.InstancedMesh(geometry, material, PUDDLE_LIMIT);
    mesh.name = `puddle-batch-${i}`;
    mesh.count = 0;
    mesh.userData.wetSurface = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    puddles.add(mesh);
    return mesh;
  });
  const puddlePoints: THREE.Vector3[] = [];
  scene.add(puddles);

  const rainGeometry = new THREE.BufferGeometry();
  // Each segment has two static endpoints. Falling and wind run only on the GPU.
  const endpoint = new Float32Array(MAX_RAIN_DROPS * 6);
  for (let i = 0; i < MAX_RAIN_DROPS; i++) endpoint[i * 6 + 4] = 1;
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(endpoint, 3));
  const dropAttributes = new THREE.BufferAttribute(new Float32Array(MAX_RAIN_DROPS * 8), 4);
  const motionAttributes = new THREE.BufferAttribute(new Float32Array(MAX_RAIN_DROPS * 4), 2);
  rainGeometry.setAttribute('aDrop', dropAttributes);
  rainGeometry.setAttribute('aMotion', motionAttributes);
  const rainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uStrength: { value: rainStrength },
      uTop: { value: 24 },
      uLengthScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    toneMapped: false,
    vertexShader: `
      attribute vec4 aDrop;
      attribute vec2 aMotion;
      uniform float uTime,uTop,uLengthScale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main(){
        float span=max(1.0,uTop-aDrop.w);
        float phase=fract(aDrop.z-uTime*aMotion.x/span);
        float length=aMotion.y*uLengthScale;
        vec3 world=vec3(aDrop.x+sin(uTime*.7+aDrop.z*31.0)*.18,aDrop.w+phase*span,aDrop.y);
        world+=vec3(-length*.12,length,0.0)*position.y;
        vAlpha=(.55+.45*position.y)*smoothstep(0.0,.035,phase)*(1.0-smoothstep(.97,1.0,phase));
        vec4 mvPosition=modelViewMatrix*vec4(world,1.0);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uStrength;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main(){
        gl_FragColor=vec4(.57,.72,.78,.38*uStrength*vAlpha);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.name = 'world-rain-streaks';
  rain.userData.raytracingExclude = true;
  rain.userData.ambientOcclusionExclude = true;
  rain.frustumCulled = false;
  rain.visible = weather === 'rain';
  scene.add(rain);
  let coverage = rainCoverage(state.size, 0),
    rainSignature = '';
  function updateRainVolume(): void {
    let maximum = 0,
      checksum = 2166136261;
    for (const tile of state.tiles) {
      const elevation = Number.isFinite(tile.elevation) ? tile.elevation : 0;
      maximum = Math.max(maximum, elevation);
      checksum = Math.imul(checksum ^ Math.round(elevation * 1024), 16777619);
    }
    const nextSignature = `${state.size}:${state.seed}:${checksum}`;
    if (nextSignature === rainSignature) return;
    rainSignature = nextSignature;
    coverage = rainCoverage(state.size, maximum);
    const drop = new THREE.Vector4();
    for (let i = 0; i < coverage.count; i++) {
      const seed = rainDropSeed(i, state.seed, coverage);
      const ground = Math.max(0, sampleGroundHeight(state, seed.x, seed.z));
      drop.set(seed.x, seed.z, seed.phase, Number.isFinite(ground) ? ground : 0);
      for (let end = 0; end < 2; end++) {
        dropAttributes.setXYZW(i * 2 + end, drop.x, drop.y, drop.z, drop.w);
        motionAttributes.setXY(i * 2 + end, seed.speed, seed.length);
      }
    }
    dropAttributes.needsUpdate = motionAttributes.needsUpdate = true;
    rainGeometry.setDrawRange(0, coverage.count * 2);
    rainMaterial.uniforms.uTop.value = coverage.top;
  }

  const ringGeometry = new THREE.RingGeometry(0.033, 0.041, 12);
  ringGeometry.rotateX(-Math.PI / 2);
  const rippleMaterial = new THREE.MeshBasicMaterial({
    color: 0xc4e2e9,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const ripples = new THREE.InstancedMesh(ringGeometry, rippleMaterial, RIPPLE_COUNT);
  ripples.name = 'raindrop-ripples';
  ripples.userData.raytracingExclude = true;
  ripples.frustumCulled = false;
  ripples.visible = rain.visible;
  ripples.count = 0;
  scene.add(ripples);
  const transform = new THREE.Object3D(),
    rippleColor = new THREE.Color();

  function eligible(tile: Tile) {
    // The center of each road has a level paved foundation. Park puddles are
    // constrained to the crossing path, away from plants and benches.
    return tile.elevation >= 0 && (tile.kind === 'road' || tile.kind === 'park');
  }

  function update(next: CityState) {
    if (disposed) return;
    state = next;
    updateRainVolume();
    if (!wet) return;
    let checksum = 2166136261;
    const candidates: Tile[] = [];
    for (const tile of state.tiles)
      if (eligible(tile)) {
        checksum = Math.imul(checksum ^ (tile.z * state.size + tile.x), 16777619);
        checksum = Math.imul(checksum ^ Math.round(tile.elevation * 1024), 16777619);
        checksum = Math.imul(checksum ^ (tile.kind === 'park' ? 1 : 2), 16777619);
        candidates.push(tile);
      }
    const nextSignature = `${state.seed}:${state.size}:${checksum >>> 0}`;
    if (signature === nextSignature) return;
    signature = nextSignature;
    for (const batch of batches) batch.count = 0;
    puddlePoints.length = 0;
    // Stable hash ordering distributes a fixed draw-call budget throughout the
    // built region without concentrating all the puddles in the first rows.
    candidates.sort((a, b) => hash(a.x, a.z, state.seed) - hash(b.x, b.z, state.seed));
    for (const tile of candidates.slice(0, PUDDLE_LIMIT)) {
      const n = hash(tile.x + 7, tile.z + 3, state.seed);
      const road = tile.kind === 'road';
      const x = tile.x - state.size / 2 + 0.5 + (road ? (n - 0.5) * 0.22 : 0);
      const z =
        tile.z - state.size / 2 + 0.5 + (road ? (hash(tile.x, tile.z, 92) - 0.5) * 0.25 : 0);
      const y = road
        ? sampleRoadHeight(state, x, z) + ROAD_SURFACE_HEIGHT + 0.0006
        : sampleGroundHeight(state, x, z) + 0.059;
      const batch = batches[Math.floor(n * geometries.length)];
      transform.position.set(x, y, z);
      transform.rotation.set(0, n * Math.PI * 2, 0);
      transform.scale.set(road ? 0.14 + n * 0.18 : 0.085, 1, road ? 0.1 + (1 - n) * 0.16 : 0.095);
      transform.updateMatrix();
      batch.setMatrixAt(batch.count++, transform.matrix);
      puddlePoints.push(new THREE.Vector3(x, y + 0.002, z));
    }
    for (const batch of batches) {
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
    }
    ripples.count = Math.min(RIPPLE_COUNT, puddlePoints.length);
  }

  function setWeather(value: Weather) {
    weather = value;
    if (weather === 'rain') wet = true;
    update(state);
  }

  function animate(
    dt: number,
    elapsed: number,
    _target: THREE.Vector3,
    camera?: THREE.Camera,
    viewportHeight = 900,
  ) {
    if (disposed) return;
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
    rainStrength = THREE.MathUtils.damp(rainStrength, weather === 'rain' ? 1 : 0, 1.4, step);
    wetness = THREE.MathUtils.clamp(wetness + (weather === 'rain' ? step * 0.2 : -step / 25), 0, 1);
    wet = wetness > 0 || weather === 'rain';
    material.opacity = 0.68 * wetness;
    material.roughness = 0.105 + (1 - wetness) * 0.3;
    material.normalScale.setScalar(0.045 + rainStrength * 0.065);
    puddles.visible = wetness > 0.001;
    rainMaterial.uniforms.uStrength.value = rainStrength;
    rippleMaterial.opacity = 0.35 * rainStrength;
    rainMaterial.uniforms.uTime.value = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    rainMaterial.uniforms.uLengthScale.value = rainLengthScale(camera, viewportHeight);
    rain.visible = ripples.visible = rainStrength > 0.001;
    if (!rain.visible) return;
    for (let i = 0; i < ripples.count; i++) {
      const phase = (elapsed * 0.9 + hash(i, 2, 74)) % 1;
      transform.rotation.set(0, 0, 0);
      transform.position.copy(puddlePoints[i]);
      transform.scale.setScalar(0.35 + phase * 1.4);
      transform.updateMatrix();
      ripples.setMatrixAt(i, transform.matrix);
      rippleColor.setRGB(1 - phase, 1 - phase, 1 - phase);
      ripples.setColorAt(i, rippleColor);
    }
    if (ripples.count) {
      ripples.instanceMatrix.needsUpdate = true;
      if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
    }
  }

  update(initialState);
  return {
    update,
    setWeather,
    animate,
    isWet: () => wetness > 0.04 || weather === 'rain',
    getDebug: () => ({
      weather,
      wetness,
      rainStrength,
      rainDrops: rain.visible ? coverage.count : 0,
      rainDrawCalls: rain.visible ? 1 : 0,
      rainCoverage: { ...coverage },
      puddles: puddles.visible ? puddlePoints.length : 0,
      puddleDrawCalls: puddles.visible ? batches.filter((batch) => batch.count > 0).length : 0,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(puddles, rain, ripples);
      geometries.forEach((geometry) => geometry.dispose());
      batches.forEach((batch) => batch.dispose());
      material.dispose();
      normalMap.dispose();
      shoreMap.dispose();
      rainGeometry.dispose();
      rainMaterial.dispose();
      ringGeometry.dispose();
      rippleMaterial.dispose();
      puddles.clear();
    },
  };
}
