import * as THREE from 'three';
import { mesh } from './primitives';
import { palette } from './materials';

// Unit resources are shared by every bay, pavilion and cap, including across lots.
// Twenty segments give a genuinely rounded silhouette without dense tessellation.
export const residentialRoundGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
export const residentialConicalGeometry = new THREE.ConeGeometry(0.5, 1, 20);
const parapet = new THREE.Shape();
parapet.absarc(0, 0, 0.5, 0, Math.PI, false);
parapet.lineTo(-0.42, 0);
parapet.absarc(0, 0, 0.42, Math.PI, 0, true);
parapet.closePath();
export const residentialCurvedParapetGeometry = new THREE.ExtrudeGeometry(parapet, {
  depth: 1,
  bevelEnabled: false,
  curveSegments: 10,
  steps: 1,
});
// Shape x/y becomes plan x/z; extrusion becomes world up.
residentialCurvedParapetGeometry.rotateX(Math.PI / 2);
residentialCurvedParapetGeometry.translate(0, 0.5, 0);

/** Rounded occupied volume overlaps its host wall, so there is no detached trim
 * or hollow cosmetic shell. Existing triangle-component colliders handle it. */
export function roundedResidentialBay(
  group: THREE.Group,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  wall: number,
  conical = false,
): void {
  const bay = mesh(
    group,
    residentialRoundGeometry,
    wall,
    x,
    height / 2 + 0.035,
    z,
    width,
    height,
    depth,
  );
  bay.name = 'residential-rounded-bay';
  bay.userData.noFacadeOpenings = true;
  const cap = mesh(
    group,
    conical ? residentialConicalGeometry : residentialRoundGeometry,
    palette.roof,
    x,
    height + 0.035 + (conical ? 0.1 : 0.017),
    z,
    width + 0.025,
    conical ? 0.2 : 0.034,
    depth + 0.025,
  );
  cap.name = 'residential-rounded-roof';
  cap.userData.fireRoof = true;
}

export function curvedResidentialBalcony(
  group: THREE.Group,
  x: number,
  y: number,
  front: number,
  width: number,
  depth: number,
): void {
  // The rear half of the elliptical slab embeds into the wall. Its thick arced
  // parapet replaces rows of thin pickets and has visible end returns.
  const slab = mesh(
    group,
    residentialRoundGeometry,
    palette.stone,
    x,
    y,
    front,
    width,
    0.035,
    depth * 2,
  );
  slab.name = 'residential-curved-balcony';
  const rim = mesh(
    group,
    residentialCurvedParapetGeometry,
    palette.cream,
    x,
    y + 0.075,
    front,
    width,
    0.12,
    depth * 2,
  );
  rim.name = 'residential-curved-parapet';
  rim.userData.noFacadeOpenings = true;
}
