import { approachKey, roadPointKey, type JunctionMovement, type RoadJunction, type RoadNetwork } from './traffic-network';
import type { Point } from './types';
import { findVehicleContact, type VehicleContactBody } from './vehicle-contacts';

export type SignalColor='red'|'yellow'|'green';
export interface SignalState { approachId:string; junctionId:string; color:SignalColor; }
export interface TrafficVehicle {id:number; x:number;z:number;y?:number;yaw:number;halfWidth:number;halfLength:number; controlled?:boolean;}
export interface TrafficConfig {prioritySide:'right'|'left';signalsEnabled:boolean;greenSeconds:number;yellowSeconds:number;allRedSeconds:number;}
export type TrafficWaitReason='signal'|'junction'|'exit'|'priority'|null;
interface Phase {index:number;stage:'green'|'yellow'|'allRed';elapsed:number;}
interface Reservation {vehicleId:number;movement:JunctionMovement;entered:boolean;}
export const STOP_LINE_OFFSET=.74;
const defaults:TrafficConfig={prioritySide:'right',signalsEnabled:true,greenSeconds:5,yellowSeconds:1,allRedSeconds:.6};
const body=(v:TrafficVehicle):VehicleContactBody=>({...v,y:v.y??0,vx:0,vz:0,angularVelocity:0,mass:1,height:100});

/** True if the other approach comes from this vehicle's configured priority side. */
export function mustYieldToSide(direction:Point,otherDirection:Point,side:'right'|'left'='right'):boolean {
  const towardSide=side==='right'?{x:-direction.z,z:direction.x}:{x:direction.z,z:-direction.x};
  // The other vehicle travels inward, opposite its position relative to this crossing.
  return -otherDirection.x*towardSide.x-otherDirection.z*towardSide.z>.5;
}
function overlapsCell(v:TrafficVehicle,p:Point,padding=0):boolean {
  return !!findVehicleContact(body(v),body({id:-1,x:p.x+.5,z:p.z+.5,y:v.y,yaw:0,halfWidth:.5+padding,halfLength:.5+padding}));
}
export function vehicleOccupiesJunction(v:TrafficVehicle,j:RoadJunction):boolean{return j.cells.some(p=>overlapsCell(v,p,.025));}

export function createTrafficController(initial:RoadNetwork,options:Partial<TrafficConfig>={}) {
  const config={...defaults,...options};let network=initial,vehicles:TrafficVehicle[]=[];
  const phases=new Map<string,Phase>(),reservations=new Map<string,Reservation>();
  const requests=new Map<number,{movement:JunctionMovement;since:number}>();
  let time=0,completed=0;
  function rebuild(next:RoadNetwork){network=next;for(const key of phases.keys())if(!network.junctions.some(j=>j.id===key))phases.delete(key);for(const [key,r]of reservations)if(!network.junctions.some(j=>j.id===key)||(!network.approaches.has(r.movement.approachId)||r.movement.path.some(p=>!network.roads.has(roadPointKey(p)))))reservations.delete(key);for(const[id,r]of requests)if(!network.approaches.has(r.movement.approachId)||r.movement.path.some(p=>!network.roads.has(roadPointKey(p))))requests.delete(id);for(const j of network.junctions)if(!phases.has(j.id))phases.set(j.id,{index:0,stage:'green',elapsed:0});}
  rebuild(initial);
  function signalStates():SignalState[]{return network.junctions.filter(j=>j.signalized!==false).flatMap(j=>{const phase=phases.get(j.id)!;return j.approaches.map((a,i)=>({approachId:a.id,junctionId:j.id,color:config.signalsEnabled&&j.signalized!==false&&i===phase.index&&phase.stage!=='allRed'?phase.stage as SignalColor:'red'}));});}
  function update(dt:number,snapshots:TrafficVehicle[]){
    vehicles=snapshots;const step=Math.max(0,Number.isFinite(dt)?dt:0);time+=step;
    const ids=new Set(vehicles.map(v=>v.id));for(const id of requests.keys())if(!ids.has(id))requests.delete(id);
    for(const [key,r]of reservations){const v=vehicles.find(v=>v.id===r.vehicleId),j=network.junctions.find(j=>j.id===key);if(!v||!j){reservations.delete(key);continue;}
      const inside=vehicleOccupiesJunction(v,j);if(inside)r.entered=true;
      // Never expire occupied space by elapsed time. Release only once the rear is out.
      if(r.entered&&!inside){reservations.delete(key);requests.delete(r.vehicleId);completed++;}
    }
    for(const j of network.junctions){if(!j.approaches.length)continue;const p=phases.get(j.id)!;p.elapsed+=step;let guard=0;
      while(guard++<100){const duration=p.stage==='green'?config.greenSeconds:p.stage==='yellow'?config.yellowSeconds:config.allRedSeconds;if(p.elapsed<duration)break;p.elapsed-=duration;if(p.stage==='green')p.stage='yellow';else if(p.stage==='yellow')p.stage='allRed';else{p.stage='green';p.index=(p.index+1)%j.approaches.length;}}
    }
  }
  function exitBlocked(id:number,m:JunctionMovement,halfLength:number,halfWidth:number):boolean{
    const d=m.exitDirection;
    // Reserve storage from the junction edge until the rear can fully clear it.
    const length=Math.max(.76,halfLength*2+.24),start={x:m.exit.x+.5-d.x*.5,z:m.exit.z+.5-d.z*.5};
    const storage=body({id:-1,x:start.x+d.x*length/2-d.z*.16,z:start.z+d.z*length/2+d.x*.16,yaw:Math.atan2(d.x,d.z),halfLength:length/2,halfWidth:halfWidth+.015});
    return vehicles.some(v=>v.id!==id&&!!findVehicleContact(storage,body(v)));
  }
  function request(vehicleId:number,m:JunctionMovement,halfLength:number,halfWidth=.13):{allowed:boolean;reason:TrafficWaitReason}{
    const j=network.junctions.find(j=>j.id===m.junctionId);if(!j||!network.approaches.has(m.approachId)||m.path.some(p=>!network.roads.has(roadPointKey(p))))return {allowed:false,reason:'junction'};
    const held=reservations.get(j.id);if(held?.vehicleId===vehicleId)return {allowed:true,reason:null};
    if(!requests.has(vehicleId))requests.set(vehicleId,{movement:m,since:time});
    if(config.signalsEnabled&&j.signalized!==false){const p=phases.get(j.id)!;if(p.stage!=='green'||j.approaches[p.index]?.id!==m.approachId)return {allowed:false,reason:'signal'};}
    else {
      const incoming=network.approaches.get(m.approachId)!;
      const contenders=new Map([...requests].filter(([id,r])=>id!==vehicleId&&r.movement.junctionId===j.id));
      // Derive simultaneous near-stop-line arrivals from physical snapshots as well,
      // so the first car in the frame cannot take priority before another calls request().
      for(const v of vehicles){if(v.id===vehicleId||contenders.has(v.id))continue;
        const arm=j.approaches.find(a=>{const dx=v.x-(a.entry.x+.5),dz=v.z-(a.entry.z+.5),along=-(dx*a.direction.x+dz*a.direction.z),side=dx*(-a.direction.z)+dz*a.direction.x;return along>=.5&&along<=1.4&&Math.abs(side-.16)<.2&&Math.sin(v.yaw)*a.direction.x+Math.cos(v.yaw)*a.direction.z>.8;});
        if(arm)contenders.set(v.id,{movement:{...m,approachId:arm.id},since:time});
      }
      const competition=[...contenders];
      // A four-way tie is resolved by the longest wait, then stable vehicle ID.
      const priority=competition.filter(([,r])=>mustYieldToSide(incoming.direction,network.approaches.get(r.movement.approachId)!.direction,config.prioritySide));
      const cycle=competition.length>=3;
      if(priority.length&&(!cycle||competition.some(([id,r])=>r.since<requests.get(vehicleId)!.since||(r.since===requests.get(vehicleId)!.since&&id<vehicleId))))return {allowed:false,reason:'priority'};
    }
    if(held||vehicles.some(v=>v.id!==vehicleId&&vehicleOccupiesJunction(v,j)))return {allowed:false,reason:'junction'};
    if(exitBlocked(vehicleId,m,halfLength,halfWidth))return {allowed:false,reason:'exit'};
    reservations.set(j.id,{vehicleId,movement:m,entered:false});return {allowed:true,reason:null};
  }
  /** A real service vehicle can reserve its unlit driveway merge before its nose reaches the street. */
  function reserveExternal(vehicleId:number,junctionId:string,movement?:JunctionMovement):boolean {
    const held=reservations.get(junctionId);if(held?.vehicleId===vehicleId)return true;
    const j=network.junctions.find(j=>j.id===junctionId);if(!j||held||vehicles.some(v=>v.id!==vehicleId&&vehicleOccupiesJunction(v,j)))return false;
    const v=vehicles.find(v=>v.id===vehicleId);if(movement&&(!v||exitBlocked(vehicleId,movement,v.halfLength,v.halfWidth)))return false;
    reservations.set(j.id,{vehicleId,entered:false,movement:movement??{junctionId:j.id,approachId:`external:${vehicleId}`,path:j.cells,exit:j.cells[0],exitDirection:{x:0,z:1}}});return true;
  }
  function cancel(vehicleId:number){requests.delete(vehicleId);for(const[key,r]of reservations)if(r.vehicleId===vehicleId)reservations.delete(key);}
  return {config,rebuild,update,request,reserveExternal,cancel,signalStates,exitBlocked,
    hasReservation:(id:number)=>[...reservations.values()].some(r=>r.vehicleId===id),
    getDebug:()=>({time,completed,prioritySide:config.prioritySide,junctionCount:network.junctions.filter(j=>j.signalized!==false).length,protectedBends:network.junctions.filter(j=>j.signalized===false).length,signals:signalStates(),reservations:[...reservations.values()].map(r=>({vehicleId:r.vehicleId,junctionId:r.movement.junctionId,entered:r.entered})),waiting:requests.size}),
  };
}
