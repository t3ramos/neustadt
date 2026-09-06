import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as CANNON from 'cannon-es';
import { createTileModel } from './models';
import { sampleGroundHeight } from './terrain-graphics';
import { createPedestrianGraph, type PedestrianGraph } from './citizen-routing';
import { createCitizenSpeechSelector, type CitizenDialogueTopic, type CitizenDialoguePair } from './citizen-dialogue';
import { tr } from './i18n';
import type { CityState, CitizenIncident, Tile } from './types';

export const MAX_CITIZENS = 150;
export const MAX_RAGDOLLS = 8;
/** One tile is roughly ten metres; adult figures stay below .18 world units. */
export const CITIZEN_SCALE = .29;
export const CITIZEN_PICK_RADIUS = .18;
export const MAX_HAND_SPEED = 10;
export const IMPACT_THRESHOLD = 5.1*Math.sqrt(CITIZEN_SCALE);
export const GET_UP_SECONDS = 1.9;
export const CITIZEN_PHYSICS_STEP = 1/240;
export const SEVERE_VEHICLE_IMPACT_SPEED = .85;
const GROUND_GROUP = 1, PERSON_GROUP = 2;
const PARTS = ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
type PartName = typeof PARTS[number];
type Incident = Omit<CitizenIncident, 'id'|'month'>;
type Vec = { x:number; y:number; z:number };
type Hit = { point:Vec; normal:Vec; speed:number };
export interface CitizenVehicleSweep {previous:Vec;current:Vec;yaw:number;width:number;length:number;height?:number;previousYaw?:number;velocity:Vec;vehicleId:number;trafficOnly?:boolean;}
export interface CitizenObservation {topic:CitizenDialogueTopic;position:Vec;id?:string|number;}
type PaneSurface = {axis:'x'|'z';direction:1|-1;outer:number;inner:number;};
const physicalPaneSurfaces=new WeakMap<CANNON.Shape,PaneSurface>();
const authoredPaneSurfaces=new WeakMap<THREE.Box3,PaneSurface>();
const clamp = THREE.MathUtils.clamp;
const random = (n:number) => { const value=Math.sin(n*127.1+31.7)*43758.5453;return value-Math.floor(value); };

export type CitizenSpeechKind='idle'|'held'|'recovery'|'witness'|'nearMiss'|'vehicle'|'observation';
export interface CitizenSpeech {actorId:number;text:string;kind:CitizenSpeechKind;expiresAt:number;}

/** Event-driven, bounded dialogue: reactions can interrupt idle chatter. */
export class CitizenDialogue {
  private active:(CitizenSpeech&{pair?:CitizenDialoguePair})[]=[];
  private last=new Map<string,number>();
  private priority(kind:CitizenSpeechKind):number {return kind==='idle'?0:kind==='observation'?1:2;}
  getActive(now:number):CitizenSpeech[] {
    this.active=this.active.filter(speech=>speech.expiresAt>now);
    // Keep the selected line and its expiry: changing language must not select
    // another line, reset a reaction cooldown, or extend a bubble's lifetime.
    return this.active.map(({pair,...speech})=>({...speech,text:pair?tr(pair.de,pair.en):speech.text}));
  }
  canSpeak(actorId:number,kind:CitizenSpeechKind,now:number):boolean {
    this.getActive(now);
    const key=`${actorId}:${kind}`,cooldown=kind==='idle'?14:4;
    if(now-(this.last.get(key)??-Infinity)<cooldown)return false;
    const existing=this.active.findIndex(speech=>speech.actorId===actorId);
    if(existing>=0&&this.priority(kind)<this.priority(this.active[existing].kind))return false;
    if(existing<0&&this.active.length>=3&&!this.active.some(speech=>this.priority(speech.kind)<=this.priority(kind)))return false;
    return true;
  }
  speak(actorId:number,text:string|CitizenDialoguePair,kind:CitizenSpeechKind,now:number):boolean {
    if(!this.canSpeak(actorId,kind,now))return false;
    const key=`${actorId}:${kind}`,existing=this.active.findIndex(speech=>speech.actorId===actorId);
    if(existing>=0)this.active.splice(existing,1);
    if(this.active.length>=3) {
      const lowest=Math.min(...this.active.map(speech=>this.priority(speech.kind))),oldest=this.active.findIndex(speech=>this.priority(speech.kind)===lowest);
      this.active.splice(oldest,1);
    }
    const pair=typeof text==='string'?undefined:{de:text.de.slice(0,140),en:text.en.slice(0,140)};
    this.last.set(key,now);this.active.push({actorId,text:typeof text==='string'?text.slice(0,140):pair!.de,kind,expiresAt:now+3.5,...(pair?{pair}:{})});return true;
  }
  forget(actorId:number):void {this.active=this.active.filter(speech=>speech.actorId!==actorId);for(const key of this.last.keys())if(key.startsWith(`${actorId}:`))this.last.delete(key);}
  clear():void {this.active=[];this.last.clear();}
}

function citizenContextTopic(state:CityState,position:Vec):CitizenDialogueTopic {
  const hour=state.settings.timeOfDay??14;
  if(hour<6||hour>=20)return 'night';
  const x=Math.floor(position.x+state.size/2),z=Math.floor(position.z+state.size/2),tile=state.tiles[z*state.size+x];
  if(state.stats.pollution>40||(tile?.pollution??0)>40)return 'industry';
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,zz=z+dz;if(xx>=0&&zz>=0&&xx<state.size&&zz<state.size&&state.tiles[zz*state.size+xx]?.kind==='park')return 'park';}
  if(state.stats.happiness>=75)return 'happy';
  if(state.stats.happiness<40)return 'unhappy';
  if(state.settings.weather==='rain')return 'rain';
  if(state.stats.traffic>45)return 'traffic';
  return 'everyday';
}

export function chooseCitizenComment(state:CityState,position:Vec,variant:number):string {
  return createCitizenSpeechSelector(state.seed+Math.floor(variant)*31).pick(citizenContextTopic(state,position),variant);
}

/** Segment-versus-expanded oriented car box; detects impacts between frames. */
export function sweepVehicleFootprint(position:Vec,event:CitizenVehicleSweep,radius=.025):{time:number;normal:Vec}|null {
  if(![position.x,position.y,position.z,event.yaw,event.width,event.length,...Object.values(event.previous),...Object.values(event.current)].every(Number.isFinite)||event.width<=0||event.length<=0)return null;
  const c=Math.cos(event.yaw),s=Math.sin(event.yaw),height=event.height??.18;
  const transform=(point:Vec)=>({x:c*(position.x-point.x)-s*(position.z-point.z),y:position.y-point.y-height/2,z:s*(position.x-point.x)+c*(position.z-point.z)});
  const from=transform(event.previous),to=transform(event.current),bounds={x:event.width/2+radius,y:height/2+.024,z:event.length/2+radius};
  let enter=0,exit=1,axis:'x'|'y'|'z'='x',sign=from.x>=0?1:-1;
  for(const name of ['x','y','z'] as const) {
    const velocity=to[name]-from[name],extent=bounds[name];
    if(Math.abs(velocity)<1e-10){if(Math.abs(from[name])>extent)return null;continue;}
    const near=(-extent-from[name])/velocity,far=(extent-from[name])/velocity,t0=Math.min(near,far),t1=Math.max(near,far);
    if(t0>enter){enter=t0;axis=name;sign=velocity>0?-1:1;}
    exit=Math.min(exit,t1);if(enter>exit)return null;
  }
  if(exit<0||enter>1)return null;
  const local={x:axis==='x'?sign:0,y:axis==='y'?sign:0,z:axis==='z'?sign:0};
  return {time:Math.max(0,enter),normal:{x:c*local.x+s*local.z,y:local.y,z:-s*local.x+c*local.z}};
}

/** Physical proportions are adult, stylised to remain readable at city scale. */
const dimensions:Record<PartName, {size:[number,number,number];offset:[number,number,number];mass:number}> = {
  torso:{size:[.16,.23,.115],offset:[0,.32,0],mass:3},
  head:{size:[.105,.125,.105],offset:[0,.495,0],mass:.7},
  leftArm:{size:[.05,.215,.055],offset:[-.12,.32,0],mass:.35},
  rightArm:{size:[.05,.215,.055],offset:[.12,.32,0],mass:.35},
  leftLeg:{size:[.063,.21,.075],offset:[-.049,.105,0],mass:.65},
  rightLeg:{size:[.063,.21,.075],offset:[.049,.105,0],mass:.65},
};

export function createCitizenPhysicsWorld():CANNON.World {
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.82*CITIZEN_SCALE,0),allowSleep:true});
  world.broadphase=new CANNON.SAPBroadphase(world);
  (world.solver as CANNON.GSSolver).iterations=18;
  (world.solver as CANNON.GSSolver).tolerance=.00001;
  world.defaultContactMaterial.friction=.62;
  world.defaultContactMaterial.restitution=.08;
  world.defaultContactMaterial.contactEquationStiffness=1e7;
  world.defaultContactMaterial.contactEquationRelaxation=3;
  return world;
}

/** Six independent rigid bodies, connected by anatomically bounded cone joints. */
export class CitizenRagdoll {
  readonly bodies:Record<PartName,CANNON.Body>;
  readonly constraints:CANNON.ConeTwistConstraint[]=[];
  readonly scale:number;
  private grab:CANNON.Body|null=null;
  private grabJoint:CANNON.PointToPointConstraint|null=null;
  private handTarget=new CANNON.Vec3();
  private handDelta=new CANNON.Vec3();
  private reported=false;
  private released=false;
  private contacted=false;
  private disposed=false;
  private severeVehicleImpact=false;
  age=0;
  private stepHand=():void=>{
    if(!this.grab)return;
    this.handTarget.vsub(this.grab.position,this.handDelta);
    const distance=this.handDelta.length(),maximum=MAX_HAND_SPEED*Math.min(this.world.dt||1/120,.05);
    if(distance>maximum)this.handDelta.scale(maximum/distance,this.handDelta);
    this.grab.position.vadd(this.handDelta,this.grab.position);this.grab.aabbNeedsUpdate=true;
  };

  constructor(private world:CANNON.World, origin:Vec, heading=0, scale=CITIZEN_SCALE, private onImpact?:(hit:Hit)=>void) {
    this.scale=scale;
    this.bodies={} as Record<PartName,CANNON.Body>;
    for(const name of PARTS) {
      const spec=dimensions[name], [sx,sy,sz]=spec.size, [ox,oy,oz]=spec.offset;
      const body=new CANNON.Body({mass:spec.mass,shape:name==='head'?new CANNON.Sphere(.06*scale):new CANNON.Box(new CANNON.Vec3(sx*scale/2,sy*scale/2,sz*scale/2)),
        position:new CANNON.Vec3(origin.x+(ox*Math.cos(heading)+oz*Math.sin(heading))*scale,origin.y+oy*scale,origin.z+(-ox*Math.sin(heading)+oz*Math.cos(heading))*scale),
        linearDamping:.15,angularDamping:.38,collisionFilterGroup:PERSON_GROUP,collisionFilterMask:GROUND_GROUP,allowSleep:true,sleepSpeedLimit:.08,sleepTimeLimit:.6});
      body.quaternion.setFromEuler(0,heading,0);
      body.addEventListener('collide',(event:{contact:CANNON.ContactEquation})=>{
        if(!this.released||this.reported||this.disposed)return;
        this.contacted=true;
        const contact=event.contact,speed=Math.abs(contact.getImpactVelocityAlongNormal());
        if(speed<IMPACT_THRESHOLD&&!(this.severeVehicleImpact&&this.age>.10))return;
        this.reported=true;
        const personFirst=contact.bi===body, surface=personFirst?contact.bj:contact.bi;
        const contactPoint=personFirst?contact.rj:contact.ri;
        const sign=personFirst?-1:1;
        const hit:Hit={point:{x:surface.position.x+contactPoint.x,y:surface.position.y+contactPoint.y,z:surface.position.z+contactPoint.z},
          normal:{x:contact.ni.x*sign,y:contact.ni.y*sign,z:contact.ni.z*sign},speed};
        // Cannon supplies the colliding shapes at runtime (its declaration
        // omits these fields). Fast overlap can select a thin pane's inward
        // separation face; use the authored face on the incoming side for the
        // visible impact, rather than stamping the invisible physics backing.
        const shaped=contact as CANNON.ContactEquation&{si?:CANNON.Shape;sj?:CANNON.Shape};
        const otherShape=personFirst?shaped.sj:shaped.si,pane=otherShape?physicalPaneSurfaces.get(otherShape):undefined;
        if(pane&&Math.abs(hit.normal[pane.axis])>.9&&Math.abs(body.velocity[pane.axis])>.01) {
          const outside=body.velocity[pane.axis]*pane.direction<0;
          hit.point[pane.axis]=surface.position[pane.axis]+(outside?pane.outer:pane.inner);
          hit.normal={x:0,y:0,z:0};hit.normal[pane.axis]=outside?pane.direction:-pane.direction;
        }
        this.onImpact?.(hit);
      });
      this.bodies[name]=body;world.addBody(body);
    }
    const connect=(part:PartName, pivot:[number,number,number], otherPivot:[number,number,number], angle:number, twist:number)=>{
      const joint=new CANNON.ConeTwistConstraint(this.bodies.torso,this.bodies[part],{
        pivotA:new CANNON.Vec3(...pivot.map(v=>v*scale) as [number,number,number]),pivotB:new CANNON.Vec3(...otherPivot.map(v=>v*scale) as [number,number,number]),
        axisA:new CANNON.Vec3(0,1,0),axisB:new CANNON.Vec3(0,1,0),angle,twistAngle:twist,maxForce:900,collideConnected:false,
      });
      this.constraints.push(joint);world.addConstraint(joint);
    };
    connect('head',[0,.12,0],[0,-.055,0],.65,.5);
    connect('leftArm',[-.12,.085,0],[0,.085,0],1.65,1.1);
    connect('rightArm',[.12,.085,0],[0,.085,0],1.65,1.1);
    connect('leftLeg',[-.049,-.11,0],[0,.105,0],1.15,.5);
    connect('rightLeg',[.049,-.11,0],[0,.105,0],1.15,.5);
  }

  hold(target:Vec):void {
    if(this.grab||this.disposed)return;
    this.released=false;
    this.grab=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC,collisionFilterGroup:0,collisionFilterMask:0,position:new CANNON.Vec3(target.x,target.y,target.z)});
    this.handTarget.set(target.x,target.y,target.z);
    this.world.addEventListener('preStep',this.stepHand);
    this.world.addBody(this.grab);
    this.grabJoint=new CANNON.PointToPointConstraint(this.bodies.torso,new CANNON.Vec3(0,0,0),this.grab,new CANNON.Vec3(),1100);
    this.world.addConstraint(this.grabJoint);
  }

  move(target:Vec):void {
    if(!this.grab)return;
    // The hand is speed-limited per physics step, so a long, fast pointer jump
    // cannot stretch the joints or inject hundreds of units/second of energy.
    this.handTarget.set(target.x,target.y,target.z);
    for(const body of Object.values(this.bodies))body.wakeUp();
  }

  release(velocity:Vec):void {
    this.detach();this.released=true;this.age=0;
    const length=Math.hypot(velocity.x,velocity.y,velocity.z),factor=length>MAX_HAND_SPEED?MAX_HAND_SPEED/length:1;
    for(const body of Object.values(this.bodies)) {
      body.velocity.set(velocity.x*factor,velocity.y*factor,velocity.z*factor);body.wakeUp();
    }
  }
  markSevereVehicleImpact():void {this.severeVehicleImpact=true;}

  private detach():void {
    this.world.removeEventListener('preStep',this.stepHand);
    if(this.grabJoint)this.world.removeConstraint(this.grabJoint);
    if(this.grab)this.world.removeBody(this.grab);
    this.grabJoint=null;this.grab=null;
  }

  get position():CANNON.Vec3 {return this.bodies.torso.position;}
  get held():boolean {return !!this.grab;}
  get impacted():boolean {return this.reported;}
  get resting():boolean {
    return this.contacted&&Object.values(this.bodies).every(body=>body.velocity.length()<.24&&body.angularVelocity.length()<1);
  }
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;this.detach();
    for(const joint of this.constraints)this.world.removeConstraint(joint);
    for(const body of Object.values(this.bodies))this.world.removeBody(body);
  }
}

export function isGentleRelease(torso:Vec, groundHeight:number, velocity:Vec, scale=CITIZEN_SCALE):boolean {
  return torso.y-groundHeight<=.32*scale+.12 && Math.hypot(velocity.x,velocity.y,velocity.z)<1.2;
}

export function isCitizenIncidentWitnessed(position:Vec, otherCitizens:readonly Vec[], police:readonly Vec[]):boolean {
  return otherCitizens.some(p=>Math.hypot(p.x-position.x,p.z-position.z)<6 && Math.abs(p.y-position.y)<6)
    ||police.some(p=>Math.hypot(p.x-position.x,p.z-position.z)<7);
}

function roadLinks(state:CityState,tile:Tile):{north:boolean;south:boolean;east:boolean;west:boolean} {
  const connects=(dx:number,dz:number)=>{const x=tile.x+dx,z=tile.z+dz;return x>=0&&z>=0&&x<state.size&&z<state.size&&['road','airport','seaport'].includes(state.tiles[z*state.size+x].kind);};
  const north=connects(0,-1),south=connects(0,1),east=connects(1,0),west=connects(-1,0),isolated=!north&&!south&&!east&&!west;
  return {north:north||isolated,south:south||isolated,east,west};
}

/** Match the visible sidewalk/asphalt/path height, including small curbs. */
export function citizenSurfaceHeight(state:CityState,x:number,z:number):number {
  const gx=Math.floor(x+state.size/2),gz=Math.floor(z+state.size/2),base=Math.max(-.08,sampleGroundHeight(state,x,z));
  if(gx<0||gz<0||gx>=state.size||gz>=state.size)return base;
  const tile=state.tiles[gz*state.size+gx],dx=x-(gx-state.size/2+.5),dz=z-(gz-state.size/2+.5);
  if(tile.kind==='road') {
    const links=roadLinks(state,tile),asphalt=(Math.abs(dx)<=.335&&Math.abs(dz)<=.335)||(Math.abs(dx)<=.335&&(dz<0?links.north:links.south))||(Math.abs(dz)<=.335&&(dx<0?links.west:links.east));
    return base+(asphalt?.0455:.028);
  }
  if(tile.kind==='park')return base+(Math.abs(dx)<=.08||Math.abs(dz)<=.08?.0415:.028);
  return base;
}

export function createGroundCollider(state:CityState,x:number,z:number):CANNON.Body {
  const wx=x-state.size/2+.5,wz=z-state.size/2+.5;
  const tile=state.tiles[z*state.size+x],paved=tile?.kind==='road'||tile?.kind==='park',top=Math.max(-.08,sampleGroundHeight(state,wx,wz))+(paved?.028:0);
  const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(.5,8,.5)),position:new CANNON.Vec3(wx,top-8,wz),collisionFilterGroup:GROUND_GROUP,collisionFilterMask:PERSON_GROUP});
  const slab=(cx:number,cz:number,width:number,depth:number,height:number)=>body.addShape(new CANNON.Box(new CANNON.Vec3(width/2,height/2,depth/2)),new CANNON.Vec3(cx,8+height/2,cz));
  if(tile?.kind==='road') {
    const links=roadLinks(state,tile);slab(0,0,.67,.67,.0175);
    if(links.north)slab(0,-.33,.67,.34,.0175);if(links.south)slab(0,.33,.67,.34,.0175);
    if(links.east)slab(.33,0,.34,.67,.0175);if(links.west)slab(-.33,0,.34,.67,.0175);
  }else if(tile?.kind==='park'){slab(0,0,.16,.92,.0135);slab(0,0,.92,.16,.0135);}
  return body;
}

const structureCache=new Map<string,THREE.Box3[]>();
function buildingBoxes(state:CityState,tile:Tile):THREE.Box3[] {
  if(['empty','tree','water','road','rail','park','rubble'].includes(tile.kind)||(['residential','commercial','industrial'].includes(tile.kind)&&tile.level===0))return [];
  if(tile.anchor>=0&&tile.anchor!==tile.z*state.size+tile.x)return [];
  const key=`${tile.kind}:${tile.level}:${tile.variation}:${tile.rotation}`;
  const cached=structureCache.get(key);if(cached)return cached;
  const model=createTileModel(tile,state),boxes:THREE.Box3[]=[],size=new THREE.Vector3();model.updateMatrixWorld(true);
  // Use actual structural meshes: stadium fields, runways and courtyards stay
  // open. Marked facade glass is solid; lamps and small decorations are ignored.
  model.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||!['BoxGeometry','CylinderGeometry','BufferGeometry'].includes(object.geometry.type))return;
    object.geometry.computeBoundingBox();if(!object.geometry.boundingBox)return;
    const bounds=object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);bounds.getSize(size);
    if(object.userData.glazingPane===true&&size.y>.02&&Math.max(size.x,size.z)>.03) {
      const axis=size.x<=size.z?'x':'z';
      if(size[axis]<.055) {
        let frame:THREE.Object3D|null=object.parent;
        while(frame&&frame!==model&&!frame.userData.glazedStructure)frame=frame.parent;
        const reference=new THREE.Vector3().setFromMatrixPosition((frame??model).matrixWorld),centre=bounds.getCenter(new THREE.Vector3()),extra=Math.max(0,.015-size[axis]),direction=centre[axis]>=reference[axis]?1:-1;
        authoredPaneSurfaces.set(bounds,{axis,direction,outer:direction>0?bounds.max[axis]:bounds.min[axis],inner:direction>0?bounds.min[axis]:bounds.max[axis]});
        // Add physical thickness towards the room, preserving the authored
        // exterior plane so impacts and saved stains land on the glass surface.
        if(direction>0)bounds.min[axis]-=extra;
        else bounds.max[axis]+=extra;
      }
      boxes.push(bounds);return;
    }
    const horizontalSlab=size.y>=.018&&size.x>=.25&&size.z>=.25;
    if((size.y<.09&&!horizontalSlab)||size.x<.055||size.z<.055||size.x*size.y*size.z<.0018)return;
    boxes.push(bounds);
  });
  if(structureCache.size>=128)structureCache.delete(structureCache.keys().next().value!);
  structureCache.set(key,boxes);return boxes;
}

/** A small compound of structural bounds, rather than a solid facility-wide box. */
export function createBuildingCollider(state:CityState,tile:Tile):CANNON.Body|null {
  const boxes=buildingBoxes(state,tile);if(!boxes.length)return null;
  const body=new CANNON.Body({mass:0,position:new CANNON.Vec3(tile.x-state.size/2+.5,tile.elevation,tile.z-state.size/2+.5),collisionFilterGroup:GROUND_GROUP,collisionFilterMask:PERSON_GROUP});
  const center=new THREE.Vector3(),size=new THREE.Vector3();
  for(const box of boxes){box.getCenter(center);box.getSize(size);const shape=new CANNON.Box(new CANNON.Vec3(size.x/2,size.y/2,size.z/2));body.addShape(shape,new CANNON.Vec3(center.x,center.y,center.z));const pane=authoredPaneSurfaces.get(box);if(pane)physicalPaneSurfaces.set(shape,pane);}
  return body;
}

interface PartPose {position:THREE.Vector3;quaternion:THREE.Quaternion;}
interface Recovery {elapsed:number;from:Record<PartName,PartPose>;}
interface Citizen { id:number; position:THREE.Vector3; from:THREE.Vector3; to:THREE.Vector3; previous:number; node:number; progress:number; heading:number; scale:number; pace:number; phase:number; variant:number; ragdoll:CitizenRagdoll|null; recovery:Recovery|null; crossing:boolean;waitUntil:number;dead:boolean; }
interface Held { citizen:Citizen; plane:THREE.Plane; offset:THREE.Vector3; target:THREE.Vector3; last:THREE.Vector3; velocity:THREE.Vector3; lastTime:number; start:THREE.Vector3; }
interface Particle { position:THREE.Vector3; velocity:THREE.Vector3; life:number; color:number; }

export interface CitizenSystem {
  group:THREE.Group;
  update:(state:CityState)=>void;
  animate:(dt:number,walking:boolean)=>void;
  pointerDown:(ray:THREE.Ray,cameraDirection:THREE.Vector3,time:number)=>boolean;
  pointerMove:(ray:THREE.Ray,time:number)=>boolean;
  pointerUp:(time:number)=>boolean;
  cancel:()=>void;
  clearHover:()=>void;
  setEnabled:(enabled:boolean)=>void;
  setUiVisible:(visible:boolean)=>void;
  refreshLocale:()=>void;
  sweepVehicleImpact:(event:CitizenVehicleSweep)=>void;
  notifyObservation:(event:CitizenObservation)=>void;
  readonly holding:boolean;
  readonly cursor:'grab'|'grabbing'|'default';
  getDebug:()=>{count:number;ragdolls:number;recovering:number;held:number|null;hovered:number|null;speech:CitizenSpeech[];positions:{id:number;x:number;y:number;z:number;crossing:boolean;state:'walking'|'held'|'ragdoll'|'recovering'}[]};
  dispose:()=>void;
}

export interface CitizenUiOptions {container:HTMLElement;getCamera:()=>THREE.Camera;}

/** Detailed miniature crowds use 22 draw calls; only active actors enter physics. */
export function createCitizens(initialState:CityState,onIncident?:(incident:Incident)=>void,ui?:CitizenUiOptions):CitizenSystem {
  let state=initialState,enabled=false,elapsed=0,spawnClock=0,sequence=0,held:Held|null=null,hovered:Citizen|null=null,uiVisible=true,nextComment=8,lastObservation=-Infinity;
  const dialogue=new CitizenDialogue();
  const speechSelector=createCitizenSpeechSelector(initialState.seed);
  let nodes:number[]=[],police:THREE.Vector3[]=[],graphSignature='',routeSignature='',decalSignature='';
  let pedestrianGraph:PedestrianGraph=createPedestrianGraph(initialState,[]);
  let previousKinds=initialState.tiles.map(tile=>tile.kind),previousWeather=initialState.settings.weather;
  const actorIndex=new Map<string,Citizen[]>(),vehicleContacts=new Map<number,number>(),observationCooldown=new Map<string,number>(),observationAttempts=new Map<string,number>();
  const vehicleAwareness=new Map<number,{event:CitizenVehicleSweep;time:number}>();
  const nodeSet=new Set<number>(),citizens:Citizen[]=[],pending:{citizen:Citizen;hit:Hit}[]=[],particles:Particle[]=[];
  const group=new THREE.Group();group.name='city-citizens';
  const world=createCitizenPhysicsWorld();
  const statics=new Map<string,{body:CANNON.Body;signature:string}>();
  const cube=new THREE.BoxGeometry(1,1,1),headGeometry=new THREE.SphereGeometry(.5,20,14);
  const hatGeometry=new THREE.LatheGeometry([[0,-.5],[.5,-.5],[.5,-.28],[.37,-.20],[.34,.4],[.25,.5],[0,.5]].map(([x,y])=>new THREE.Vector2(x,y)),12);
  const torsoGeometry=new THREE.CylinderGeometry(.49,.43,1,16),limbGeometry=new THREE.CapsuleGeometry(.5,1,4,10);
  limbGeometry.scale(1,.5,1);
  const shoeGeometry=new RoundedBoxGeometry(1,1,1,2,.19),backpackGeometry=new RoundedBoxGeometry(1,1,1,1,.17);
  const handParts:THREE.BufferGeometry[]=[new THREE.SphereGeometry(.5,10,6).scale(.85,.65,.8).translate(0,.12,0)];
  for(let finger=0;finger<4;finger++)handParts.push(new THREE.CapsuleGeometry(.07,.27-(finger===3?.06:0),2,5).translate(-.27+finger*.18,-.23,0));
  handParts.push(new THREE.CapsuleGeometry(.075,.22,2,5).rotateZ(-.8).translate(.34,.025,0));
  const handGeometry=mergeGeometries(handParts,false)!;for(const part of handParts)part.dispose();
  handGeometry.computeBoundingBox();const handBounds=handGeometry.boundingBox!,handCentre=handBounds.getCenter(new THREE.Vector3()),handSize=handBounds.getSize(new THREE.Vector3());
  handGeometry.translate(-handCentre.x,-handCentre.y,-handCentre.z);handGeometry.scale(1/handSize.x,1/handSize.y,1/handSize.z);
  const rightHandGeometry=handGeometry.clone().rotateY(Math.PI),noseGeometry=new THREE.SphereGeometry(.5,10,8),earGeometry=new THREE.SphereGeometry(.5,10,8),cuffGeometry=new THREE.CylinderGeometry(.5,.5,1,10);
  const hairGeometry=new THREE.SphereGeometry(.5,16,10,0,Math.PI*2,0,Math.PI*.74);
  // Retain the exact previous envelope while replacing boxy hair with a scalp
  // volume. The same capped shape also reads as longer hair behind the head.
  hairGeometry.computeBoundingBox();
  const hairBounds=hairGeometry.boundingBox!,hairCentre=hairBounds.getCenter(new THREE.Vector3()),hairSize=hairBounds.getSize(new THREE.Vector3());
  hairGeometry.translate(-hairCentre.x,-hairCentre.y,-hairCentre.z);hairGeometry.scale(1/hairSize.x,1/hairSize.y,1/hairSize.z);
  const sharedMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.82});
  const slots=['torso','head','leftArm','rightArm','leftLeg','rightLeg','hat','hair','nose','leftEye','rightEye','backpack','leftShoe','rightShoe','shirtFront','collar','leftHand','rightHand','leftEar','rightEar','leftCuff','rightCuff'] as const;
  const meshes=new Map<string,THREE.InstancedMesh>();
  for(const name of slots) {
    const geometry=name==='head'?headGeometry:name==='hat'?hatGeometry:name==='torso'?torsoGeometry:name==='hair'?hairGeometry:name==='backpack'?backpackGeometry:name==='nose'||name.endsWith('Eye')?noseGeometry:name.endsWith('Shoe')?shoeGeometry:name==='leftHand'?handGeometry:name==='rightHand'?rightHandGeometry:name.endsWith('Ear')?earGeometry:name.endsWith('Cuff')?cuffGeometry:name.includes('Arm')||name.includes('Leg')?limbGeometry:cube;
    const mesh=new THREE.InstancedMesh(geometry,sharedMaterial,MAX_CITIZENS);
    mesh.name=`citizen-${name}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;
    meshes.set(name,mesh);group.add(mesh);
  }
  const splatMaterial=new THREE.MeshStandardMaterial({color:0x752b2a,roughness:.67,metalness:0,polygonOffset:true,polygonOffsetFactor:-.3,polygonOffsetUnits:-.3});
  const decals=new THREE.Group();decals.name='persistent-citizen-splatters';group.add(decals);
  const particleGeometry=new THREE.IcosahedronGeometry(.5,0),particleMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.55});
  const particleMesh=new THREE.InstancedMesh(particleGeometry,particleMaterial,256);particleMesh.count=0;particleMesh.frustumCulled=false;particleMesh.userData.raytracingExclude=true;group.add(particleMesh);
  const dummy=new THREE.Object3D(),color=new THREE.Color(),local=new THREE.Vector3(),axisY=new THREE.Vector3(0,1,0),axisZ=new THREE.Vector3(0,0,1);
  const shirts=[0x9e6948,0x3f7181,0xb5a05b,0x686282,0x995e67,0x647b5c,0xd8cdb3,0x42566e];
  const skins=[0xf0bd94,0xc8845e,0x8f5941,0xe2a877,0x633f32];
  const trousers=[0x354959,0x6f6954,0x6c5577,0x454d4c];
  const hairs=[0x42342c,0xcc995a,0x817976,0x633e2e];

  function say(citizen:Citizen,topic:CitizenDialogueTopic,kind:CitizenSpeechKind):boolean {
    if(citizen.dead||!dialogue.canSpeak(citizen.id,kind,elapsed))return false;
    if((kind==='idle'||kind==='observation')&&!onScreen(citizen))return false;
    return dialogue.speak(citizen.id,speechSelector.pickPair(topic,citizen.id),kind,elapsed);
  }
  function onScreen(citizen:Citizen):boolean {
    if(!ui)return true;
    const p=headPosition(citizen).project(ui.getCamera());return p.z>=-1&&p.z<=1&&Math.abs(p.x)<.97&&Math.abs(p.y)<.97;
  }
  function ambientTopic(citizen:Citizen):CitizenDialogueTopic {
    const topics:CitizenDialogueTopic[]=['everyday','everyday',citizenContextTopic(state,citizen.position)];
    const gx=Math.floor(citizen.position.x+state.size/2),gz=Math.floor(citizen.position.z+state.size/2);
    for(let z=Math.max(0,gz-3);z<=Math.min(state.size-1,gz+3);z++)for(let x=Math.max(0,gx-3);x<=Math.min(state.size-1,gx+3);x++) {
      const tile=state.tiles[z*state.size+x];let topic:CitizenDialogueTopic|undefined;
      if(tile.fire>0)topic='fire';else if(tile.kind==='tree')topic='trees';else if(tile.kind==='park')topic='park';else if(tile.kind==='water')topic='water';else if(tile.kind==='industrial')topic='industry';else if(tile.kind==='stadium')topic='stadium';else if(tile.kind==='airport')topic='airport';else if(['police','fire','hospital','school','university'].includes(tile.kind))topic='services';
      if(topic&&!topics.includes(topic))topics.push(topic);
    }
    if(state.settings.weather==='clear'&&state.settings.timeOfDay>=7&&state.settings.timeOfDay<19)topics.push('sun');
    return topics[Math.floor(random(elapsed*7+citizen.id)*topics.length)];
  }
  function actorTorso(citizen:Citizen):THREE.Vector3 {
    if(citizen.ragdoll){const p=citizen.ragdoll.position;return new THREE.Vector3(p.x,p.y,p.z);}
    if(citizen.recovery)return recoveryPose(citizen,'torso').position;
    return citizen.position.clone().add(new THREE.Vector3(0,.32*citizen.scale,0));
  }
  function rebuildActorIndex():void {
    actorIndex.clear();
    for(const citizen of citizens)if(!citizen.dead){const p=actorTorso(citizen),key=`${Math.floor(p.x)}:${Math.floor(p.z)}`,bucket=actorIndex.get(key)??[];bucket.push(citizen);actorIndex.set(key,bucket);}
  }
  function notifyObservation(event:CitizenObservation):void {
    if(elapsed-lastObservation<.9&&!['carCrash','personHit','fire'].includes(event.topic))return;
    const key=event.id!==undefined?`${event.topic}:${event.id}`:`${event.topic}:${Math.round(event.position.x)}:${Math.round(event.position.z)}`;
    if(elapsed-(observationCooldown.get(key)??-Infinity)<9)return;
    if(elapsed-(observationAttempts.get(key)??-Infinity)<.5)return;observationAttempts.set(key,elapsed);
    const point=new THREE.Vector3(event.position.x,event.position.y,event.position.z);
    const range=['fastCar','drift','carCrash','personHit','nearMiss','traffic'].includes(event.topic)?3.5:6;
    const candidate=citizens.filter(c=>!c.dead&&!c.ragdoll&&!c.recovery&&c.position.distanceTo(point)<range&&dialogue.canSpeak(c.id,'observation',elapsed)&&onScreen(c)).sort((a,b)=>a.position.distanceToSquared(point)-b.position.distanceToSquared(point))[0];
    if(candidate&&say(candidate,event.topic,'observation')){observationCooldown.set(key,elapsed);lastObservation=elapsed;}
    if(observationCooldown.size>256)for(const [id,time]of observationCooldown)if(elapsed-time>30)observationCooldown.delete(id);
    if(observationAttempts.size>256)for(const [id,time]of observationAttempts)if(elapsed-time>10)observationAttempts.delete(id);
  }

  function crosswalkHasTraffic(citizen:Citizen):boolean {
    if(!citizen.crossing||citizen.progress>.045)return false;
    for(const {event,time}of vehicleAwareness.values()) {
      if(elapsed-time>.6||Math.hypot(event.velocity.x,event.velocity.z)<.08)continue;
      if(Math.hypot(event.current.x-citizen.from.x,event.current.z-citizen.from.z)>3.5)continue;
      const future={...event,previous:event.current,current:{x:event.current.x+event.velocity.x*2.7,y:event.current.y,z:event.current.z+event.velocity.z*2.7}};
      for(const t of [.2,.5,.8]){const p=citizen.from.clone().lerp(citizen.to,t);p.y+=.32*citizen.scale;if(sweepVehicleFootprint(p,future,.04))return true;}
    }
    return false;
  }

  function sweepVehicleImpact(event:CitizenVehicleSweep):void {
    const speed=Math.hypot(event.velocity.x,event.velocity.z);
    if(!Number.isFinite(speed)||![event.width,event.length,event.yaw,event.current.x,event.current.y,event.current.z,event.previous.x,event.previous.y,event.previous.z].every(Number.isFinite)||event.width<=0||event.length<=0)return;
    vehicleAwareness.set(event.vehicleId,{event,time:elapsed});
    if(vehicleAwareness.size>192)for(const [id,value]of vehicleAwareness)if(elapsed-value.time>1)vehicleAwareness.delete(id);
    if(speed<.08)return;
    const padding=Math.hypot(event.width,event.length)/2+.8,candidates=new Set<Citizen>();
    for(let z=Math.floor(Math.min(event.previous.z,event.current.z)-padding);z<=Math.floor(Math.max(event.previous.z,event.current.z)+padding);z++)for(let x=Math.floor(Math.min(event.previous.x,event.current.x)-padding);x<=Math.floor(Math.max(event.previous.x,event.current.x)+padding);x++)for(const citizen of actorIndex.get(`${x}:${z}`)??[])candidates.add(citizen);
    for(const citizen of candidates) {
      if(citizen.dead||held?.citizen===citizen)continue;
      const torso=actorTorso(citizen),hit=sweepVehicleFootprint(torso,event,.025);
      if(!hit||event.trafficOnly) {
        if(speed>=.4&&sweepVehicleFootprint(torso,event,.15)){
          if(event.trafficOnly&&!hit)notifyObservation({topic:'traffic',position:event.current,id:event.vehicleId});else say(citizen,'nearMiss','nearMiss');
          if(citizen.crossing&&citizen.progress<.045)citizen.waitUntil=Math.max(citizen.waitUntil,elapsed+.45);
        }
        continue;
      }
      if(elapsed-(vehicleContacts.get(citizen.id)??-Infinity)<.85)continue;
      vehicleContacts.set(citizen.id,elapsed);
      if(speed<.12){say(citizen,'nearMiss','nearMiss');continue;}
      if(!citizen.ragdoll) {
        const active=citizens.filter(c=>c.ragdoll&&!c.dead);if(active.length>=MAX_RAGDOLLS){say(citizen,'nearMiss','nearMiss');continue;}
        citizen.recovery=null;
        const origin=new THREE.Vector3(torso.x,ground(torso.x,torso.z)+.006,torso.z);
        citizen.ragdoll=new CitizenRagdoll(world,origin,citizen.heading,citizen.scale,impact=>pending.push({citizen,hit:impact}));
      }
      const impulse={x:event.velocity.x*.9,y:.22+Math.min(1,speed*.34),z:event.velocity.z*.9};
      citizen.ragdoll.release(impulse);
      if(speed>=SEVERE_VEHICLE_IMPACT_SPEED)citizen.ragdoll.markSevereVehicleImpact();
      say(citizen,'personHit','vehicle');witnessReaction(citizen,torso,'personHit');
    }
    if(!event.trafficOnly&&speed>1.08)notifyObservation({topic:'fastCar',position:event.current,id:event.vehicleId});
    const lateral=event.velocity.x*Math.cos(event.yaw)-event.velocity.z*Math.sin(event.yaw);
    if(!event.trafficOnly&&speed>.65&&Math.abs(lateral)>speed*.48)notifyObservation({topic:'drift',position:event.current,id:event.vehicleId});
  }

  // Pixel-sized UI remains readable in both orthographic and chase cameras.
  // The optional camera getter is first called from animate(), after scene setup.
  const overlay=ui&&typeof document!=='undefined'?document.createElement('div'):null;
  let handBadge:HTMLDivElement|null=null;
  const bubbleNodes=new Map<number,{element:HTMLDivElement;label:HTMLSpanElement;tail:HTMLSpanElement;text:string;width:number;height:number;maxWidth:number}>();
  if(overlay&&ui) {
    overlay.className='citizen-feedback';overlay.setAttribute('aria-hidden','true');
    overlay.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6;';
    handBadge=document.createElement('div');handBadge.className='citizen-grab-marker';
    handBadge.style.cssText='position:absolute;display:none;width:24px;height:24px;box-sizing:border-box;padding:4px;background:rgba(32,51,56,.88);border:1px solid rgba(255,255,255,.5);border-radius:6px;color:#fff8eb;box-shadow:0 2px 6px #15262b33;transform:translate(-50%,-100%);pointer-events:none;';
    handBadge.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M8 13V5a2 2 0 0 1 4 0v7-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v7c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-5a2 2 0 0 1 3-2l1 2Z"/></svg>';
    overlay.appendChild(handBadge);ui.container.appendChild(overlay);
  }

  function recoveryPose(citizen:Citizen,name:PartName):PartPose {
    const recovery=citizen.recovery!,time=recovery.elapsed,heading=new THREE.Quaternion().setFromAxisAngle(axisY,citizen.heading);
    const floorPose=(stage:'prone'|'kneel'|'stand'):PartPose=>{
      let offset:[number,number,number]=dimensions[name].offset,angle=0;
      if(stage==='prone') {
        const offsets:Record<PartName,[number,number,number]>={torso:[0,.072,0],head:[0,.072,.175],leftArm:[-.12,.038,.025],rightArm:[.12,.038,.025],leftLeg:[-.049,.043,-.20],rightLeg:[.049,.043,-.20]};
        offset=offsets[name];angle=Math.PI/2;
      }else if(stage==='kneel') {
        const offsets:Record<PartName,[number,number,number]>={torso:[0,.22,.015],head:[0,.391,.075],leftArm:[-.105,.135,.08],rightArm:[.105,.135,.08],leftLeg:[-.049,.076,-.053],rightLeg:[.049,.076,-.053]};
        offset=offsets[name];angle=name==='torso'?-.30:name==='head'?-.10:name.includes('Arm')?-.85:1.10;
      }
      return {position:new THREE.Vector3(...offset).multiplyScalar(citizen.scale).applyQuaternion(heading).add(citizen.position),quaternion:heading.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle))};
    };
    const start=time<.5?recovery.from[name]:floorPose(time<1.2?'prone':'kneel'),end=floorPose(time<.5?'prone':time<1.2?'kneel':'stand');
    const raw=clamp(time<.5?time/.5:time<1.2?(time-.5)/.7:(time-1.2)/(GET_UP_SECONDS-1.2),0,1),t=raw*raw*(3-2*raw);
    return {position:start.position.clone().lerp(end.position,t),quaternion:start.quaternion.clone().slerp(end.quaternion,t)};
  }

  function headPosition(citizen:Citizen):THREE.Vector3 {
    if(citizen.ragdoll){const p=citizen.ragdoll.bodies.head.position;return new THREE.Vector3(p.x,p.y,p.z);}
    if(citizen.recovery)return recoveryPose(citizen,'head').position;
    return citizen.position.clone().add(new THREE.Vector3(0,.55*citizen.scale,0));
  }

  function updateUi():void {
    if(!overlay||!ui)return;
    overlay.style.display=uiVisible?'block':'none';if(!uiVisible)return;
    const camera=ui.getCamera(),width=ui.container.clientWidth,height=ui.container.clientHeight;
    const project=(citizen:Citizen,element:HTMLElement,offset:number)=>{
      const point=headPosition(citizen).project(camera);
      const visible=point.z>=-1&&point.z<=1&&Math.abs(point.x)<1.08&&Math.abs(point.y)<1.08;
      element.style.display=visible?'block':'none';
      if(visible){element.style.left=`${(point.x*.5+.5)*width}px`;element.style.top=`${(-point.y*.5+.5)*height-offset}px`;}
    };
    const selected=held?.citizen??hovered;
    if(handBadge){if(enabled&&selected&&!selected.dead)project(selected,handBadge,12);else handBadge.style.display='none';}
    const active=dialogue.getActive(elapsed),ids=new Set(active.map(speech=>speech.actorId));
    for(const [id,node]of bubbleNodes)if(!ids.has(id)){node.element.remove();bubbleNodes.delete(id);}
    for(const speech of active) {
      const citizen=citizens.find(actor=>actor.id===speech.actorId&&!actor.dead);if(!citizen)continue;
      let node=bubbleNodes.get(speech.actorId);
      if(!node) {
        const element=document.createElement('div'),label=document.createElement('span'),tail=document.createElement('span');
        element.className='citizen-speech';element.style.cssText='position:absolute;width:max-content;max-width:188px;box-sizing:border-box;white-space:normal;overflow-wrap:break-word;padding:7px 10px;background:rgba(255,251,243,.96);color:#253d42;border:1px solid #d4d9ce;border-radius:9px 9px 9px 2px;box-shadow:0 3px 9px #17333924;font:500 12px/1.35 "DM Sans",system-ui,sans-serif;transform:translate(-50%,-100%);pointer-events:none;';
        tail.style.cssText='position:absolute;bottom:-4px;left:12px;width:6px;height:6px;background:#fffbf3;border-right:1px solid #d4d9ce;border-bottom:1px solid #d4d9ce;transform:rotate(45deg);';
        element.append(label,tail);overlay.appendChild(element);node={element,label,tail,text:'',width:0,height:0,maxWidth:0};bubbleNodes.set(speech.actorId,node);
      }
      const projected=headPosition(citizen).project(camera),visible=projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<1.08&&Math.abs(projected.y)<1.08;
      node.element.style.display=visible?'block':'none';if(!visible)continue;
      const maxWidth=Math.max(32,Math.min(188,width-16));
      // Content width does not depend on the actor's distance from the screen
      // edge. Measure only new text or a changed viewport width, not every frame.
      if(node.text!==speech.text||node.maxWidth!==maxWidth||!node.width) {
        if(node.text!==speech.text){node.label.textContent=speech.text;node.text=speech.text;}
        if(node.maxWidth!==maxWidth){node.element.style.maxWidth=`${maxWidth}px`;node.maxWidth=maxWidth;}
        node.width=node.element.offsetWidth;node.height=node.element.offsetHeight;
      }
      if(node.element.dataset.reaction!==speech.kind)node.element.dataset.reaction=speech.kind;
      const actorX=(projected.x*.5+.5)*width,actorY=(-projected.y*.5+.5)*height,offset=selected?.id===citizen.id?45:16;
      const half=node.width/2,centreX=clamp(actorX,Math.min(half+8,width/2),Math.max(width-half-8,width/2));
      let bottom=actorY-offset;
      if(bottom<node.height+8)bottom=actorY+offset+node.height;
      bottom=clamp(bottom,Math.min(node.height+8,height-8),Math.max(8,height-8));
      node.element.style.left=`${centreX}px`;node.element.style.top=`${bottom}px`;
      node.tail.style.left=`${clamp(actorX-(centreX-half)-3,8,Math.max(8,node.width-14))}px`;
      const pointsUp=actorY<bottom-node.height;
      node.tail.style.top=pointsUp?'-4px':'auto';node.tail.style.bottom=pointsUp?'auto':'-4px';node.tail.style.transform=pointsUp?'rotate(225deg)':'rotate(45deg)';
      node.element.style.opacity=`${Math.min(1,(speech.expiresAt-elapsed)/.35)}`;
    }
  }

  function witnessReaction(subject:Citizen,position:Vec,topic:CitizenDialogueTopic='witness'):void {
    const witness=citizens.filter(c=>c!==subject&&!c.dead&&!c.ragdoll&&!c.recovery&&c.position.distanceTo(new THREE.Vector3(position.x,position.y,position.z))<6)
      .sort((a,b)=>a.position.distanceToSquared(subject.position)-b.position.distanceToSquared(subject.position))[0];
    if(witness)say(witness,topic,'witness');
  }

  function ground(x:number,z:number):number {
    return citizenSurfaceHeight(state,x,z)+.0012;
  }
  function nodePoint(index:number,id:number):THREE.Vector3 {
    const node=pedestrianGraph.byId.get(index);void id;
    return node?new THREE.Vector3(node.x,ground(node.x,node.z),node.z):new THREE.Vector3();
  }
  function nearestWalkNode(x:number,z:number,preferred?:number):number|null {
    const nearest=pedestrianGraph.nearest(x,z,preferred);
    if(nearest!==null&&nodeSet.has(nearest))return nearest;
    // A clipped active area can contain an isolated inside corner. Do not
    // attach a returning resident to a node from which no walking edge exists.
    let best:number|null=null,distance=Infinity;
    for(const id of nodes){const point=pedestrianGraph.byId.get(id)!,d=(point.x-x)**2+(point.z-z)**2;if(d<distance){best=id;distance=d;}}
    return best;
  }
  function nextNode(citizen:Citizen):void {
    if(!nodeSet.has(citizen.node)) {
      citizen.node=nearestWalkNode(citizen.position.x,citizen.position.z)??nodes[0]??0;
      citizen.from.copy(citizen.position);citizen.to.copy(nodePoint(citizen.node,citizen.id));citizen.progress=0;return;
    }
    const nearby=pedestrianGraph.neighbors(citizen.node),onward=nearby.filter(edge=>edge.node!==citizen.previous),all=onward.length?onward:nearby;
    const pavement=all.filter(edge=>!edge.crosswalk),choices=pavement.length&&random(citizen.id+elapsed)<.84?pavement:all;
    const selected=choices[Math.floor(random(citizen.id+Math.floor(elapsed*9)+citizen.node)*choices.length)],next=selected?.node??citizen.node;
    citizen.crossing=selected?.crosswalk??false;
    citizen.previous=citizen.node;citizen.node=next;citizen.from.copy(citizen.position);citizen.to.copy(nodePoint(next,citizen.id));citizen.progress=0;
  }
  function spawn():void {
    const target=Math.min(MAX_CITIZENS,state.stats.population,Math.max(state.stats.population>0?24:0,Math.ceil(state.stats.population/28)));
    while(citizens.length<target&&nodes.length) {
      const id=++sequence,node=nodes[Math.floor(random(id*7+state.seed)*nodes.length)],position=nodePoint(node,id);
      const citizen:Citizen={id,node,previous:-1,position,from:position.clone(),to:position.clone(),progress:0,heading:random(id)*Math.PI*2,scale:CITIZEN_SCALE*(.96+random(id*11)*.055),pace:.11+random(id*31)*.05,phase:random(id*43)*6.3,variant:id%120,ragdoll:null,recovery:null,crossing:false,waitUntil:0,dead:false};
      citizens.push(citizen);nextNode(citizen);citizen.progress=random(id*53);
      citizen.position.lerpVectors(citizen.from,citizen.to,citizen.progress);
    }
    if(citizens.length>target)for(let i=citizens.length-1;i>=0&&citizens.length>target;i--)if(!citizens[i].ragdoll&&!citizens[i].recovery){dialogue.forget(citizens[i].id);citizens.splice(i,1);}
  }
  function rebuildNodes():void {
    // Restrict crowds to roads and parks near occupied lots; wilderness roads stay quiet.
    const active=new Set<number>();
    for(const tile of state.tiles)if(['residential','commercial','industrial'].includes(tile.kind)&&tile.level>0) {
      for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++){const x=tile.x+dx,z=tile.z+dz;if(x>=0&&z>=0&&x<state.size&&z<state.size)active.add(z*state.size+x);}
    }
    const activeTiles=state.tiles.filter(t=>(t.kind==='road'||t.kind==='park')&&t.elevation>=0&&t.fire===0&&active.has(t.z*state.size+t.x)).map(t=>t.z*state.size+t.x);
    let checksum=2166136261;
    for(const index of activeTiles){const tile=state.tiles[index];checksum=Math.imul(checksum^index,16777619);checksum=Math.imul(checksum^Math.round(tile.elevation*10),16777619);checksum=Math.imul(checksum^(tile.kind==='park'?1:0),16777619);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=tile.x+dx,z=tile.z+dz;checksum=Math.imul(checksum^(x>=0&&z>=0&&x<state.size&&z<state.size&&['road','airport','seaport'].includes(state.tiles[z*state.size+x].kind)?1:0),16777619);}}
    const newRouteSignature=`${state.size}:${activeTiles.length}:${checksum}`;
    if(newRouteSignature!==routeSignature){pedestrianGraph=createPedestrianGraph(state,activeTiles);routeSignature=newRouteSignature;}
    nodes=pedestrianGraph.nodes.filter(node=>pedestrianGraph.neighbors(node.id).length>0).map(node=>node.id);
    nodeSet.clear();for(const node of nodes)nodeSet.add(node);
    police=state.tiles.filter(t=>t.kind==='police'&&(t.anchor<0||t.anchor===t.z*state.size+t.x)).map(t=>new THREE.Vector3(t.x-state.size/2+1,t.elevation,t.z-state.size/2+1));
    for(const citizen of citizens)if(!citizen.ragdoll&&!citizen.recovery&&!nodeSet.has(citizen.node)&&nodes.length)nextNode(citizen);
  }
  function updateDecals():void {
    const incidents=state.citizenEffects?.incidents??[],key=incidents.map(i=>`${i.id}:${i.x}:${i.y}:${i.z}`).join('|');
    if(key===decalSignature)return;decalSignature=key;
    for(const child of [...decals.children]){(child as THREE.Mesh).geometry.dispose();decals.remove(child);}
    for(const incident of incidents.slice(-64)) {
      if(incident.kind!=='impact')continue;
      const shape=new THREE.Shape(),count=44,shapes:THREE.Shape[]=[shape],seed=incident.id*37;
      for(let i=0;i<count;i++) {
        const angle=i/count*Math.PI*2,radius=.049+random(seed+i)*.029+(i%9===0?.022:0);
        const x=Math.cos(angle)*radius*1.12,y=Math.sin(angle)*radius*.77;
        if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);
      }
      shape.closePath();
      // Sparse tiny satellite droplets and two thin smears, all in one mesh.
      for(let drop=0;drop<18;drop++) {
        const angle=random(seed+drop*11)*Math.PI*2,distance=.067+random(seed+drop*19)*.081,radius=.0025+random(seed+drop*23)*.006;
        const cx=Math.cos(angle)*distance,cy=Math.sin(angle)*distance*.76,droplet=new THREE.Shape();
        for(let n=0;n<7;n++){const a=n/7*Math.PI*2,r=radius*(.72+random(seed+drop+n)*.45),x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;if(n===0)droplet.moveTo(x,y);else droplet.lineTo(x,y);}droplet.closePath();shapes.push(droplet);
      }
      for(let smear=0;smear<2;smear++) {
        const sign=smear?1:-1,streak=new THREE.Shape();streak.moveTo(sign*.035,-.006);streak.lineTo(sign*.126,.008);streak.lineTo(sign*.067,.006);streak.lineTo(sign*.045,.012);streak.closePath();shapes.push(streak);
      }
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shapes),splatMaterial),normal=new THREE.Vector3(incident.nx,incident.ny,incident.nz).normalize();
      mesh.quaternion.setFromUnitVectors(axisZ,normal);mesh.position.set(incident.x-state.size/2,incident.y,incident.z-state.size/2).addScaledVector(normal,.0012);
      // Ground marks follow the actual local pavement/terrain, rather than
      // hovering as a flat disk across curb edges. Walls keep their contact plane.
      if(normal.y>.7&&Math.abs(incident.y-citizenSurfaceHeight(state,mesh.position.x,mesh.position.z))<.12) {
        const positions=mesh.geometry.getAttribute('position'),inverse=mesh.quaternion.clone().invert(),vertex=new THREE.Vector3();
        for(let i=0;i<positions.count;i++){vertex.fromBufferAttribute(positions,i).applyQuaternion(mesh.quaternion).add(mesh.position);vertex.y=citizenSurfaceHeight(state,vertex.x,vertex.z)+.0012;vertex.sub(mesh.position).applyQuaternion(inverse);positions.setXYZ(i,vertex.x,vertex.y,vertex.z);}
        positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
      }
      mesh.name=`citizen-splatter-${incident.id}`;mesh.receiveShadow=true;decals.add(mesh);
    }
  }
  function update(next:CityState):void {
    if(next!==state) {
      // Loading, undoing or starting another city must never carry live throws
      // into that city's population, even when the renderer is reused.
      for(const citizen of citizens)citizen.ragdoll?.dispose();
      citizens.length=0;pending.length=0;particles.length=0;held=null;hovered=null;
      for(const value of statics.values())world.removeBody(value.body);statics.clear();
      sequence=0;spawnClock=0;graphSignature='';routeSignature='';dialogue.clear();speechSelector.clear();vehicleContacts.clear();observationCooldown.clear();observationAttempts.clear();vehicleAwareness.clear();actorIndex.clear();nextComment=elapsed+8;lastObservation=-Infinity;previousKinds=next.tiles.map(tile=>tile.kind);previousWeather=next.settings.weather;
    }
    state=next;
    // Revision changes during simulation include growth/road edits; lightweight graph
    // construction occurs on state updates, never once per rendered frame.
    const key=`${state.revision}:${state.stats.population}:${state.size}`;
    if(key!==graphSignature){graphSignature=key;rebuildNodes();if(!sequence||spawnClock>18){spawn();spawnClock=0;}}
    let observations=0;
    for(let i=0;i<state.tiles.length;i++){const tile=state.tiles[i],before=previousKinds[i];if(before!==undefined&&before!==tile.kind&&observations<4){notifyObservation({topic:['empty','rubble'].includes(tile.kind)?'demolition':tile.kind==='tree'?'trees':tile.kind==='park'?'park':'construction',position:{x:tile.x-state.size/2+.5,y:tile.elevation,z:tile.z-state.size/2+.5},id:`${state.revision}:${i}`});observations++;}previousKinds[i]=tile.kind;}
    if(previousWeather!==state.settings.weather){const citizen=citizens.find(c=>!c.dead&&!c.ragdoll);if(citizen)say(citizen,state.settings.weather==='rain'?'rain':'sun','observation');previousWeather=state.settings.weather;}
    updateDecals();renderCitizens();rebuildActorIndex();
  }

  function ensureColliders():void {
    const required=new Set<string>();
    for(const citizen of citizens)if(citizen.ragdoll) {
      const p=citizen.ragdoll.position,gx=Math.floor(p.x+state.size/2),gz=Math.floor(p.z+state.size/2);
      for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++) {
        const x=gx+dx,z=gz+dz;
        if(x<0||z<0||x>=state.size||z>=state.size)continue;
        const tile=state.tiles[z*state.size+x],key=`g:${x}:${z}`,signature=`${tile.elevation}:${tile.kind}:${state.revision}`;
        required.add(key);
        if(statics.get(key)?.signature!==signature){const old=statics.get(key);if(old)world.removeBody(old.body);const body=createGroundCollider(state,x,z);statics.set(key,{body,signature});world.addBody(body);}
        const anchor=tile.anchor>=0?state.tiles[tile.anchor]:tile,buildingKey=`b:${anchor.x}:${anchor.z}`,buildingSignature=`${anchor.kind}:${anchor.level}:${anchor.elevation}:${anchor.rotation}:${anchor.variation}`;
        required.add(buildingKey);
        if(statics.get(buildingKey)?.signature!==buildingSignature){const old=statics.get(buildingKey);if(old)world.removeBody(old.body);statics.delete(buildingKey);const body=createBuildingCollider(state,anchor);if(body){statics.set(buildingKey,{body,signature:buildingSignature});world.addBody(body);}}
      }
    }
    for(const [key,value]of statics)if(!required.has(key)){world.removeBody(value.body);statics.delete(key);}
  }

  function recover(citizen:Citizen,preferred?:Vec,animated=false):void {
    const physicalPose=animated&&citizen.ragdoll?Object.fromEntries(PARTS.map(name=>{const body=citizen.ragdoll!.bodies[name];return [name,{position:new THREE.Vector3(body.position.x,body.position.y,body.position.z),quaternion:new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w)}];})) as Record<PartName,PartPose>:null;
    const p=preferred??citizen.ragdoll?.position??citizen.position;
    let x=clamp(p.x,-state.size/2+.1,state.size/2-.1),z=clamp(p.z,-state.size/2+.1,state.size/2-.1);
    const tile=state.tiles[Math.floor(z+state.size/2)*state.size+Math.floor(x+state.size/2)];
    const node=nearestWalkNode(x,z,citizen.node)??citizen.node,nearest=nodes.length?Math.hypot(nodePoint(node,citizen.id).x-x,nodePoint(node,citizen.id).z-z):Infinity;
    // Always reconnect at the landing neighbourhood, not the original route.
    // A remote roof/field drop returns to the nearest safe sidewalk.
    if(nodes.length) {
      citizen.node=node;citizen.previous=-1;
      if(!tile||!['empty','road','park'].includes(tile.kind)||tile.elevation<0||nearest>.8){const point=nodePoint(node,citizen.id);x=point.x;z=point.z;}
    }
    citizen.ragdoll?.dispose();citizen.ragdoll=null;citizen.position.set(x,ground(x,z),z);
    citizen.recovery=physicalPose?{elapsed:0,from:physicalPose}:null;
    citizen.from.copy(citizen.position);citizen.to.copy(citizen.position);citizen.progress=1;
    if(nodes.length){citizen.to.copy(nodePoint(citizen.node,citizen.id));citizen.progress=0;if(citizen.position.distanceTo(citizen.to)<.08)nextNode(citizen);}
    if(physicalPose){say(citizen,'recovery','recovery');witnessReaction(citizen,citizen.position);}
  }
  function incident(citizen:Citizen,kind:'impact'|'abduction',point:Vec,normal:Vec):void {
    if(citizen.dead)return;witnessReaction(citizen,point);citizen.dead=true;dialogue.forget(citizen.id);speechSelector.forget(citizen.id);vehicleContacts.delete(citizen.id);
    const witnessed=isCitizenIncidentWitnessed(point,citizens.filter(c=>c!==citizen&&!c.dead).map(c=>c.ragdoll?.position??c.position),police);
    citizen.ragdoll?.dispose();citizen.ragdoll=null;
    if(held?.citizen===citizen)held=null;if(hovered===citizen)hovered=null;
    if(kind==='impact')for(let i=0;i<16;i++) {
      const angle=random(citizen.id*4+i)*Math.PI*2,radius=.18+random(i*13+citizen.id)*.35;
      particles.push({position:new THREE.Vector3(point.x,point.y,point.z).addScaledVector(new THREE.Vector3(normal.x,normal.y,normal.z),.008),
        velocity:new THREE.Vector3(Math.cos(angle)*radius,.18+random(i*19)*.32,Math.sin(angle)*radius).addScaledVector(new THREE.Vector3(normal.x,normal.y,normal.z),.22),life:.18+random(i*37)*.24,color:i%3?0x7f302d:0x4b2426});
    }
    onIncident?.({x:clamp(point.x+state.size/2,0,state.size-.001),y:clamp(point.y,-15,127),z:clamp(point.z+state.size/2,0,state.size-.001),nx:normal.x,ny:normal.y,nz:normal.z,witnessed,kind});
    spawnClock=0;
  }
  function choose(ray:THREE.Ray):Citizen|null {
    let best:Citizen|null=null,distance=Infinity;
    for(const citizen of citizens)if(!citizen.dead&&!citizen.ragdoll&&!citizen.recovery) {
      local.copy(citizen.position);local.y+=.31*citizen.scale;
      const along=ray.direction.dot(local.clone().sub(ray.origin));
      if(along<0||along>distance||ray.distanceSqToPoint(local)>CITIZEN_PICK_RADIUS**2)continue;
      best=citizen;distance=along;
    }
    if(!best)return null;
    // Sampling the ray's crossed grid cells is bounded, and structural bounds
    // are cached. Hidden residents cannot be selected through houses or hills.
    const checked=new Set<number>(),point=new THREE.Vector3(),hit=new THREE.Vector3(),offset=new THREE.Vector3(),box=new THREE.Box3();
    const end=Math.max(0,distance-.25*best.scale);
    for(let along=0;along<end;along+=.45) {
      ray.at(along,point);const x=Math.floor(point.x+state.size/2),z=Math.floor(point.z+state.size/2);
      if(x<0||z<0||x>=state.size||z>=state.size)continue;
      if(point.y<ground(point.x,point.z)-.035)return null;
      const tile=state.tiles[z*state.size+x],anchor=tile.anchor>=0?state.tiles[tile.anchor]:tile,index=anchor.z*state.size+anchor.x;
      if(checked.has(index))continue;checked.add(index);
      offset.set(anchor.x-state.size/2+.5,anchor.elevation,anchor.z-state.size/2+.5);
      for(const structuralBox of buildingBoxes(state,anchor)) {
        box.copy(structuralBox).translate(offset);
        if(ray.intersectBox(box,hit)&&hit.distanceTo(ray.origin)<end)return null;
      }
    }
    return best;
  }
  function pointerDown(ray:THREE.Ray,cameraDirection:THREE.Vector3,time:number):boolean {
    if(!enabled||held)return false;
    const citizen=choose(ray);if(!citizen)return false;
    const active=citizens.filter(c=>c.ragdoll);
    if(active.length>=MAX_RAGDOLLS)recover(active[0]);
    const origin=citizen.position.clone();
    citizen.ragdoll=new CitizenRagdoll(world,origin,citizen.heading,citizen.scale,hit=>pending.push({citizen,hit}));
    const target=new THREE.Vector3(origin.x,origin.y+.32*citizen.scale,origin.z);
    citizen.ragdoll.hold(target);
    // Vertical camera-facing plane: an upward cursor movement really lifts the
    // person. Horizontal cursor movement carries them sideways through the city.
    const normal=new THREE.Vector3(cameraDirection.x,0,cameraDirection.z).normalize();
    if(normal.lengthSq()<.001)normal.set(0,0,-1);
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,target);
    const initialHit=ray.intersectPlane(plane,new THREE.Vector3())??target;
    held={citizen,plane,offset:target.clone().sub(initialHit),target,last:target.clone(),velocity:new THREE.Vector3(),lastTime:time,start:origin};
    hovered=citizen;say(citizen,'held','held');ensureColliders();return true;
  }
  function pointerMove(ray:THREE.Ray,time:number):boolean {
    if(!enabled)return false;
    if(!held){hovered=choose(ray);return !!hovered;}
    const hit=ray.intersectPlane(held.plane,new THREE.Vector3());
    if(!hit)return true;
    hit.add(held.offset);
    hit.y=clamp(hit.y,-5,50);
    const dt=clamp((time-held.lastTime)/1000,.008,.2);
    const movement=hit.clone().sub(held.last).divideScalar(dt);
    if(movement.length()>MAX_HAND_SPEED)movement.setLength(MAX_HAND_SPEED);
    held.velocity.copy(movement);held.last.copy(hit);held.lastTime=time;held.target.copy(hit);
    held.citizen.ragdoll?.move(hit);return true;
  }
  function pointerUp(time:number):boolean {
    if(!held)return false;
    const current=held;held=null;
    const citizen=current.citizen,ragdoll=citizen.ragdoll;if(!ragdoll)return true;
    const p=ragdoll.position;
    if(time-current.lastTime>140)current.velocity.set(0,0,0);
    if(Math.abs(p.x)>state.size/2||Math.abs(p.z)>state.size/2){incident(citizen,'abduction',p,{x:0,y:1,z:0});return true;}
    if(isGentleRelease(p,ground(p.x,p.z),current.velocity,citizen.scale))recover(citizen);
    else {ragdoll.release(current.velocity);if(current.velocity.length()>1.2)say(citizen,'thrown','vehicle');}
    return true;
  }
  function cancel():void {
    if(held){const current=held;held=null;recover(current.citizen,current.start);}hovered=null;if(handBadge)handBadge.style.display='none';renderCitizens();
  }
  function drawPart(name:string,index:number,position:THREE.Vector3,q:THREE.Quaternion,sx:number,sy:number,sz:number,c:number):void {
    const mesh=meshes.get(name)!;dummy.position.copy(position);dummy.quaternion.copy(q);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);color.set(c);mesh.setColorAt(index,color);
  }
  function renderCitizens():void {
    let index=0;
    for(const citizen of citizens)if(!citizen.dead) {
      const s=citizen.scale,skin=skins[citizen.variant%skins.length],shirt=shirts[citizen.variant%shirts.length],pants=trousers[citizen.variant%trousers.length];
      const walk=citizen.ragdoll||citizen.recovery?0:Math.sin(citizen.phase)*.30;
      const positions={} as Record<PartName,THREE.Vector3>,rotations={} as Record<PartName,THREE.Quaternion>;
      const heading=new THREE.Quaternion().setFromAxisAngle(axisY,citizen.heading);
      for(const name of PARTS) {
        const spec=dimensions[name],size=spec.size;
        const body=citizen.ragdoll?.bodies[name];
        if(body){positions[name]=new THREE.Vector3(body.position.x,body.position.y,body.position.z);rotations[name]=new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);}
        else if(citizen.recovery){const pose=recoveryPose(citizen,name);positions[name]=pose.position;rotations[name]=pose.quaternion;}
        else {
          const limb=name.includes('Arm')||name.includes('Leg'),swing=name==='leftArm'||name==='rightLeg'?walk:-walk;
          rotations[name]=heading.clone();
          if(limb)rotations[name].multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),swing));
          positions[name]=new THREE.Vector3(...spec.offset).multiplyScalar(s);
          if(limb){positions[name].z+=Math.sin(swing)*size[1]*s*.45;positions[name].y+=(1-Math.cos(swing))*size[1]*s*.45;}
          positions[name].applyQuaternion(heading).add(citizen.position);
          if(!limb)positions[name].y+=Math.abs(Math.sin(citizen.phase))*.005*s;
        }
        drawPart(name,index,positions[name],rotations[name],size[0]*s,size[1]*s,size[2]*s,name==='head'?skin:name.includes('Leg')?pants:shirt);
      }
      const detail=(name:string,parent:PartName,offset:[number,number,number],size:[number,number,number],c:number)=>{
        local.set(...offset).multiplyScalar(s).applyQuaternion(rotations[parent]).add(positions[parent]);
        drawPart(name,index,local,rotations[parent],size[0]*s,size[1]*s,size[2]*s,c);
      };
      const wearsHat=citizen.variant%3===0;
      detail('hat','head',[0,.073,0],wearsHat?[.14,.04,.145]:[0,0,0],citizen.variant%2?0x9d8557:shirt);
      const longHair=citizen.variant%5===1;
      detail('hair','head',longHair?[0,.002,-.034]:[0,.046,-.009],longHair?[.108,.12,.078]:[.109,.033,.104],hairs[citizen.variant%4]);
      detail('nose','head',[0,-.002,.055],[.022,.026,.025],skin);
      detail('leftEye','head',[-.023,.014,.051],[.012,.015,.012],0x2c373b);
      detail('rightEye','head',[.023,.014,.051],[.012,.015,.012],0x2c373b);
      detail('backpack','torso',[0,.025,-.068],citizen.variant%4===0?[.10,.13,.055]:[0,0,0],citizen.variant%2?0xa68a58:0x78573e);
      detail('leftShoe','leftLeg',[0,-.079,.015],[.069,.052,.105],0x354044);
      detail('rightShoe','rightLeg',[0,-.079,.015],[.069,.052,.105],0x354044);
      detail('shirtFront','torso',[0,.025,.052],[.045,.165,.014],citizen.variant%3===0?0xe3d9c4:citizen.variant%3===1?0x354653:0xb2b8a7);
      detail('collar','torso',[0,.111,.025],[.078,.022,.055],0xded8c5);
      detail('leftHand','leftArm',[0,-.105,0],[.043,.045,.047],skin);
      detail('rightHand','rightArm',[0,-.105,0],[.043,.045,.047],skin);
      detail('leftEar','head',[-.054,-.003,-.006],[.014,.030,.019],skin);
      detail('rightEar','head',[.054,-.003,-.006],[.014,.030,.019],skin);
      detail('leftCuff','leftArm',[0,-.09,0],[.053,.026,.058],citizen.variant%3===0?0xd6d4c3:shirt);
      detail('rightCuff','rightArm',[0,-.09,0],[.053,.026,.058],citizen.variant%3===0?0xd6d4c3:shirt);
      index++;
    }
    for(const mesh of meshes.values()){mesh.count=index;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  function animate(dt:number,walking:boolean):void {
    dt=clamp(dt,0,.05);elapsed+=dt;spawnClock+=dt;
    for(const citizen of citizens) {
      if(citizen.dead)continue;
      if(citizen.recovery){citizen.recovery.elapsed+=dt;if(citizen.recovery.elapsed>=GET_UP_SECONDS){citizen.recovery=null;citizen.phase=0;}continue;}
      if(citizen.ragdoll) {
        if(!citizen.ragdoll.held)citizen.ragdoll.age+=dt;
        continue;
      }
      if(!walking||!nodes.length||elapsed<citizen.waitUntil||crosswalkHasTraffic(citizen))continue;
      const crossingPace=citizen.crossing?1.6:1;
      citizen.phase+=dt*(5.8+citizen.pace*6)*crossingPace;
      const distance=Math.max(.08,citizen.from.distanceTo(citizen.to));citizen.progress+=dt*citizen.pace*crossingPace/distance;
      if(citizen.progress>=1){citizen.position.copy(citizen.to);nextNode(citizen);}
      citizen.position.lerpVectors(citizen.from,citizen.to,Math.min(1,citizen.progress));citizen.position.y=ground(citizen.position.x,citizen.position.z);
      const dx=citizen.to.x-citizen.from.x,dz=citizen.to.z-citizen.from.z;if(Math.abs(dx)+Math.abs(dz)>.001)citizen.heading=Math.atan2(dx,dz);
    }
    if(citizens.some(c=>c.ragdoll)) {
      // Miniature torsos can cross a thin pane within a 120 Hz step at the
      // allowed throw speed. 240 Hz keeps displacement below torso + glass
      // thickness, avoiding missed facade contacts without thick fake walls.
      ensureColliders();world.step(CITIZEN_PHYSICS_STEP,dt,16);
      for(const item of pending.splice(0))incident(item.citizen,'impact',item.hit.point,item.hit.normal);
      for(const citizen of citizens)if(citizen.ragdoll&&!citizen.ragdoll.held) {
        const p=citizen.ragdoll.position;
        if(Math.abs(p.x)>state.size/2+.4||Math.abs(p.z)>state.size/2+.4)incident(citizen,'abduction',p,{x:0,y:1,z:0});
        else if(citizen.ragdoll.age>.8&&citizen.ragdoll.resting&&!citizen.ragdoll.impacted)recover(citizen,undefined,true);
      }
    }else if(statics.size){for(const value of statics.values())world.removeBody(value.body);statics.clear();}
    for(let i=citizens.length-1;i>=0;i--)if(citizens[i].dead)citizens.splice(i,1);
    if(spawnClock>20){spawn();spawnClock=0;}
    for(let i=particles.length-1;i>=0;i--) {
      const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.velocity.y-=5*dt;p.position.addScaledVector(p.velocity,dt);
    }
    const count=Math.min(particles.length,256);
    for(let i=0;i<count;i++){const p=particles[i];dummy.position.copy(p.position);dummy.quaternion.identity();dummy.scale.setScalar(.004+.01*clamp(p.life/.4,0,1));dummy.updateMatrix();particleMesh.setMatrixAt(i,dummy.matrix);color.set(p.color);particleMesh.setColorAt(i,color);}
    particleMesh.count=count;if(count){particleMesh.instanceMatrix.needsUpdate=true;if(particleMesh.instanceColor)particleMesh.instanceColor.needsUpdate=true;}
    if(walking&&elapsed>=nextComment) {
      nextComment=elapsed+9+random(sequence+Math.floor(elapsed))*6;
      const walkingCitizens=citizens.filter(c=>!c.dead&&!c.ragdoll&&!c.recovery&&onScreen(c));
      const candidate=walkingCitizens[Math.floor(random(elapsed+state.seed)*walkingCitizens.length)];
      if(candidate)say(candidate,ambientTopic(candidate),'idle');
    }
    renderCitizens();rebuildActorIndex();updateUi();
  }
  update(initialState);renderCitizens();
  return {group,update,animate,pointerDown,pointerMove,pointerUp,cancel,sweepVehicleImpact,notifyObservation,
    clearHover(){if(!held){hovered=null;if(handBadge)handBadge.style.display='none';}},
    setEnabled(value){if(!value)cancel();enabled=value;},
    setUiVisible(value){uiVisible=value;if(overlay)overlay.style.display=value?'block':'none';},
    refreshLocale:updateUi,
    get holding(){return !!held;},get cursor(){return held?'grabbing':hovered?'grab':'default';},
    getDebug(){return {count:citizens.length,ragdolls:citizens.filter(c=>c.ragdoll).length,recovering:citizens.filter(c=>c.recovery).length,held:held?.citizen.id??null,hovered:hovered?.id??null,speech:dialogue.getActive(elapsed),positions:citizens.filter(c=>!c.dead).map(c=>{const p=c.ragdoll?actorTorso(c).add(new THREE.Vector3(0,-.32*c.scale,0)):c.position;return {id:c.id,x:p.x,y:p.y,z:p.z,crossing:c.crossing,state:c.recovery?'recovering' as const:c.ragdoll?.held?'held' as const:c.ragdoll?'ragdoll' as const:'walking' as const};})};},
    dispose(){cancel();for(const c of citizens)c.ragdoll?.dispose();for(const value of statics.values())world.removeBody(value.body);statics.clear();
      for(const geometry of [cube,headGeometry,hatGeometry,torsoGeometry,limbGeometry,shoeGeometry,backpackGeometry,handGeometry,rightHandGeometry,noseGeometry,earGeometry,cuffGeometry,hairGeometry,particleGeometry])geometry.dispose();
      for(const material of [sharedMaterial,splatMaterial,particleMaterial])material.dispose();
      for(const child of decals.children)(child as THREE.Mesh).geometry.dispose();dialogue.clear();overlay?.remove();group.removeFromParent();},
  };
}
