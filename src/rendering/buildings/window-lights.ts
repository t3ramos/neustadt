import * as THREE from 'three';
import type { Tile } from '../../domain/types';
import { boxGeometry } from './primitives';
import { buildingWindowMaterial } from './materials';
// Small deterministic panes sit on the opaque facades. They never turn the entire blue tower/window-band material into an emitting wall.
export function addBuildingWindowLights(g: THREE.Group, tile: Tile): void {
  type WindowPatch = {
    parent: THREE.Object3D;
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    color: number;
    score: number;
  };
  const candidates: WindowPatch[] = [];
  let sequence = 0;
  const offer = (
    source: THREE.Mesh,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): void => {
    const value =
      Math.sin((Math.abs(tile.variation) + 1) * 12.9898 + ++sequence * 78.233) * 43758.5453;
    const score = value - Math.floor(value);
    if (score > 0.35 || !source.parent) return;
    // Retain only the sixteen strongest panes. This preserves the original
    // stable score ordering without allocating vectors for discarded windows.
    if (candidates.length === 16 && score >= candidates[15].score) return;
    const candidate = {
      parent: source.parent,
      x,
      y,
      z,
      w,
      h,
      d,
      color: (source.material as THREE.MeshStandardMaterial).color.getHex(),
      score,
    };
    let index = candidates.length;
    while (index > 0 && candidates[index - 1].score > score) index--;
    candidates.splice(index, 0, candidate);
    if (candidates.length > 16) candidates.pop();
  };
  g.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      Array.isArray(object.material) ||
      !object.material.userData.glazing ||
      object.material.userData.facadeTexture ||
      object.geometry.type !== 'BoxGeometry'
    )
      return;
    if (
      Math.abs(object.rotation.x) + Math.abs(object.rotation.y) + Math.abs(object.rotation.z) >
      1e-6
    )
      return;
    const p = object.position,
      s = object.scale;
    if (s.y >= 0.4 && s.x >= 0.18 && s.z >= 0.18) {
      const rows = Math.max(3, Math.min(10, Math.floor(s.y / 0.26)));
      for (let row = 0; row < rows; row++) {
        const y = p.y - s.y / 2 + ((row + 0.5) * s.y) / rows;
        for (let column = 0; column < 3; column++) {
          const u = (column - 1) * 0.27;
          for (const side of [-1, 1]) {
            offer(
              object,
              p.x + u * s.x,
              y,
              p.z + side * (s.z / 2 + 0.0015),
              Math.min(0.075, s.x * 0.14),
              0.095,
              0.002,
            );
            offer(
              object,
              p.x + side * (s.x / 2 + 0.0015),
              y,
              p.z + u * s.z,
              0.002,
              0.095,
              Math.min(0.075, s.z * 0.14),
            );
          }
        }
      }
    } else if (s.y >= 0.075 && s.y <= 0.32) {
      if (s.z <= 0.04 && s.x >= 0.075) {
        for (let i = 0; i < Math.min(3, Math.max(1, Math.floor(s.x / 0.17))); i++) {
          const x = p.x + (i - (Math.min(3, Math.max(1, Math.floor(s.x / 0.17))) - 1) / 2) * 0.14;
          offer(
            object,
            x,
            p.y,
            p.z + s.z / 2 + 0.001,
            Math.min(0.075, s.x * 0.55),
            Math.min(0.085, s.y * 0.72),
            0.002,
          );
          offer(
            object,
            x,
            p.y,
            p.z - s.z / 2 - 0.001,
            Math.min(0.075, s.x * 0.55),
            Math.min(0.085, s.y * 0.72),
            0.002,
          );
        }
      } else if (s.x <= 0.04 && s.z >= 0.075) {
        offer(
          object,
          p.x + s.x / 2 + 0.001,
          p.y,
          p.z,
          0.002,
          Math.min(0.085, s.y * 0.72),
          Math.min(0.075, s.z * 0.55),
        );
        offer(
          object,
          p.x - s.x / 2 - 0.001,
          p.y,
          p.z,
          0.002,
          Math.min(0.085, s.y * 0.72),
          Math.min(0.075, s.z * 0.55),
        );
      }
    }
  });
  for (const candidate of candidates) {
    const patch = new THREE.Mesh(boxGeometry, buildingWindowMaterial(candidate.color));
    patch.name = 'building-window-light';
    patch.userData.buildingWindowLight = true;
    patch.position.set(candidate.x, candidate.y, candidate.z);
    patch.scale.set(candidate.w, candidate.h, candidate.d);
    patch.castShadow = false;
    patch.receiveShadow = true;
    candidate.parent.add(patch);
  }
}
