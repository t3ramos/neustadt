import { commercialFacadeMaterial, type CommercialFamily } from './commercial-facades';
import { boxGeometry } from './primitives';
import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import {
  box,
  cylinder,
  roof,
  slab,
  tree,
  ribbon,
  rooftop,
  zone,
  mesh,
  sphereGeometry,
} from './primitives';
import { palette } from './materials';
import { foundation } from './facility-frame';
import { buildingVariant, zoneLotDimensions } from '../../buildings/lots';
// Original v1 RCI silhouettes and dimensions.
export function residential(g: THREE.Group, tile: Tile): void {
  const v = Math.abs(tile.variation);
  if (!tile.level) {
    zone(g, 0x66a276, v);
    return;
  }
  slab(g, palette.grass);
  if (tile.level === 1) {
    const walls = [palette.cream, 0xe6c7a9, 0xcdd5bf, 0xe9d7b7][v % 4];
    box(g, palette.stone, 0.03, 0.034, 0.1, 0.69, 0.04, 0.74);
    box(g, walls, -0.04, 0.24, -0.05, 0.49, 0.42, 0.5);
    roof(g, v % 2 ? palette.terracotta : palette.roof, -0.04, 0.45, -0.05, 0.59, 0.23, 0.61);
    box(g, palette.rust, 0.09, 0.63, -0.17, 0.073, 0.28, 0.082);
    box(g, palette.wood, -0.07, 0.147, 0.204, 0.09, 0.23, 0.013);
    box(g, palette.glass, -0.195, 0.275, 0.205, 0.11, 0.13, 0.016);
    box(g, palette.glass, 0.108, 0.275, 0.205, 0.11, 0.13, 0.016);
    box(g, palette.white, -0.195, 0.213, 0.216, 0.145, 0.018, 0.025);
    box(g, palette.white, 0.108, 0.213, 0.216, 0.145, 0.018, 0.025);
    box(g, palette.stone, -0.07, 0.024, 0.345, 0.13, 0.02, 0.24);
    tree(g, 0.32, -0.26, 0.76, v);
    box(g, palette.forest, -0.36, 0.085, -0.06, 0.055, 0.14, 0.65);
  } else if (tile.level === 2) {
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * 0.36;
      box(g, i ? 0xdbc6ac : 0xe9ddc2, x, 0.405, -0.03, 0.34, 0.75, 0.54);
      roof(g, v % 2 ? palette.terracotta : palette.roof, x, 0.78, -0.03, 0.37, 0.18, 0.61);
      for (let j = 0; j < 2; j++)
        box(g, palette.glassDark, x, 0.32 + j * 0.27, 0.245, 0.25, 0.14, 0.015);
      box(g, palette.dark, x - 0.085, 0.16, 0.245, 0.085, 0.26, 0.014);
      box(g, palette.cream, x, 0.26, 0.29, 0.34, 0.035, 0.11);
    }
    tree(g, 0.32, 0.36, 0.47, v + 1);
  } else {
    const h = 1.05 + (v % 4) * 0.19;
    box(g, v % 2 ? palette.stone : 0xd0d5bd, 0, h / 2 + 0.035, 0, 0.66, h, 0.61);
    for (let level = 0; level < 4; level++) {
      const y = 0.22 + (level * (h - 0.21)) / 4;
      ribbon(g, 0, y, 0, 0.66, 0.1, 0.61);
      box(g, palette.cream, 0, y - 0.07, 0.348, 0.72, 0.029, 0.1);
    }
    rooftop(g, 0, h + 0.035, 0, 0.72);
    box(g, palette.dark, 0, 0.14, 0.316, 0.11, 0.23, 0.015);
    tree(g, -0.36, 0.33, 0.53, v);
  }
}
export function commercial(g: THREE.Group, tile: Tile): void {
  if (tile.level === 2) {
    commercialMedium(g, tile, true);
    return;
  }
  if (tile.level >= 3) {
    commercialHighrise(g, tile, true);
    return;
  }
  const v = Math.abs(tile.variation);
  if (!tile.level) {
    zone(g, 0x548fac, v);
    return;
  }
  slab(g);
  if (tile.level === 1) {
    box(g, palette.cream, 0, 0.23, -0.05, 0.74, 0.42, 0.61);
    box(g, palette.glassDark, 0, 0.205, 0.261, 0.62, 0.27, 0.018);
    box(g, palette.roof, 0, 0.459, -0.045, 0.79, 0.049, 0.68);
    box(g, palette.yellow, 0, 0.37, 0.292, 0.78, 0.04, 0.24);
    for (let j = 0; j < 4; j++)
      box(g, v % 2 ? palette.red : palette.blue, -0.3 + j * 0.2, 0.396, 0.3, 0.1, 0.018, 0.22);
    box(g, palette.blue, 0, 0.52, 0.08, 0.39, 0.09, 0.043);
    box(g, palette.cream, 0, 0.52, 0.106, 0.25, 0.017, 0.005);
    box(g, palette.white, 0, 0.205, 0.277, 0.025, 0.27, 0.012);
    box(g, palette.green, -0.39, 0.08, 0.33, 0.1, 0.11, 0.19);
  }
}
export function industrial(g: THREE.Group, tile: Tile, connected = false): void {
  const v = Math.abs(tile.variation);
  if (!tile.level) {
    zone(g, 0xc6a958, v);
    return;
  }
  if (connected) foundation(g, 1, 1, 0xb4b29b);
  else slab(g, 0xb4b29b);
  const h = 0.34 + Math.min(tile.level, 3) * 0.105;
  box(g, v % 2 ? 0xb2ae98 : 0xc6b692, -0.09, h / 2 + 0.025, 0.07, 0.65, h, 0.61);
  for (let i = 0; i < 3; i++) {
    roof(g, palette.roof, -0.305 + i * 0.215, h + 0.025, 0.07, 0.22, 0.15, 0.65);
    box(g, palette.glass, -0.305 + i * 0.215, h - 0.05, 0.379, 0.15, 0.074, 0.012);
  }
  box(g, palette.dark, -0.1, 0.18, 0.381, 0.22, 0.27, 0.015);
  box(g, palette.yellow, -0.1, 0.322, 0.395, 0.28, 0.032, 0.027);
  const chimneyHeight = 0.65 + tile.level * 0.18;
  cylinder(g, palette.rust, 0.31, chimneyHeight / 2, -0.23, 0.12, chimneyHeight);
  cylinder(g, palette.cream, 0.31, chimneyHeight * 0.83, -0.23, 0.123, 0.075);
  cylinder(g, palette.dark, 0.31, chimneyHeight + 0.009, -0.23, 0.085, 0.022);
  cylinder(g, palette.metal, 0.32, 0.18, 0.22, 0.19, 0.33);
  mesh(g, sphereGeometry, palette.metal, 0.32, 0.35, 0.22, 0.19, 0.1, 0.19);
  if (tile.level > 1) {
    box(g, palette.dark, -0.22, 0.07, -0.34, 0.23, 0.09, 0.14);
    box(g, palette.terracotta, 0.05, 0.08, -0.34, 0.18, 0.11, 0.14);
  }
}
/** Five construction systems: legacy, courtyard, pavilion, stepped block, paired towers. */
export function zoneArchitecture(g: THREE.Group, tile: Tile, centered = false): void {
  const v = buildingVariant(tile),
    [w, d] = zoneLotDimensions(tile);
  if (tile.kind === 'commercial' && tile.level === 2) {
    commercialMedium(g, tile, centered);
    return;
  }
  if (tile.kind === 'commercial' && tile.level >= 3) {
    commercialHighrise(g, tile, centered);
    return;
  }
  if (v === 0 && w === 1 && d === 1) {
    if (tile.kind === 'residential') residential(g, tile);
    else if (tile.kind === 'commercial') commercial(g, tile);
    else industrial(g, tile);
    return;
  }
  const frame = new THREE.Group();
  if (!centered) frame.position.set((w - 1) / 2, 0, (d - 1) / 2);
  g.add(frame);
  if (tile.kind === 'industrial' && centered) foundation(g, w, d);
  else
    slab(frame, tile.kind === 'residential' ? palette.grass : palette.concrete, w - 0.06, d - 0.06);
  const height =
    tile.kind === 'industrial'
      ? 0.42 + tile.level * 0.16
      : tile.kind === 'commercial'
        ? 0.42 + tile.level * 0.36
        : 0.38 + tile.level * 0.25;
  const color =
    tile.kind === 'commercial'
      ? palette.stone
      : tile.kind === 'industrial'
        ? palette.concrete
        : palette.cream;
  const block = (x: number, z: number, bw: number, bd: number, h: number) => {
    box(frame, color, x, h / 2 + 0.035, z, bw, h, bd);
    for (let floor = 0.18; floor < h; floor += 0.26) ribbon(frame, x, floor, z, bw, 0.105, bd);
    rooftop(frame, x, h + 0.035, z, Math.min(bw, bd) * 0.82);
  };
  if (v === 1) {
    // courtyard U with open forecourt
    block(-w * 0.29, 0, w * 0.23, d * 0.76, height);
    block(w * 0.29, 0, w * 0.23, d * 0.76, height);
    block(0, -d * 0.29, w * 0.38, d * 0.18, height);
    tree(frame, 0, d * 0.14, 0.48, tile.variation);
  } else if (v === 2) {
    // low glazed pavilion / long production hall
    block(0, -d * 0.08, w * 0.79, d * 0.55, height * 0.7);
    roof(frame, palette.roof, 0, height * 0.7 + 0.035, -d * 0.08, w * 0.85, 0.24, d * 0.62);
    for (let x = -w * 0.3; x <= w * 0.3; x += 0.3)
      box(frame, palette.white, x, height * 0.28, d * 0.28, 0.035, height * 0.56, 0.035);
    box(frame, palette.roof, 0, height * 0.58, d * 0.31, w * 0.84, 0.055, d * 0.22);
  } else if (v === 3) {
    // deep stepped terraces
    for (let i = 0; i < 3; i++)
      block(
        -w * 0.26 + i * w * 0.26,
        -d * 0.1,
        w * 0.25,
        d * (0.7 - i * 0.12),
        height * (0.55 + i * 0.3),
      );
    for (let i = 0; i < 3; i++)
      box(
        frame,
        palette.green,
        -w * 0.26 + i * w * 0.26,
        height * (0.55 + i * 0.3) + 0.1,
        -d * 0.1,
        w * 0.18,
        0.09,
        d * 0.2,
      );
  } else {
    // twin towers joined by a podium, or two shed halls
    block(0, 0, w * 0.86, d * 0.73, height * 0.3);
    block(-w * 0.23, -d * 0.08, w * 0.3, d * 0.48, height * 1.12);
    block(w * 0.23, -d * 0.08, w * 0.3, d * 0.48, height * 0.84);
    box(frame, palette.glassLight, 0, height * 0.58, -d * 0.08, w * 0.2, 0.12, d * 0.22);
  }
  if (tile.kind === 'industrial') {
    cylinder(frame, palette.metal, w * 0.36, 0.48, d * 0.33, 0.16, 0.88);
    cylinder(frame, palette.rust, w * 0.18, 0.36, d * 0.33, 0.14, 0.65);
    for (let i = 0; i < Math.min(6, w * 2); i++)
      box(frame, palette.dark, -w * 0.32 + i * 0.28, 0.14, d * 0.4, 0.18, 0.22, 0.025);
  } else if (tile.kind === 'commercial')
    box(frame, palette.blue, 0, 0.23, d * 0.39, w * 0.35, 0.12, 0.035);
}

/** Distinct structural systems, not recolorings of a common ribbon-window block. */
export function commercialHighrise(g: THREE.Group, tile: Tile, centered = false): void {
  const variant = buildingVariant(tile),
    [w, d] = zoneLotDimensions(tile);
  const family: CommercialFamily = ['curtain', 'brick', 'limestone', 'charcoal', 'campus'][
    variant
  ] as CommercialFamily;
  const frame = new THREE.Group();
  frame.name = `commercial-${family}`;
  frame.userData.commercialFamily = family;
  if (!centered) frame.position.set((w - 1) / 2, 0, (d - 1) / 2);
  g.add(frame);
  slab(frame, 0xbcbcb3, w - 0.06, d - 0.06);
  const h = (tile.level >= 4 ? 3.7 : 2.8) + (Math.floor(Math.abs(tile.variation) / 5) % 3) * 0.12;
  const facade = commercialFacadeMaterial(family);
  const block = (
    x: number,
    z: number,
    bw: number,
    bd: number,
    height: number,
    bottom = 0.035,
    roofColor = 0x737e83,
  ): void => {
    const body = new THREE.Mesh(boxGeometry, facade);
    body.position.set(x, bottom + height / 2, z);
    body.scale.set(bw, height, bd);
    body.castShadow = body.receiveShadow = true;
    frame.add(body);
    const cap = box(frame, roofColor, x, bottom + height + 0.022, z, bw + 0.018, 0.044, bd + 0.018);
    cap.name = 'commercial-roof';
    cap.userData.fireRoof = { width: bw + 0.018, depth: bd + 0.018, height: 0.022 };
  };
  if (variant === 0) {
    // Slender, uninterrupted curtain wall with visible full-height metal fins.
    box(frame, 0xe0ded5, 0, 0.12, 0, w * 0.86, 0.2, d * 0.84);
    block(-w * 0.1, -d * 0.07, w * 0.49, d * 0.55, h, 0.22, 0xa1afb4);
    block(w * 0.24, d * 0.12, w * 0.22, d * 0.42, h * 0.53, 0.22, 0x859399);
    for (const side of [-1, 1])
      box(
        frame,
        0xbecbd0,
        -w * 0.1 + side * w * 0.245,
        h / 2 + 0.22,
        -d * 0.07,
        0.019,
        h + 0.02,
        d * 0.57,
      );
    box(frame, 0x80949f, -w * 0.1, h + 0.36, -d * 0.07, w * 0.22, 0.22, d * 0.24);
    cylinder(frame, 0xc1c9c7, -w * 0.1, h + 0.72, -d * 0.07, 0.014, 0.54);
  } else if (variant === 1) {
    // Brick office loft grows into a three-stage Art Deco crown.
    block(0, 0, w * 0.82, d * 0.76, h * 0.48, 0.035, 0xbaa185);
    block(0, -d * 0.07, w * 0.62, d * 0.59, h * 0.29, h * 0.48 + 0.06, 0xb99e7c);
    block(0, -d * 0.08, w * 0.38, d * 0.36, h * 0.23, h * 0.77 + 0.09, 0xc8b99d);
    for (const side of [-1, 1])
      box(frame, 0xb18b68, side * w * 0.27, h * 0.26, d * 0.389, w * 0.046, h * 0.48, 0.023);
    box(frame, 0x513b2d, 0, 0.15, d * 0.389, w * 0.16, 0.25, 0.018);
    box(frame, 0xcdbaa0, 0, 0.29, d * 0.4, w * 0.27, 0.045, 0.06);
  } else if (variant === 2) {
    // Broad limestone terraces: three asymmetric occupied roof levels.
    block(-w * 0.21, 0, w * 0.36, d * 0.76, h * 0.52, 0.035, 0xd4cdbb);
    block(w * 0.075, -d * 0.06, w * 0.24, d * 0.64, h * 0.75, 0.035, 0xe5decc);
    block(w * 0.29, -d * 0.12, w * 0.18, d * 0.52, h, 0.035, 0xf0e9d8);
    for (const [x, width, height] of [
      [-w * 0.21, w * 0.36, h * 0.52],
      [w * 0.075, w * 0.24, h * 0.75],
      [w * 0.29, w * 0.18, h],
    ]) {
      box(frame, 0xf1eadb, x, height + 0.11, d * 0.2, width, 0.08, 0.025);
    }
    box(frame, 0xb7a181, -w * 0.2, 0.2, d * 0.4, w * 0.35, 0.04, 0.15);
  } else if (variant === 3) {
    // Dark vertical tower on a low stone podium; no blue horizontal ribbons.
    block(0, 0, w * 0.84, d * 0.78, 0.4, 0.035, 0x6f7476);
    block(-w * 0.08, -d * 0.045, w * 0.53, d * 0.55, h, 0.43, 0x353c42);
    for (let i = 0; i < 5; i++) {
      const x = -w * 0.08 + (i - 2) * w * 0.105;
      for (const side of [-1, 1])
        box(
          frame,
          i % 2 ? 0x7b8589 : 0xa0a7a6,
          x,
          h / 2 + 0.43,
          -d * 0.045 + side * d * 0.279,
          0.015,
          h + 0.06,
          0.018,
        );
    }
    box(frame, 0x3d4247, -w * 0.08, h + 0.55, -d * 0.045, w * 0.31, 0.16, d * 0.35);
    box(frame, 0xb9b3a4, w * 0.23, 0.3, d * 0.32, w * 0.22, 0.035, d * 0.18);
  } else {
    // Linked business campus: broad occupied wings, transparent central atrium.
    block(-w * 0.28, -d * 0.015, w * 0.27, d * 0.73, h * 0.61, 0.035, 0x8e979a);
    block(w * 0.28, -d * 0.11, w * 0.27, d * 0.56, h * 0.84, 0.035, 0x758186);
    block(0, -d * 0.27, w * 0.33, d * 0.18, h * 0.43, 0.035, 0xa4adae);
    box(frame, 0x93a5a9, 0, h * 0.19, d * 0.08, w * 0.29, h * 0.34, d * 0.39);
    box(frame, 0xc1c8c7, 0, h * 0.365, d * 0.08, w * 0.32, 0.045, d * 0.42);
    box(frame, 0xc4cbc9, 0, h * 0.43, -d * 0.03, w * 0.38, 0.1, d * 0.13);
    box(frame, 0xdee1db, 0, 0.21, d * 0.36, w * 0.35, 0.035, d * 0.15);
  }
  // Keep a legible street-level entry on the positive-Z facade in every family.
  box(frame, 0x414c51, 0, 0.15, d * 0.43, Math.min(0.22, w * 0.18), 0.25, 0.016);
}

/** Medium offices use human-scaled three-storey grids and five plan types. */
export function commercialMedium(g: THREE.Group, tile: Tile, centered = false): void {
  const variant = buildingVariant(tile),
    [w, d] = zoneLotDimensions(tile);
  const family = (['limestone', 'brick', 'curtain', 'charcoal', 'campus'] as CommercialFamily[])[
    variant
  ];
  const frame = new THREE.Group();
  frame.name = `medium-office-${family}`;
  if (!centered) frame.position.set((w - 1) / 2, 0, (d - 1) / 2);
  g.add(frame);
  slab(frame, 0xc3c2b7, w - 0.06, d - 0.06);
  const h = 0.85 + (Math.abs(tile.variation) % 3) * 0.19;
  const facade = commercialFacadeMaterial(family, true);
  const block = (
    x: number,
    z: number,
    bw: number,
    bd: number,
    height: number,
    roofColor: number,
  ): void => {
    const body = new THREE.Mesh(boxGeometry, facade);
    body.position.set(x, height / 2 + 0.04, z);
    body.scale.set(bw, height, bd);
    body.castShadow = body.receiveShadow = true;
    body.userData.fourSidedOpenings = true;
    frame.add(body);
    const cap = box(frame, roofColor, x, height + 0.065, z, bw + 0.025, 0.05, bd + 0.025);
    cap.name = 'commercial-roof';
    cap.userData.fireRoof = { width: bw + 0.025, depth: bd + 0.025, height: 0.025 };
  };
  if (variant === 0) {
    // A compact limestone address with full-height corner piers and a deep entry.
    block(0, 0, w * 0.69, d * 0.66, h, 0xa7a79d);
    for (const side of [-1, 1])
      box(frame, 0xece5d6, side * w * 0.3, h / 2 + 0.04, d * 0.335, 0.035, h, 0.035);
    box(frame, 0xc6bca6, 0, 0.32, d * 0.37, w * 0.4, 0.065, d * 0.19);
  } else if (variant === 1) {
    // Brick warehouse conversion with a recessed rooftop studio.
    block(0, 0, w * 0.8, d * 0.74, h * 0.8, 0x8d7767);
    block(-w * 0.12, -d * 0.12, w * 0.44, d * 0.4, h * 1.18, 0xb4a18a);
    for (const side of [-1, 1])
      box(frame, 0xb89270, side * w * 0.35, h * 0.4 + 0.04, d * 0.38, 0.028, h * 0.8, 0.024);
    box(frame, 0x473f38, w * 0.17, 0.27, d * 0.405, w * 0.35, 0.035, d * 0.12);
  } else if (variant === 2) {
    // Glazed L-shaped studios, one tall wing and one low street wing.
    block(-w * 0.24, -d * 0.035, w * 0.3, d * 0.76, h * 1.15, 0x9daeb2);
    block(w * 0.11, -d * 0.23, w * 0.43, d * 0.28, h * 0.72, 0xb6c1c2);
    box(frame, 0xc8d3d2, w * 0.11, 0.35, d * 0.2, w * 0.42, 0.045, d * 0.27);
    for (const x of [w * 0.02, w * 0.28]) cylinder(frame, 0xa0acab, x, 0.19, d * 0.29, 0.025, 0.34);
  } else if (variant === 3) {
    // Two charcoal volumes joined by a lighter full-height entrance slot.
    block(-w * 0.22, -0.04 * d, w * 0.31, d * 0.66, h * 1.18, 0x4e5a60);
    block(w * 0.22, 0.02 * d, w * 0.31, d * 0.74, h * 0.85, 0x727d82);
    box(frame, 0xb5bcbc, 0, h * 0.42, d * 0.09, w * 0.13, h * 0.76, d * 0.34);
    for (const side of [-1, 1])
      box(frame, 0xb1b7b5, side * w * 0.22, h * 0.44, d * 0.397, 0.022, h * 0.77, 0.019);
  } else {
    // Low linked campus framing an open arrival court, gray roofs throughout.
    block(-w * 0.28, 0, w * 0.25, d * 0.75, h * 0.9, 0x8e999c);
    block(w * 0.28, -d * 0.09, w * 0.25, d * 0.58, h * 1.12, 0x78888e);
    block(0, -d * 0.29, w * 0.33, d * 0.17, h * 0.64, 0xa5afb1);
    box(frame, 0xd2d8d3, 0, 0.33, d * 0.09, w * 0.36, 0.06, d * 0.36);
  }
  // Entries sit on occupied exterior walls rather than floating across courtyards.
  const entryX = [0, 0, -w * 0.24, w * 0.22, -w * 0.28][variant];
  const frontZ = [0.33, 0.37, 0.345, 0.39, 0.375][variant] * d;
  const rearX = [0, 0, -w * 0.24, -w * 0.22, -w * 0.28][variant];
  const rearZ = [-0.33, -0.37, -0.415, -0.37, -0.375][variant] * d;
  box(frame, 0x364c58, entryX, 0.17, frontZ + 0.01, Math.min(0.23, w * 0.2), 0.27, 0.018);
  box(frame, 0x596669, rearX, 0.155, rearZ - 0.008, Math.min(0.13, w * 0.12), 0.23, 0.014);
}
