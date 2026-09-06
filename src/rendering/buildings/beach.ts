import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import { box, cylinder, mesh, coneGeometry, sphereGeometry } from './primitives';
/** Five compact recreation props; sand and every prop stay inside a single dry tile. */
export function buildBeach(tile: Tile): THREE.Group {
  const g = new THREE.Group();
  g.name = 'beach';
  const v = Math.abs(tile.variation) % 5;
  g.userData.beachVariant = v;
  box(g, 0xd9c493, 0, 0.016, 0, 0.98, 0.032, 0.98);
  box(g, 0xe4d0a2, 0.09, 0.034, 0.1, 0.68, 0.009, 0.56);
  const chair = (x: number, z: number) => {
    for (const side of [-1, 1]) box(g, 0x9b805a, x + side * 0.065, 0.085, z, 0.017, 0.14, 0.21);
    box(g, 0xeee3c4, x, 0.14, z, 0.14, 0.025, 0.21);
    const back = box(g, 0xeee3c4, x, 0.205, z - 0.1, 0.14, 0.16, 0.025);
    back.rotation.x = -0.3;
  };
  if (v === 0) {
    cylinder(g, 0x927957, -0.14, 0.25, -0.1, 0.025, 0.49);
    mesh(g, coneGeometry, 0xdd8055, -0.14, 0.5, -0.1, 0.51, 0.16, 0.51);
    box(g, 0x6b9dba, 0.2, 0.045, 0.16, 0.17, 0.015, 0.38);
  }
  if (v === 1) {
    for (let i = 0; i < 3; i++)
      box(g, [0xb77a62, 0x749dad, 0xd8b662][i], -0.27 + i * 0.27, 0.041, 0.03, 0.18, 0.016, 0.43);
    mesh(g, sphereGeometry, 0xf0e2bd, 0.32, 0.075, -0.3, 0.1, 0.1, 0.1);
  }
  if (v === 2) {
    chair(-0.22, 0);
    chair(0.16, 0.1);
    cylinder(g, 0xa48258, 0, 0.095, -0.27, 0.14, 0.18);
  }
  if (v === 3) {
    for (const x of [-0.26, 0.26]) box(g, 0x95724e, x, 0.18, -0.1, 0.035, 0.36, 0.035);
    box(g, 0x95724e, 0, 0.26, -0.1, 0.59, 0.04, 0.04);
    for (let i = 0; i < 3; i++) {
      const b = mesh(
        g,
        sphereGeometry,
        [0xd7794e, 0x78aaba, 0xe1c469][i],
        -0.19 + i * 0.19,
        0.22,
        -0.04,
        0.12,
        0.4,
        0.045,
      );
      b.rotation.x = -0.25;
    }
  }
  if (v === 4) {
    for (const x of [-0.19, 0.19])
      for (const z of [-0.19, 0.19]) box(g, 0x9e8059, x, 0.2, z, 0.04, 0.4, 0.04);
    box(g, 0xbf9c67, 0, 0.39, 0, 0.48, 0.05, 0.48);
    for (const x of [-0.22, 0.22]) box(g, 0xd6bb85, x, 0.51, 0, 0.025, 0.23, 0.47);
    box(g, 0xd6bb85, 0, 0.51, -0.22, 0.47, 0.23, 0.025);
    for (let i = 0; i < 3; i++)
      box(g, 0xa68a61, 0, 0.07 + i * 0.105, 0.33 - i * 0.03, 0.19, 0.035, 0.08);
  }
  return g;
}
