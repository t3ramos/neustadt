import * as THREE from 'three';
import { sampleGroundHeight } from './terrain-graphics';
import type { CityState, Tile, Weather } from './types';

const PUDDLE_LIMIT = 160;
const DROP_COUNT = 800;
const RIPPLE_COUNT = 40;
const hash = (x: number, z: number, seed: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * .013) * 43758.5453123;
  return n - Math.floor(n);
};

/** Physical, texture-backed surface: ray tracing sees the same puddles as raster rendering. */
function waterNormalMap(): THREE.DataTexture {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = z / size * Math.PI * 2;
    const nx = .12 * Math.cos(u * 3 + v * 2) + .04 * Math.cos(u * 7 - v * 5);
    const ny = .12 * Math.cos(v * 4 - u * 2) + .04 * Math.cos(u * 5 + v * 7);
    const normal = new THREE.Vector3(nx, ny, 1).normalize(), i = (z * size + x) * 4;
    pixels[i] = Math.round((normal.x * .5 + .5) * 255);
    pixels[i + 1] = Math.round((normal.y * .5 + .5) * 255);
    pixels[i + 2] = Math.round((normal.z * .5 + .5) * 255);
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

function puddleGeometry(variant: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(), count = 12;
  const points = Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2;
    const radius = .78 + hash(i, variant, 19) * .22;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  const first = points[0].clone().add(points[count - 1]).multiplyScalar(.5);
  shape.moveTo(first.x, first.y);
  for (let i = 0; i < count; i++) {
    const current = points[i], next = points[(i + 1) % count];
    shape.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 2);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createWeatherEffects(scene: THREE.Scene, initialState: CityState) {
  let state = initialState;
  let weather: Weather = initialState.settings.weather;
  let wet = weather === 'rain';
  let signature = '';
  let disposed = false;
  const puddles = new THREE.Group();
  puddles.name = 'rainwater-puddles';
  const normalMap = waterNormalMap();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xa9c5cb, roughness: .035, metalness: .18,
    clearcoat: 1, clearcoatRoughness: .018, ior: 1.333,
    normalMap, normalScale: new THREE.Vector2(.18, .18),
    transparent: true, opacity: .76, depthWrite: false,
    envMapIntensity: .9, polygonOffset: true, polygonOffsetFactor: -1,
  });
  const geometries = Array.from({ length: 8 }, (_, i) => puddleGeometry(i));
  const puddlePoints: THREE.Vector3[] = [];
  scene.add(puddles);

  const dropPositions = new Float32Array(DROP_COUNT * 6);
  const dropData = new Float32Array(DROP_COUNT * 3);
  for (let i = 0; i < DROP_COUNT; i++) {
    dropData[i * 3] = (hash(i, 1, 42) - .5) * 38;
    dropData[i * 3 + 1] = hash(i, 2, 42) * 21;
    dropData[i * 3 + 2] = (hash(i, 3, 42) - .5) * 38;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rainMaterial = new THREE.LineBasicMaterial({ color: 0xc5e6ee, transparent: true, opacity: .31, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.name = 'local-rain-streaks';
  rain.userData.raytracingExclude = true;
  rain.frustumCulled = false;
  rain.visible = weather === 'rain';
  scene.add(rain);

  const ringGeometry = new THREE.RingGeometry(.033, .041, 12);
  ringGeometry.rotateX(-Math.PI / 2);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xc4e2e9, transparent: true, opacity: .35, depthWrite: false });
  const ripples = new THREE.InstancedMesh(ringGeometry, rippleMaterial, RIPPLE_COUNT);
  ripples.name = 'raindrop-ripples';
  ripples.userData.raytracingExclude = true;
  ripples.frustumCulled = false;
  ripples.visible = rain.visible;
  ripples.count = 0;
  scene.add(ripples);
  const transform = new THREE.Object3D(), rippleColor = new THREE.Color();

  function eligible(tile: Tile) {
    // The center of each road has a level paved foundation. Park puddles are
    // constrained to the crossing path, away from plants and benches.
    return tile.elevation >= 0 && (tile.kind === 'road' || tile.kind === 'park');
  }

  function update(next: CityState) {
    if (disposed) return;
    state = next;
    if (!wet) return;
    let checksum = 2166136261;
    const candidates: Tile[] = [];
    for (const tile of state.tiles) if (eligible(tile)) {
      checksum = Math.imul(checksum ^ (tile.z * state.size + tile.x), 16777619);
      checksum = Math.imul(checksum ^ Math.round(tile.elevation * 1024), 16777619);
      checksum = Math.imul(checksum ^ (tile.kind === 'park' ? 1 : 2), 16777619);
      candidates.push(tile);
    }
    const nextSignature = `${state.seed}:${state.size}:${checksum >>> 0}`;
    if (signature === nextSignature) return;
    signature = nextSignature;
    puddles.clear();
    puddlePoints.length = 0;
    // Stable hash ordering distributes a fixed draw-call budget throughout the
    // built region without concentrating all the puddles in the first rows.
    candidates.sort((a, b) => hash(a.x, a.z, state.seed) - hash(b.x, b.z, state.seed));
    for (const tile of candidates.slice(0, PUDDLE_LIMIT)) {
      const n = hash(tile.x + 7, tile.z + 3, state.seed);
      const road = tile.kind === 'road';
      const x = tile.x - state.size / 2 + .5 + (road ? (n - .5) * .22 : 0);
      const z = tile.z - state.size / 2 + .5 + (road ? (hash(tile.x, tile.z, 92) - .5) * .25 : 0);
      const y = sampleGroundHeight(state, x, z) + .059;
      const mesh = new THREE.Mesh(geometries[Math.floor(n * geometries.length)], material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = n * Math.PI * 2;
      mesh.scale.set(road ? .1 + n * .13 : .061, 1, road ? .08 + (1 - n) * .12 : .07);
      mesh.name = `puddle-${tile.x}-${tile.z}`;
      mesh.userData.wetSurface = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      puddles.add(mesh);
      puddlePoints.push(new THREE.Vector3(x, y + .002, z));
    }
    ripples.count = Math.min(RIPPLE_COUNT, puddlePoints.length);
  }

  function setWeather(value: Weather) {
    weather = value;
    if (weather === 'rain') wet = true;
    rain.visible = ripples.visible = weather === 'rain';
    update(state);
  }

  function animate(dt: number, elapsed: number, target: THREE.Vector3) {
    if (disposed || weather !== 'rain') return;
    rain.position.set(target.x, target.y, target.z);
    const wind = .45 + Math.sin(elapsed * .17) * .15;
    for (let i = 0; i < DROP_COUNT; i++) {
      const d = i * 3, p = i * 6;
      dropData[d + 1] -= Math.min(dt, .1) * (9 + hash(i, 5, 42) * 4);
      dropData[d] += dt * wind;
      if (dropData[d + 1] < -.15) dropData[d + 1] += 21;
      if (dropData[d] > 19) dropData[d] -= 38;
      dropPositions[p] = dropData[d];
      dropPositions[p + 1] = dropData[d + 1];
      dropPositions[p + 2] = dropData[d + 2];
      dropPositions[p + 3] = dropData[d] - .018;
      dropPositions[p + 4] = dropData[d + 1] + .18 + hash(i, 4, 42) * .13;
      dropPositions[p + 5] = dropData[d + 2];
    }
    rainGeometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < ripples.count; i++) {
      const phase = (elapsed * .9 + hash(i, 2, 74)) % 1;
      transform.position.copy(puddlePoints[i]);
      transform.scale.setScalar(.35 + phase * 1.4);
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
    update, setWeather, animate,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(puddles, rain, ripples);
      geometries.forEach(geometry => geometry.dispose());
      material.dispose(); normalMap.dispose(); rainGeometry.dispose(); rainMaterial.dispose();
      ringGeometry.dispose(); rippleMaterial.dispose();
      puddles.clear();
    },
  };
}
