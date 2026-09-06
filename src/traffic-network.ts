import type { CityState, Point } from './types';

export interface TrafficApproach { id:string; junctionId:string; from:Point; entry:Point; direction:Point; }
export interface RoadJunction { id:string; cells:Point[]; approaches:TrafficApproach[]; signalized?:boolean; }
export interface RoadNetwork {
  roads:Map<string,Point>; neighbors:Map<string,Point[]>; junctions:RoadJunction[];
  junctionAt:Map<string,RoadJunction>; approaches:Map<string,TrafficApproach>;
}
export interface JunctionMovement {
  junctionId:string; approachId:string;
  /** All junction cells in travel order followed by the first external exit tile. */
  path:Point[]; exit:Point; exitDirection:Point;
}
export const roadPointKey=(p:Point):string=>`${p.x},${p.z}`;
export const approachKey=(from:Point,entry:Point):string=>`${roadPointKey(from)}>${roadPointKey(entry)}`;
const steps:Point[]=[{x:0,z:-1},{x:1,z:0},{x:0,z:1},{x:-1,z:0}];
export const sameRoadPoint=(a:Point,b:Point):boolean=>a.x===b.x&&a.z===b.z;

/** Junctions separated by less than a full vehicle storage tile share a controller. */
export function buildRoadNetwork(state:Pick<CityState,'tiles'>):RoadNetwork {
  const roads=new Map(state.tiles.filter(t=>t.kind==='road').map(t=>[roadPointKey(t),{x:t.x,z:t.z}]));
  const neighbors=new Map<string,Point[]>();
  for(const [key,p] of roads)neighbors.set(key,steps.map(d=>({x:p.x+d.x,z:p.z+d.z})).filter(n=>roads.has(roadPointKey(n))));
  const signalCells=new Set([...neighbors].filter(([,ns])=>ns.length>=3).map(([key])=>key));
  // Tight bends need exclusive truck clearance, without traffic lights.
  const serviceTiles=new Set(state.tiles.filter(t=>['fire','hospital','police'].includes(t.kind)).map(roadPointKey));
  const junctionCells=new Set([...neighbors].filter(([key,ns])=>{const p=roads.get(key)!;return steps.some(d=>serviceTiles.has(roadPointKey({x:p.x+d.x,z:p.z+d.z})))||ns.length>=3||(ns.length===2&&(ns[0].x+ns[1].x!==p.x*2||ns[0].z+ns[1].z!==p.z*2));}).map(([key])=>key));
  // Absorb a one-tile link between two crossings: it cannot safely store a truck.
  for(const [key,ns] of neighbors)if(ns.length===2&&ns.every(n=>junctionCells.has(roadPointKey(n))))junctionCells.add(key);
  const junctions:RoadJunction[]=[],junctionAt=new Map<string,RoadJunction>(),approaches=new Map<string,TrafficApproach>();
  const seen=new Set<string>();
  for(const key of [...junctionCells].sort()) {
    if(seen.has(key))continue;
    const cells:Point[]=[],queue=[roads.get(key)!];seen.add(key);
    while(queue.length){const p=queue.shift()!;cells.push(p);for(const n of neighbors.get(roadPointKey(p))??[]){const nk=roadPointKey(n);if(junctionCells.has(nk)&&!seen.has(nk)){seen.add(nk);queue.push(n);}}}
    cells.sort((a,b)=>a.z-b.z||a.x-b.x);
    const id=`junction:${cells.map(roadPointKey).join(';')}`,junction:RoadJunction={id,cells,approaches:[],signalized:cells.some(p=>signalCells.has(roadPointKey(p)))};
    const own=new Set(cells.map(roadPointKey));
    for(const entry of cells)for(const from of neighbors.get(roadPointKey(entry))??[])if(!own.has(roadPointKey(from))){
      const a:TrafficApproach={id:approachKey(from,entry),junctionId:id,from,entry,direction:{x:entry.x-from.x,z:entry.z-from.z}};
      junction.approaches.push(a);approaches.set(a.id,a);
    }
    junction.approaches.sort((a,b)=>Math.atan2(a.direction.x,a.direction.z)-Math.atan2(b.direction.x,b.direction.z)||a.id.localeCompare(b.id));
    junctions.push(junction);for(const p of cells)junctionAt.set(roadPointKey(p),junction);
  }
  return {roads,neighbors,junctions,junctionAt,approaches};
}

/** Choose an external destination first, then a shortest path through the entire junction. */
export function planJunctionMovement(network:RoadNetwork,from:Point,entry:Point,choice=0):JunctionMovement|null {
  const approach=network.approaches.get(approachKey(from,entry));if(!approach)return null;
  const junction=network.junctionAt.get(roadPointKey(entry))!;
  let exits=junction.approaches.filter(a=>!sameRoadPoint(a.from,from));
  if(!exits.length)exits=[approach];
  const selected=exits[Math.abs(Math.floor(choice))%exits.length],target=selected.entry;
  const queue=[entry],parents=new Map<string,Point|null>([[roadPointKey(entry),null]]);
  while(queue.length){const p=queue.shift()!;if(sameRoadPoint(p,target))break;for(const n of network.neighbors.get(roadPointKey(p))??[]){const k=roadPointKey(n);if(network.junctionAt.get(k)?.id===junction.id&&!parents.has(k)){parents.set(k,p);queue.push(n);}}}
  const path:Point[]=[];let p:Point|null=target;
  while(p){path.unshift(p);p=parents.get(roadPointKey(p))??null;}
  path.push(selected.from);
  return {junctionId:junction.id,approachId:approach.id,path,exit:selected.from,exitDirection:{x:selected.from.x-target.x,z:selected.from.z-target.z}};
}

/** Pre-plan a driveway vehicle's first road turn and a real external storage tile. */
export function planExternalMovement(network:RoadNetwork,entry:Point,next:Point,vehicleId:number):JunctionMovement|null {
  const junction=network.junctionAt.get(roadPointKey(entry));if(!junction)return null;
  if(network.junctionAt.get(roadPointKey(next))?.id!==junction.id)return {junctionId:junction.id,approachId:`external:${vehicleId}`,path:[entry,next],exit:next,exitDirection:{x:next.x-entry.x,z:next.z-entry.z}};
  const queue=[next],parents=new Map<string,Point|null>([[roadPointKey(next),null]]);let exit:Point|null=null,last:Point|null=null;
  while(queue.length&&!exit){const p=queue.shift()!;for(const n of network.neighbors.get(roadPointKey(p))??[]){const k=roadPointKey(n);if(network.junctionAt.get(k)?.id!==junction.id){exit=n;last=p;break;}if(!sameRoadPoint(n,entry)&&!parents.has(k)){parents.set(k,p);queue.push(n);}}}
  if(!exit||!last)return null;
  const path:Point[]=[];let p:Point|null=last;while(p){path.unshift(p);p=parents.get(roadPointKey(p))??null;}path.unshift(entry);path.push(exit);
  return {junctionId:junction.id,approachId:`external:${vehicleId}`,path,exit,exitDirection:{x:exit.x-last.x,z:exit.z-last.z}};
}
