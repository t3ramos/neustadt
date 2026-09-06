import * as THREE from 'three';
import { buildRoadNetwork,roadPointKey } from './traffic-network';
import { STOP_LINE_OFFSET } from './traffic-controller';
import type { CityState,Tile } from './types';

export const ROAD_SURFACE_HEIGHT=.0455;
const SIZE=256;
const directions=[{x:0,z:-1},{x:1,z:0},{x:0,z:1},{x:-1,z:0}];
const materials=new Map<number,THREE.MeshStandardMaterial>();
const roadMasks=new WeakMap<CityState,{revision:number;masks:Map<string,number>}>();
let wet=false;

/** The actual albedo of the asphalt, including lane paint and pedestrian crossings. */
export function roadPaintAt(x:number,z:number,connections:number,stops=0):'line'|'crosswalk'|null {
  const arms=directions.map((_,i)=>!!(connections&(1<<i))),[north,east,south,west]=arms;
  const count=arms.filter(Boolean).length,horizontal=east||west,vertical=north||south;
  for(let i=0;i<4;i++)if(stops&(1<<i)){
    const d=directions[i],along=x*d.x+z*d.z,lateral=-x*d.z+z*d.x;
    if(Math.abs(along-(1-(STOP_LINE_OFFSET-.025)))<=.015&&Math.abs(lateral-.17)<=.135)return 'crosswalk';
  }
  if(count>2){
    for(let j=0;j<4;j++){
      const p=(j-1.5)*.13;
      if((north&&Math.abs(z+.36)<=.06||south&&Math.abs(z-.36)<=.06)&&Math.abs(x-p)<=.0375)return 'crosswalk';
      if((east&&Math.abs(x-.36)<=.06||west&&Math.abs(x+.36)<=.06)&&Math.abs(z-p)<=.0375)return 'crosswalk';
    }
  }else if((north&&south)||(!horizontal&&!vertical)||(vertical&&!horizontal)){
    if(Math.abs(x)<=.011&&[-.34,0,.34].some(p=>Math.abs(z-p)<=.085))return 'line';
  }else if(horizontal&&!vertical){
    if(Math.abs(z)<=.011&&[-.34,0,.34].some(p=>Math.abs(x-p)<=.085))return 'line';
  }else{
    if((north&&Math.abs(z+.30)<=.12||south&&Math.abs(z-.30)<=.12)&&Math.abs(x)<=.011)return 'line';
    if((east&&Math.abs(x-.30)<=.12||west&&Math.abs(x+.30)<=.12)&&Math.abs(z)<=.011)return 'line';
  }
  return null;
}

function material(connections:number,stops:number):THREE.MeshStandardMaterial {
  const key=connections|(stops<<4),cached=materials.get(key);if(cached)return cached;
  const pixels=new Uint8Array(SIZE*SIZE*4);
  for(let z=0;z<SIZE;z++)for(let x=0;x<SIZE;x++){
    const paint=roadPaintAt((x+.5)/SIZE-.5,(z+.5)/SIZE-.5,connections,stops);
    const color=paint==='line'?[242,232,186]:paint==='crosswalk'?[255,249,232]:[83,98,106];
    const index=(z*SIZE+x)*4;pixels.set([...color,255],index);
  }
  const map=new THREE.DataTexture(pixels,SIZE,SIZE,THREE.RGBAFormat);
  map.colorSpace=THREE.SRGBColorSpace;map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  const value=new THREE.MeshStandardMaterial({color:0xffffff,map,roughness:wet?.18:.84,metalness:wet?.09:.02});
  value.name=`road-albedo-${connections}-${stops}`;value.userData.roadSurface=true;
  materials.set(key,value);return value;
}

export function setRoadSurfaceWet(value:boolean):void {
  wet=value;for(const m of materials.values()){m.roughness=wet?.18:.84;m.metalness=wet?.09:.02;}
}

export function roadStopMask(state:CityState,tile:Tile):number {
  let cached=roadMasks.get(state);
  if(!cached||cached.revision!==state.revision){
    const masks=new Map<string,number>();
    for(const junction of buildRoadNetwork(state).junctions)if(junction.signalized!==false){
      for(const approach of junction.approaches){
        const i=directions.findIndex(d=>d.x===approach.direction.x&&d.z===approach.direction.z),key=roadPointKey(approach.from);
        masks.set(key,(masks.get(key)??0)|(1<<i));
      }
    }
    cached={revision:state.revision,masks};roadMasks.set(state,cached);
  }
  return cached.masks.get(roadPointKey(tile))??0;
}

export function roadSurfaceMaterial(state:CityState,tile:Tile):THREE.MeshStandardMaterial {
  let mask=0;directions.forEach((d,i)=>{const x=tile.x+d.x,z=tile.z+d.z;
    if(x>=0&&z>=0&&x<state.size&&z<state.size&&state.tiles[z*state.size+x]?.kind==='road')mask|=1<<i;
  });
  return material(mask,roadStopMask(state,tile));
}

/** Map all top vertices to the same tile coordinates before the slope is deformed. */
export function textureAsphalt(mesh:THREE.Mesh,surface:THREE.Material):void {
  const geometry=mesh.geometry.clone(),position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal');
  const uv=new Float32Array(position.count*2);
  for(let i=0;i<position.count;i++){
    uv[i*2]=normal.getY(i)>.5?position.getX(i)*mesh.scale.x+mesh.position.x+.5:.99;
    uv[i*2+1]=normal.getY(i)>.5?position.getZ(i)*mesh.scale.z+mesh.position.z+.5:.99;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.userData.roadUvOwned=true;mesh.geometry=geometry;mesh.material=surface;
  mesh.userData.roadSurface=true;
}
