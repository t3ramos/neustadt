import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeometry } from './primitives';
import { buildingWindowMaterial, modelMaterial, palette } from './materials';

/** Bake small architectural parts by material; completed designs are cached by the caller.
 * Solid occupied bodies stay separate for the existing picking/collider pipeline. */
export class ResidentialDetails {
  private batches = new Map<number, THREE.BufferGeometry[]>();
  private lights: THREE.Mesh[] = [];

  box(
    c: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    ry = 0,
    rz = 0,
  ): void {
    if (c === -1) {
      const light = new THREE.Mesh(boxGeometry, buildingWindowMaterial(palette.glassDark));
      light.position.set(x, y, z);
      light.rotation.set(0, ry, rz);
      light.scale.set(w, h, d);
      light.userData.buildingWindowLight = true;
      light.userData.noFacadeOpenings = true;
      light.name = 'residential-window-light';
      this.lights.push(light);
      return;
    }
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)),
      new THREE.Vector3(w, h, d),
    );
    const parts = this.batches.get(c) ?? [];
    parts.push(boxGeometry.clone().applyMatrix4(matrix));
    this.batches.set(c, parts);
  }

  window(x: number, y: number, z: number, w: number, h: number, side = 0, lit = false): void {
    // Deep dark reveal, inset glass, proud frame and sill produce real sun shadows.
    const part = (
      c: number,
      dx: number,
      dy: number,
      dz: number,
      pw: number,
      ph: number,
      pd: number,
    ) => {
      const co = Math.cos(side),
        si = Math.sin(side);
      this.box(c, x + co * dx + si * dz, y + dy, z - si * dx + co * dz, pw, ph, pd, side);
    };
    part(palette.dark, 0, 0, 0.005, w + 0.025, h + 0.026, 0.012);
    part(lit ? -1 : palette.glassDark, 0, 0, 0.012, w, h, 0.008);
    for (const dx of [-w / 2 - 0.006, w / 2 + 0.006])
      part(palette.white, dx, 0, 0.023, 0.012, h + 0.024, 0.021);
    for (const dy of [-h / 2 - 0.006, h / 2 + 0.006])
      part(palette.white, 0, dy, 0.023, w + 0.024, 0.012, 0.021);
    part(palette.stone, 0, -h / 2 - 0.014, 0.029, w + 0.044, 0.013, 0.046);
  }

  entrance(x: number, z: number, width = 0.1): void {
    this.box(palette.dark, x, 0.14, z + 0.012, width + 0.035, 0.225, 0.025);
    this.box(palette.wood, x, 0.14, z + 0.028, width, 0.207, 0.012);
    this.box(palette.glass, x, 0.178, z + 0.037, width * 0.62, 0.091, 0.007);
    this.box(palette.metal, x + width * 0.3, 0.12, z + 0.043, 0.008, 0.04, 0.01);
    this.box(palette.roof, x, 0.278, z + 0.053, width + 0.09, 0.017, 0.135);
    this.box(palette.stone, x, 0.039, z + 0.057, width + 0.07, 0.022, 0.115);
  }

  balcony(x: number, y: number, front: number, w: number, depth = 0.08): void {
    this.box(palette.stone, x, y, front + depth / 2, w, 0.023, depth);
    this.box(palette.cream, x, y + 0.065, front + depth, w, 0.11, 0.024);
    for (const dx of [-w / 2 + 0.006, w / 2 - 0.006])
      this.box(palette.cream, x + dx, y + 0.065, front + depth / 2, 0.024, 0.11, depth);
    this.box(
      palette.terracotta,
      x + w * 0.25,
      y + 0.034,
      front + depth * 0.48,
      w * 0.22,
      0.035,
      depth * 0.4,
    );
    this.box(
      palette.forest,
      x + w * 0.25,
      y + 0.056,
      front + depth * 0.48,
      w * 0.24,
      0.018,
      depth * 0.44,
    );
  }

  finish(group: THREE.Group): void {
    for (const [color, parts] of this.batches) {
      const geometry = mergeGeometries(parts, false)!;
      for (const part of parts) part.dispose();
      const mesh = new THREE.Mesh(geometry, modelMaterial(color));
      mesh.name = 'residential-crafted-details';
      mesh.userData.noFacadeOpenings = true;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.batches.clear();
    if (this.lights.length) group.add(...this.lights);
    this.lights = [];
  }
}
