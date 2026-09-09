import * as THREE from 'three';

const cache = new Map<number, THREE.BufferGeometry>();

/** Unit rounded footprint with four facade sheets, upright V and arc-length U.
 * Each sheet spans half a straight edge, a corner and half the next edge.
 * Separate cap vertices prevent window normals/UVs leaking onto roofs.
 */
export function commercialRoundedGeometry(radius = 0.22): THREE.BufferGeometry {
  const cached = cache.get(radius);
  if (cached) return cached;
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  const vertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
  ) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
  };
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const rotate = (x: number, z: number): [number, number] => {
      const a = (quadrant * Math.PI) / 2;
      return [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
    };
    const points = [{ x: 0, z: -0.5, nx: 0, nz: -1 }];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 16;
      points.push({
        x: 0.5 - radius + radius * Math.cos(a),
        z: -0.5 + radius + radius * Math.sin(a),
        nx: Math.cos(a),
        nz: Math.sin(a),
      });
    }
    points.push({ x: 0.5, z: 0, nx: 1, nz: 0 });
    const lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(
        lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z),
      );
    for (let i = 0; i < points.length - 1; i++) {
      const wallVertex = (j: number, y: number) => {
        const p = points[j],
          [x, z] = rotate(p.x, p.z),
          [nx, nz] = rotate(p.nx, p.nz);
        vertex(x, y, z, nx, 0, nz, lengths[j] / lengths.at(-1)!, y + 0.5);
      };
      // Counter-clockwise when seen from outside; lower and upper share U.
      wallVertex(i, -0.5);
      wallVertex(i, 0.5);
      wallVertex(i + 1, 0.5);
      wallVertex(i, -0.5);
      wallVertex(i + 1, 0.5);
      wallVertex(i + 1, -0.5);
      const a = rotate(points[i].x, points[i].z),
        b = rotate(points[i + 1].x, points[i + 1].z);
      for (const y of [-0.5, 0.5]) {
        const ends = y > 0 ? [b, a] : [a, b];
        vertex(0, y, 0, 0, y * 2, 0, 0.5, 0.5);
        for (const [x, z] of ends) vertex(x, y, z, 0, y * 2, 0, x + 0.5, z + 0.5);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.commercialRounded = true;
  cache.set(radius, geometry);
  return geometry;
}
