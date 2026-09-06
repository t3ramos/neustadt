import * as THREE from 'three';
import type { CityState, Tile } from './types';

const isTransport = (tile: Tile) => tile.kind==='road' || tile.kind==='rail';

/** Shared transport corners ignore nearby hills; bridge decks use sea level, not seabed height. */
export function roadCornerHeight(state: CityState, x: number, z: number): number|null {
  let sum = 0, count = 0;
  for (let dz=-1; dz<=0; dz++) for (let dx=-1; dx<=0; dx++) {
    const xx=x+dx, zz=z+dz;
    if (xx<0 || zz<0 || xx>=state.size || zz>=state.size) continue;
    const tile=state.tiles[zz*state.size+xx];
    if (!isTransport(tile)) continue;
    sum += Math.max(0, tile.elevation);
    count++;
  }
  return count ? sum/count : null;
}

/**
 * Exact road/rail deck base in centered world coordinates. Add the existing pavement thickness
 * separately (approximately .052 for vehicle contact). No height is derived from water depth.
 * The same NW–SE triangle split is used by warped meshes and the land beneath roads.
 */
export function sampleRoadHeight(state: CityState, worldX: number, worldZ: number): number {
  const gx=THREE.MathUtils.clamp(worldX+state.size/2, 0, state.size-1e-8);
  const gz=THREE.MathUtils.clamp(worldZ+state.size/2, 0, state.size-1e-8);
  const x=Math.floor(gx), z=Math.floor(gz), u=gx-x, v=gz-z;
  const base=Math.max(0, state.tiles[z*state.size+x].elevation);
  const nw=roadCornerHeight(state,x,z)??base, ne=roadCornerHeight(state,x+1,z)??base;
  const se=roadCornerHeight(state,x+1,z+1)??base, sw=roadCornerHeight(state,x,z+1)??base;
  return v<=u ? nw+(ne-nw)*u+(se-ne)*v : nw+(se-sw)*u+(sw-nw)*v;
}

// The model system deliberately shares primitives. Keep their untouched source across re-warps.
const sourceGeometries = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();

/**
 * Warp a freshly created transport model BEFORE positioning its root over the map tile.
 * Mesh-local rotations/scales and a rail root's 90-degree rotation are retained. Shared source
 * primitives are never changed. Splitting triangles at the terrain diagonal makes the asphalt,
 * curbs and markings follow exactly the same surface instead of floating over a coarse quad.
 */
export function warpRoadModel(model: THREE.Group, tile: Tile, state: CityState): void {
  if (!isTransport(tile)) return;
  model.updateWorldMatrix(true, true);
  const parentInverse=model.parent ? model.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const centerX=tile.x-state.size/2+.5, centerZ=tile.z-state.size/2+.5;
  const base=Math.max(0,tile.elevation);
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const source: THREE.BufferGeometry=sourceGeometries.get(object) ?? object.geometry;
    if (!sourceGeometries.has(object)) sourceGeometries.set(object,source);
    const geometry=source.clone();
    const transform=parentInverse.clone().multiply(object.matrixWorld), inverse=transform.clone().invert();
    const attributes=Object.entries(geometry.attributes);
    const values=new Map<string, number[]>();
    for (const [name, attribute] of attributes) {
      const data:number[]=[];
      for (let i=0; i<attribute.count; i++) for (let component=0; component<attribute.itemSize; component++) data.push(attribute.getComponent(i,component));
      values.set(name,data);
    }
    const points=values.get('position')!;
    const distances:number[]=[];
    const vector=new THREE.Vector3();
    for (let i=0; i<points.length; i+=3) {
      vector.set(points[i],points[i+1],points[i+2]).applyMatrix4(transform);
      distances.push(vector.x-vector.z);
    }
    const crossings=new Map<string,number>();
    function crossing(a:number,b:number):number {
      if (Math.abs(distances[a])<1e-9) return a;
      if (Math.abs(distances[b])<1e-9) return b;
      const key=a<b?`${a}:${b}`:`${b}:${a}`;
      const existing=crossings.get(key);
      if (existing!==undefined) return existing;
      const t=distances[a]/(distances[a]-distances[b]);
      const index=points.length/3;
      for (const [name, attribute] of attributes) {
        const data=values.get(name)!;
        for (let component=0; component<attribute.itemSize; component++) {
          data.push(THREE.MathUtils.lerp(data[a*attribute.itemSize+component],data[b*attribute.itemSize+component],t));
        }
      }
      distances.push(0);
      crossings.set(key,index);
      return index;
    }
    function clip(triangle:number[],positive:boolean):number[] {
      const result:number[]=[];
      for (let i=0; i<triangle.length; i++) {
        const a=triangle[i],b=triangle[(i+1)%triangle.length];
        const insideA=positive?distances[a]>=-1e-9:distances[a]<=1e-9;
        const insideB=positive?distances[b]>=-1e-9:distances[b]<=1e-9;
        if (insideA) result.push(a);
        if (insideA!==insideB) result.push(crossing(a,b));
      }
      return result.filter((index,i)=>i===0||index!==result[i-1]).filter((index,i,array)=>i!==array.length-1||index!==array[0]);
    }
    const originalIndices=geometry.index ? Array.from(geometry.index.array) : Array.from({length:points.length/3},(_,i)=>i);
    const originalGroups=geometry.groups.length ? geometry.groups.map(group=>({...group})) : [{start:0,count:originalIndices.length,materialIndex:0}];
    const indices:number[]=[];
    geometry.clearGroups();
    for (const group of originalGroups) {
      const start=indices.length;
      for (let offset=group.start; offset<Math.min(originalIndices.length,group.start+group.count); offset+=3) {
        const triangle=originalIndices.slice(offset,offset+3);
        if (triangle.length<3) continue;
        const ds=triangle.map(index=>distances[index]);
        if (!ds.some(d=>d>1e-9) || !ds.some(d=>d<-1e-9)) { indices.push(...triangle); continue; }
        for (const positive of [true,false]) {
          const polygon=clip(triangle,positive);
          for (let i=1; i<polygon.length-1; i++) indices.push(polygon[0],polygon[i],polygon[i+1]);
        }
      }
      if (indices.length>start) geometry.addGroup(start,indices.length-start,group.materialIndex);
    }
    for (let i=0; i<points.length; i+=3) {
      vector.set(points[i],points[i+1],points[i+2]).applyMatrix4(transform);
      vector.y += sampleRoadHeight(state,centerX+vector.x,centerZ+vector.z)-base;
      vector.applyMatrix4(inverse);
      points[i]=vector.x;points[i+1]=vector.y;points[i+2]=vector.z;
    }
    for (const [name,attribute] of attributes) geometry.setAttribute(name,new THREE.Float32BufferAttribute(values.get(name)!,attribute.itemSize,attribute.normalized));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (object.geometry!==source) object.geometry.dispose();
    object.geometry=geometry;
  });
}
