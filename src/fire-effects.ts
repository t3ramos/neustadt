import * as THREE from 'three';
import { getModelFootprint } from './models';
import type { CityState, Tile } from './types';

/** Fixed GPU budget, even if an entire 128 × 128 city catches fire. */
export const MAX_FIRE_SITES = 256;
const FLAMES_PER_SITE = 6;
const SMOKE_PER_SITE = 6;
const EMBERS_PER_SITE = 8;

export interface FirePatch { x: number; y: number; z: number; width: number; depth: number }
interface FireSite { id: number; tile: Tile; intensity: number; x: number; z: number }
const patch = (x: number, y: number, z: number, width: number, depth: number): FirePatch => ({ x, y, z, width, depth });

/** The main roof surfaces, excluding antennas, chimneys and floodlight poles.
 * Coordinates match models.ts; using the whole model's maximum height would
 * leave a fire floating over those small rooftop details. */
export function getFirePatches(tile: Tile): FirePatch[] {
  const v = Math.abs(tile.variation), level = tile.level;
  let roofs: FirePatch[];
  switch (tile.kind) {
    case 'residential':
      roofs = level === 1 ? [patch(-.04, .62, -.05, .50, .50)]
        : level === 2 ? [patch(-.18, .91, -.03, .28, .5), patch(.18, .91, -.03, .28, .5)]
          : level > 2 ? [patch(0, 1.05 + v % 4 * .19 + .075, 0, .62, .53)] : [patch(0, .04, 0, .55, .55)]; break;
    case 'commercial': {
      const h = 2.6 + v % 6 * .29;
      roofs = level === 1 ? [patch(0, .477, -.045, .66, .55)]
        : level === 2 ? [patch(0, .85 + v % 3 * .19 + .080, 0, .63, .53)]
          : level > 2 ? [patch(-.10, h + .26, -.07, .45, .43), patch(.24, h * .66 + .264, .10, .24, .45)]
            : [patch(0, .04, 0, .55, .55)]; break;
    }
    case 'industrial': roofs = [patch(-.09, level ? .34 + Math.min(level, 3) * .105 + .115 : .04, .07, .54, .54)]; break;
    case 'power': roofs = [patch(-.54, 1.39, .15, 1.45, 1.50)]; break;
    case 'waterpump': roofs = [patch(.48, .71, .32, .55, .7)]; break;
    case 'police': roofs = [patch(-.30, 1.25, -.29, .96, .87)]; break;
    case 'fire': roofs = [patch(-.20, 1.015, -.25, 2.1, .92)]; break;
    case 'hospital': roofs = [patch(-.10, 2.00, -.50, 1.94, .94), patch(.64, 1.20, .25, .76, 1.09)]; break;
    case 'school': roofs = [patch(-.35, 1.03, -.33, 1.60, .80)]; break;
    case 'university': roofs = [patch(0, 1.70, -1.12, 3.22, 1.02), patch(1.52, 1.30, .18, .78, 1.48)]; break;
    case 'stadium': roofs = [patch(0, 1.07, -2.2, 4.25, .3), patch(0, 1.07, 2.2, 4.25, .3)]; break;
    case 'airport': roofs = [patch(-.71, .88, 1.77, 4.30, 1.03), patch(4.06, .88, .26, 1.30, 1.08)]; break;
    case 'seaport': roofs = [patch(-1.46, 1.00, -.07, 1.29, .85)]; break;
    case 'wind': roofs = [patch(0, 2.56, -.055, .18, .3)]; break;
    case 'solar': roofs = [patch(-.75, .39, -.55, 1.15, .55), patch(.75, .39, .34, 1.15, .55)]; break;
    case 'recycling': roofs = [patch(-.48, 1.30, -.45, 1.55, 1.10)]; break;
    case 'tree': roofs = [patch(-.12, .38 * (.94 + v % 4 * .1), -.09, .31, .31)]; break;
    case 'park': roofs = [patch(-.29, .35, -.27, .3, .3), patch(.29, .27, .29, .23, .23)]; break;
    default: roofs = [patch(0, .055, 0, .50, .50)]; break;
  }
  const [width, depth] = getModelFootprint(tile.kind, tile.rotation);
  if (width === 1 && depth === 1) return roofs;
  const angle = -(tile.rotation ?? 0) * Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle);
  return roofs.map(roof => ({
    x: roof.x * cos + roof.z * sin + (width - 1) / 2,
    y: roof.y,
    z: -roof.x * sin + roof.z * cos + (depth - 1) / 2,
    width: tile.rotation % 2 ? roof.depth : roof.width,
    depth: tile.rotation % 2 ? roof.width : roof.depth,
  }));
}

export function fireIntensity(value: number): number {
  return Number.isFinite(value) && value > 0 ? .25 + .75 * THREE.MathUtils.clamp(value / 6, 0, 1) : 0;
}
const hash = (value: number) => { const n = Math.sin(value * 12.9898 + 78.233) * 43758.5453; return n - Math.floor(n); };

const noiseGLSL = /* glsl */`
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) { return noise(p)*.57 + noise(p*2.03+17.2)*.28 + noise(p*4.11-9.1)*.15; }
`;
const vertexShader = /* glsl */`
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
const flameFragment = /* glsl */`
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
const smokeFragment = /* glsl */`
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
const emberFragment = /* glsl */`
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

function particleBatch(name: string, capacity: number, fragmentShader: string, define: string, time: { value: number }) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5,0,0, .5,0,0, -.5,1,0, .5,1,0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 0,1, 1,1], 2));
  geometry.setIndex([0,1,2, 2,1,3]);
  const origins = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const shapes = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aOrigin', origins); geometry.setAttribute('aShape', shapes); geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time }, defines: { [define]: 1 }, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `fire-${name}`; mesh.frustumCulled = false;
  mesh.userData.ambientOcclusionExclude = true; mesh.userData.raytracingExclude = true;
  return { mesh, geometry, material, origins, shapes };
}

/** Three draws with GPU animation; no texture downloads, postprocessing or
 * per-particle allocations in the frame loop. Visuals never mutate the city. */
export function createFireEffects(initialState: CityState) {
  const group = new THREE.Group(); group.name = 'city-fire-effects';
  group.userData.ambientOcclusionExclude = true;
  const time = { value: 0 };
  const flames = particleBatch('flames', MAX_FIRE_SITES * FLAMES_PER_SITE, flameFragment, 'FIRE_FLAME', time);
  const smoke = particleBatch('smoke', MAX_FIRE_SITES * SMOKE_PER_SITE, smokeFragment, 'FIRE_SMOKE', time);
  const embers = particleBatch('embers', MAX_FIRE_SITES * EMBERS_PER_SITE, emberFragment, 'FIRE_EMBER', time);
  group.add(flames.mesh, smoke.mesh, embers.mesh);
  let sites: FireSite[] = [], selected: FireSite[] = [], disposed = false;
  let state = initialState, focusX = 0, focusZ = 0, lastSelectionTime = -1;
  const batches = [flames, smoke, embers];

  function put(batch: typeof flames, i: number, x: number, y: number, z: number, width: number, height: number, seed: number, intensity: number) {
    batch.origins.setXYZ(i, x, y, z); batch.shapes.setXYZW(i, width, height, seed, intensity);
  }
  function selectSites() {
    if (sites.length > MAX_FIRE_SITES) {
      // Sorting happens only at state changes or after substantial camera
      // movement, never once per particle or once per frame.
      sites.sort((a, b) => (a.x-focusX)**2+(a.z-focusZ)**2-((b.x-focusX)**2+(b.z-focusZ)**2) || a.id-b.id);
    }
    selected = sites.slice(0, MAX_FIRE_SITES);
    let f = 0, s = 0, e = 0;
    const half = state.size / 2;
    for (const site of selected) {
      const tile = site.tile, roofs = getFirePatches(tile), baseX = tile.x-half+.5, baseZ = tile.z-half+.5;
      const baseY = Math.max(0, tile.elevation), intensity = site.intensity;
      for (let i = 0; i < FLAMES_PER_SITE; i++) {
        const roof = roofs[i % roofs.length], seed = hash(site.id*13+i*37+state.seed)*91;
        const x = baseX+roof.x+(hash(seed+1)-.5)*roof.width*.78;
        const z = baseZ+roof.z+(hash(seed+2)-.5)*roof.depth*.78;
        const extent = Math.min(1.4, Math.sqrt(roof.width*roof.depth));
        const width = (.25+extent*.30)*(.8+hash(seed+3)*.35)*(.6+intensity*.4);
        const height = (.32+extent*.38)*(.70+hash(seed+4)*.55)*(.48+intensity*.52);
        put(flames, f++, x, baseY+roof.y-.025, z, width, height, seed, intensity);
      }
      for (let i = 0; i < SMOKE_PER_SITE; i++) {
        const roof = roofs[i % roofs.length], seed = hash(site.id*7+i*19+state.seed)*79;
        const extent = Math.min(1.65, Math.sqrt(roof.width*roof.depth));
        put(smoke, s++, baseX+roof.x+(hash(seed+1)-.5)*roof.width*.65, baseY+roof.y+.18,
          baseZ+roof.z+(hash(seed+2)-.5)*roof.depth*.65, .44+extent*.58, .56+extent*.65, seed, intensity);
      }
      for (let i = 0; i < EMBERS_PER_SITE; i++) {
        const roof = roofs[i % roofs.length], seed = hash(site.id*17+i*23+state.seed)*67;
        const extent = Math.min(1.4, Math.sqrt(roof.width*roof.depth));
        put(embers, e++, baseX+roof.x+(hash(seed+1)-.5)*roof.width*.75, baseY+roof.y+.12,
          baseZ+roof.z+(hash(seed+2)-.5)*roof.depth*.75, .013+hash(seed+3)*.008, .032+extent*.018, seed, intensity);
      }
    }
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i], count = [f,s,e][i];
      batch.geometry.instanceCount = count; batch.mesh.visible = count > 0;
      batch.origins.needsUpdate = true; batch.shapes.needsUpdate = true;
    }
    group.visible = selected.length > 0;
  }
  function update(next: CityState) {
    if (disposed) return;
    state = next; sites = [];
    const half = state.size/2, seen = new Set<number>();
    for (const tile of state.tiles) {
      if (fireIntensity(tile.fire) === 0) continue;
      const id = tile.anchor >= 0 ? tile.anchor : tile.z*state.size+tile.x;
      if (seen.has(id)) continue;
      seen.add(id);
      const root = state.tiles[id] ?? tile;
      const [width, depth] = getModelFootprint(root.kind, root.rotation);
      sites.push({ id, tile: root, intensity: fireIntensity(Math.max(root.fire, tile.fire)), x: root.x-half+width/2, z: root.z-half+depth/2 });
    }
    selectSites();
  }
  update(initialState);
  return {
    group, update,
    animate(elapsed: number, focus: { x: number; z: number }) {
      if (disposed) return;
      time.value = Number.isFinite(elapsed) ? elapsed : 0;
      if (sites.length > MAX_FIRE_SITES && elapsed-lastSelectionTime >= .75 && (focus.x-focusX)**2+(focus.z-focusZ)**2>16) {
        focusX = focus.x; focusZ = focus.z; lastSelectionTime = elapsed; selectSites();
      }
    },
    getDebug() {
      return { burningBuildings: sites.length, visibleBuildings: selected.length, maxBuildings: MAX_FIRE_SITES,
        flames: flames.geometry.instanceCount, smoke: smoke.geometry.instanceCount, embers: embers.geometry.instanceCount,
        drawCalls: group.visible ? 3 : 0, time: time.value, disposed,
        sites: selected.map(site => ({ id: site.id, x: site.x, z: site.z, intensity: site.intensity })) };
    },
    dispose() {
      if (disposed) return;
      disposed = true; sites = []; selected = []; group.visible = false;
      group.removeFromParent();
      for (const batch of batches) { batch.geometry.instanceCount = 0; batch.geometry.dispose(); batch.material.dispose(); }
      group.clear();
    },
  };
}
