import * as THREE from 'three';
import { createDetailedCar } from './vehicle-model';
import { tr } from './i18n';
import { getFacilityAccess, sampleFacilityAccessHeight, facilityWorldToLocal, type FacilityAccessPlan } from './facility-access';
import type { CityState, Tile, Tool } from './types';

// Shared primitives and an intentionally small palette keep an entire city
// inexpensive to batch, while the silhouettes remain readable from above.
const palette = {
  stone: 0xe4d9bf, cream: 0xf6e8ca, white: 0xfff9e8, concrete: 0xbfc4b6,
  sidewalk: 0xc3c5b4, asphalt: 0x53626a, line: 0xf2e8ba, dark: 0x334852,
  terracotta: 0xb36f50, rust: 0x965746, roof: 0x637c80, glass: 0x588c9c,
  glassLight: 0x80afba, glassDark: 0x396b7c, blue: 0x367d9a, red: 0xc75948,
  yellow: 0xe5b65e, green: 0x68935d, grass: 0x8fb777, forest: 0x3e7657,
  leaf: 0x658c56, leafLight: 0x91a35a, trunk: 0x7c634a, water: 0x63b4c5,
  metal: 0x9aaba9, rail: 0x6b7777, wood: 0x937855, violet: 0x927e9e,
  solarCell: 0x1b3d56,
};

const materialCache = new Map<number, THREE.MeshStandardMaterial>();
let modelNightBlend = 0;
let modelWet = false;
let facilityPavingMaterial: THREE.MeshStandardMaterial | undefined;

function updateWetMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  const isGlass = [palette.glass, palette.glassLight, palette.glassDark].includes(color);
  const wettable = [palette.asphalt, palette.roof, palette.concrete, palette.sidewalk, palette.stone, palette.terracotta].includes(color);
  material.roughness = isGlass ? .27 : modelWet && wettable ? (color === palette.asphalt ? .18 : color === palette.roof ? .29 : .36) : .84;
  material.metalness = isGlass ? .23 : modelWet && wettable ? .09 : .02;
}

export function setModelWet(wet: boolean): void {
  modelWet = wet;
  for (const [color, material] of materialCache) updateWetMaterial(material, color);
  if (facilityPavingMaterial) updateWetMaterial(facilityPavingMaterial, palette.asphalt);
}
function updateNightMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  if ([palette.glass, palette.glassLight, palette.glassDark].includes(color)) {
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  }
}

export function setModelNightBlend(blend: number): void {
  modelNightBlend = Number.isFinite(blend) ? Math.max(0, Math.min(1, blend)) : 0;
  for (const [color, material] of materialCache) updateNightMaterial(material, color);
  for (const [color, material] of buildingWindowMaterials) updateBuildingWindowMaterial(material, color);
}

export function setModelNight(night: boolean): void {
  setModelNightBlend(night ? 1 : 0);
}

export function modelMaterial(color: number): THREE.MeshStandardMaterial {
  let material = materialCache.get(color);
  if (!material) {
    const isGlass = [palette.glass, palette.glassLight, palette.glassDark].includes(color);
    material = new THREE.MeshStandardMaterial({ color, roughness: isGlass ? .27 : .84, metalness: isGlass ? .23 : .02 });
    material.forceSinglePass = true;
    if (isGlass) material.userData.glazing = true;

    updateNightMaterial(material, color);
    updateWetMaterial(material, color);
    materialCache.set(color, material);
  }
  return material;
}

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const coneGeometry = new THREE.ConeGeometry(0.5, 1, 7);
const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const sphereGeometry = new THREE.IcosahedronGeometry(0.5, 1);
const crownGeometry = new THREE.IcosahedronGeometry(0.5, 0);
// Forest geometry is shared and instanced by the renderer. Smooth canopies have
// enough contour detail at street height without multiplying every forest tile
// into a high-poly asset (248–296 triangles per individual tree).
const treeTrunkGeometry = new THREE.CylinderGeometry(.36, .5, 1, 8);
const treeBranchGeometry = new THREE.CylinderGeometry(.22, .5, 1, 5);
const treeCrownGeometry = new THREE.SphereGeometry(.5, 10, 8);
const treeCrownSmallGeometry = new THREE.SphereGeometry(.5, 8, 6);
const evergreenGeometry = new THREE.LatheGeometry([
  new THREE.Vector2(.05, 0), new THREE.Vector2(.46, .04),
  new THREE.Vector2(.38, .14), new THREE.Vector2(.25, .26),
  new THREE.Vector2(.38, .29), new THREE.Vector2(.26, .42),
  new THREE.Vector2(.15, .55), new THREE.Vector2(.27, .58),
  new THREE.Vector2(.14, .77), new THREE.Vector2(0, 1),
], 12);
const roofGeometry = new THREE.BufferGeometry();
// Gabled prism: ridge runs along local z. All dimensions are unit length.
roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -.5,0,-.5, 0,1,-.5, .5,0,-.5,
  -.5,0,.5, .5,0,.5, 0,1,.5,
  -.5,0,-.5, 0,1,.5, 0,1,-.5, -.5,0,-.5, -.5,0,.5, 0,1,.5,
  0,1,-.5, .5,0,.5, .5,0,-.5, 0,1,-.5, 0,1,.5, .5,0,.5,
  -.5,0,-.5, .5,0,.5, -.5,0,.5, -.5,0,-.5, .5,0,-.5, .5,0,.5,
], 3));
roofGeometry.computeVertexNormals();

function mesh(group: THREE.Group, geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Mesh {
  const result = new THREE.Mesh(geometry, modelMaterial(color));
  result.position.set(x, y, z);
  result.scale.set(sx, sy, sz);
  result.rotation.y = ry;
  result.castShadow = true;
  result.receiveShadow = true;
  group.add(result);
  return result;
}

function box(g: THREE.Group, c: number, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0): THREE.Mesh {
  return mesh(g, boxGeometry, c, x, y, z, w, h, d, angle);
}
function cylinder(g: THREE.Group, c: number, x: number, y: number, z: number, w: number, h: number, d = w): THREE.Mesh {
  return mesh(g, cylinderGeometry, c, x, y, z, w, h, d);
}
function roof(g: THREE.Group, c: number, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0): void {
  mesh(g, roofGeometry, c, x, y, z, w, h, d, angle);
}
function slab(g: THREE.Group, color = palette.concrete, width = .9, depth = .9): void {
  box(g, color, 0, .014, 0, width, .028, depth);
}
function tree(g: THREE.Group, x: number, z: number, scale: number, variant = 0): void {
  const species = Math.abs(variant) % 4;
  const bark = species === 2 ? palette.cream : palette.trunk;
  mesh(g, treeTrunkGeometry, bark, x, .21 * scale, z, .064 * scale, .42 * scale, .064 * scale);
  if (species === 0) {
    // A continuous, rounded twelve-sided profile retains the layered silhouette
    // of a conifer rather than placing a pair of coarse cones on a stick.
    mesh(g, evergreenGeometry, palette.forest, x, .17 * scale, z, .44 * scale, .69 * scale, .44 * scale);
    return;
  }
  const birch = species === 2;
  const branch = mesh(g, treeBranchGeometry, bark, x + .058 * scale, .35 * scale, z + .025 * scale, .027 * scale, .20 * scale, .027 * scale);
  branch.rotation.z = -.57;
  branch.rotation.x = .2;
  mesh(g, treeCrownGeometry, species === 1 ? palette.leaf : species === 2 ? palette.leafLight : palette.forest,
    x - .035 * scale, (birch ? .48 : .45) * scale, z - .006 * scale,
    (birch ? .34 : .38) * scale, (birch ? .57 : .49) * scale, (birch ? .35 : .41) * scale);
  mesh(g, treeCrownSmallGeometry, species === 3 ? palette.leaf : palette.leafLight,
    x + .115 * scale, (birch ? .51 : .4) * scale, z + .06 * scale,
    .22 * scale, (birch ? .39 : .34) * scale, .28 * scale);
  if (birch) for (const y of [.15, .28]) box(g, palette.trunk, x, y * scale, z + .027 * scale, .038 * scale, .018 * scale, .009 * scale);
}
function ribbon(g: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, color = palette.glassDark): void {
  // Two long windows are enough to read as glazing without hundreds of tiny panes.
  box(g, color, x, y, z + d / 2 + .003, w * .77, h, .008);
  box(g, color, x + w / 2 + .003, y, z, .008, h, d * .76);
  box(g, color, x, y, z - d / 2 - .003, w * .77, h, .008);
}
function rooftop(g: THREE.Group, x: number, y: number, z: number, width: number): void {
  box(g, palette.roof, x, y + .024, z, width, .048, width * .84);
  box(g, palette.metal, x - width * .17, y + .073, z - width * .15, width * .2, .05, width * .24);
}

function zone(g: THREE.Group, color: number, variation: number): void {
  const light = new THREE.Color(color).lerp(new THREE.Color(palette.grass), .45).getHex();
  box(g, light, 0, .008, 0, .94, .016, .94);
  box(g, color, 0, .019, -.455, .93, .009, .018);
  box(g, color, 0, .019, .455, .93, .009, .018);
  box(g, color, -.455, .019, 0, .018, .009, .89);
  box(g, color, .455, .019, 0, .018, .009, .89);
  for (let n = 0; n < 3; n++) {
    box(g, color, (n - 1) * .2, .021, .02, .12, .012, .035);
  }
  if (variation % 4 === 0) tree(g, -.3, -.29, .36, 1);
}

const buildingWindowMaterials = new Map<number, THREE.MeshStandardMaterial>();
function updateBuildingWindowMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  material.color.setHex(color).lerp(new THREE.Color(0xffd59a), Math.sqrt(modelNightBlend) * .88);
  material.emissive.setHex(0xffd39a);
  material.emissiveIntensity = modelNightBlend * .20;
}
function buildingWindowMaterial(color: number): THREE.MeshStandardMaterial {
  let material = buildingWindowMaterials.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: .27, metalness: .23 });
    material.userData.buildingWindowLight = true;
    material.forceSinglePass = true;
    buildingWindowMaterials.set(color, material);
  }
  updateBuildingWindowMaterial(material, color);
  return material;
}

// Small, deterministic lit panes sit on the original opaque v1 facades. They
// never turn the entire blue tower/window-band material into an emitting wall.
function addBuildingWindowLights(g: THREE.Group, tile: Tile): void {
  type WindowPatch = { parent: THREE.Object3D; position: THREE.Vector3; scale: THREE.Vector3; color: number; score: number };
  const candidates: WindowPatch[] = [];
  let sequence = 0;
  const offer = (source: THREE.Mesh, x: number, y: number, z: number, w: number, h: number, d: number): void => {
    const value = Math.sin((Math.abs(tile.variation) + 1) * 12.9898 + ++sequence * 78.233) * 43758.5453;
    const score = value - Math.floor(value);
    if (score > .35 || !source.parent) return;
    candidates.push({ parent: source.parent, position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(w, h, d), color: (source.material as THREE.MeshStandardMaterial).color.getHex(), score });
  };
  g.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || !object.material.userData.glazing || object.geometry.type !== 'BoxGeometry') return;
    if (Math.abs(object.rotation.x) + Math.abs(object.rotation.y) + Math.abs(object.rotation.z) > 1e-6) return;
    const p = object.position, s = object.scale;
    if (s.y >= .4 && s.x >= .18 && s.z >= .18) {
      const rows = Math.max(3, Math.min(10, Math.floor(s.y / .26)));
      for (let row = 0; row < rows; row++) {
        const y = p.y - s.y / 2 + (row + .5) * s.y / rows;
        for (let column = 0; column < 3; column++) {
          const u = (column - 1) * .27;
          for (const side of [-1, 1]) {
            offer(object, p.x + u * s.x, y, p.z + side * (s.z / 2 + .0015), Math.min(.075, s.x * .14), .095, .002);
            offer(object, p.x + side * (s.x / 2 + .0015), y, p.z + u * s.z, .002, .095, Math.min(.075, s.z * .14));
          }
        }
      }
    } else if (s.y >= .075 && s.y <= .32) {
      if (s.z <= .04 && s.x >= .075) {
        for (let i = 0; i < Math.min(3, Math.max(1, Math.floor(s.x / .17))); i++) {
          const x = p.x + (i - (Math.min(3, Math.max(1, Math.floor(s.x / .17))) - 1) / 2) * .14;
          offer(object, x, p.y, p.z + s.z / 2 + .001, Math.min(.075, s.x * .55), Math.min(.085, s.y * .72), .002);
          offer(object, x, p.y, p.z - s.z / 2 - .001, Math.min(.075, s.x * .55), Math.min(.085, s.y * .72), .002);
        }
      } else if (s.x <= .04 && s.z >= .075) {
        offer(object, p.x + s.x / 2 + .001, p.y, p.z, .002, Math.min(.085, s.y * .72), Math.min(.075, s.z * .55));
        offer(object, p.x - s.x / 2 - .001, p.y, p.z, .002, Math.min(.085, s.y * .72), Math.min(.075, s.z * .55));
      }
    }
  });
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates.slice(0, 16)) {
    const patch = new THREE.Mesh(boxGeometry, buildingWindowMaterial(candidate.color));
    patch.name = 'building-window-light'; patch.userData.buildingWindowLight = true;
    patch.position.copy(candidate.position); patch.scale.copy(candidate.scale);
    patch.castShadow = false; patch.receiveShadow = true;
    candidate.parent.add(patch);
  }
}

// Original v1 RCI silhouettes and dimensions.
function residential(g: THREE.Group, tile: Tile): void {
  const v = Math.abs(tile.variation);
  if (!tile.level) { zone(g, 0x66a276, v); return; }
  slab(g, palette.grass);
  if (tile.level === 1) {
    const walls = [palette.cream, 0xe6c7a9, 0xcdd5bf, 0xe9d7b7][v % 4];
    box(g, palette.stone, .03, .034, .1, .69, .04, .74);
    box(g, walls, -.04, .24, -.05, .49, .42, .5);
    roof(g, v % 2 ? palette.terracotta : palette.roof, -.04, .45, -.05, .59, .23, .61);
    box(g, palette.rust, .09, .63, -.17, .073, .28, .082);
    box(g, palette.wood, -.07, .147, .204, .09, .23, .013);
    box(g, palette.glass, -.195, .275, .205, .11, .13, .016);
    box(g, palette.glass, .108, .275, .205, .11, .13, .016);
    box(g, palette.white, -.195, .213, .216, .145, .018, .025);
    box(g, palette.white, .108, .213, .216, .145, .018, .025);
    box(g, palette.stone, -.07, .024, .345, .13, .02, .24);
    tree(g, .32, -.26, .76, v);
    box(g, palette.forest, -.36, .085, -.06, .055, .14, .65);
  } else if (tile.level === 2) {
    for (let i = 0; i < 2; i++) {
      const x = (i - .5) * .36;
      box(g, i ? 0xdbc6ac : 0xe9ddc2, x, .405, -.03, .34, .75, .54);
      roof(g, v % 2 ? palette.terracotta : palette.roof, x, .78, -.03, .37, .18, .61);
      for (let j = 0; j < 2; j++) box(g, palette.glassDark, x, .32 + j * .27, .245, .25, .14, .015);
      box(g, palette.dark, x - .085, .16, .245, .085, .26, .014);
      box(g, palette.cream, x, .26, .29, .34, .035, .11);
    }
    tree(g, .32, .36, .47, v + 1);
  } else {
    const h = 1.05 + (v % 4) * .19;
    box(g, v % 2 ? palette.stone : 0xd0d5bd, 0, h / 2 + .035, 0, .66, h, .61);
    for (let level = 0; level < 4; level++) {
      const y = .22 + level * (h - .21) / 4;
      ribbon(g, 0, y, 0, .66, .10, .61);
      box(g, palette.cream, 0, y - .07, .348, .72, .029, .10);
    }
    rooftop(g, 0, h + .035, 0, .72);
    box(g, palette.dark, 0, .14, .316, .11, .23, .015);
    tree(g, -.36, .33, .53, v);
  }
}

function commercial(g: THREE.Group, tile: Tile): void {
  const v = Math.abs(tile.variation);
  if (!tile.level) { zone(g, 0x548fac, v); return; }
  slab(g);
  if (tile.level === 1) {
    box(g, palette.cream, 0, .23, -.05, .74, .42, .61);
    box(g, palette.glassDark, 0, .205, .261, .62, .27, .018);
    box(g, palette.roof, 0, .459, -.045, .79, .049, .68);
    box(g, palette.yellow, 0, .37, .292, .78, .04, .24);
    for (let j = 0; j < 4; j++) box(g, v % 2 ? palette.red : palette.blue, -.30 + j * .20, .396, .30, .10, .018, .22);
    box(g, palette.blue, 0, .52, .08, .39, .09, .043);
    box(g, palette.cream, 0, .52, .106, .25, .017, .005);
    box(g, palette.white, 0, .205, .277, .025, .27, .012);
    box(g, palette.green, -.39, .08, .33, .1, .11, .19);
  } else if (tile.level === 2) {
    const h = .85 + (v % 3) * .19;
    box(g, palette.stone, 0, h / 2 + .04, 0, .69, h, .66);
    for (let j = 0; j < 3; j++) {
      ribbon(g, 0, .22 + j * h / 3, 0, .69, h * .20, .66, palette.glass);
    }
    box(g, palette.white, -.27, h / 2 + .04, .34, .04, h, .04);
    box(g, palette.white, .27, h / 2 + .04, .34, .04, h, .04);
    rooftop(g, 0, h + .04, 0, .75);
  } else {
    const h = 2.6 + (v % 6) * .29;
    const color = v % 2 ? palette.glass : palette.glassLight;
    box(g, palette.stone, 0, .125, 0, .87, .20, .85);
    box(g, color, -.10, h / 2 + .22, -.07, .54, h, .59);
    box(g, palette.glassDark, .24, h * .33 + .22, .1, .29, h * .66, .52);
    for (let j = 1; j < 7; j++) {
      box(g, palette.concrete, -.1, .22 + h * j / 7, -.07, .554, .026, .606);
    }
    box(g, palette.white, -.37, h / 2 + .22, -.07, .032, h, .62);
    box(g, palette.white, .17, h / 2 + .22, -.07, .025, h, .61);
    rooftop(g, -.10, h + .22, -.07, .57);
    if (v % 2 === 0) {
      box(g, palette.glassDark, -.10, h + .38, -.07, .23, .28, .25);
      cylinder(g, palette.metal, -.10, h + .70, -.07, .025, .40);
    }
    box(g, palette.white, .24, h * .66 + .25, .1, .33, .04, .55);
    box(g, palette.blue, 0, .18, .43, .2, .23, .025);
  }
}

function industrial(g: THREE.Group, tile: Tile, connected = false): void {
  const v = Math.abs(tile.variation);
  if (!tile.level) { zone(g, 0xc6a958, v); return; }
  if (connected) foundation(g, 1, 1, 0xb4b29b);
  else slab(g, 0xb4b29b);
  const h = .34 + Math.min(tile.level, 3) * .105;
  box(g, v % 2 ? 0xb2ae98 : 0xc6b692, -.09, h / 2 + .025, .07, .65, h, .61);
  for (let i = 0; i < 3; i++) {
    roof(g, palette.roof, -.305 + i * .215, h + .025, .07, .22, .15, .65);
    box(g, palette.glass, -.305 + i * .215, h - .05, .379, .15, .074, .012);
  }
  box(g, palette.dark, -.1, .18, .381, .22, .27, .015);
  box(g, palette.yellow, -.1, .322, .395, .28, .032, .027);
  const chimneyHeight = .65 + tile.level * .18;
  cylinder(g, palette.rust, .31, chimneyHeight / 2, -.23, .12, chimneyHeight);
  cylinder(g, palette.cream, .31, chimneyHeight * .83, -.23, .123, .075);
  cylinder(g, palette.dark, .31, chimneyHeight + .009, -.23, .085, .022);
  cylinder(g, palette.metal, .32, .18, .22, .19, .33);
  mesh(g, sphereGeometry, palette.metal, .32, .35, .22, .19, .10, .19);
  if (tile.level > 1) {
    box(g, palette.dark, -.22, .07, -.34, .23, .09, .14);
    box(g, palette.terracotta, .05, .08, -.34, .18, .11, .14);
  }
}

function road(g: THREE.Group, tile: Tile, state: CityState): void {
  const connects = (dx: number, dz: number): boolean => {
    const x = tile.x + dx, z = tile.z + dz;
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) return false;
    return state.tiles[z * state.size + x]?.kind === 'road';
  };
  const north = connects(0, -1), east = connects(1, 0), south = connects(0, 1), west = connects(-1, 0);
  const horizontal = east || west;
  const vertical = north || south;
  const count = Number(north) + Number(east) + Number(south) + Number(west);
  slab(g, palette.sidewalk, 1, 1);
  box(g, palette.asphalt, 0, .033, 0, .67, .025, .67);
  if (north || (!horizontal && !vertical)) box(g, palette.asphalt, 0, .033, -.33, .67, .025, .34);
  if (south || (!horizontal && !vertical)) box(g, palette.asphalt, 0, .033, .33, .67, .025, .34);
  if (east) box(g, palette.asphalt, .33, .033, 0, .34, .025, .67);
  if (west) box(g, palette.asphalt, -.33, .033, 0, .34, .025, .67);
  // A property's selected gate opens the curb at its real lane position.
  // It is a driveway, so it never invents another arm in intersection markings.
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const x = tile.x + dx, z = tile.z + dz;
    if (x < 0 || z < 0 || x >= state.size || z >= state.size) continue;
    const neighbor = state.tiles[z * state.size + x];
    if (!FACILITY_FOOTPRINTS[neighbor.kind] && !(neighbor.kind === 'industrial' && neighbor.level > 0)) continue;
    const access = getFacilityAccess(state, neighbor);
    if (!access?.connected || access.road?.x !== tile.x || access.road.z !== tile.z
      || access.previous?.x !== x || access.previous.z !== z) continue;
    const end = access.points[access.points.length - 1];
    const offsetX = end.x - (tile.x - state.size / 2 + .5);
    const offsetZ = end.z - (tile.z - state.size / 2 + .5);
    const apron = box(g, palette.asphalt, dx ? dx * .4075 : offsetX, .033,
      dz ? dz * .4075 : offsetZ, dx ? .185 : access.laneWidth, .025, dz ? .185 : access.laneWidth);
    apron.name = 'road-facility-apron';
    apron.userData.drivingSurface = true;
  }
  if (count <= 2) {
    if ((north && south) || (!horizontal && !vertical) || (vertical && !horizontal)) {
      for (let j = 0; j < 3; j++) box(g, palette.line, 0, .047, (j - 1) * .34, .022, .004, .17);
    } else if (horizontal && !vertical) {
      for (let j = 0; j < 3; j++) box(g, palette.line, (j - 1) * .34, .047, 0, .17, .004, .022);
    } else {
      if (north) box(g, palette.line, 0, .047, -.30, .022, .004, .24);
      if (south) box(g, palette.line, 0, .047, .30, .022, .004, .24);
      if (east) box(g, palette.line, .30, .047, 0, .24, .004, .022);
      if (west) box(g, palette.line, -.30, .047, 0, .24, .004, .022);
    }
  } else {
    for (let j = 0; j < 4; j++) {
      const p = (j - 1.5) * .13;
      if (north) box(g, palette.white, p, .047, -.36, .075, .004, .12);
      if (south) box(g, palette.white, p, .047, .36, .075, .004, .12);
      if (east) box(g, palette.white, .36, .047, p, .12, .004, .075);
      if (west) box(g, palette.white, -.36, .047, p, .12, .004, .075);
    }
  }
  if ((tile.x + tile.z) % 6 === 0) {
    cylinder(g, palette.dark, -.413, .265, .405, .025, .48);
    box(g, palette.dark, -.343, .505, .405, .16, .025, .035);
    box(g, palette.cream, -.275, .49, .405, .07, .024, .052);
  }
}

function rail(g: THREE.Group, tile: Tile, state: CityState): void {
  const isRail = (x: number, z: number) => x >= 0 && z >= 0 && x < state.size && z < state.size && state.tiles[z * state.size + x]?.kind === 'rail';
  const horizontal = isRail(tile.x - 1, tile.z) || isRail(tile.x + 1, tile.z);
  box(g, 0x9b9b84, 0, .018, 0, .52, .036, 1);
  for (let i = 0; i < 7; i++) box(g, palette.wood, 0, .052, -.45 + i * .15, .39, .035, .065);
  box(g, palette.rail, -.125, .079, 0, .033, .027, 1);
  box(g, palette.rail, .125, .079, 0, .033, .027, 1);
  if (horizontal) g.rotation.y = Math.PI / 2;
}

// All civic models are authored at their real footprint scale. Local origin is
// the footprint centre; facilityFrame later places that centre over its anchor.
const FACILITY_FOOTPRINTS: Partial<Record<Tile['kind'], readonly [number, number]>> = {
  power: [4, 4], waterpump: [2, 2], police: [2, 2], fire: [3, 2], hospital: [3, 3],
  school: [3, 2], university: [5, 4], stadium: [6, 5], airport: [10, 6], seaport: [5, 3],
  wind: [2, 2], solar: [4, 3], recycling: [3, 3],
};

export function getModelFootprint(kind: Tool, rotation = 0): [number, number] {
  const [width, depth] = FACILITY_FOOTPRINTS[kind as Tile['kind']] ?? [1, 1];
  return Math.abs(rotation) % 2 ? [depth, width] : [width, depth];
}

function facilityFrame(g: THREE.Group, tile: Tile): THREE.Group {
  const frame = new THREE.Group();
  const [width, depth] = getModelFootprint(tile.kind, tile.rotation);
  frame.position.set((width - 1) / 2, 0, (depth - 1) / 2);
  frame.rotation.y = -(tile.rotation ?? 0) * Math.PI / 2;
  g.add(frame);
  return frame;
}

function foundation(g: THREE.Group, width: number, depth: number, color = palette.concrete): void {
  const base = box(g, palette.stone, 0, .035, 0, width - .06, .07, depth - .06);
  base.userData.facilityFoundation = 'base';
  const surface = box(g, color, 0, .076, 0, width - .13, .014, depth - .13);
  surface.userData.facilityFoundation = 'surface';
}

/** The visible foundation and driveway use the suspension's height sampler.
 * Moving only a lane overlay left the old plinth standing across a lower ramp. */
function facilitySurfaceGeometry(
  plan: FacilityAccessPlan, tile: Tile, state: CityState,
  origin: { x: number; z: number }, u: { x: number; z: number }, v: { x: number; z: number },
  step: number, verticalOffset = 0, sideDepth = 0,
): THREE.BufferGeometry {
  const nx = Math.max(1, Math.ceil(Math.hypot(u.x, u.z) / step));
  const nz = Math.max(1, Math.ceil(Math.hypot(v.x, v.z) / step));
  const rootX = tile.x - state.size / 2 + .5, rootZ = tile.z - state.size / 2 + .5;
  const positions: number[] = [], indices: number[] = [];
  const surfaceY = (x: number, z: number): number =>
    (sampleFacilityAccessHeight(plan, x + rootX, z + rootZ) ?? plan.baseY + .052) - plan.baseY + verticalOffset;
  for (let z = 0; z <= nz; z++) for (let x = 0; x <= nx; x++) {
    const wx = origin.x + u.x * x / nx + v.x * z / nz;
    const wz = origin.z + u.z * x / nx + v.z * z / nz;
    const y = sampleFacilityAccessHeight(plan, wx, wz) ?? plan.baseY + .052;
    positions.push(wx - rootX, y - plan.baseY + verticalOffset, wz - rootZ);
  }
  const forward = u.x * v.z - u.z * v.x > 0;
  type Midpoint = { x: number; y: number; z: number; index?: number };
  const midpoints = new Map<string, Midpoint>();
  const midpoint = (a: number, b: number): Midpoint => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let point = midpoints.get(key);
    if (!point) {
      const x = (positions[a * 3] + positions[b * 3]) / 2;
      const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
      point = { x, y: surfaceY(x, z), z }; midpoints.set(key, point);
    }
    return point;
  };
  const vertex = (point: Midpoint): number => {
    if (point.index === undefined) {
      point.index = positions.length / 3;
      positions.push(point.x, point.y, point.z);
    }
    return point.index;
  };
  const triangle = (a: number, b: number, c: number, depth = 0): void => {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    const ay = positions[a * 3 + 1], by = positions[b * 3 + 1], cy = positions[c * 3 + 1];
    const centerX = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
    const centerZ = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    const error = Math.max(Math.abs(ab.y - (ay + by) / 2), Math.abs(bc.y - (by + cy) / 2),
      Math.abs(ca.y - (cy + ay) / 2), Math.abs(surfaceY(centerX, centerZ) - (ay + by + cy) / 3));
    // Flat forecourts remain a coarse grid. Only curved slopes and shoulders
    // need extra vertices: matching grid vertices alone still bridged the
    // ramp's depression between them and put visible asphalt through tires.
    if (error > .0015 && depth < 4) {
      const iab = vertex(ab), ibc = vertex(bc), ica = vertex(ca);
      triangle(a, iab, ica, depth + 1); triangle(iab, b, ibc, depth + 1);
      triangle(ica, ibc, c, depth + 1); triangle(iab, ibc, ica, depth + 1);
    } else indices.push(a, b, c);
  };
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const a = z * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
    if (forward) { triangle(a, c, b); triangle(b, c, d); }
    else { triangle(a, b, c); triangle(b, d, c); }
  }
  // The GPU stores Float32 coordinates. Sample their actual X/Z values too,
  // otherwise rounding at a tight bend can select a different ramp projection.
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = Math.fround(positions[i]);
    positions[i + 2] = Math.fround(positions[i + 2]);
    positions[i + 1] = surfaceY(positions[i], positions[i + 2]);
  }
  const surfaceVertexCount = positions.length / 3;
  if (sideDepth) {
    const perimeter: number[] = [];
    for (let x = 0; x <= nx; x++) perimeter.push(x);
    for (let z = 1; z <= nz; z++) perimeter.push(z * (nx + 1) + nx);
    for (let x = nx - 1; x >= 0; x--) perimeter.push(nz * (nx + 1) + x);
    for (let z = nz - 1; z > 0; z--) perimeter.push(z * (nx + 1));
    for (let i = 0; i < perimeter.length; i++) {
      const a = perimeter[i] * 3, b = perimeter[(i + 1) % perimeter.length] * 3, n = positions.length / 3;
      positions.push(...positions.slice(a, a + 3), ...positions.slice(b, b + 3),
        positions[a], positions[a + 1] - sideDepth, positions[a + 2],
        positions[b], positions[b + 1] - sideDepth, positions[b + 2]);
      if (forward) indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      else indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.userData.surfaceVertexCount = surfaceVertexCount;
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function connectFacilityModel(root: THREE.Group, frame: THREE.Group, plan: FacilityAccessPlan, tile: Tile, state: CityState): void {
  const content = new THREE.Group();
  content.name = 'facility-content';
  content.scale.set(plan.contentScale.x, 1, plan.contentScale.z);
  content.position.y = plan.kind === 'industrial' ? .027 : -.031;
  content.position.z = plan.contentOffsetZ ?? 0;
  for (const child of [...frame.children]) {
    if (!(child instanceof THREE.Mesh) || !child.userData.facilityFoundation) { content.add(child); continue; }
    const top = child.userData.facilityFoundation === 'surface';
    const width = plan.width - (top ? .13 : .06), depth = plan.depth - (top ? .13 : .06);
    const geometry = facilitySurfaceGeometry(plan, tile, state,
      { x: plan.center.x - width / 2, z: plan.center.z - depth / 2 },
      { x: width, z: 0 }, { x: 0, z: depth }, .15, top ? 0 : -.01, top ? .01 : .04);
    const surface = new THREE.Mesh(geometry, child.material);
    surface.name = `facility-foundation-${top ? 'surface' : 'base'}`;
    surface.userData.drivingSurface = true;
    surface.receiveShadow = true;
    root.add(surface); frame.remove(child);
  }
  frame.add(content);
  if (!facilityPavingMaterial) {
    facilityPavingMaterial = modelMaterial(palette.asphalt).clone();
    facilityPavingMaterial.polygonOffset = true;
    facilityPavingMaterial.polygonOffsetFactor = -1;
    facilityPavingMaterial.polygonOffsetUnits = -1;
  }
  // The four complete perimeter strips already include the routed section.
  // Add only the connector outside that ring, avoiding duplicate pavement.
  const rx = plan.localWidth / 2 - plan.laneWidth / 2, rz = plan.localDepth / 2 - plan.laneWidth / 2;
  for (const [index, segment] of plan.renderSegments.entries()) {
    if (plan.kind !== 'industrial' && index >= 4) {
      const a = facilityWorldToLocal(plan, segment.a), b = facilityWorldToLocal(plan, segment.b);
      if ([a, b].every(p => Math.abs(p.x) <= rx + 1e-7 && Math.abs(p.z) <= rz + 1e-7)) continue;
    }
    const dx = segment.b.x - segment.a.x, dz = segment.b.z - segment.a.z, length = Math.hypot(dx, dz);
    if (length < 1e-8) continue;
    const px = -dz / length * segment.width, pz = dx / length * segment.width;
    const geometry = facilitySurfaceGeometry(plan, tile, state,
      { x: segment.a.x - px / 2, z: segment.a.z - pz / 2 },
      { x: dx, z: dz }, { x: px, z: pz }, .09);
    const lane = new THREE.Mesh(geometry, facilityPavingMaterial);
    lane.name = 'facility-access-paving';
    lane.userData.drivingSurface = true;
    lane.receiveShadow = true;
    root.add(lane);
  }
}

function lamp(g: THREE.Group, x: number, z: number, height = .9): void {
  cylinder(g, palette.dark, x, height / 2 + .08, z, .035, height);
  box(g, palette.dark, x + .06, height + .08, z, .18, .038, .055);
  box(g, palette.cream, x + .09, height + .057, z, .13, .027, .075);
}

function bench(g: THREE.Group, x: number, z: number, angle = 0): void {
  const b = new THREE.Group();
  box(b, palette.wood, 0, .15, 0, .36, .045, .16);
  box(b, palette.wood, 0, .23, .072, .36, .15, .035);
  box(b, palette.dark, -.13, .09, 0, .035, .15, .12);
  box(b, palette.dark, .13, .09, 0, .035, .15, .12);
  b.position.set(x, 0, z); b.rotation.y = angle; g.add(b);
}

function parking(g: THREE.Group, x: number, z: number, count: number, angle = 0): void {
  const p = new THREE.Group();
  const width = count * .27;
  box(p, palette.asphalt, 0, .088, 0, width + .08, .015, .65);
  for (let i = 0; i <= count; i++) box(p, palette.white, -width / 2 + i * .27, .1, -.07, .012, .005, .46);
  for (let i = 0; i < count; i++) if (i % 3 !== 1) {
    const car = createCar([palette.blue, palette.cream, palette.red, palette.metal][i % 4]);
    car.position.set(-width / 2 + (i + .5) * .27, .1, -.06); p.add(car);
  }
  p.position.set(x, 0, z); p.rotation.y = angle; g.add(p);
}

function flag(g: THREE.Group, x: number, z: number, color = palette.blue): void {
  cylinder(g, palette.metal, x, .68, z, .021, 1.2);
  box(g, color, x + .14, 1.15, z, .29, .17, .016);
}

function officeBlock(g: THREE.Group, x: number, z: number, width: number, depth: number, height: number, accent = palette.blue, floors = 3): void {
  box(g, palette.cream, x, height / 2 + .09, z, width, height, depth);
  for (let floor = 0; floor < floors; floor++) ribbon(g, x, .25 + floor * (height - .15) / floors, z, width, Math.min(.16, height / floors * .45), depth, palette.glass);
  box(g, accent, x, height + .12, z, width + .06, .08, depth + .06);
  box(g, palette.glassDark, x, .29, z + depth / 2 + .013, .25, .39, .026);
  box(g, accent, x, .52, z + depth / 2 + .1, .49, .045, .25);
  box(g, palette.metal, x - width * .22, height + .23, z - depth * .22, .22, .14, .26);
}

function powerPlant(g: THREE.Group): void {
  foundation(g, 4, 4);
  box(g, palette.asphalt, 0, .092, 1.47, 3.84, .014, .63);
  box(g, palette.stone, -.54, .60, .15, 1.73, 1.03, 1.70);
  for (let i = 0; i < 4; i++) roof(g, palette.roof, -1.2 + i * .43, 1.13, .15, .46, .27, 1.8);
  ribbon(g, -.54, .7, .15, 1.73, .31, 1.7);
  box(g, palette.blue, -.54, .27, 1.014, .62, .38, .033);
  for (let i = 0; i < 2; i++) {
    const x = -.85 + i * .89;
    cylinder(g, palette.concrete, x, 1.27, -1.12, .32, 2.39);
    for (const y of [1.83, 2.16]) cylinder(g, palette.red, x, y, -1.12, .326, .16);
    cylinder(g, palette.dark, x, 2.48, -1.12, .25, .028);
    box(g, palette.metal, x, .48, -.71, .18, .16, .72);
  }
  for (const z of [-.83, .23]) {
    cylinder(g, palette.metal, 1.17, .51, z, .80, .84);
    mesh(g, sphereGeometry, palette.metal, 1.17, .93, z, .8, .24, .8);
    cylinder(g, palette.blue, 1.17, .48, z, .811, .082);
  }
  box(g, palette.yellow, .52, .34, .85, .55, .49, .34);
  box(g, palette.dark, .52, .38, 1.026, .41, .17, .015);
  // Substation: switchgear, copper rails and visible outgoing gantry.
  for (let i = 0; i < 3; i++) {
    box(g, palette.metal, .63 + i * .39, .2, -1.67, .27, .2, .25);
    cylinder(g, palette.dark, .63 + i * .39, .47, -1.67, .062, .4);
  }
  box(g, palette.rust, 1.02, .69, -1.67, 1.02, .037, .04);
  lamp(g, -1.67, 1.72, 1.03); lamp(g, 1.7, 1.72, 1.03);
  parking(g, -.94, 1.44, 4);
}

function waterPump(g: THREE.Group): void {
  foundation(g, 2, 2, palette.grass);
  box(g, palette.concrete, -.37, .15, -.16, .94, .14, 1.40);
  cylinder(g, palette.white, -.35, .24, -.22, .83, .21);
  cylinder(g, palette.water, -.35, .35, -.22, .72, .018);
  box(g, palette.metal, -.35, .38, -.22, .89, .04, .07);
  cylinder(g, palette.white, -.35, .37, -.22, .08, .13);
  officeBlock(g, .48, .32, .61, .79, .56, palette.blue, 1);
  const x = .49, z = -.58;
  for (const dx of [-.22, .22]) for (const dz of [-.2, .2]) cylinder(g, palette.white, x + dx, .63, z + dz, .04, 1.09);
  cylinder(g, palette.water, x, 1.18, z, .65, .42);
  cylinder(g, palette.white, x, .98, z, .68, .065);
  mesh(g, coneGeometry, palette.blue, x, 1.45, z, .73, .17, .73);
  box(g, palette.blue, -.11, .18, .66, .66, .12, .11);
  cylinder(g, palette.blue, -.43, .23, .66, .12, .25);
  lamp(g, -.82, .80, .72);
}

function service(g: THREE.Group, kind: Tile['kind']): void {
  if (kind === 'police') {
    foundation(g, 2, 2);
    officeBlock(g, -.3, -.29, 1.10, .99, 1.1, palette.blue, 3);
    box(g, palette.stone, .53, .36, -.30, .47, .53, 1.00);
    box(g, palette.dark, .53, .3, .213, .34, .38, .02);
    box(g, palette.blue, -.3, .89, .217, .35, .21, .035);
    mesh(g, crownGeometry, palette.yellow, -.3, .89, .243, .13, .15, .024);
    box(g, palette.asphalt, 0, .091, .53, 1.8, .022, .66);
    flag(g, -.82, .72); tree(g, -.79, -.74, .56, 1);
  } else if (kind === 'fire') {
    foundation(g, 3, 2);
    box(g, palette.rust, -.20, .51, -.25, 2.32, .85, 1.02);
    box(g, palette.cream, -.2, .98, -.25, 2.39, .09, 1.09);
    for (let i = 0; i < 3; i++) {
      const x = -.99 + i * .66;
      box(g, palette.dark, x, .40, .267, .51, .57, .022);
      for (let j = 0; j < 4; j++) box(g, palette.metal, x, .44 + j * .064, .282, .46, .013, .008);
    }
    box(g, palette.stone, 1.09, .91, -.42, .48, 1.63, .55);
    box(g, palette.red, 1.09, 1.77, -.42, .55, .09, .62);
    ribbon(g, 1.09, 1.45, -.42, .48, .15, .55);
    box(g, palette.red, -.2, .87, .286, 1.5, .10, .033);
    flag(g, 1.15, .78, palette.red); lamp(g, -1.33, .8, .86);
  } else if (kind === 'hospital') {
    foundation(g, 3, 3);
    officeBlock(g, -.1, -.5, 2.14, 1.05, 1.85, palette.white, 5);
    officeBlock(g, -.72, .25, .91, 1.25, .76, palette.white, 2);
    officeBlock(g, .64, .25, .86, 1.25, 1.05, palette.white, 3);
    box(g, palette.glass, -.02, .4, .66, .44, .65, .70);
    box(g, palette.red, -.02, .78, 1.03, .70, .075, .27);
    box(g, palette.white, -.07, 1.67, .04, .47, .42, .025);
    box(g, palette.red, -.07, 1.67, .062, .28, .079, .019);
    box(g, palette.red, -.07, 1.67, .062, .079, .29, .019);
    cylinder(g, palette.roof, -.15, 1.983, -.5, .86, .017);
    cylinder(g, palette.white, -.15, 1.995, -.5, .76, .01);
    cylinder(g, palette.roof, -.15, 2.001, -.5, .69, .009);
    for (const xx of [-.28, -.02]) box(g, palette.white, xx, 2.011, -.5, .04, .008, .31);
    box(g, palette.white, -.15, 2.011, -.5, .26, .008, .04);
    parking(g, -.83, 1.13, 3);
    tree(g, -1.29, -.9, .77, 2); tree(g, 1.27, -.92, .73, 1);
    lamp(g, 1.3, 1.26); lamp(g, -1.3, 1.26);
  } else if (kind === 'school') {
    foundation(g, 3, 2, palette.grass);
    officeBlock(g, -.35, -.33, 1.8, .97, .69, palette.terracotta, 2);
    roof(g, palette.terracotta, -.35, .84, -.33, 1.04, .24, 1.86, Math.PI / 2);
    box(g, palette.yellow, .83, .4, -.25, .62, .62, 1.06);
    box(g, palette.blue, .83, .74, -.25, .69, .08, 1.13);
    box(g, palette.stone, -.4, .092, .53, 1.80, .025, .51);
    for (let i = 0; i < 2; i++) {
      box(g, palette.red, .64 + i * .42, .32, .55, .035, .47, .035);
    }
    box(g, palette.yellow, .85, .56, .55, .5, .034, .034);
    for (const x of [.74, .96]) {
      cylinder(g, palette.dark, x, .4, .55, .012, .3);
      box(g, palette.blue, x, .25, .55, .13, .025, .1);
    }
    tree(g, -1.3, .55, .8, 1); bench(g, -.55, .73); flag(g, 1.15, .75, palette.yellow);
  }
}

function university(g: THREE.Group): void {
  foundation(g, 5, 4, palette.grass);
  box(g, palette.stone, 0, .094, .20, 3.95, .026, 3.5);
  officeBlock(g, 0, -1.12, 3.52, 1.11, 1.19, palette.terracotta, 3);
  roof(g, palette.terracotta, 0, 1.36, -1.12, 1.25, .40, 3.64, Math.PI / 2);
  for (const x of [-1.52, 1.52]) {
    officeBlock(g, x, .18, .86, 1.60, .96, palette.terracotta, 3);
    roof(g, palette.terracotta, x, 1.10, .18, .96, .24, 1.73);
  }
  box(g, palette.cream, 0, 1.19, -.67, .64, 2.18, .63);
  roof(g, palette.blue, 0, 2.30, -.67, .76, .53, .75);
  cylinder(g, palette.white, 0, 1.95, -.34, .3, .022).rotation.x = Math.PI / 2;
  box(g, palette.dark, 0, 1.95, -.316, .017, .1, .01);
  box(g, palette.dark, .038, 1.95, -.316, .085, .017, .01);
  box(g, palette.grass, 0, .12, .49, 1.89, .03, 1.53);
  box(g, palette.stone, 0, .14, .59, .3, .022, 1.91);
  cylinder(g, palette.cream, 0, .17, .32, .88, .07);
  cylinder(g, palette.water, 0, .214, .32, .73, .012);
  cylinder(g, palette.stone, 0, .36, .32, .14, .28);
  cylinder(g, palette.water, 0, .51, .32, .34, .045);
  for (const x of [-2.14, 2.14]) for (const z of [-1.4, -.35, .7, 1.54]) tree(g, x, z, .82, Math.round(z * 10));
  for (const x of [-.72, .72]) { bench(g, x, .96); lamp(g, x, 1.51, 1.05); }
  parking(g, -.73, 1.58, 6); flag(g, 1.56, 1.61);
}

function park(g: THREE.Group, tile: Tile): void {
  slab(g, palette.grass);
  box(g, palette.stone, 0, .034, 0, .16, .015, .92);
  box(g, palette.stone, 0, .034, 0, .92, .015, .12);
  tree(g, -.29, -.27, .96, tile.variation);
  tree(g, .27, -.25, .68, tile.variation + 1);
  tree(g, .29, .29, .77, tile.variation + 2);
  if (tile.variation % 2) {
    cylinder(g, palette.stone, -.25, .04, .26, .28, .045, .28);
    cylinder(g, palette.water, -.25, .066, .26, .24, .008, .24);
    cylinder(g, palette.cream, -.25, .12, .26, .038, .11);
    cylinder(g, palette.water, -.25, .18, .26, .085, .02);
  } else {
    bench(g, -.25, .28);
  }
}

function stadium(g: THREE.Group): void {
  foundation(g, 6, 5);
  // The playing surface is sunk into four stepped grandstands: a genuine bowl.
  box(g, palette.rust, 0, .105, 0, 4.77, .045, 3.3);
  box(g, palette.green, 0, .135, 0, 3.84, .026, 2.33);
  for (let i = 0; i < 8; i++) if (i % 2) box(g, palette.grass, -1.68 + i * .48, .15, 0, .48, .012, 2.33);
  for (const x of [-1.88, 1.88]) box(g, palette.white, x, .163, 0, .019, .009, 2.25);
  for (const z of [-1.12, 1.12]) box(g, palette.white, 0, .163, z, 3.78, .009, .018);
  box(g, palette.white, 0, .163, 0, .018, .009, 2.25);
  const circle = new THREE.Mesh(new THREE.RingGeometry(.36, .379, 24), modelMaterial(palette.white));
  circle.rotation.x = -Math.PI / 2; circle.position.y = .169; circle.receiveShadow = true; g.add(circle);
  for (const x of [-1.65, 1.65]) {
    box(g, palette.white, x, .164, 0, .022, .009, .91);
    for (const z of [-.455, .455]) box(g, palette.white, x + (x < 0 ? -.12 : .12), .164, z, .25, .009, .02);
    for (const z of [-.31, .31]) cylinder(g, palette.white, x < 0 ? -1.91 : 1.91, .32, z, .029, .32);
    box(g, palette.white, x < 0 ? -1.91 : 1.91, .49, 0, .029, .032, .65);
    box(g, palette.concrete, x < 0 ? -2.045 : 2.045, .30, 0, .024, .26, .59);
  }
  for (let row = 0; row < 5; row++) {
    const y = .27 + row * .13, d = 1.38 + row * .151, x = 2.11 + row * .127;
    for (const sign of [-1, 1]) {
      box(g, palette.stone, 0, y - .08, sign * d, 4.41, .23, .21);
      box(g, row % 2 ? palette.blue : palette.cream, 0, y + .043, sign * d, 4.32, .035, .16);
      box(g, palette.stone, sign * x, y - .08, 0, .20, .23, 2.73);
      box(g, row % 2 ? palette.blue : palette.cream, sign * x, y + .043, 0, .16, .035, 2.64);
      // Alternating supporter ribbons read as seated crowds at a useful distance.
      for (let block = 0; block < 7; block++) box(g, [palette.yellow,palette.red,palette.dark][(row + block) % 3], -1.85 + block * .61, y + .096, sign * d, .36, .075, .086);
    }
  }
  for (const z of [-2.20, 2.20]) {
    box(g, palette.white, 0, 1.04, z, 4.74, .075, .41);
    for (const x of [-2.22, 0, 2.22]) cylinder(g, palette.dark, x, .57, z, .055, 1.02);
  }
  for (const x of [-2.72, 2.72]) for (const z of [-1.87, 1.87]) {
    cylinder(g, palette.dark, x, .94, z, .057, 1.7);
    box(g, palette.dark, x, 1.84, z, .50, .22, .09);
    for (let i = 0; i < 3; i++) box(g, palette.cream, x - .16 + i * .16, 1.84, z + (z > 0 ? -.05 : .05), .11, .14, .025);
  }
  box(g, palette.dark, -2.71, 1.06, 0, .08, .61, 1.32);
  box(g, palette.blue, -2.661, 1.08, 0, .019, .44, 1.13);
  for (const z of [-.29, .29]) box(g, palette.white, -2.645, 1.1, z, .011, .13, .19);
  box(g, palette.cream, 0, .20, 2.32, 1.42, .25, .24);
  box(g, palette.glassDark, 0, .23, 2.447, .92, .17, .013);
}

function aircraft(): THREE.Group {
  const p = new THREE.Group();
  p.userData.drivingObstacle = true;
  // Airframe points toward local +X. Swept wings, nacelles and a real tail.
  mesh(p, sphereGeometry, palette.white, 0, .12, 0, 1.20, .15, .15);
  box(p, palette.white, -.11, .12, 0, .32, .035, 1.05, -.24);
  box(p, palette.blue, -.46, .17, 0, .16, .028, .39);
  box(p, palette.blue, -.46, .23, 0, .14, .23, .022);
  box(p, palette.glassDark, .40, .183, 0, .15, .018, .09);
  for (const z of [-.26, .26]) {
    const engine = cylinder(p, palette.metal, .03, .074, z, .095, .27);
    engine.rotation.z = Math.PI / 2;
  }
  for (const z of [-.078, .078]) box(p, palette.glassDark, .09, .142, z, .52, .021, .006);
  return p;
}

function airport(g: THREE.Group): void {
  foundation(g, 10, 6, palette.grass);
  box(g, palette.asphalt, 0, .095, -1.60, 9.63, .026, 1.13);
  for (const z of [-2.10, -1.10]) box(g, palette.white, 0, .112, z, 9.41, .008, .035);
  for (let i = 0; i < 16; i++) box(g, palette.white, -4.42 + i * .59, .116, -1.60, .29, .008, .035);
  for (const x of [-4.21, 4.21]) for (let i = 0; i < 4; i++) box(g, palette.white, x, .117, -1.95 + i * .23, .48, .008, .079);
  box(g, palette.asphalt, 0, .097, -.31, 8.69, .022, .43);
  for (const x of [-3.71, 0, 3.71]) box(g, palette.asphalt, x, .098, -.91, .51, .022, 1.17);
  box(g, palette.yellow, 0, .114, -.31, 8.22, .008, .023);
  box(g, palette.concrete, -.66, .094, .77, 6.68, .028, 1.71);
  officeBlock(g, -.71, 1.77, 4.86, 1.14, .69, palette.roof, 2);
  box(g, palette.glass, -.71, .72, 1.77, 4.62, .34, 1.17);
  for (let i = 0; i < 4; i++) {
    const x = -2.67 + i * 1.25;
    box(g, palette.cream, x, .44, .86, .21, .31, .83);
    box(g, palette.glassDark, x, .48, .63, .23, .13, .42);
    box(g, palette.yellow, x, .115, .39, .85, .008, .022);
    if (i !== 1) { const plane = aircraft(); plane.rotation.y = -Math.PI / 2; plane.position.set(x, .09, .22); plane.scale.setScalar(.71); g.add(plane); }
  }
  box(g, palette.cream, 3.33, .79, 1.52, .34, 1.38, .34);
  box(g, palette.glassDark, 3.33, 1.61, 1.52, .77, .32, .71);
  box(g, palette.white, 3.33, 1.81, 1.52, .85, .079, .79);
  cylinder(g, palette.metal, 3.33, 2.04, 1.52, .035, .45);
  officeBlock(g, 4.06, .26, 1.27, 1.47, .52, palette.roof, 1);
  roof(g, palette.roof, 4.06, .66, .26, 1.33, .27, 1.54);
  box(g, palette.dark, 4.06, .36, -.487, 1.06, .40, .022);
  parking(g, -.68, 2.56, 14);
  for (let i = 0; i < 9; i++) for (const z of [-2.31, -.87]) box(g, palette.cream, -4.61 + i * 1.15, .13, z, .065, .083, .065);
  for (const x of [-3.44, 1.95]) lamp(g, x, 2.58, .86);
}

function seaport(g: THREE.Group): void {
  foundation(g, 5, 3);
  box(g, palette.asphalt, 0, .095, -.90, 4.83, .027, .62);
  box(g, palette.concrete, 0, .15, .76, 4.86, .22, 1.17);
  for (const x of [-1.8, -.6, .6, 1.8]) cylinder(g, palette.dark, x, .12, 1.40, .11, .23);
  box(g, palette.stone, -1.46, .49, -.07, 1.52, .66, 1.01);
  for (let i = 0; i < 3; i++) roof(g, palette.roof, -1.96 + i * .51, .84, -.07, .54, .22, 1.09);
  for (let i = 0; i < 6; i++) {
    const x = -.35 + (i % 3) * .71, z = -.43 + Math.floor(i / 3) * .61;
    box(g, [palette.blue,palette.red,palette.yellow][i % 3], x, .35, z, .61, .38, .43);
    for (let j = 0; j < 4; j++) box(g, palette.metal, x - .23 + j * .15, .35, z + .219, .012, .29, .007);
    if (i === 1 || i === 4) box(g, palette.red, x, .73, z, .61, .36, .43);
  }
  for (const x of [1.7, .1]) {
    for (const z of [.55, 1.04]) box(g, palette.yellow, x, .85, z, .10, 1.42, .10);
    box(g, palette.yellow, x, 1.59, .67, .15, .15, 1.44);
    box(g, palette.yellow, x, 1.84, .25, .11, .44, .11);
    box(g, palette.dark, x, 1.41, .73, .29, .20, .27);
    box(g, palette.glass, x, 1.44, .874, .23, .11, .024);
  }
  lamp(g, -2.18, -1.28); lamp(g, 2.18, -1.28);
}

function windPlant(g: THREE.Group): void {
  foundation(g, 2, 2, palette.grass);
  cylinder(g, palette.concrete, 0, .15, 0, .54, .16);
  mesh(g, new THREE.CylinderGeometry(.055, .14, 2.32, 10), palette.white, 0, 1.33, 0, 1, 1, 1);
  box(g, palette.white, 0, 2.52, -.055, .19, .20, .36);
  box(g, palette.blue, .56, .24, .62, .39, .32, .42);
  box(g, palette.stone, .29, .096, .33, .18, .02, .75, -.48);
  tree(g, -.66, -.62, .59, 1); tree(g, .68, -.58, .43, 2);
}

function solarPlant(g: THREE.Group): void {
  foundation(g, 4, 3, palette.grass);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const x = -1.51 + col * .75, z = -.99 + row * .60;
    box(g, palette.metal, x, .20, z, .037, .25, .037);
    const panel = box(g, palette.solarCell, x, .36, z, .65, .037, .49);
    panel.rotation.x = -.36;
    const ridge = box(g, palette.metal, x, .381, z, .015, .014, .48);
    ridge.rotation.x = -.36;
    box(g, palette.metal, x, .362, z, .65, .015, .015);
  }
  box(g, palette.white, 1.51, .24, 1.26, .44, .31, .30);
  box(g, palette.yellow, 1.51, .29, 1.417, .17, .10, .012);
}

function recyclingPlant(g: THREE.Group): void {
  foundation(g, 3, 3);
  box(g, palette.green, -.48, .58, -.45, 1.71, .99, 1.34);
  for (let i = 0; i < 3; i++) roof(g, palette.roof, -.48, 1.09, -.86 + i * .45, .48, .27, 1.80, Math.PI / 2);
  box(g, palette.dark, -.48, .43, .233, .96, .67, .024);
  box(g, palette.white, -.48, .91, .25, .79, .16, .023);
  for (let i = 0; i < 3; i++) {
    const x = -.99 + i * .89;
    box(g, [palette.blue,palette.yellow,palette.green][i], x, .30, 1.00, .67, .41, .56);
    box(g, palette.dark, x, .51, 1, .70, .044, .60);
  }
  for (const z of [-.88, -.14]) {
    cylinder(g, palette.metal, .88, .61, z, .64, 1.05);
    mesh(g, coneGeometry, palette.white, .88, 1.23, z, .70, .24, .70);
  }
  box(g, palette.dark, .64, .37, .54, .39, .20, .62);
  box(g, palette.green, .64, .54, .33, .41, .17, .34);
  lamp(g, -1.34, 1.31, .89); tree(g, 1.31, 1.31, .68, 1);
}

export function createFacilityActors(tile: Tile, _state: CityState): THREE.Group | null {
  if (tile.anchor >= 0 && tile.anchor !== tile.z * _state.size + tile.x) return null;
  // Emergency vehicles belong to the scene's real road fleet. A second set of
  // decorative cars used to slide along the apron without ever reaching a road.
  if (!['wind','stadium','airport','seaport'].includes(tile.kind)) return null;
  const g = new THREE.Group();
  g.name = `actors:${tile.kind}:${tile.x},${tile.z}`;
  const frame = facilityFrame(g, tile);
  const access = getFacilityAccess(_state, tile);
  if (access?.connected) {
    frame.scale.set(access.contentScale.x, 1, access.contentScale.z);
    frame.position.y = -.031;
  }
  g.userData.kind = tile.kind;
  g.userData.seed = Math.abs(tile.variation);
  if (tile.kind === 'wind') {
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 2.52, .16);
    cylinder(rotor, palette.white, 0, 0, 0, .18, .19).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Group(); blade.rotation.z = i * Math.PI * 2 / 3;
      const fin = box(blade, palette.white, .038, .46, 0, .13, .84, .035);
      fin.rotation.z = -.06; rotor.add(blade);
    }
    frame.add(rotor);
  } else if (tile.kind === 'stadium') {
    for (let i = 0; i < 12; i++) {
      const player = new THREE.Group(); player.name = `player:${i}`;
      cylinder(player, i < 6 ? palette.red : palette.blue, 0, .08, 0, .054, .10);
      mesh(player, sphereGeometry, palette.cream, 0, .159, 0, .049, .049, .049);
      for (const x of [-.02, .02]) box(player, palette.dark, x, .032, 0, .017, .057, .021);
      frame.add(player);
    }
    mesh(frame, sphereGeometry, palette.white, 0, .19, 0, .052, .052, .052).name = 'ball';
  } else if (tile.kind === 'airport') {
    const plane = aircraft(); plane.name = 'aircraft'; frame.add(plane);
  } else if (tile.kind === 'seaport') {
    for (const x of [1.7, .1]) {
      const hook = new THREE.Group(); hook.name = `hook:${x}`; hook.position.set(x, 0, 1.18);
      cylinder(hook, palette.dark, 0, .90, 0, .016, 1.15);
      box(hook, palette.yellow, 0, .31, 0, .46, .045, .27);
      frame.add(hook);
    }
  }
  return g;
}

export function updateFacilityActors(g: THREE.Group, elapsed: number, state: CityState): void {
  const frame = g.children[0]; if (!frame) return;
  const seed = Number(g.userData.seed ?? 0);
  const time = elapsed + seed % 29;
  switch (g.userData.kind) {
    case 'wind': { const rotor = frame.getObjectByName('rotor'); if (rotor) rotor.rotation.z = -elapsed * 1.05; break; }
    case 'stadium': {
      for (let i = 0; i < 12; i++) {
        const player = frame.getObjectByName(`player:${i}`);
        if (!player) continue;
        const side = i < 6 ? -1 : 1;
        const phase = time * .57 + i * 2.17;
        player.position.set(side * (.53 + (i % 3) * .34) + Math.sin(phase) * .26, .165 + Math.abs(Math.sin(phase * 5)) * .013, ((i % 6) / 5 - .5) * 1.62 + Math.cos(phase * .71) * .17);
      }
      const ball = frame.getObjectByName('ball');
      if (ball) ball.position.set(Math.sin(time * .49) * 1.38, .19 + Math.abs(Math.sin(time * 2.1)) * .05, Math.cos(time * .77) * .67);
      break;
    }
    case 'airport': {
      const plane = frame.getObjectByName('aircraft'); if (!plane) break;
      // Closed racetrack: accelerate along the runway, climb, fly a banked
      // circuit and return for landing. Position and heading are continuous.
      const phase = (time % 52) / 52;
      if (phase < .45) {
        const t = phase / .45, climb = Math.max(0, (t - .45) / .55);
        const lift = climb * climb * (3 - 2 * climb);
        plane.position.set(-3.45 + t * 6.9, .115 + lift * 2.085, -1.60);
        plane.rotation.set(0, 0, Math.sin(climb * Math.PI) * .24);
      } else if (phase < .58) {
        const t = (phase - .45) / .13, angle = -Math.PI / 2 + t * Math.PI;
        plane.position.set(3.45 + Math.cos(angle) * .9, 2.2, -.70 + Math.sin(angle) * .9);
        plane.rotation.set(Math.sin(t * Math.PI) * -.25, -t * Math.PI, 0);
      } else if (phase < .87) {
        const t = (phase - .58) / .29;
        plane.position.set(3.45 - t * 6.9, 2.2, .20);
        plane.rotation.set(0, -Math.PI, 0);
      } else {
        const t = (phase - .87) / .13, angle = Math.PI / 2 + t * Math.PI;
        const landing = t * t * (3 - 2 * t);
        plane.position.set(-3.45 + Math.cos(angle) * .9, 2.2 - landing * 2.085, -.70 + Math.sin(angle) * .9);
        plane.rotation.set(Math.sin(t * Math.PI) * -.2, -Math.PI - t * Math.PI, -Math.sin(t * Math.PI) * .25);
      }
      break;
    }
    case 'seaport':
      for (let i = 0; i < frame.children.length; i++) {
        const hook = frame.children[i];
        hook.position.y = Math.sin(time * .45 + i) * .16;
        hook.position.z = 1.02 + Math.sin(time * .28 + i * 2) * .21;
      }
      break;
  }
  g.visible = true;
  // The caller owns the simulation clock. Passing a constant elapsed value
  // during pause/photo mode freezes every actor for stable path tracing.
  void state;
}

export function createTileModel(tile: Tile, state: CityState): THREE.Group {
  const g = new THREE.Group();
  g.name = `${tile.kind}:${tile.x},${tile.z}`;
  const access = FACILITY_FOOTPRINTS[tile.kind] || tile.kind === 'industrial' && tile.level > 0 ? getFacilityAccess(state, tile) : null;
  const connectedIndustry = tile.kind === 'industrial' && access?.connected;
  const facility = FACILITY_FOOTPRINTS[tile.kind] ? facilityFrame(g, tile)
    : connectedIndustry ? facilityFrame(g, { ...tile, rotation: access.rotation as Tile['rotation'] }) : g;
  switch (tile.kind) {
    case 'road': road(g, tile, state); break;
    case 'rail': rail(g, tile, state); break;
    case 'tree': {
      tree(g, -.12, -.09, .94 + (Math.abs(tile.variation) % 4) * .1, tile.variation);
      if (tile.variation % 2) tree(g, .24, .18, .53, tile.variation + 1);
      break;
    }
    case 'residential': residential(g, tile); break;
    case 'commercial': commercial(g, tile); break;
    case 'industrial': industrial(facility, tile, !!connectedIndustry); break;
    case 'power': powerPlant(facility); break;
    case 'waterpump': waterPump(facility); break;
    case 'police': case 'fire': case 'hospital': case 'school': service(facility, tile.kind); break;
    case 'park': park(g, tile); break;
    case 'stadium': stadium(facility); break;
    case 'airport': airport(facility); break;
    case 'seaport': seaport(facility); break;
    case 'wind': windPlant(facility); break;
    case 'solar': solarPlant(facility); break;
    case 'university': university(facility); break;
    case 'recycling': recyclingPlant(facility); break;
    case 'rubble':
      slab(g, 0x9c927f);
      for (let i = 0; i < 5; i++) {
        const n = (Math.abs(tile.variation) + i * 37) % 100;
        mesh(g, crownGeometry, i % 2 ? palette.concrete : palette.stone, ((n * 7) % 61 - 30) / 100, .08 + (n % 3) * .04, ((n * 13) % 61 - 30) / 100, .18 + (n % 4) * .04, .16 + (n % 3) * .07, .18 + (n % 4) * .03, n);
      }
      break;
    default: break;
  }
  if (access?.connected) connectFacilityModel(g, facility, access, tile, state);
  if (FACILITY_FOOTPRINTS[tile.kind] || tile.level > 0 && ['residential', 'commercial', 'industrial'].includes(tile.kind)) addBuildingWindowLights(g, tile);
  // Burning buildings retain their geometry; fire-effects owns animated flames,
  // smoke and embers independently of these shared static model primitives.
  return g;
}

export function createCar(color: number): THREE.Group {
  return createDetailedCar(color);
}

export type FacilityServiceVehicleKind = 'firetruck' | 'ambulance' | 'police';

export function refreshFacilityServiceVehicleLabel(car: THREE.Object3D): void {
  const kind = car.userData.vehicleKind as FacilityServiceVehicleKind;
  const label = kind === 'firetruck' ? tr('Feuerwehrwagen', 'Fire engine')
    : kind === 'ambulance' ? tr('Krankenwagen', 'Ambulance')
      : kind === 'police' ? tr('Polizeiwagen', 'Police car') : undefined;
  if (label) car.userData.vehicleLabel = car.userData.label = label;
}

/** Road-going service vehicles share the same +Z chassis and contact metadata. */
export function createFacilityServiceVehicle(kind: FacilityServiceVehicleKind): THREE.Group {
  const car = createDetailedCar(kind === 'firetruck' ? palette.red : palette.white,
    kind === 'firetruck' ? 'truck' : kind === 'ambulance' ? 'van' : 'sedan');
  car.name = `city-service-${kind}`;
  if (kind === 'firetruck') {
    box(car, palette.red, 0, .218, -.102, .208, .205, .35);
    for (const side of [-1, 1]) {
      box(car, palette.white, side * .105, .153, -.1, .003, .024, .33);
      for (const z of [-.209, -.105, -.001]) {
        box(car, palette.metal, side * .106, .245, z, .003, .096, .087);
        box(car, palette.dark, side * .108, .197, z, .003, .007, .046);
      }
      box(car, palette.metal, side * .057, .34, -.075, .011, .014, .366);
    }
    for (let i = 0; i < 9; i++) box(car, palette.white, 0, .34, -.234 + i * .038, .114, .01, .01);
    box(car, palette.white, 0, .28, .135, .116, .014, .025);
  } else if (kind === 'ambulance') {
    for (const side of [-1, 1]) {
      box(car, palette.red, side * .088, .119, -.05, .003, .025, .211);
      box(car, palette.red, side * .089, .183, -.067, .003, .022, .065);
      box(car, palette.red, side * .09, .183, -.067, .003, .067, .022);
    }
    box(car, palette.red, 0, .19, -.184, .085, .016, .002);
    box(car, palette.red, 0, .19, -.185, .016, .062, .002);
  } else {
    for (const side of [-1, 1]) box(car, palette.blue, side * .081, .079, -.011, .003, .03, .15);
    box(car, palette.blue, 0, .093, .119, .093, .008, .04);
  }
  const lightY = kind === 'firetruck' ? .289 : kind === 'ambulance' ? .24 : .18;
  box(car, palette.dark, 0, lightY - .009, kind === 'firetruck' ? .133 : .005, .135, .012, .031);
  for (const side of [-1, 1]) {
    const light = box(car, palette.blue, side * .047, lightY, kind === 'firetruck' ? .133 : .005, .039, .02, .034);
    light.name = `service-beacon-${side}`;
    light.userData.serviceBeacon = true;
  }
  car.userData.vehicleKind = kind;
  refreshFacilityServiceVehicleLabel(car);
  car.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(car);
  // The shared chassis includes a small modeling offset beneath the wheels.
  // Service routes provide their own road clearance, so their root is the tire
  // contact plane instead of adding both offsets and visibly hovering.
  for (const part of car.children) part.position.y -= bounds.min.y;
  car.updateMatrixWorld(true);
  bounds.setFromObject(car);
  const size = bounds.getSize(new THREE.Vector3());
  car.userData.vehicleDimensions = { ...car.userData.vehicleDimensions, width: size.x, length: size.z, height: bounds.max.y };
  car.userData.collisionHalfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  car.userData.collisionHalfLength = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  return car;
}
