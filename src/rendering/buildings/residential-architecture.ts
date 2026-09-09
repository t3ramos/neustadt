import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import { buildingVariant, zoneLotDimensions } from '../../buildings/lots';
import { box, roof, slab, tree, zone } from './primitives';
import { palette } from './materials';
import { ResidentialDetails } from './residential-details';
import { roundedResidentialBay, curvedResidentialBalcony } from './residential-curves';

const designs = new Map<string, THREE.Group>();
const wallColors = [0xede3d3, 0xd7b8a3, 0xcdd2c4, 0xe2d2b5];
const families = ['village', 'courtyard', 'garden-villa', 'terraced', 'paired'];

/** All occupied masses remain ordinary shared primitive meshes. Decorative geometry
 * is baked once per finite design key, then reused by the renderer's instancing. */
export function residentialArchitecture(g: THREE.Group, tile: Tile, centered = false): void {
  const [w, d] = zoneLotDimensions(tile),
    v = Math.abs(tile.variation),
    family = buildingVariant(tile);
  if (!tile.level) {
    zone(g, 0x66a276, v);
    return;
  }
  const level = Math.min(tile.level, 3);
  const key = `${family}:${v % 4}:${level}:${w}:${d}`;
  let design = designs.get(key);
  if (!design) {
    design = new THREE.Group();
    design.name = `residential-${families[family]}`;
    design.userData.residentialFamily = families[family];
    build(design, family, v % 4, level, w, d);
    designs.set(key, design);
  }
  const frame = design.clone(true);
  if (!centered) frame.position.set((w - 1) / 2, 0, (d - 1) / 2);
  g.add(frame);
}

function build(
  g: THREE.Group,
  family: number,
  variation: number,
  level: number,
  w: number,
  d: number,
): void {
  slab(g, palette.grass, w - 0.06, d - 0.06);
  const details = new ResidentialDetails(),
    wall = wallColors[variation];
  const body = (
    x: number,
    z: number,
    bw: number,
    bd: number,
    h: number,
    base = 0.035,
    color = wall,
  ) => {
    const mesh = box(g, color, x, base + h / 2, z, bw, h, bd);
    mesh.name = 'residential-occupied-body';
    mesh.userData.noFacadeOpenings = true;
    details.box(palette.stone, x, base + 0.032, z, bw + 0.012, 0.064, bd + 0.012);
    return mesh;
  };
  const pitched = (
    x: number,
    z: number,
    bw: number,
    bd: number,
    eave: number,
    rise: number,
    exact = false,
  ) => {
    const rw = exact ? bw : bw + 0.06,
      rd = exact ? bd : bd + 0.065;
    roof(g, variation % 2 ? palette.terracotta : palette.roof, x, eave, z, rw, rise, rd);
    details.box(palette.rust, x, eave + rise, z, 0.025, 0.017, rd + 0.005);
    for (const side of [-1, 1]) {
      details.box(palette.dark, x + (side * rw) / 2, eave + 0.001, z, 0.019, 0.021, rd);
      details.box(palette.white, x + side * (bw / 2 - 0.016), eave - 0.012, z, 0.018, 0.026, bd);
    }
    const slope = Math.atan2(rise, rw / 2),
      panelX = rw * 0.25;
    details.box(
      palette.solarCell,
      x + panelX,
      eave + rise * 0.5 + 0.014,
      z - rd * 0.09,
      (rw * 0.29) / Math.cos(slope),
      0.012,
      rd * 0.35,
      0,
      -slope,
    );
    details.box(
      palette.rust,
      x - rw * 0.2,
      eave + rise * 0.63,
      z - rd * 0.26,
      0.053,
      rise * 0.82,
      0.062,
    );
    details.box(
      palette.stone,
      x - rw * 0.2,
      eave + rise * 1.04,
      z - rd * 0.26,
      0.068,
      0.018,
      0.074,
    );
  };
  const openings = (
    x: number,
    z: number,
    bw: number,
    bd: number,
    h: number,
    floors: number,
    base = 0.035,
    balconies = false,
  ) => {
    const columns = bw >= 0.46 ? 2 : 1;
    const wh = Math.min(0.15, (h / floors) * 0.48),
      ww = Math.min(0.12, bw * 0.34);
    for (let row = 0; row < floors; row++) {
      const y = base + ((row + 0.56) * h) / floors;
      for (let col = 0; col < columns; col++) {
        const wx = x + (col - (columns - 1) / 2) * bw * 0.49;
        // Ground-floor center is reserved for the entrance on narrow houses.
        if (row > 0 || columns > 1)
          details.window(wx, y, z + bd / 2, ww, wh, 0, (row + col + variation) % 4 === 1);
        details.window(wx, y, z - bd / 2, ww, wh, Math.PI, (row + col + variation) % 4 === 2);
      }
      for (const side of [-1, 1])
        details.window(
          x + (side * bw) / 2,
          y,
          z,
          Math.min(ww, bd * 0.34),
          wh,
          (side * Math.PI) / 2,
        );
      if (balconies && row > 0) {
        if (family === 2 || family === 4)
          curvedResidentialBalcony(g, x, y - wh / 2 - 0.036, z + bd / 2 + 0.006, bw * 0.8, 0.095);
        else details.balcony(x, y - wh / 2 - 0.036, z + bd / 2 + 0.016, bw * 0.82);
      }
    }
    if (base < 0.1) {
      details.entrance(x, z + bd / 2, Math.min(0.1, bw * 0.27));
      const front = z + bd / 2,
        end = d * 0.465;
      details.box(
        palette.stone,
        x,
        0.032,
        (front + end) / 2,
        Math.min(0.12, bw * 0.45),
        0.008,
        end - front,
      );
    }
  };
  const terrace = (x: number, z: number, bw: number, bd: number, y: number) => {
    const cap = box(g, palette.roof, x, y + 0.013, z, bw + 0.025, 0.026, bd + 0.025);
    cap.name = 'residential-roof-terrace';
    cap.userData.fireRoof = true;
    for (const side of [-1, 1]) {
      details.box(palette.stone, x, y + 0.065, z + (side * bd) / 2, bw, 0.075, 0.019);
      details.box(palette.stone, x + (side * bw) / 2, y + 0.065, z, 0.019, 0.075, bd);
    }
    details.box(palette.wood, x, y + 0.03, z + bd * 0.18, bw * 0.65, 0.012, bd * 0.36);
    details.box(
      palette.terracotta,
      x - bw * 0.27,
      y + 0.061,
      z - bd * 0.22,
      bw * 0.16,
      0.055,
      bd * 0.27,
    );
    details.box(
      palette.forest,
      x - bw * 0.27,
      y + 0.096,
      z - bd * 0.22,
      bw * 0.17,
      0.026,
      bd * 0.28,
    );
    details.box(
      palette.solarCell,
      x + bw * 0.17,
      y + 0.065,
      z - bd * 0.18,
      bw * 0.37,
      0.018,
      bd * 0.27,
    );
  };
  const home = (x: number, z: number, bw: number, bd: number, h: number, floors: number) => {
    body(x, z, bw, bd, h);
    openings(x, z, bw, bd, h, floors, 0.035, floors > 1);
    pitched(x, z, bw, bd, h + 0.035, Math.min(0.34, 0.19 + bw * 0.13));
  };
  const apartment = (x: number, z: number, bw: number, bd: number, h: number) => {
    body(x, z, bw, bd, h);
    openings(x, z, bw, bd, h, 4, 0.035, true);
    terrace(x, z, bw, bd, h + 0.035);
    // Pale corner piers and expressed horizontal floor edges frame the loggias.
    for (const side of [-1, 1])
      details.box(
        palette.white,
        x + side * (bw / 2 - 0.012),
        h / 2 + 0.035,
        z + bd / 2 + 0.012,
        0.024,
        h,
        0.026,
      );
  };

  if (family === 0 && w === 1 && d === 1) {
    if (level === 1) {
      body(-0.04, -0.05, 0.49, 0.5, 0.42, 0.03);
      openings(-0.04, -0.05, 0.49, 0.5, 0.42, 1, 0.03);
      pitched(-0.04, -0.05, 0.59, 0.61, 0.45, 0.23, true);
      details.window(-0.04, 0.51, 0.256, 0.055, 0.052);
    } else if (level === 2) {
      for (const x of [-0.18, 0.18]) {
        body(x, -0.03, 0.34, 0.54, 0.75, 0.03, x < 0 ? wall : 0xd6c3b1);
        openings(x, -0.03, 0.34, 0.54, 0.75, 2, 0.03, true);
        pitched(x, -0.03, 0.37, 0.61, 0.78, 0.18, true);
      }
    } else apartment(0, 0, 0.66, 0.61, 1.05 + variation * 0.19);
  } else if (level < 3) {
    const h = level === 1 ? 0.42 : 0.72;
    if (family === 1) {
      home(-w * 0.21, -d * 0.09, w * 0.33, d * 0.63, h, level);
      home(w * 0.21, -d * 0.2, w * 0.33, d * 0.41, h * 0.88, level);
    } else if (family === 2) {
      home(-w * 0.1, -d * 0.12, w * 0.57, d * 0.59, h, level);
      roundedResidentialBay(g, w * 0.265, -d * 0.1, w * 0.3, d * 0.46, h * 0.85, wall, true);
      details.window(w * 0.415, h * 0.48, -d * 0.1, Math.min(0.12, d * 0.16), 0.12, Math.PI / 2);
    } else {
      const count = family === 3 ? 3 : 2;
      for (let i = 0; i < count; i++)
        home(
          ((i - (count - 1) / 2) * w * 0.78) / count,
          -d * (0.09 + (i % 2) * 0.06),
          (w * 0.69) / count,
          d * 0.57,
          h + (i % 2) * 0.055,
          level,
        );
    }
  } else if (family === 1) {
    apartment(-w * 0.265, -d * 0.04, w * 0.25, d * 0.66, 1.14);
    apartment(w * 0.265, -d * 0.04, w * 0.25, d * 0.66, 1.14);
    home(0, -d * 0.28, w * 0.26, d * 0.18, 0.86, 3);
  } else if (family === 2) {
    apartment(0, -d * 0.09, w * 0.73, d * 0.6, 0.93);
    body(-w * 0.12, -d * 0.15, w * 0.38, d * 0.3, 0.24, 0.99);
    openings(-w * 0.12, -d * 0.15, w * 0.38, d * 0.3, 0.24, 1, 0.99);
    terrace(-w * 0.12, -d * 0.15, w * 0.38, d * 0.3, 1.23);
  } else if (family === 3) {
    for (let i = 0; i < 3; i++)
      apartment((i - 1) * w * 0.26, -d * 0.11, w * 0.24, d * (0.64 - i * 0.09), 0.9 + i * 0.24);
  } else {
    apartment(-w * 0.23, -d * 0.12, w * 0.32, d * 0.59, 1.46);
    apartment(w * 0.23, -d * 0.12, w * 0.32, d * 0.59, 1.14);
  }
  if (family === 4) {
    // Full-height rear bow bays soften the paired houses while leaving the
    // front doors and the central passage between the pair unobstructed.
    const bx = level < 3 ? w * 0.195 : w * 0.23;
    for (const side of [-1, 1]) {
      const h = level < 3 ? (level === 1 ? 0.36 : 0.66) : side < 0 ? 1.24 : 0.98;
      roundedResidentialBay(g, side * bx, -d * 0.33, w * 0.25, d * 0.22, h, wall, level < 3);
      for (let row = 0; row < (level < 3 ? level : 3); row++)
        details.window(
          side * bx,
          0.2 + (row * (h - 0.15)) / (level < 3 ? level : 3),
          -d * 0.44,
          Math.min(0.11, w * 0.12),
          0.12,
          Math.PI,
        );
    }
  } else if (family === 2 && level >= 3) {
    roundedResidentialBay(g, w * 0.2, -d * 0.32, w * 0.28, d * 0.23, 0.84, wall);
    for (let row = 0; row < 3; row++)
      details.window(w * 0.2, 0.21 + row * 0.24, -d * 0.435, 0.12, 0.13, Math.PI);
  }
  // Public approach remains inside the lot; front beds never obstruct the door.
  details.box(palette.stone, 0, 0.031, d * 0.345, w * 0.16, 0.012, d * 0.25);
  for (const side of [-1, 1]) {
    details.box(palette.stone, side * w * 0.29, 0.047, d * 0.39, w * 0.26, 0.038, d * 0.1);
    details.box(palette.forest, side * w * 0.29, 0.093, d * 0.39, w * 0.23, 0.061, d * 0.075);
  }
  details.box(palette.metal, w * 0.115, 0.075, d * 0.425, 0.032, 0.09, 0.026);
  details.box(palette.dark, w * 0.115, 0.131, d * 0.425, 0.052, 0.03, 0.035);
  if (family === 1) tree(g, 0, d * 0.13, 0.36, variation);
  details.finish(g);
}
