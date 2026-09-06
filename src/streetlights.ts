import * as THREE from 'three';
import { sampleRoadHeight } from './road-graphics';
import type { CityState, Tile } from './types';

type Quality = 'performance' | 'balanced' | 'ultra';
const MAX_POINT_LIGHTS = 10;
const POINT_LIMIT: Record<Quality, number> = { performance: 4, balanced: 8, ultra: 10 };
const POOL_INTERVAL = .25;
const POOL_HALF = .445;
const POOL_LIFT = .055;
const WARM_LIGHT = 0xffdfa2;
const LEGACY_PARTS = [
  { type: 'CylinderGeometry', position: [-.413, .265, .405], scale: [.025, .48, .025] },
  { type: 'BoxGeometry', position: [-.343, .505, .405], scale: [.16, .025, .035] },
  { type: 'BoxGeometry', position: [-.275, .49, .405], scale: [.07, .024, .052] },
] as const;

/** Call before warpRoadModel. Its cached primitives/materials belong to the model system. */
export function removeLegacyStreetlight(model: THREE.Group, tile: Tile): void {
  if (tile.kind !== 'road' || (tile.x + tile.z) % 6 !== 0) return;
  for (const part of LEGACY_PARTS) {
    const child = model.children.find(object => object instanceof THREE.Mesh
      && object.geometry.type === part.type
      && part.position.every((value, axis) => Math.abs(object.position.getComponent(axis) - value) < 1e-8)
      && part.scale.every((value, axis) => Math.abs(object.scale.getComponent(axis) - value) < 1e-8)
      && object.rotation.x === 0 && object.rotation.y === 0 && object.rotation.z === 0);
    if (child) model.remove(child);
  }
}

function radialTexture(): THREE.DataTexture {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (z + .5) / size * 2 - 1);
    const falloff = Math.round(255 * Math.pow(Math.max(0, 1 - r * r), 2));
    const offset = (z * size + x) * 4;
    // Three's alphaMap samples green, not the source alpha channel.
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = falloff;
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Two instances of this triangle form a square with the road's exact NW–SE split. */
function poolTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 1, 1, 0, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 1, 1, 0], 2));
  geometry.computeVertexNormals();
  return geometry;
}

interface Lamp { id: number; bulb: THREE.Vector3; powered: boolean; }

/** Shared with vehicle collisions: the actual pole starts on the raised curb. */
export function getRoadStreetlightFixture(state: CityState, tile: Tile): {
  mast: THREE.Vector3; bulb: THREE.Vector3; mastRadius: number; mastHeight: number;
  base: THREE.Vector3; baseRadius: number; baseHeight: number;
} | null {
  if (tile.kind !== 'road' || (tile.x + tile.z) % 6 !== 0) return null;
  const centerX = tile.x - state.size / 2 + .5, centerZ = tile.z - state.size / 2 + .5;
  // Clear the pedestrian corner route at (-.405, +.405), keeping the fixture on the curb.
  const mastX = centerX - .47, bulbX = centerX - .332, z = centerZ + .47;
  const ground = sampleRoadHeight(state, mastX, z);
  return {
    mast: new THREE.Vector3(mastX, ground + .045, z),
    bulb: new THREE.Vector3(bulbX, sampleRoadHeight(state, bulbX, z) + .49, z),
    mastRadius: .014, mastHeight: .468,
    base: new THREE.Vector3(mastX, ground + .025, z), baseRadius: .036, baseHeight: .028,
  };
}

/** Instanced road fixtures plus a fixed, shadow-free real-light budget. */
export function createStreetlights(initialState: CityState) {
  const group = new THREE.Group();
  group.name = 'streetlights';
  const texture = radialTexture();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pole = new THREE.CylinderGeometry(.38, .5, 1, 10);
  const base = new THREE.CylinderGeometry(.48, .62, 1, 10);
  const triangle = poolTriangle();
  const metal = new THREE.MeshStandardMaterial({ color: 0x41515c, roughness: .43, metalness: .72 });
  const footing = new THREE.MeshStandardMaterial({ color: 0x89938b, roughness: .75, metalness: .14 });
  const unlitLens = new THREE.MeshStandardMaterial({ color: 0xc8cbbc, roughness: .24, metalness: .05 });
  const litLens = new THREE.MeshStandardMaterial({ color: 0xffedc7, roughness: .24, metalness: .05, emissive: WARM_LIGHT, emissiveIntensity: 0 });
  const poolMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: WARM_LIGHT, emissiveIntensity: 0, roughness: 1,
    transparent: true, opacity: 0, alphaMap: texture, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  poolMaterial.name = 'streetlight-soft-ground-pool';
  // Additive light should disappear into atmospheric fog, never add the fog color.
  poolMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float streetFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        #else
          float streetFog = smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor.rgb *= 1.0 - streetFog;
      #endif
    `);
  };
  poolMaterial.customProgramCacheKey = () => 'streetlight-ground-pool-fog-v1';
  const geometries = [box, pole, base, triangle];
  const materials = [metal, footing, unlitLens, litLens, poolMaterial];
  const transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  const xAxis = new THREE.Vector3(1, 0, 0), delta = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const lights = Array.from({ length: MAX_POINT_LIGHTS }, (_, index) => {
    const light = new THREE.PointLight(WARM_LIGHT, 0, 1.85, 2);
    light.name = `streetlight-local-${index}`;
    light.castShadow = false;
    group.add(light);
    return light;
  });
  let capacity = 0, signature = '', disposed = false;
  let quality: Quality = 'balanced', blend = 0, enabled = initialState.settings.buildingLights ?? true;
  let nightStrength = 0, timeUntilSelection = 0;
  let lamps: Lamp[] = [], poweredLamps: Lamp[] = [];
  let batches: THREE.InstancedMesh[] = [];
  let bases: THREE.InstancedMesh, poles: THREE.InstancedMesh, arms: THREE.InstancedMesh;
  let housings: THREE.InstancedMesh, offLenses: THREE.InstancedMesh, onLenses: THREE.InstancedMesh, pools: THREE.InstancedMesh;
  const selected: Lamp[] = [];

  function makeBatch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, multiplier = 1) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity * multiplier);
    mesh.name = `streetlight-${name}`;
    mesh.userData.drivingObstacle = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); batches.push(mesh);
    return mesh;
  }

  function ensureCapacity(count: number) {
    if (count <= capacity) return;
    for (const batch of batches) { group.remove(batch); batch.dispose(); }
    batches = [];
    capacity = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    bases = makeBatch('bases', base, footing);
    poles = makeBatch('poles', pole, metal);
    bases.userData.drivingObstacle = poles.userData.drivingObstacle = true;
    arms = makeBatch('arms', box, metal);
    housings = makeBatch('housings', box, metal);
    offLenses = makeBatch('off-lenses', box, unlitLens);
    onLenses = makeBatch('lit-lenses', box, litLens);
    pools = makeBatch('ground-pools', triangle, poolMaterial, 2);
    pools.castShadow = pools.receiveShadow = false;
    pools.renderOrder = 1.5;
    pools.userData.ambientOcclusionExclude = true;
    pools.userData.raytracingExclude = true;
  }

  function place(batch: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    transform.position.set(x, y, z);
    transform.quaternion.identity();
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    batch.setMatrixAt(index, transform.matrix);
  }

  function selectPointLights() {
    selected.length = 0;
    const distances: number[] = [];
    const cap = POINT_LIMIT[quality];
    for (const lamp of poweredLamps) {
      const distance = (lamp.bulb.x - focus.x) ** 2 + (lamp.bulb.z - focus.z) ** 2;
      let index = 0;
      while (index < distances.length && distances[index] <= distance) index++;
      if (index >= cap) continue;
      distances.splice(index, 0, distance); selected.splice(index, 0, lamp);
      if (selected.length > cap) { selected.pop(); distances.pop(); }
    }
    for (let index = 0; index < lights.length; index++) {
      const lamp = selected[index], light = lights[index];
      if (lamp) { light.position.copy(lamp.bulb); light.position.y -= .022; }
      light.intensity = lamp && enabled ? .55 * nightStrength : 0;
    }
    timeUntilSelection = POOL_INTERVAL;
  }

  function applyLighting() {
    nightStrength = THREE.MathUtils.smoothstep(blend, .08, .72);
    litLens.emissiveIntensity = enabled ? .1 + 3.6 * blend : 0;
    poolMaterial.emissiveIntensity = enabled ? nightStrength : 0;
    poolMaterial.opacity = enabled ? .38 * nightStrength : 0;
    pools.visible = enabled && poweredLamps.length > 0 && nightStrength > 0;
    for (let index = 0; index < lights.length; index++) lights[index].intensity = enabled && selected[index] ? .55 * nightStrength : 0;
  }

  function update(state: CityState) {
    if (disposed) return;
    let checksum = 2166136261;
    const tiles: Tile[] = [];
    // All transport elevations participate: nearby road/rail edits affect shared corner heights.
    for (const tile of state.tiles) if (tile.kind === 'road' || tile.kind === 'rail') {
      checksum = Math.imul(checksum ^ (tile.z * state.size + tile.x), 16777619);
      checksum = Math.imul(checksum ^ Math.round(tile.elevation * 65536), 16777619);
      checksum = Math.imul(checksum ^ (tile.kind === 'road' ? 1 : 2), 16777619);
      if (tile.kind === 'road' && (tile.x + tile.z) % 6 === 0) {
        checksum = Math.imul(checksum ^ (tile.powered && tile.fire === 0 ? 1 : 0), 16777619);
        tiles.push(tile);
      }
    }
    const nextSignature = `${state.size}:${checksum >>> 0}`;
    if (signature === nextSignature) return;
    signature = nextSignature;
    ensureCapacity(Math.max(1, tiles.length));
    lamps = []; poweredLamps = [];
    let onCount = 0, offCount = 0;
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index], x = tile.x - state.size / 2 + .5, z = tile.z - state.size / 2 + .5;
      const fixture = getRoadStreetlightFixture(state, tile)!;
      const mastX = fixture.mast.x, lampZ = fixture.mast.z, bulbX = fixture.bulb.x;
      const mastGround = fixture.mast.y - .045, bulbGround = fixture.bulb.y - .49;
      const bulb = fixture.bulb;
      const lamp = { id: tile.z * state.size + tile.x, bulb, powered: tile.powered && tile.fire === 0 };
      lamps.push(lamp);
      place(bases, index, mastX, mastGround + .039, lampZ, .058, .028, .058);
      place(poles, index, mastX, mastGround + .279, lampZ, .028, .468, .028);
      const armStart = new THREE.Vector3(mastX, mastGround + .505, lampZ);
      const armEnd = new THREE.Vector3(bulbX + .023, bulbGround + .505, lampZ);
      delta.copy(armEnd).sub(armStart);
      transform.position.copy(armStart).add(armEnd).multiplyScalar(.5);
      transform.quaternion.setFromUnitVectors(xAxis, delta.clone().normalize());
      transform.scale.set(delta.length(), .024, .031); transform.updateMatrix();
      arms.setMatrixAt(index, transform.matrix);
      place(housings, index, bulbX, bulbGround + .509, lampZ, .095, .017, .070);
      const lensBatch = lamp.powered ? onLenses : offLenses, lensIndex = lamp.powered ? onCount++ : offCount++;
      place(lensBatch, lensIndex, bulbX, bulb.y, lampZ, .073, .024, .052);
      if (!lamp.powered) continue;
      const poolIndex = poweredLamps.length * 2;
      poweredLamps.push(lamp);
      const west = x - POOL_HALF, east = x + POOL_HALF, north = z - POOL_HALF, south = z + POOL_HALF;
      const nw = sampleRoadHeight(state, west, north) + POOL_LIFT;
      const ne = sampleRoadHeight(state, east, north) + POOL_LIFT;
      const se = sampleRoadHeight(state, east, south) + POOL_LIFT;
      const sw = sampleRoadHeight(state, west, south) + POOL_LIFT;
      const width = POOL_HALF * 2;
      // Positive determinants preserve front faces. UV rotation is harmless for the radial texture.
      matrix.set(width, 0, 0, west, ne - nw, 1, se - ne, nw, 0, 0, width, north, 0, 0, 0, 1);
      pools.setMatrixAt(poolIndex, matrix);
      matrix.set(-width, 0, 0, east, sw - se, 1, nw - sw, se, 0, 0, -width, south, 0, 0, 0, 1);
      pools.setMatrixAt(poolIndex + 1, matrix);
    }
    bases.count = poles.count = arms.count = housings.count = tiles.length;
    offLenses.count = offCount; onLenses.count = onCount; pools.count = poweredLamps.length * 2;
    for (const batch of batches) {
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox(); batch.computeBoundingSphere();
    }
    selectPointLights(); applyLighting();
  }

  update(initialState);
  return {
    group, update,
    setLighting(nightBlend: number, value: boolean) {
      if (disposed) return;
      blend = THREE.MathUtils.clamp(Number.isFinite(nightBlend) ? nightBlend : 0, 0, 1);
      enabled = value; applyLighting();
    },
    animate(dt: number, target: THREE.Vector3) {
      if (disposed) return;
      if (Number.isFinite(target.x) && Number.isFinite(target.z)) focus.copy(target);
      timeUntilSelection -= Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (timeUntilSelection <= 0) selectPointLights();
    },
    setQuality(value: Quality) {
      if (disposed || quality === value) return;
      quality = value; selectPointLights();
    },
    getDebug() {
      return { count: lamps.length, litCount: enabled ? poweredLamps.length : 0,
        pointLights: lights.length, activePointLights: lights.filter(light => light.intensity > 0).length,
        groundPools: !disposed && pools.visible ? pools.count / 2 : 0, enabled, nightBlend: blend,
        positions: lamps.slice(0, 128).map(lamp => ({ id: lamp.id, x: lamp.bulb.x, y: lamp.bulb.y, z: lamp.bulb.z, powered: lamp.powered })),
        points: lights.map((light, index) => ({ id: selected[index]?.id ?? null, x: light.position.x, y: light.position.y, z: light.position.z, intensity: light.intensity })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of lights) { light.intensity = 0; light.dispose(); }
      for (const batch of batches) batch.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      texture.dispose();
      lamps = []; poweredLamps = []; selected.length = 0;
      group.clear(); group.removeFromParent();
    },
  };
}
