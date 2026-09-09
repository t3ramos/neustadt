import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CITIZEN_DETAIL_ENTER_PX = 18;
export const CITIZEN_DETAIL_EXIT_PX = 14;

/** Screen-aligned height estimate avoids vanishing LOD sizes in a top-down view.
 * projectionMatrix includes orthographic/perspective zoom and camera view offsets.
 * Caller supplies rendered viewport pixels in the same units as the thresholds. */
export function citizenScreenHeight(
  camera: THREE.Camera,
  position: THREE.Vector3,
  worldHeight: number,
  viewportHeight: number,
): number {
  const view = camera.matrixWorldInverse.elements,
    projection = camera.projectionMatrix.elements;
  const depth = view[2] * position.x + view[6] * position.y + view[10] * position.z + view[14];
  const w = projection[11] * depth + projection[15];
  if (w <= 0) return 0;
  return (Math.abs(projection[5]) * worldHeight * viewportHeight) / (2 * w);
}

export function citizenUsesDetail(pixelHeight: number, wasDetailed = false): boolean {
  return pixelHeight >= (wasDetailed ? CITIZEN_DETAIL_EXIT_PX : CITIZEN_DETAIL_ENTER_PX);
}

/** No facial marks, cuffs, seams or separate fingers at subpixel sizes. These
 * three reusable geometries retain the head/body/foot envelope in under 200 tris. */
export function createCitizenLodGeometries() {
  const merge = (parts: THREE.BufferGeometry[]) => {
    const nonIndexed = parts.map((part) => (part.index ? part.toNonIndexed() : part));
    const result = mergeGeometries(nonIndexed, false)!;
    for (const part of new Set([...parts, ...nonIndexed])) part.dispose();
    return result;
  };
  const tint = (geometry: THREE.BufferGeometry, hex: number) => {
    const color = new THREE.Color(hex),
      colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  };
  const upper = merge([
    new THREE.BoxGeometry(0.147, 0.22, 0.1).translate(0, 0.32, 0),
    new THREE.BoxGeometry(0.04, 0.21, 0.045).rotateZ(-0.05).translate(-0.088, 0.31, 0),
    new THREE.BoxGeometry(0.04, 0.21, 0.045).rotateZ(0.05).translate(0.088, 0.31, 0),
  ]);
  const lower = merge(
    [-1, 1].flatMap((side) => [
      new THREE.BoxGeometry(0.052, 0.2, 0.064).translate(side * 0.049, 0.11, 0),
      new THREE.BoxGeometry(0.06, 0.04, 0.095).translate(side * 0.049, 0.02, 0.015),
    ]),
  );
  const head = merge([
    tint(new THREE.BoxGeometry(0.042, 0.035, 0.04).translate(0, 0.438, 0), 0xffffff),
    tint(
      new THREE.SphereGeometry(0.5, 8, 4).scale(0.088, 0.105, 0.095).translate(0, 0.495, 0),
      0xffffff,
    ),
    tint(
      new THREE.SphereGeometry(0.5, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.48)
        .scale(0.095, 0.108, 0.1)
        .translate(0, 0.497, -0.005),
      0x493b32,
    ),
  ]);
  // One material can render every LOD batch, with instanceColor for outfit/skin.
  tint(upper, 0xffffff);
  tint(lower, 0xffffff);
  return { upper, lower, head };
}
