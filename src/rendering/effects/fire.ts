import * as THREE from 'three';
import { getModelFootprint } from '../buildings/models';
import { commercialHighrise, commercialMedium } from '../buildings/architecture';
import { getFacilityAccess } from '../../buildings/facility-access';
import { buildingVariant, zoneLotDimensions, isEasterEggLot } from '../../buildings/lots';
import type { CityState, Tile } from '../../domain/types';

/** Fixed GPU budget, even if an entire 128 × 128 city catches fire. */
export const MAX_FIRE_SITES = 256;
const FLAMES_PER_SITE = 6;
const SMOKE_PER_SITE = 6;
const EMBERS_PER_SITE = 8;

export interface FirePatch {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  slopeX?: number;
  slopeZ?: number;
}
interface FireSite {
  id: number;
  tile: Tile;
  intensity: number;
  x: number;
  z: number;
}
const patch = (x: number, y: number, z: number, width: number, depth: number): FirePatch => ({
  x,
  y,
  z,
  width,
  depth,
});

/** Roof-plane sampling also keeps particles on pitched surfaces. */
export function firePatchHeight(roof: FirePatch, x: number, z: number): number {
  return roof.y + (roof.slopeX ?? 0) * (x - roof.x) + (roof.slopeZ ?? 0) * (z - roof.z);
}
function gabledPatches(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
): FirePatch[] {
  return [-1, 1].map((side) => ({
    ...patch(x + side * width * 0.24, y + height * 0.52, z, width * 0.42, depth * 0.86),
    slopeX: (-side * height * 2) / width,
  }));
}
const commercialRoofCache = new Map<string, FirePatch[]>();
/** Read authored cap surfaces once per layout, then remove footprints hidden by
 * taller blocks, crowns and antennas. No model construction in the frame loop. */
function commercialRoofs(tile: Tile): FirePatch[] {
  const [w, d] = zoneLotDimensions(tile);
  const key = `${buildingVariant(tile)}:${Math.floor(Math.abs(tile.variation) / 5) % 3}:${tile.level >= 4 ? 4 : tile.level}:${w}:${d}`;
  const cached = commercialRoofCache.get(key);
  if (cached) return cached;
  const model = new THREE.Group();
  if (tile.level === 2) commercialMedium(model, tile, true);
  else commercialHighrise(model, tile, true);
  model.updateMatrixWorld(true);
  const solids: { box: THREE.Box3; roof: boolean }[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh)
      solids.push({
        box: new THREE.Box3().setFromObject(object),
        roof: !!object.userData.fireRoof,
      });
  });
  const result: FirePatch[] = [];
  for (const surface of solids.filter((solid) => solid.roof)) {
    const bounds = surface.box,
      y = bounds.max.y;
    let rectangles = [
      {
        left: bounds.min.x + 0.006,
        right: bounds.max.x - 0.006,
        back: bounds.min.z + 0.006,
        front: bounds.max.z - 0.006,
      },
    ];
    for (const solid of solids) {
      if (solid === surface || solid.box.max.y <= y + 0.012) continue;
      const b = solid.box,
        cut = {
          left: b.min.x - 0.008,
          right: b.max.x + 0.008,
          back: b.min.z - 0.008,
          front: b.max.z + 0.008,
        };
      rectangles = rectangles.flatMap((r) => {
        if (
          cut.right <= r.left ||
          cut.left >= r.right ||
          cut.front <= r.back ||
          cut.back >= r.front
        )
          return [r];
        const left = Math.max(r.left, cut.left),
          right = Math.min(r.right, cut.right);
        return [
          { ...r, right: left },
          { ...r, left: right },
          { left, right, back: r.back, front: Math.max(r.back, cut.back) },
          { left, right, back: Math.min(r.front, cut.front), front: r.front },
        ].filter((piece) => piece.right - piece.left > 0.055 && piece.front - piece.back > 0.055);
      });
    }
    for (const r of rectangles)
      result.push(
        patch(
          (r.left + r.right) / 2,
          y,
          (r.back + r.front) / 2,
          r.right - r.left,
          r.front - r.back,
        ),
      );
  }
  result.sort((a, b) => b.y - a.y || b.width * b.depth - a.width * a.depth);
  // Bounded cache and six useful surfaces match the fixed particles per site.
  if (commercialRoofCache.size >= 128)
    commercialRoofCache.delete(commercialRoofCache.keys().next().value!);
  commercialRoofCache.set(key, result.slice(0, 6));
  return commercialRoofCache.get(key)!;
}

/** Matches zoneArchitecture's broad slabs, excluding roof plant and courtyard trees. */
function zoneRoofs(tile: Tile): FirePatch[] | null {
  const [w, d] = zoneLotDimensions(tile),
    v = buildingVariant(tile);
  if (tile.level === 0) return [patch(0, 0.04, 0, w * 0.8, d * 0.8)];
  if (tile.kind === 'commercial' && tile.level >= 2 && !isEasterEggLot(tile))
    return commercialRoofs(tile);
  if (v === 0 && w === 1 && d === 1) return null;
  const h =
    tile.kind === 'industrial'
      ? 0.42 + tile.level * 0.16
      : tile.kind === 'commercial'
        ? 0.42 + tile.level * 0.36
        : 0.38 + tile.level * 0.25;
  const block = (x: number, z: number, bw: number, bd: number, height: number): FirePatch => {
    const cap = Math.min(bw, bd) * 0.82;
    // The right-hand cap half leaves rooftop machinery to the left untouched.
    return patch(x + cap * 0.23, height + 0.083, z, cap * 0.4, cap * 0.72);
  };
  if (v === 1)
    return [
      block(-w * 0.29, 0, w * 0.23, d * 0.76, h),
      block(w * 0.29, 0, w * 0.23, d * 0.76, h),
      block(0, -d * 0.29, w * 0.38, d * 0.18, h),
    ];
  if (v === 2) return gabledPatches(0, h * 0.7 + 0.035, -d * 0.08, w * 0.85, 0.24, d * 0.62);
  if (v === 3)
    return [0, 1, 2].map((i) => {
      // Green terraces occupy the central cap; their top is a real roof surface.
      return patch(
        -w * 0.26 + i * w * 0.26,
        h * (0.55 + i * 0.3) + 0.145,
        -d * 0.1,
        w * 0.16,
        d * 0.17,
      );
    });
  return [
    block(-w * 0.23, -d * 0.08, w * 0.3, d * 0.48, h * 1.12),
    block(w * 0.23, -d * 0.08, w * 0.3, d * 0.48, h * 0.84),
  ];
}

/** The main roof surfaces, excluding antennas, chimneys and floodlight poles.
 * Coordinates match models.ts; using the whole model's maximum height would
 * leave a fire floating over those small rooftop details. */
export function getFirePatches(tile: Tile, state?: CityState): FirePatch[] {
  if (tile.anchor >= 0 && state && tile.anchor !== tile.z * state.size + tile.x) return [];
  const v = Math.abs(tile.variation),
    level = tile.level;
  let roofs: FirePatch[];
  switch (tile.kind) {
    case 'residential':
      roofs =
        level === 1
          ? [patch(-0.04, 0.62, -0.05, 0.5, 0.5)]
          : level === 2
            ? [patch(-0.18, 0.91, -0.03, 0.28, 0.5), patch(0.18, 0.91, -0.03, 0.28, 0.5)]
            : level > 2
              ? [patch(0, 1.05 + (v % 4) * 0.19 + 0.075, 0, 0.62, 0.53)]
              : [patch(0, 0.04, 0, 0.55, 0.55)];
      break;
    case 'commercial': {
      const h = 2.6 + (v % 6) * 0.29;
      roofs =
        level === 1
          ? [patch(0, 0.477, -0.045, 0.66, 0.55)]
          : level === 2
            ? [patch(0, 0.85 + (v % 3) * 0.19 + 0.08, 0, 0.63, 0.53)]
            : level > 2
              ? [
                  patch(-0.1, h + 0.26, -0.07, 0.45, 0.43),
                  patch(0.24, h * 0.66 + 0.264, 0.1, 0.24, 0.45),
                ]
              : [patch(0, 0.04, 0, 0.55, 0.55)];
      break;
    }
    case 'industrial':
      roofs = [
        patch(-0.09, level ? 0.34 + Math.min(level, 3) * 0.105 + 0.115 : 0.04, 0.07, 0.54, 0.54),
      ];
      break;
    case 'power':
      roofs = [patch(-0.54, 1.39, 0.15, 1.45, 1.5)];
      break;
    case 'waterpump':
      roofs = [patch(0.48, 0.71, 0.32, 0.55, 0.7)];
      break;
    case 'police':
      roofs = [patch(-0.3, 1.25, -0.29, 0.96, 0.87)];
      break;
    case 'fire':
      roofs = [patch(-0.2, 1.015, -0.25, 2.1, 0.92)];
      break;
    case 'hospital':
      roofs = [patch(-0.1, 2.0, -0.5, 1.94, 0.94), patch(0.64, 1.2, 0.25, 0.76, 1.09)];
      break;
    case 'school':
      roofs = [patch(-0.35, 1.03, -0.33, 1.6, 0.8)];
      break;
    case 'university':
      roofs = [patch(0, 1.7, -1.12, 3.22, 1.02), patch(1.52, 1.3, 0.18, 0.78, 1.48)];
      break;
    case 'stadium':
      roofs = [patch(0, 1.07, -2.2, 4.25, 0.3), patch(0, 1.07, 2.2, 4.25, 0.3)];
      break;
    case 'airport':
      roofs = [patch(-0.71, 0.88, 1.77, 4.3, 1.03), patch(4.06, 0.88, 0.26, 1.3, 1.08)];
      break;
    case 'seaport':
      roofs = [patch(-1.46, 1.0, -0.07, 1.29, 0.85)];
      break;
    case 'wind':
      roofs = [patch(0, 2.56, -0.055, 0.18, 0.3)];
      break;
    case 'solar':
      roofs = [patch(-0.75, 0.39, -0.55, 1.15, 0.55), patch(0.75, 0.39, 0.34, 1.15, 0.55)];
      break;
    case 'recycling':
      roofs = [patch(-0.48, 1.3, -0.45, 1.55, 1.1)];
      break;
    case 'tree':
      roofs = [patch(-0.12, 0.38 * (0.94 + (v % 4) * 0.1), -0.09, 0.31, 0.31)];
      break;
    case 'park':
      roofs = [patch(-0.29, 0.35, -0.27, 0.3, 0.3), patch(0.29, 0.27, 0.29, 0.23, 0.23)];
      break;
    default:
      roofs = [patch(0, 0.055, 0, 0.5, 0.5)];
      break;
  }
  const zone = ['residential', 'commercial', 'industrial'].includes(tile.kind);
  if (zone) roofs = zoneRoofs(tile) ?? roofs;
  const easterEgg = isEasterEggLot(tile);
  // Clear rear canopy area measured against the final GLB geometry.
  if (easterEgg) roofs = [patch(-0.06, 0.96081501245, -0.175, 0.26, 0.15)];
  const [width, depth] = tile.lotWidth
    ? zoneLotDimensions(tile)
    : getModelFootprint(tile.kind, tile.rotation);
  const facility = width > 1 || depth > 1;
  const access =
    state && ((!zone && facility) || tile.kind === 'industrial')
      ? getFacilityAccess(state, tile)
      : null;
  const connected = !!access?.connected;
  if (!facility && !connected) return roofs;
  // Driveways inset civic architecture; factory aprons additionally shift and
  // orient the factory toward its access road without changing saved tiles.
  // Apply the content transform before the outer footprint frame, exactly as
  // createTileModel does. Fire must follow the roof, not the original plot.
  const rotation = easterEgg
    ? tile.rotation
    : tile.lotWidth || (zone && tile.kind !== 'industrial')
      ? 0
      : tile.kind === 'industrial' && connected
        ? access!.rotation
        : tile.rotation;
  const sx = connected ? access!.contentScale.x : 1;
  const sz = connected ? access!.contentScale.z : 1;
  const oz = connected ? (access!.contentOffsetZ ?? 0) : 0;
  const oy = connected ? (tile.kind === 'industrial' ? 0.027 : -0.031) : 0;
  const angle = (-(rotation ?? 0) * Math.PI) / 2,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  return roofs.map((roof) => ({
    x: roof.x * sx * cos + (roof.z * sz + oz) * sin + (width - 1) / 2,
    y: roof.y + oy,
    z: -roof.x * sx * sin + (roof.z * sz + oz) * cos + (depth - 1) / 2,
    width: rotation % 2 ? roof.depth * sz : roof.width * sx,
    depth: rotation % 2 ? roof.width * sx : roof.depth * sz,
    ...(roof.slopeX !== undefined || roof.slopeZ !== undefined
      ? {
          slopeX: ((roof.slopeX ?? 0) / sx) * cos + ((roof.slopeZ ?? 0) / sz) * sin,
          slopeZ: (-(roof.slopeX ?? 0) / sx) * sin + ((roof.slopeZ ?? 0) / sz) * cos,
        }
      : {}),
  }));
}

export function fireIntensity(value: number): number {
  return Number.isFinite(value) && value > 0
    ? 0.25 + 0.75 * THREE.MathUtils.clamp(value / 6, 0, 1)
    : 0;
}
const hash = (value: number) => {
  const n = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return n - Math.floor(n);
};

const noiseGLSL = /* glsl */ `
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) { return noise(p)*.57 + noise(p*2.03+17.2)*.28 + noise(p*4.11-9.1)*.15; }
`;
const vertexShader = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec4 aShape;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vIntensity;
  varying float vAge;
  void main() {
    vUv=uv; vSeed=aShape.z; vIntensity=aShape.w;
    float phase=fract(aShape.z*.173);
    vec3 origin=aOrigin;
    vec2 scale=aShape.xy;
    vAge=0.;
    #ifdef FIRE_FLAME
      float pulse=1.+sin(uTime*7.3+aShape.z)*.065+sin(uTime*12.7+aShape.z*1.7)*.035;
      scale.y*=pulse;
      vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
      origin+=right*(sin(uTime*3.7+aShape.z+uv.y*4.)*uv.y*.035);
      vec4 viewPosition=viewMatrix*vec4(origin+right*position.x*scale.x+vec3(0.,position.y*scale.y,0.),1.);
    #else
      #ifdef FIRE_SMOKE
        vAge=fract(uTime*(.13+phase*.045)+phase);
        float rise=vAge*(1.5+aShape.y);
        origin.y+=rise;
        origin.x+=rise*.18+sin(vAge*4.+aShape.z)*.12*vAge;
        origin.z+=sin(vAge*3.+aShape.z*.7)*.17*vAge;
        scale*=.66+vAge*1.85;
      #else
        vAge=fract(uTime*(.36+phase*.18)+phase);
        origin.y+=vAge*(.7+aShape.y*15.);
        origin.x+=sin(vAge*6.+aShape.z)*vAge*.17+vAge*.16;
        origin.z+=cos(vAge*5.+aShape.z)*vAge*.13;
      #endif
      vec4 viewPosition=viewMatrix*vec4(origin,1.);
      viewPosition.xy+=(position.xy-vec2(0.,.5))*scale;
    #endif
    gl_Position=projectionMatrix*viewPosition;
  }
`;
const flameFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying float vSeed; varying float vIntensity;
  ${noiseGLSL}
  void main() {
    vec2 p=vec2(vUv.x*2.-1.,vUv.y);
    float t=uTime*1.9+vSeed;
    float turbulence=fbm(vec2(p.x*4.7,p.y*6.2-t));
    float curl=fbm(vec2(p.x*7.1+vSeed,p.y*9.3-t*1.37));
    float bend=sin(p.y*9.-t*2.1)*(.045+p.y*.20)+(turbulence-.5)*(.22+p.y*.50);
    float front=p.y+(curl-.5)*(.08+p.y*.28);
    // Broad, rolling lower lobes narrow into several moving wisps. The noisy
    // burn front breaks up the tip before a straight triangular edge forms.
    float width=(.43+sin(p.y*3.14159)*.42)*pow(max(0.,1.-front),.56);
    float body=width-abs(p.x+bend)+(turbulence-.5)*.40;
    float alpha=smoothstep(-.095,.24,body)*smoothstep(0.,.075,p.y)*(1.-smoothstep(.72,.97,front));
    alpha*=mix(.30,1.,smoothstep(.18,.66,turbulence));
    float core=(1.-smoothstep(.06,.35,abs(p.x+bend)))*(1.-smoothstep(.12,.55,p.y));
    vec3 color=mix(vec3(1.05,.12,.009),vec3(1.35,.56,.045),smoothstep(.04,.23,body));
    color=mix(color,vec3(1.5,1.10,.38),core*.72);
    color=mix(color,vec3(.88,.035,.002),p.y*.28);
    gl_FragColor=vec4(color,alpha*(.60+vIntensity*.30));
    if(gl_FragColor.a<.015)discard;
    #include <colorspace_fragment>
  }
`;
const smokeFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying float vSeed; varying float vIntensity; varying float vAge;
  ${noiseGLSL}
  void main() {
    vec2 p=(vUv-.5)*2.;
    float a=vSeed*.71+vAge*.8;
    p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
    float clouds=fbm(p*2.9+vec2(vSeed,vAge*1.7));
    float edge=1.-dot(p,p)+(clouds-.5)*.90;
    float alpha=smoothstep(0.,.95,edge)*smoothstep(0.,.075,vAge)*(1.-smoothstep(.56,1.,vAge));
    alpha*= (.25+vIntensity*.31)*(.45+clouds*.55);
    vec3 color=mix(vec3(.030,.027,.024),vec3(.16,.15,.14),clouds*.62+vAge*.20);
    gl_FragColor=vec4(color,alpha);
    if(alpha<.005)discard;
    #include <colorspace_fragment>
  }
`;
const emberFragment = /* glsl */ `
  varying vec2 vUv; varying float vSeed; varying float vIntensity; varying float vAge;
  void main() {
    vec2 p=(vUv-.5)*2.;
    float alpha=(1.-smoothstep(.15,1.,dot(p,p)))*(1.-smoothstep(.40,1.,vAge));
    alpha*=smoothstep(0.,.06,vAge)*vIntensity;
    gl_FragColor=vec4(mix(vec3(1.5,.72,.12),vec3(1.,.14,.004),vAge),alpha);
    if(alpha<.01)discard;
    #include <colorspace_fragment>
  }
`;

function particleBatch(
  name: string,
  capacity: number,
  fragmentShader: string,
  define: string,
  time: { value: number },
) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const origins = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  const shapes = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
    THREE.DynamicDrawUsage,
  );
  geometry.setAttribute('aOrigin', origins);
  geometry.setAttribute('aShape', shapes);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    defines: { [define]: 1 },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `fire-${name}`;
  mesh.frustumCulled = false;
  mesh.userData.ambientOcclusionExclude = true;
  mesh.userData.raytracingExclude = true;
  return { mesh, geometry, material, origins, shapes };
}

/** Three draws with GPU animation; no texture downloads, postprocessing or
 * per-particle allocations in the frame loop. Visuals never mutate the city. */
export function createFireEffects(initialState: CityState) {
  const group = new THREE.Group();
  group.name = 'city-fire-effects';
  group.userData.ambientOcclusionExclude = true;
  const time = { value: 0 };
  const flames = particleBatch(
    'flames',
    MAX_FIRE_SITES * FLAMES_PER_SITE,
    flameFragment,
    'FIRE_FLAME',
    time,
  );
  const smoke = particleBatch(
    'smoke',
    MAX_FIRE_SITES * SMOKE_PER_SITE,
    smokeFragment,
    'FIRE_SMOKE',
    time,
  );
  const embers = particleBatch(
    'embers',
    MAX_FIRE_SITES * EMBERS_PER_SITE,
    emberFragment,
    'FIRE_EMBER',
    time,
  );
  group.add(flames.mesh, smoke.mesh, embers.mesh);
  let sites: FireSite[] = [],
    selected: FireSite[] = [],
    disposed = false;
  let state = initialState,
    focusX = 0,
    focusZ = 0,
    lastSelectionTime = -1;
  const batches = [flames, smoke, embers];

  function put(
    batch: typeof flames,
    i: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    seed: number,
    intensity: number,
  ) {
    batch.origins.setXYZ(i, x, y, z);
    batch.shapes.setXYZW(i, width, height, seed, intensity);
  }
  function selectSites() {
    if (sites.length > MAX_FIRE_SITES) {
      // Sorting happens only at state changes or after substantial camera
      // movement, never once per particle or once per frame.
      sites.sort(
        (a, b) =>
          (a.x - focusX) ** 2 + (a.z - focusZ) ** 2 - ((b.x - focusX) ** 2 + (b.z - focusZ) ** 2) ||
          a.id - b.id,
      );
    }
    selected = sites.slice(0, MAX_FIRE_SITES);
    let f = 0,
      s = 0,
      e = 0;
    const half = state.size / 2;
    for (const site of selected) {
      const tile = site.tile,
        roofs = getFirePatches(tile, state),
        baseX = tile.x - half + 0.5,
        baseZ = tile.z - half + 0.5;
      const baseY = Math.max(0, tile.elevation),
        intensity = site.intensity;
      for (let i = 0; i < FLAMES_PER_SITE; i++) {
        const roof = roofs[i % roofs.length],
          seed = hash(site.id * 13 + i * 37 + state.seed) * 91;
        const x = baseX + roof.x + (hash(seed + 1) - 0.5) * roof.width * 0.78;
        const z = baseZ + roof.z + (hash(seed + 2) - 0.5) * roof.depth * 0.78;
        const extent = Math.min(1.4, Math.sqrt(roof.width * roof.depth));
        const width =
          (0.25 + extent * 0.3) * (0.8 + hash(seed + 3) * 0.35) * (0.6 + intensity * 0.4);
        const height =
          (0.32 + extent * 0.38) * (0.7 + hash(seed + 4) * 0.55) * (0.48 + intensity * 0.52);
        put(
          flames,
          f++,
          x,
          baseY + firePatchHeight(roof, x - baseX, z - baseZ) - 0.025,
          z,
          width,
          height,
          seed,
          intensity,
        );
      }
      for (let i = 0; i < SMOKE_PER_SITE; i++) {
        const roof = roofs[i % roofs.length],
          seed = hash(site.id * 7 + i * 19 + state.seed) * 79;
        const extent = Math.min(1.65, Math.sqrt(roof.width * roof.depth));
        const x = roof.x + (hash(seed + 1) - 0.5) * roof.width * 0.65,
          z = roof.z + (hash(seed + 2) - 0.5) * roof.depth * 0.65;
        put(
          smoke,
          s++,
          baseX + x,
          baseY + firePatchHeight(roof, x, z) + 0.18,
          baseZ + z,
          0.44 + extent * 0.58,
          0.56 + extent * 0.65,
          seed,
          intensity,
        );
      }
      for (let i = 0; i < EMBERS_PER_SITE; i++) {
        const roof = roofs[i % roofs.length],
          seed = hash(site.id * 17 + i * 23 + state.seed) * 67;
        const extent = Math.min(1.4, Math.sqrt(roof.width * roof.depth));
        const x = roof.x + (hash(seed + 1) - 0.5) * roof.width * 0.75,
          z = roof.z + (hash(seed + 2) - 0.5) * roof.depth * 0.75;
        put(
          embers,
          e++,
          baseX + x,
          baseY + firePatchHeight(roof, x, z) + 0.12,
          baseZ + z,
          0.013 + hash(seed + 3) * 0.008,
          0.032 + extent * 0.018,
          seed,
          intensity,
        );
      }
    }
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i],
        count = [f, s, e][i];
      batch.geometry.instanceCount = count;
      batch.mesh.visible = count > 0;
      batch.origins.needsUpdate = true;
      batch.shapes.needsUpdate = true;
    }
    group.visible = selected.length > 0;
  }
  function update(next: CityState) {
    if (disposed) return;
    state = next;
    sites = [];
    const half = state.size / 2,
      seen = new Set<number>();
    for (const tile of state.tiles) {
      if (fireIntensity(tile.fire) === 0) continue;
      const id = tile.anchor >= 0 ? tile.anchor : tile.z * state.size + tile.x;
      if (seen.has(id)) continue;
      seen.add(id);
      const root = state.tiles[id] ?? tile;
      const [width, depth] = root.lotWidth
        ? zoneLotDimensions(root)
        : getModelFootprint(root.kind, root.rotation);
      sites.push({
        id,
        tile: root,
        intensity: fireIntensity(Math.max(root.fire, tile.fire)),
        x: root.x - half + width / 2,
        z: root.z - half + depth / 2,
      });
    }
    selectSites();
  }
  update(initialState);
  return {
    group,
    update,
    animate(elapsed: number, focus: { x: number; z: number }) {
      if (disposed) return;
      time.value = Number.isFinite(elapsed) ? elapsed : 0;
      if (
        sites.length > MAX_FIRE_SITES &&
        elapsed - lastSelectionTime >= 0.75 &&
        (focus.x - focusX) ** 2 + (focus.z - focusZ) ** 2 > 16
      ) {
        focusX = focus.x;
        focusZ = focus.z;
        lastSelectionTime = elapsed;
        selectSites();
      }
    },
    getDebug() {
      return {
        burningBuildings: sites.length,
        visibleBuildings: selected.length,
        maxBuildings: MAX_FIRE_SITES,
        flames: flames.geometry.instanceCount,
        smoke: smoke.geometry.instanceCount,
        embers: embers.geometry.instanceCount,
        drawCalls: group.visible ? 3 : 0,
        time: time.value,
        disposed,
        sites: selected.map((site) => ({
          id: site.id,
          x: site.x,
          z: site.z,
          intensity: site.intensity,
        })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sites = [];
      selected = [];
      group.visible = false;
      group.removeFromParent();
      for (const batch of batches) {
        batch.geometry.instanceCount = 0;
        batch.geometry.dispose();
        batch.material.dispose();
      }
      group.clear();
    },
  };
}
