import * as THREE from 'three';
import { sampleGroundHeight, type TerrainMaterials } from './terrain-graphics';
import type { CityState } from './types';

const DISTANCES = [0, 1.5, 5, 12, 28, 60];
export const getRegionMargin = (size:number):number => Math.max(80,size);
const smoothstep = (a:number,b:number,value:number) => {
  const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);
  return t*t*(3-2*t);
};

function perimeterPoint(size:number,index:number,distance:number):[number,number] {
  const side=Math.floor(index/size),t=(index%size)/size;
  const half=size/2+distance,along=-half+t*half*2;
  if(side===0)return [along,-half];
  if(side===1)return [half,along];
  if(side===2)return [-along,half];
  return [-half,-along];
}

function boundaryNormal(state:CityState,x:number,z:number):THREE.Vector3 {
  const half=state.size/2;
  const xa=Math.max(-half,x-1),xb=Math.min(half,x+1);
  const za=Math.max(-half,z-1),zb=Math.min(half,z+1);
  const dx=(sampleGroundHeight(state,xb,z)-sampleGroundHeight(state,xa,z))/Math.max(1,xb-xa);
  const dz=(sampleGroundHeight(state,x,zb)-sampleGroundHeight(state,x,za))/Math.max(1,zb-za);
  return new THREE.Vector3(-dx,1,-dz).normalize();
}

function groundColor(state:CityState,x:number,z:number,y:number,slope:number,distance:number):THREE.Color {
  const gx=x+state.size/2,gz=z+state.size/2;
  const variation=Math.sin(gx*.113+state.seed*.001)*Math.cos(gz*.087)*.025+Math.sin((gx+gz)*.247)*.012;
  const color=new THREE.Color().setHSL(.221+variation*.12,.235,.49+variation);
  color.lerp(new THREE.Color(0xc8c0a2),(1-smoothstep(-.45,.24,y))*.93);
  color.lerp(new THREE.Color(0xaaa99c),smoothstep(1,3.1,slope)*smoothstep(.7,2,y)*.8);
  return color.lerp(new THREE.Color(0xabb8ac),smoothstep(8,60,distance)*.9);
}

/**
 * Calm, non-buildable surroundings, exclusively outside the map. The inner ring shares the
 * exact terrain boundary; outward rings gently relax hills to plains and coastline to seabed.
 * Borrowed ground material/textures remain owned by the scene. No outside shadow receiving
 * surfaces means no shadow-map striping or giant hard-edged map slab beneath the city.
 */
export function createRegionContext(state:CityState,materials:TerrainMaterials):THREE.Group {
  const distances=[...new Set([...DISTANCES,getRegionMargin(state.size)])];
  const count=state.size*4,positions:number[]=[],uvs:number[]=[],colors:number[]=[],indices:number[]=[];
  const heights:number[]=[],boundaryNormals:THREE.Vector3[]=[];
  for(let i=0;i<count;i++) {
    const [x,z]=perimeterPoint(state.size,i,0);
    heights.push(sampleGroundHeight(state,x,z));
    boundaryNormals.push(boundaryNormal(state,x,z));
  }
  for(const distance of distances) for(let i=0;i<count;i++) {
    const [x,z]=perimeterPoint(state.size,i,distance),edgeHeight=heights[i];
    const target=edgeHeight<-.08?-2:0;
    const y=THREE.MathUtils.lerp(edgeHeight,target,smoothstep(0,42,distance));
    positions.push(x,y,z);
    uvs.push((x+state.size/2)/6,-(z+state.size/2)/6);
    const normal=boundaryNormals[i],slope=Math.hypot(normal.x,normal.z)/Math.max(.01,normal.y);
    const color=groundColor(state,x,z,y,slope,distance);
    colors.push(color.r,color.g,color.b);
  }
  for(let ring=0;ring<distances.length-1;ring++) for(let i=0;i<count;i++) {
    const next=(i+1)%count,a=ring*count+i,b=ring*count+next,c=(ring+1)*count+next,d=(ring+1)*count+i;
    indices.push(a,b,c,a,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals=geometry.getAttribute('normal');
  // Match the playable surface's analytical edge normals to avoid a visible lighting seam.
  boundaryNormals.forEach((normal,i)=>normals.setXYZ(i,normal.x,normal.y,normal.z));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const surface=new THREE.Mesh(geometry,materials.ground);
  surface.name='region-continuation';
  surface.castShadow=false;surface.receiveShadow=false;
  surface.userData.nonBuildable=true;

  const lines:number[]=[];
  for(let i=0;i<count;i+=2) {
    const [ax,az]=perimeterPoint(state.size,i,0),[bx,bz]=perimeterPoint(state.size,(i+1)%count,0);
    // Omit the underwater boundary. The playable coast itself is enough visual context there.
    if(heights[i]<-.06)continue;
    for(const t of [.24,.57]) {
      const x=THREE.MathUtils.lerp(ax,bx,t),z=THREE.MathUtils.lerp(az,bz,t);
      lines.push(x,sampleGroundHeight(state,x,z)+.022,z);
    }
  }
  const lineGeometry=new THREE.BufferGeometry();
  lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
  const lineMaterial=new THREE.LineBasicMaterial({color:0xe9e8d6,transparent:true,opacity:.34,depthWrite:false});
  const boundary=new THREE.LineSegments(lineGeometry,lineMaterial);
  boundary.name='region-buildable-boundary';boundary.userData.raytracingExclude=true;
  boundary.castShadow=false;boundary.receiveShadow=false;
  const group=new THREE.Group();
  group.name='region-context';group.userData.nonBuildable=true;
  group.userData.ownedMaterials=[lineMaterial];
  group.add(surface,boundary);
  return group;
}
