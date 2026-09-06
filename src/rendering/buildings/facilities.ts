import { addMeadowFlowers } from './meadow-flowers';
import { createCar } from './service-vehicles';
import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import {
  box,
  cylinder,
  roof,
  slab,
  tree,
  ribbon,
  mesh,
  coneGeometry,
  sphereGeometry,
  crownGeometry,
} from './primitives';
import { palette, modelMaterial } from './materials';
import { foundation, FACILITY_FOOTPRINTS } from './facility-frame';
import { airportArchitecture } from './airport-layout';
import { buildingVariant } from '../../buildings/lots';
const stadiumCircleGeometry = new THREE.RingGeometry(0.36, 0.379, 24);
const windTowerGeometry = new THREE.CylinderGeometry(0.055, 0.14, 2.32, 10);
export function lamp(g: THREE.Group, x: number, z: number, height = 0.9): void {
  cylinder(g, palette.dark, x, height / 2 + 0.08, z, 0.035, height);
  box(g, palette.dark, x + 0.06, height + 0.08, z, 0.18, 0.038, 0.055);
  box(g, palette.cream, x + 0.09, height + 0.057, z, 0.13, 0.027, 0.075);
}
export function bench(g: THREE.Group, x: number, z: number, angle = 0): void {
  const b = new THREE.Group();
  box(b, palette.wood, 0, 0.15, 0, 0.36, 0.045, 0.16);
  box(b, palette.wood, 0, 0.23, 0.072, 0.36, 0.15, 0.035);
  box(b, palette.dark, -0.13, 0.09, 0, 0.035, 0.15, 0.12);
  box(b, palette.dark, 0.13, 0.09, 0, 0.035, 0.15, 0.12);
  b.position.set(x, 0, z);
  b.rotation.y = angle;
  g.add(b);
}
export function parking(g: THREE.Group, x: number, z: number, count: number, angle = 0): void {
  const p = new THREE.Group();
  const width = count * 0.27;
  box(p, palette.asphalt, 0, 0.088, 0, width + 0.08, 0.015, 0.65);
  for (let i = 0; i <= count; i++)
    box(p, palette.white, -width / 2 + i * 0.27, 0.1, -0.07, 0.012, 0.005, 0.46);
  for (let i = 0; i < count; i++)
    if (i % 3 !== 1) {
      const car = createCar([palette.blue, palette.cream, palette.red, palette.metal][i % 4]);
      car.position.set(-width / 2 + (i + 0.5) * 0.27, 0.1, -0.06);
      p.add(car);
    }
  p.position.set(x, 0, z);
  p.rotation.y = angle;
  g.add(p);
}
export function flag(g: THREE.Group, x: number, z: number, color = palette.blue): void {
  cylinder(g, palette.metal, x, 0.68, z, 0.021, 1.2);
  box(g, color, x + 0.14, 1.15, z, 0.29, 0.17, 0.016);
}
export function officeBlock(
  g: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  accent = palette.blue,
  floors = 3,
): void {
  box(g, palette.cream, x, height / 2 + 0.09, z, width, height, depth);
  for (let floor = 0; floor < floors; floor++)
    ribbon(
      g,
      x,
      0.25 + (floor * (height - 0.15)) / floors,
      z,
      width,
      Math.min(0.16, (height / floors) * 0.45),
      depth,
      palette.glass,
    );
  box(g, accent, x, height + 0.12, z, width + 0.06, 0.08, depth + 0.06);
  box(g, palette.glassDark, x, 0.29, z + depth / 2 + 0.013, 0.25, 0.39, 0.026);
  box(g, accent, x, 0.52, z + depth / 2 + 0.1, 0.49, 0.045, 0.25);
  box(g, palette.metal, x - width * 0.22, height + 0.23, z - depth * 0.22, 0.22, 0.14, 0.26);
}
export function powerPlant(g: THREE.Group): void {
  foundation(g, 4, 4);
  box(g, palette.asphalt, 0, 0.092, 1.47, 3.84, 0.014, 0.63);
  box(g, palette.stone, -0.54, 0.6, 0.15, 1.73, 1.03, 1.7);
  for (let i = 0; i < 4; i++) roof(g, palette.roof, -1.2 + i * 0.43, 1.13, 0.15, 0.46, 0.27, 1.8);
  ribbon(g, -0.54, 0.7, 0.15, 1.73, 0.31, 1.7);
  box(g, palette.blue, -0.54, 0.27, 1.014, 0.62, 0.38, 0.033);
  for (let i = 0; i < 2; i++) {
    const x = -0.85 + i * 0.89;
    cylinder(g, palette.concrete, x, 1.27, -1.12, 0.32, 2.39);
    for (const y of [1.83, 2.16]) cylinder(g, palette.red, x, y, -1.12, 0.326, 0.16);
    cylinder(g, palette.dark, x, 2.48, -1.12, 0.25, 0.028);
    box(g, palette.metal, x, 0.48, -0.71, 0.18, 0.16, 0.72);
  }
  for (const z of [-0.83, 0.23]) {
    cylinder(g, palette.metal, 1.17, 0.51, z, 0.8, 0.84);
    mesh(g, sphereGeometry, palette.metal, 1.17, 0.93, z, 0.8, 0.24, 0.8);
    cylinder(g, palette.blue, 1.17, 0.48, z, 0.811, 0.082);
  }
  box(g, palette.yellow, 0.52, 0.34, 0.85, 0.55, 0.49, 0.34);
  box(g, palette.dark, 0.52, 0.38, 1.026, 0.41, 0.17, 0.015);
  // Substation: switchgear, copper rails and visible outgoing gantry.
  for (let i = 0; i < 3; i++) {
    box(g, palette.metal, 0.63 + i * 0.39, 0.2, -1.67, 0.27, 0.2, 0.25);
    cylinder(g, palette.dark, 0.63 + i * 0.39, 0.47, -1.67, 0.062, 0.4);
  }
  box(g, palette.rust, 1.02, 0.69, -1.67, 1.02, 0.037, 0.04);
  lamp(g, -1.67, 1.72, 1.03);
  lamp(g, 1.7, 1.72, 1.03);
  parking(g, -0.94, 1.44, 4);
}
export function waterPump(g: THREE.Group): void {
  foundation(g, 2, 2, palette.grass);
  box(g, palette.concrete, -0.37, 0.15, -0.16, 0.94, 0.14, 1.4);
  cylinder(g, palette.white, -0.35, 0.24, -0.22, 0.83, 0.21);
  cylinder(g, palette.water, -0.35, 0.35, -0.22, 0.72, 0.018);
  box(g, palette.metal, -0.35, 0.38, -0.22, 0.89, 0.04, 0.07);
  cylinder(g, palette.white, -0.35, 0.37, -0.22, 0.08, 0.13);
  officeBlock(g, 0.48, 0.32, 0.61, 0.79, 0.56, palette.blue, 1);
  const x = 0.49,
    z = -0.58;
  for (const dx of [-0.22, 0.22])
    for (const dz of [-0.2, 0.2]) cylinder(g, palette.white, x + dx, 0.63, z + dz, 0.04, 1.09);
  cylinder(g, palette.water, x, 1.18, z, 0.65, 0.42);
  cylinder(g, palette.white, x, 0.98, z, 0.68, 0.065);
  mesh(g, coneGeometry, palette.blue, x, 1.45, z, 0.73, 0.17, 0.73);
  box(g, palette.blue, -0.11, 0.18, 0.66, 0.66, 0.12, 0.11);
  cylinder(g, palette.blue, -0.43, 0.23, 0.66, 0.12, 0.25);
  lamp(g, -0.82, 0.8, 0.72);
}
export function service(g: THREE.Group, kind: Tile['kind']): void {
  if (kind === 'police') {
    foundation(g, 2, 2);
    officeBlock(g, -0.3, -0.29, 1.1, 0.99, 1.1, palette.blue, 3);
    box(g, palette.stone, 0.53, 0.36, -0.3, 0.47, 0.53, 1.0);
    box(g, palette.dark, 0.53, 0.3, 0.213, 0.34, 0.38, 0.02);
    box(g, palette.blue, -0.3, 0.89, 0.217, 0.35, 0.21, 0.035);
    mesh(g, crownGeometry, palette.yellow, -0.3, 0.89, 0.243, 0.13, 0.15, 0.024);
    box(g, palette.asphalt, 0, 0.091, 0.53, 1.8, 0.022, 0.66);
    flag(g, -0.82, 0.72);
    tree(g, -0.79, -0.74, 0.56, 1);
  } else if (kind === 'fire') {
    foundation(g, 3, 2);
    box(g, palette.rust, -0.2, 0.51, -0.25, 2.32, 0.85, 1.02);
    box(g, palette.cream, -0.2, 0.98, -0.25, 2.39, 0.09, 1.09);
    for (let i = 0; i < 3; i++) {
      const x = -0.99 + i * 0.66;
      box(g, palette.dark, x, 0.4, 0.267, 0.51, 0.57, 0.022);
      for (let j = 0; j < 4; j++)
        box(g, palette.metal, x, 0.44 + j * 0.064, 0.282, 0.46, 0.013, 0.008);
    }
    box(g, palette.stone, 1.09, 0.91, -0.42, 0.48, 1.63, 0.55);
    box(g, palette.red, 1.09, 1.77, -0.42, 0.55, 0.09, 0.62);
    ribbon(g, 1.09, 1.45, -0.42, 0.48, 0.15, 0.55);
    box(g, palette.red, -0.2, 0.87, 0.286, 1.5, 0.1, 0.033);
    flag(g, 1.15, 0.78, palette.red);
    lamp(g, -1.33, 0.8, 0.86);
  } else if (kind === 'hospital') {
    foundation(g, 3, 3);
    officeBlock(g, -0.1, -0.5, 2.14, 1.05, 1.85, palette.white, 5);
    officeBlock(g, -0.72, 0.25, 0.91, 1.25, 0.76, palette.white, 2);
    officeBlock(g, 0.64, 0.25, 0.86, 1.25, 1.05, palette.white, 3);
    box(g, palette.glass, -0.02, 0.4, 0.66, 0.44, 0.65, 0.7);
    box(g, palette.red, -0.02, 0.78, 1.03, 0.7, 0.075, 0.27);
    box(g, palette.white, -0.07, 1.67, 0.04, 0.47, 0.42, 0.025);
    box(g, palette.red, -0.07, 1.67, 0.062, 0.28, 0.079, 0.019);
    box(g, palette.red, -0.07, 1.67, 0.062, 0.079, 0.29, 0.019);
    cylinder(g, palette.roof, -0.15, 1.983, -0.5, 0.86, 0.017);
    cylinder(g, palette.white, -0.15, 1.995, -0.5, 0.76, 0.01);
    cylinder(g, palette.roof, -0.15, 2.001, -0.5, 0.69, 0.009);
    for (const xx of [-0.28, -0.02]) box(g, palette.white, xx, 2.011, -0.5, 0.04, 0.008, 0.31);
    box(g, palette.white, -0.15, 2.011, -0.5, 0.26, 0.008, 0.04);
    parking(g, -0.83, 1.13, 3);
    tree(g, -1.29, -0.9, 0.77, 2);
    tree(g, 1.27, -0.92, 0.73, 1);
    lamp(g, 1.3, 1.26);
    lamp(g, -1.3, 1.26);
  } else if (kind === 'school') {
    foundation(g, 3, 2, palette.grass);
    officeBlock(g, -0.35, -0.33, 1.8, 0.97, 0.69, palette.terracotta, 2);
    roof(g, palette.terracotta, -0.35, 0.84, -0.33, 1.04, 0.24, 1.86, Math.PI / 2);
    box(g, palette.yellow, 0.83, 0.4, -0.25, 0.62, 0.62, 1.06);
    box(g, palette.blue, 0.83, 0.74, -0.25, 0.69, 0.08, 1.13);
    box(g, palette.stone, -0.4, 0.092, 0.53, 1.8, 0.025, 0.51);
    for (let i = 0; i < 2; i++) {
      box(g, palette.red, 0.64 + i * 0.42, 0.32, 0.55, 0.035, 0.47, 0.035);
    }
    box(g, palette.yellow, 0.85, 0.56, 0.55, 0.5, 0.034, 0.034);
    for (const x of [0.74, 0.96]) {
      cylinder(g, palette.dark, x, 0.4, 0.55, 0.012, 0.3);
      box(g, palette.blue, x, 0.25, 0.55, 0.13, 0.025, 0.1);
    }
    tree(g, -1.3, 0.55, 0.8, 1);
    bench(g, -0.55, 0.73);
    flag(g, 1.15, 0.75, palette.yellow);
  }
}
export function university(g: THREE.Group): void {
  foundation(g, 5, 4, palette.grass);
  box(g, palette.stone, 0, 0.094, 0.2, 3.95, 0.026, 3.5);
  officeBlock(g, 0, -1.12, 3.52, 1.11, 1.19, palette.terracotta, 3);
  roof(g, palette.terracotta, 0, 1.36, -1.12, 1.25, 0.4, 3.64, Math.PI / 2);
  for (const x of [-1.52, 1.52]) {
    officeBlock(g, x, 0.18, 0.86, 1.6, 0.96, palette.terracotta, 3);
    roof(g, palette.terracotta, x, 1.1, 0.18, 0.96, 0.24, 1.73);
  }
  box(g, palette.cream, 0, 1.19, -0.67, 0.64, 2.18, 0.63);
  roof(g, palette.blue, 0, 2.3, -0.67, 0.76, 0.53, 0.75);
  cylinder(g, palette.white, 0, 1.95, -0.34, 0.3, 0.022).rotation.x = Math.PI / 2;
  box(g, palette.dark, 0, 1.95, -0.316, 0.017, 0.1, 0.01);
  box(g, palette.dark, 0.038, 1.95, -0.316, 0.085, 0.017, 0.01);
  box(g, palette.grass, 0, 0.12, 0.49, 1.89, 0.03, 1.53);
  box(g, palette.stone, 0, 0.14, 0.59, 0.3, 0.022, 1.91);
  cylinder(g, palette.cream, 0, 0.17, 0.32, 0.88, 0.07);
  cylinder(g, palette.water, 0, 0.214, 0.32, 0.73, 0.012);
  cylinder(g, palette.stone, 0, 0.36, 0.32, 0.14, 0.28);
  cylinder(g, palette.water, 0, 0.51, 0.32, 0.34, 0.045);
  for (const x of [-2.14, 2.14])
    for (const z of [-1.4, -0.35, 0.7, 1.54]) tree(g, x, z, 0.82, Math.round(z * 10));
  for (const x of [-0.72, 0.72]) {
    bench(g, x, 0.96);
    lamp(g, x, 1.51, 1.05);
  }
  parking(g, -0.73, 1.58, 6);
  flag(g, 1.56, 1.61);
}
export function park(g: THREE.Group, tile: Tile): void {
  const variant = buildingVariant(tile);
  slab(g, palette.grass, variant === 3 ? 1 : 0.9, variant === 3 ? 1 : 0.9);
  if (variant === 1) {
    cylinder(g, palette.stone, 0, 0.04, 0, 0.7, 0.05);
    cylinder(g, palette.water, 0, 0.073, 0, 0.59, 0.02);
    cylinder(g, palette.cream, 0, 0.22, 0, 0.07, 0.3);
    cylinder(g, palette.water, 0, 0.38, 0, 0.2, 0.04);
    for (const x of [-0.32, 0.32]) bench(g, x, 0.3);
    return;
  }
  if (variant === 2) {
    for (const x of [-0.32, 0.32])
      for (const z of [-0.27, 0.27]) box(g, palette.wood, x, 0.3, z, 0.045, 0.58, 0.045);
    for (let i = 0; i < 6; i++) box(g, palette.wood, -0.34 + i * 0.135, 0.6, 0, 0.055, 0.045, 0.64);
    box(g, palette.stone, 0, 0.04, 0, 0.42, 0.02, 0.9);
    bench(g, 0, -0.2);
    return;
  }
  if (variant === 3) {
    // Open meadow tiles meet flush. Sparse world-aligned walks join across a
    // whole park, rather than outlining every tile as a separate garden bed.
    const verticalWalk = ((tile.x % 5) + 5) % 5 === 0;
    const horizontalWalk = ((tile.z % 4) + 4) % 4 === 0;
    if (verticalWalk) box(g, 0xd8c9aa, 0, 0.031, 0, 0.12, 0.006, 1).castShadow = false;
    if (horizontalWalk) box(g, 0xd8c9aa, 0, 0.031, 0, 1, 0.006, 0.12).castShadow = false;
    // Low, irregular flower drifts occupy only some lawn tiles. Position and
    // colour come from the tile coordinates, so existing saves need no edits.
    const seed = (Math.imul(tile.x, 73856093) ^ Math.imul(tile.z, 19349663)) >>> 0;
    if (seed % 3 !== 0) {
      const x = (((seed >>> 3) % 55) - 27) / 100;
      const z = (((seed >>> 10) % 55) - 27) / 100;
      const px = verticalWalk && Math.abs(x) < 0.18 ? (x < 0 ? -0.25 : 0.25) : x;
      const pz = horizontalWalk && Math.abs(z) < 0.18 ? (z < 0 ? -0.25 : 0.25) : z;
      addMeadowFlowers(g, px, pz, seed);
    }
    return;
  }
  if (variant === 4) {
    for (const x of [-0.27, 0.27])
      for (const z of [-0.27, 0.27]) tree(g, x, z, 0.56, tile.variation);
    box(g, palette.stone, 0, 0.045, 0, 0.26, 0.025, 0.9);
    box(g, palette.stone, 0, 0.05, 0, 0.9, 0.025, 0.24);
    cylinder(g, palette.cream, 0, 0.18, 0, 0.16, 0.25);
    mesh(g, sphereGeometry, palette.metal, 0, 0.38, 0, 0.25, 0.25, 0.25);
    return;
  }
  box(g, palette.stone, 0, 0.034, 0, 0.16, 0.015, 0.92);
  box(g, palette.stone, 0, 0.034, 0, 0.92, 0.015, 0.12);
  tree(g, -0.29, -0.27, 0.96, tile.variation);
  tree(g, 0.27, -0.25, 0.68, tile.variation + 1);
  tree(g, 0.29, 0.29, 0.77, tile.variation + 2);
  if (tile.variation % 2) {
    cylinder(g, palette.stone, -0.25, 0.04, 0.26, 0.28, 0.045, 0.28);
    cylinder(g, palette.water, -0.25, 0.066, 0.26, 0.24, 0.008, 0.24);
    cylinder(g, palette.cream, -0.25, 0.12, 0.26, 0.038, 0.11);
    cylinder(g, palette.water, -0.25, 0.18, 0.26, 0.085, 0.02);
  } else {
    bench(g, -0.25, 0.28);
  }
}
export function stadium(g: THREE.Group): void {
  foundation(g, 6, 5);
  // The playing surface is sunk into four stepped grandstands: a genuine bowl.
  box(g, palette.rust, 0, 0.105, 0, 4.77, 0.045, 3.3);
  box(g, palette.green, 0, 0.135, 0, 3.84, 0.026, 2.33);
  for (let i = 0; i < 8; i++)
    if (i % 2) box(g, palette.grass, -1.68 + i * 0.48, 0.15, 0, 0.48, 0.012, 2.33);
  for (const x of [-1.88, 1.88]) box(g, palette.white, x, 0.163, 0, 0.019, 0.009, 2.25);
  for (const z of [-1.12, 1.12]) box(g, palette.white, 0, 0.163, z, 3.78, 0.009, 0.018);
  box(g, palette.white, 0, 0.163, 0, 0.018, 0.009, 2.25);
  const circle = new THREE.Mesh(stadiumCircleGeometry, modelMaterial(palette.white));
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.169;
  circle.receiveShadow = true;
  g.add(circle);
  for (const x of [-1.65, 1.65]) {
    box(g, palette.white, x, 0.164, 0, 0.022, 0.009, 0.91);
    for (const z of [-0.455, 0.455])
      box(g, palette.white, x + (x < 0 ? -0.12 : 0.12), 0.164, z, 0.25, 0.009, 0.02);
    for (const z of [-0.31, 0.31])
      cylinder(g, palette.white, x < 0 ? -1.91 : 1.91, 0.32, z, 0.029, 0.32);
    box(g, palette.white, x < 0 ? -1.91 : 1.91, 0.49, 0, 0.029, 0.032, 0.65);
    box(g, palette.concrete, x < 0 ? -2.045 : 2.045, 0.3, 0, 0.024, 0.26, 0.59);
  }
  for (let row = 0; row < 5; row++) {
    const y = 0.27 + row * 0.13,
      d = 1.38 + row * 0.151,
      x = 2.11 + row * 0.127;
    for (const sign of [-1, 1]) {
      box(g, palette.stone, 0, y - 0.08, sign * d, 4.41, 0.23, 0.21);
      box(g, row % 2 ? palette.blue : palette.cream, 0, y + 0.043, sign * d, 4.32, 0.035, 0.16);
      box(g, palette.stone, sign * x, y - 0.08, 0, 0.2, 0.23, 2.73);
      box(g, row % 2 ? palette.blue : palette.cream, sign * x, y + 0.043, 0, 0.16, 0.035, 2.64);
      // Alternating supporter ribbons read as seated crowds at a useful distance.
      for (let block = 0; block < 7; block++)
        box(
          g,
          [palette.yellow, palette.red, palette.dark][(row + block) % 3],
          -1.85 + block * 0.61,
          y + 0.096,
          sign * d,
          0.36,
          0.075,
          0.086,
        );
    }
  }
  for (const z of [-2.2, 2.2]) {
    box(g, palette.white, 0, 1.04, z, 4.74, 0.075, 0.41);
    for (const x of [-2.22, 0, 2.22]) cylinder(g, palette.dark, x, 0.57, z, 0.055, 1.02);
  }
  for (const x of [-2.72, 2.72])
    for (const z of [-1.87, 1.87]) {
      cylinder(g, palette.dark, x, 0.94, z, 0.057, 1.7);
      box(g, palette.dark, x, 1.84, z, 0.5, 0.22, 0.09);
      for (let i = 0; i < 3; i++)
        box(
          g,
          palette.cream,
          x - 0.16 + i * 0.16,
          1.84,
          z + (z > 0 ? -0.05 : 0.05),
          0.11,
          0.14,
          0.025,
        );
    }
  box(g, palette.dark, -2.71, 1.06, 0, 0.08, 0.61, 1.32);
  box(g, palette.blue, -2.661, 1.08, 0, 0.019, 0.44, 1.13);
  for (const z of [-0.29, 0.29]) box(g, palette.white, -2.645, 1.1, z, 0.011, 0.13, 0.19);
  box(g, palette.cream, 0, 0.2, 2.32, 1.42, 0.25, 0.24);
  box(g, palette.glassDark, 0, 0.23, 2.447, 0.92, 0.17, 0.013);
}
export function aircraft(): THREE.Group {
  const p = new THREE.Group();
  p.userData.drivingObstacle = true;
  // Airframe points toward local +X. Swept wings, nacelles and a real tail.
  mesh(p, sphereGeometry, palette.white, 0, 0.12, 0, 1.2, 0.15, 0.15);
  box(p, palette.white, -0.11, 0.12, 0, 0.32, 0.035, 1.05, -0.24);
  box(p, palette.blue, -0.46, 0.17, 0, 0.16, 0.028, 0.39);
  box(p, palette.blue, -0.46, 0.23, 0, 0.14, 0.23, 0.022);
  box(p, palette.glassDark, 0.4, 0.183, 0, 0.15, 0.018, 0.09);
  for (const z of [-0.26, 0.26]) {
    const engine = cylinder(p, palette.metal, 0.03, 0.074, z, 0.095, 0.27);
    engine.rotation.z = Math.PI / 2;
  }
  for (const z of [-0.078, 0.078]) box(p, palette.glassDark, 0.09, 0.142, z, 0.52, 0.021, 0.006);
  return p;
}
export function airport(g: THREE.Group): void {
  foundation(g, 10, 6, palette.grass);
  box(g, palette.asphalt, 0, 0.095, -1.6, 9.63, 0.026, 1.13);
  for (const z of [-2.1, -1.1]) box(g, palette.white, 0, 0.112, z, 9.41, 0.008, 0.035);
  for (let i = 0; i < 16; i++)
    box(g, palette.white, -4.42 + i * 0.59, 0.116, -1.6, 0.29, 0.008, 0.035);
  for (const x of [-4.21, 4.21])
    for (let i = 0; i < 4; i++)
      box(g, palette.white, x, 0.117, -1.95 + i * 0.23, 0.48, 0.008, 0.079);
  box(g, palette.asphalt, 0, 0.097, -0.31, 8.69, 0.022, 0.43);
  for (const x of [-3.71, 0, 3.71]) box(g, palette.asphalt, x, 0.098, -0.91, 0.51, 0.022, 1.17);
  box(g, palette.yellow, 0, 0.114, -0.31, 8.22, 0.008, 0.023);
  box(g, palette.concrete, -0.66, 0.094, 0.77, 6.68, 0.028, 1.71);
  officeBlock(g, -0.71, 1.77, 4.86, 1.14, 0.69, palette.roof, 2);
  box(g, palette.glass, -0.71, 0.72, 1.77, 4.62, 0.34, 1.17);
  for (let i = 0; i < 4; i++) {
    const x = -2.67 + i * 1.25;
    box(g, palette.cream, x, 0.44, 0.86, 0.21, 0.31, 0.83);
    box(g, palette.glassDark, x, 0.48, 0.63, 0.23, 0.13, 0.42);
    box(g, palette.yellow, x, 0.115, 0.39, 0.85, 0.008, 0.022);
    if (i !== 1) {
      const plane = aircraft();
      plane.rotation.y = -Math.PI / 2;
      plane.position.set(x, 0.09, 0.4);
      plane.scale.setScalar(0.71);
      g.add(plane);
    }
  }
  box(g, palette.cream, 2.75, 0.79, 1.72, 0.34, 1.38, 0.34);
  box(g, palette.glassDark, 2.75, 1.61, 1.72, 0.77, 0.32, 0.71);
  box(g, palette.white, 2.75, 1.81, 1.72, 0.85, 0.079, 0.79);
  cylinder(g, palette.metal, 2.75, 2.04, 1.72, 0.035, 0.45);
  officeBlock(g, 4.06, 1.32, 1.27, 1.47, 0.52, palette.roof, 1);
  roof(g, palette.roof, 4.06, 0.66, 1.32, 1.33, 0.27, 1.54);
  box(g, palette.dark, 4.06, 0.36, 0.573, 1.06, 0.4, 0.022);
  parking(g, -0.68, 2.56, 14);
  for (let i = 0; i < 9; i++)
    for (const z of [-2.31, -0.87])
      box(g, palette.cream, -4.61 + i * 1.15, 0.13, z, 0.065, 0.083, 0.065);
  for (const x of [-3.44, 1.95]) lamp(g, x, 2.58, 0.86);
}
export function seaport(g: THREE.Group): void {
  foundation(g, 5, 3);
  box(g, palette.asphalt, 0, 0.095, -0.9, 4.83, 0.027, 0.62);
  box(g, palette.concrete, 0, 0.15, 0.76, 4.86, 0.22, 1.17);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) cylinder(g, palette.dark, x, 0.12, 1.4, 0.11, 0.23);
  box(g, palette.stone, -1.46, 0.49, -0.07, 1.52, 0.66, 1.01);
  for (let i = 0; i < 3; i++)
    roof(g, palette.roof, -1.96 + i * 0.51, 0.84, -0.07, 0.54, 0.22, 1.09);
  for (let i = 0; i < 6; i++) {
    const x = -0.35 + (i % 3) * 0.71,
      z = -0.43 + Math.floor(i / 3) * 0.61;
    box(
      g,
      [palette.blue, palette.red, palette.yellow][i % 3],
      x,
      0.35,
      z,
      0.61,
      0.38,
      0.43,
    ).userData.noFacadeOpenings = true;
    for (let j = 0; j < 4; j++)
      box(g, palette.metal, x - 0.23 + j * 0.15, 0.35, z + 0.219, 0.012, 0.29, 0.007);
    if (i === 1 || i === 4)
      box(g, palette.red, x, 0.73, z, 0.61, 0.36, 0.43).userData.noFacadeOpenings = true;
  }
  for (const x of [1.7, 0.1]) {
    for (const z of [0.55, 1.04]) box(g, palette.yellow, x, 0.85, z, 0.1, 1.42, 0.1);
    box(g, palette.yellow, x, 1.59, 0.67, 0.15, 0.15, 1.44);
    box(g, palette.yellow, x, 1.84, 0.25, 0.11, 0.44, 0.11);
    box(g, palette.dark, x, 1.41, 0.73, 0.29, 0.2, 0.27);
    box(g, palette.glass, x, 1.44, 0.874, 0.23, 0.11, 0.024);
  }
  lamp(g, -2.18, -1.28);
  lamp(g, 2.18, -1.28);
}
export function windPlant(g: THREE.Group): void {
  foundation(g, 2, 2, palette.grass);
  cylinder(g, palette.concrete, 0, 0.15, 0, 0.54, 0.16);
  mesh(g, windTowerGeometry, palette.white, 0, 1.33, 0, 1, 1, 1);
  box(g, palette.white, 0, 2.52, -0.055, 0.19, 0.2, 0.36);
  box(g, palette.blue, 0.56, 0.24, 0.62, 0.39, 0.32, 0.42).userData.noFacadeOpenings = true;
  box(g, palette.stone, 0.29, 0.096, 0.33, 0.18, 0.02, 0.75, -0.48);
  tree(g, -0.66, -0.62, 0.59, 1);
  tree(g, 0.68, -0.58, 0.43, 2);
}
export function solarPlant(g: THREE.Group): void {
  foundation(g, 4, 3, palette.grass);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++) {
      const x = -1.51 + col * 0.75,
        z = -0.99 + row * 0.6;
      box(g, palette.metal, x, 0.2, z, 0.037, 0.25, 0.037);
      const panel = box(g, palette.solarCell, x, 0.36, z, 0.65, 0.037, 0.49);
      panel.rotation.x = -0.36;
      const ridge = box(g, palette.metal, x, 0.381, z, 0.015, 0.014, 0.48);
      ridge.rotation.x = -0.36;
      box(g, palette.metal, x, 0.362, z, 0.65, 0.015, 0.015);
    }
  box(g, palette.white, 1.51, 0.24, 1.26, 0.44, 0.31, 0.3);
  box(g, palette.yellow, 1.51, 0.29, 1.417, 0.17, 0.1, 0.012);
}
export function recyclingPlant(g: THREE.Group): void {
  foundation(g, 3, 3);
  box(g, palette.green, -0.48, 0.58, -0.45, 1.71, 0.99, 1.34);
  for (let i = 0; i < 3; i++)
    roof(g, palette.roof, -0.48, 1.09, -0.86 + i * 0.45, 0.48, 0.27, 1.8, Math.PI / 2);
  box(g, palette.dark, -0.48, 0.43, 0.233, 0.96, 0.67, 0.024);
  box(g, palette.white, -0.48, 0.91, 0.25, 0.79, 0.16, 0.023);
  for (let i = 0; i < 3; i++) {
    const x = -0.99 + i * 0.89;
    box(g, [palette.blue, palette.yellow, palette.green][i], x, 0.3, 1.0, 0.67, 0.41, 0.56);
    box(g, palette.dark, x, 0.51, 1, 0.7, 0.044, 0.6);
  }
  for (const z of [-0.88, -0.14]) {
    cylinder(g, palette.metal, 0.88, 0.61, z, 0.64, 1.05);
    mesh(g, coneGeometry, palette.white, 0.88, 1.23, z, 0.7, 0.24, 0.7);
  }
  box(g, palette.dark, 0.64, 0.37, 0.54, 0.39, 0.2, 0.62);
  box(g, palette.green, 0.64, 0.54, 0.33, 0.41, 0.17, 0.34);
  lamp(g, -1.34, 1.31, 0.89);
  tree(g, 1.31, 1.31, 0.68, 1);
}
/** Architectural additions change massing, roof lines and circulation, not only paint. */
export function facilityArchitecture(g: THREE.Group, tile: Tile): void {
  const v = buildingVariant(tile);
  if (tile.kind === 'airport') {
    airportArchitecture(g, v);
    return;
  }
  // A landmark's moving parts and field must never receive generic masses.
  if (tile.kind === 'wind') {
    if (v) {
      const equipment = new THREE.Group();
      equipment.name = `architecture-${v}`;
      g.add(equipment);
      for (let i = 0; i < v; i++)
        box(equipment, palette.metal, -0.66 + i * 0.17, 0.2, 0.64, 0.13, 0.22, 0.28);
    }
    return;
  }
  if (tile.kind === 'stadium') {
    if (v) {
      const canopy = new THREE.Group();
      canopy.name = `architecture-${v}`;
      g.add(canopy);
      for (let i = 0; i < v; i++)
        roof(canopy, palette.white, -1.65 + i * 1.1, 1.09, -2.18, 1.04, 0.12 + v * 0.03, 0.48);
    }
    return;
  }
  if (v === 0) return;
  const [w, d] = FACILITY_FOOTPRINTS[tile.kind] ?? [1, 1];
  const x = -w * 0.24,
    z = -d * 0.22,
    base = 0.12;
  const architecture = new THREE.Group();
  architecture.name = `architecture-${v}`;
  g.add(architecture);
  if (v === 1) {
    // administration wing with a barrel roof
    box(architecture, palette.cream, x, 0.4, z, w * 0.28, 0.56, d * 0.22);
    const barrel = cylinder(architecture, palette.roof, x, 0.68, z, w * 0.3, d * 0.24, w * 0.3);
    barrel.rotation.x = Math.PI / 2;
    ribbon(architecture, x, 0.4, z, w * 0.28, 0.16, d * 0.22);
  } else if (v === 2) {
    // glass service tower
    box(architecture, palette.glassDark, x, 0.73, z, w * 0.17, 1.25, d * 0.18);
    for (let i = 0; i < 4; i++)
      box(architecture, palette.white, x, 0.27 + i * 0.3, z, w * 0.19, 0.045, d * 0.2);
    box(architecture, palette.roof, x, 1.4, z, w * 0.23, 0.12, d * 0.23);
  } else if (v === 3) {
    // three cascading roof terraces
    for (let i = 0; i < 3; i++) {
      box(
        architecture,
        palette.stone,
        x + i * w * 0.105,
        base + 0.18 + i * 0.1,
        z,
        w * 0.13,
        0.36 + i * 0.2,
        d * 0.27,
      );
      box(
        architecture,
        palette.green,
        x + i * w * 0.105,
        base + 0.39 + i * 0.2,
        z,
        w * 0.12,
        0.055,
        d * 0.25,
      );
    }
  } else {
    // paired pitched halls with shared entrance arcade
    for (const side of [-1, 1]) {
      const bx = x + side * w * 0.11;
      box(architecture, palette.cream, bx, 0.37, z, w * 0.2, 0.5, d * 0.28);
      roof(architecture, palette.terracotta, bx, 0.62, z, w * 0.22, 0.25, d * 0.3);
    }
    box(architecture, palette.glass, x, 0.31, z + d * 0.19, w * 0.45, 0.35, 0.08);
  }
}
