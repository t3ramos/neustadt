import * as THREE from 'three';

/** Original simplified vector drawing inspired by Albania's public-domain flag.
 * Reference: https://commons.wikimedia.org/wiki/File:Flag_of_Albania.svg
 * No textures, lettering, political-party marks or ethnicity-specific anatomy.
 * Right outline runs from the cleft between the two necks to the tail tip.
 * The mirrored outline gives two outward-facing beaks, seven flight feathers
 * per wing, hooked talons and a fan tail, in one connected, hole-free contour.
 */
const RIGHT_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.23],
  [0.047, 0.31],
  [0.049, 0.405],
  [0.028, 0.46],
  [0.074, 0.445],
  [0.086, 0.5],
  [0.121, 0.464],
  [0.159, 0.47],
  [0.177, 0.438],
  [0.238, 0.421],
  [0.251, 0.38],
  [0.216, 0.399],
  [0.174, 0.398],
  [0.207, 0.369],
  [0.235, 0.365],
  [0.217, 0.341],
  [0.159, 0.355],
  [0.132, 0.381],
  [0.115, 0.347],
  [0.122, 0.285],
  [0.166, 0.245],
  [0.225, 0.293],
  [0.306, 0.353],
  [0.415, 0.463],
  [0.439, 0.448],
  [0.407, 0.365],
  [0.311, 0.266],
  [0.454, 0.365],
  [0.478, 0.376],
  [0.467, 0.328],
  [0.334, 0.193],
  [0.48, 0.284],
  [0.495, 0.282],
  [0.48, 0.23],
  [0.344, 0.127],
  [0.5, 0.193],
  [0.494, 0.145],
  [0.35, 0.062],
  [0.493, 0.102],
  [0.48, 0.056],
  [0.338, -0.001],
  [0.473, 0.014],
  [0.448, -0.033],
  [0.318, -0.058],
  [0.428, -0.07],
  [0.395, -0.112],
  [0.282, -0.101],
  [0.202, -0.035],
  [0.146, 0.055],
  [0.128, -0.041],
  [0.18, -0.116],
  [0.249, -0.168],
  [0.327, -0.148],
  [0.371, -0.163],
  [0.383, -0.2],
  [0.349, -0.182],
  [0.306, -0.193],
  [0.367, -0.219],
  [0.379, -0.255],
  [0.349, -0.243],
  [0.291, -0.224],
  [0.317, -0.267],
  [0.306, -0.295],
  [0.281, -0.263],
  [0.253, -0.225],
  [0.225, -0.233],
  [0.219, -0.276],
  [0.2, -0.249],
  [0.204, -0.209],
  [0.146, -0.172],
  [0.097, -0.138],
  [0.063, -0.195],
  [0.116, -0.26],
  [0.18, -0.306],
  [0.166, -0.343],
  [0.08, -0.31],
  [0.145, -0.404],
  [0.121, -0.433],
  [0.045, -0.35],
  [0.066, -0.47],
  [0, -0.5],
];

/** Caller owns the returned geometry. Share one between front/back instances;
 * dispose once when the crowd is destroyed, never when removing one citizen.
 * Exactly unit width/height, centered in XY, with front normals facing +Z.
 * Back placement: rotate Y by Math.PI (do not apply a negative scale).
 */
export function createDoubleEagleGeometry(): THREE.BufferGeometry {
  const outline = [
    ...RIGHT_OUTLINE,
    ...RIGHT_OUTLINE.slice(1, -1)
      .reverse()
      .map(([x, y]) => [-x, y] as const),
  ];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.name = 'Albanian double-headed eagle';
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Gallery actor 3 has the existing purple hat. Selection is clothing only. */
export function heritageAppearance(variant: number) {
  return Number.isInteger(variant) && variant >= 0 && variant % 120 === 3
    ? { sweater: 0xe51b23, badge: 0x080808 }
    : undefined;
}
