import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityState } from './types';
import type { PowerLayout, PowerService } from './power-layout';
import { FACILITY_PAVEMENT_HEIGHT, facilityLocalToWorld, facilityWorldToLocal, getFacilityAccess } from './facility-access';
import { getFootprint, TOOL_DEFS } from './simulation';
import { isPowerServiceDropClear } from './power-service';

const POLE_HEIGHT = 1.36;
const ARM_HEIGHT = 1.27;
const CONTACT_HEIGHT = 1.385;
const WIRE_SEPARATION = .145;

const materials = {
  pole: new THREE.MeshStandardMaterial({color:0x9eaa9e,roughness:.78,metalness:.05}),
  base: new THREE.MeshStandardMaterial({color:0x879189,roughness:.84,metalness:.05}),
  metal: new THREE.MeshStandardMaterial({color:0x516461,roughness:.47,metalness:.58}),
  wire: new THREE.MeshStandardMaterial({color:0x344741,roughness:.55,metalness:.48}),
  ceramic: new THREE.MeshStandardMaterial({color:0xbbd8cb,roughness:.24,metalness:.08}),
  box: new THREE.MeshStandardMaterial({color:0x849d90,roughness:.51,metalness:.4}),
  live: new THREE.MeshStandardMaterial({color:0x93dbaf,emissive:0x71c994,emissiveIntensity:.32,roughness:.35}),
  idle: new THREE.MeshStandardMaterial({color:0xbb9b6d,roughness:.7}),
};

/** A discrete slack wire with both ends exactly on their physical insulators. */
export function powerWirePoints(from:THREE.Vector3,to:THREE.Vector3,slack=.08,segments=6):THREE.Vector3[] {
  const sag=Math.max(0,Math.min(.23,slack));
  return Array.from({length:segments+1},(_,i)=>{
    const t=i/segments;
    const point=from.clone().lerp(to,t);
    point.y-=4*t*(1-t)*sag;
    return point;
  });
}

export interface PowerServiceModelPlacement {
  cabinet: THREE.Vector3;
  contact: THREE.Vector3;
  cableStart: THREE.Vector3;
  /** A connected forecourt needs a cabinet clear of the vehicle lane and a high service riser. */
  driveway: boolean;
  overhead: boolean;
}

/** Render-only adjustment: saved plots, block feeds and their assigned poles never change. */
export function powerServiceModelPlacement(state: CityState, service: PowerService, pole: THREE.Vector3): PowerServiceModelPlacement {
  const half = state.size / 2, tile = state.tiles[service.building];
  const source = ['power', 'wind', 'solar'].includes(tile.kind);
  const height = source ? .42 : .31, width = source ? .20 : .105, depth = source ? .16 : .07;
  const cableStart = pole.clone().add(new THREE.Vector3(0, 1.245, .077));
  const cabinet = new THREE.Vector3(service.targetX - half, service.elevation, service.targetZ - half);
  const plan = getFacilityAccess(state, tile);
  if (!plan?.connected) return { cabinet, contact: cabinet.clone().add(new THREE.Vector3(0, height + .145, 0)), cableStart, driveway: false, overhead: true };

  // Content starts .40 inside a property, but the actual drive occupies .44.
  // Reserve the whole rotated cabinet footing, with a further 2 cm clear shoulder.
  const inset = plan.laneWidth + Math.hypot(width + .055, depth + .055) / 2 + .02;
  const minX = plan.center.x - plan.width / 2 + inset, maxX = plan.center.x + plan.width / 2 - inset;
  const minZ = plan.center.z - plan.depth / 2 + inset, maxZ = plan.center.z + plan.depth / 2 - inset;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const local = facilityWorldToLocal(plan, { x: cabinet.x, z: cabinet.z });
  const scaled = facilityLocalToWorld(plan, { x: local.x * plan.contentScale.x, z: local.z * plan.contentScale.z });
  const preferred = { x: clamp(scaled.x, minX, maxX), z: clamp(scaled.z, minZ, maxZ) };
  const candidates = [preferred];
  // Keeping the original ray where possible also keeps its checked street-side path.
  const dx = cabinet.x - cableStart.x, dz = cabinet.z - cableStart.z;
  let enter = 0, exit = Infinity;
  for (const [origin, delta, min, max] of [[cableStart.x, dx, minX, maxX], [cableStart.z, dz, minZ, maxZ]]) {
    if (Math.abs(delta) < 1e-10) { if (origin < min || origin > max) { enter = Infinity; break; } continue; }
    const a = (min - origin) / delta, b = (max - origin) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (enter <= exit && Number.isFinite(enter)) candidates.unshift({ x: cableStart.x + dx * enter, z: cableStart.z + dz * enter });
  // A ray aimed close to a corner can miss the inset rectangle. Try other points
  // on the inner plinth, checking the actual public asphalt for every alternative.
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) candidates.push({ x: minX + (maxX - minX) * x / 4, z: minZ + (maxZ - minZ) * z / 4 });
  const footprintIds = new Set(getFootprint(state, tile).map(p => p.z * state.size + p.x));
  const obstructs = (other: CityState['tiles'][number]) => !!TOOL_DEFS[other.kind]?.footprint || ['residential', 'commercial', 'industrial'].includes(other.kind) && other.level > 0;
  const selected = candidates.find(point => isPowerServiceDropClear(state, state.tiles[service.pole], [point.x + half, point.z + half], footprintIds, obstructs));
  const target = selected ?? preferred;
  cabinet.set(target.x, plan.baseY + FACILITY_PAVEMENT_HEIGHT, target.z);
  const contact = cabinet.clone().add(new THREE.Vector3(0, 1.20, 0));
  // Both endpoints clear the highest part of this private driveway. The ramp
  // sampler blends these exact route heights, so this bound also covers steep
  // shoulders between samples. Extend the physical pole riser on a raised plot
  // instead of stretching a low wire across the top of its entrance ramp.
  const pavementTop = Math.max(plan.baseY + FACILITY_PAVEMENT_HEIGHT, ...plan.points.map(point => point.y));
  const safeEndpoint = pavementTop + .85 + .055 + .007;
  cableStart.y = Math.max(cableStart.y, safeEndpoint);
  contact.y = Math.max(contact.y, safeEndpoint);
  // An exceptionally obstructed plot keeps its electric feed as a buried service
  // rather than drawing a new public-road crossing to reach the inset cabinet.
  return { cabinet, contact, cableStart, driveway: true, overhead: !!selected };
}

/** Small pole, conductor and service-meter meshes merged to one draw per palette entry. */
export function createPowerGridModel(state:CityState,layout:PowerLayout):THREE.Group {
  const half=state.size/2;
  const primitive={
    box:new THREE.BoxGeometry(1,1,1),
    mast:new THREE.CylinderGeometry(.023,.041,POLE_HEIGHT,8),
    ring:new THREE.CylinderGeometry(.027,.027,.012,8),
    contact:new THREE.CylinderGeometry(.013,.013,.092,6),
    collar:new THREE.CylinderGeometry(.045,.045,.022,8),
  };
  const own=new Set<THREE.BufferGeometry>(Object.values(primitive));
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const transform=new THREE.Object3D();
  const directions=new THREE.Vector3(0,1,0);
  const poles=new Map(layout.poles.map(p=>[p.id,p]));
  const servicePoles=new Set(layout.services.map(service=>service.pole));
  const centers=new Map<number,THREE.Vector3>();
  const serviceRiserHeights=new Map<number,number>();
  const output=new THREE.Group();
  output.name='Connected electricity grid';
  output.userData.utilityCounts={poles:layout.poles.length,spans:layout.spans.length,services:layout.services.length};

  function add(geometry:THREE.BufferGeometry,material:THREE.Material,position:THREE.Vector3,scale=new THREE.Vector3(1,1,1),rotation=new THREE.Euler()) {
    transform.position.copy(position);transform.rotation.copy(rotation);transform.scale.copy(scale);transform.updateMatrix();
    const part=geometry.index?geometry.toNonIndexed():geometry.clone();
    if(!part.getAttribute('uv'))part.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(part.getAttribute('position').count*2),2));
    for(const name of Object.keys(part.attributes))if(!['position','normal','uv'].includes(name))part.deleteAttribute(name);
    part.applyMatrix4(transform.matrix);part.clearGroups();
    const list=batches.get(material)??[];list.push(part);batches.set(material,list);
  }
  function box(material:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number,angle=0){
    add(primitive.box,material,new THREE.Vector3(x,y,z),new THREE.Vector3(w,h,d),new THREE.Euler(0,angle,0));
  }
  function rod(a:THREE.Vector3,b:THREE.Vector3,radius:number,material:THREE.Material){
    const geometry=new THREE.CylinderGeometry(radius,radius,a.distanceTo(b),5);own.add(geometry);
    const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(directions,b.clone().sub(a).normalize()));
    add(geometry,material,a.clone().lerp(b,.5),undefined,rotation);
  }
  function insulator(x:number,y:number,z:number){
    add(primitive.contact,materials.metal,new THREE.Vector3(x,y-.045,z));
    for(let i=0;i<3;i++)add(primitive.ring,materials.ceramic,new THREE.Vector3(x,y-.07+i*.025,z));
  }
  function cable(a:THREE.Vector3,b:THREE.Vector3,radius=.008,slack=.09){
    const middle=a.clone().lerp(b,.5);middle.y-=Math.max(0,Math.min(.23,slack))*2;
    const geometry=new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a,middle,b),6,radius,4,false);
    own.add(geometry);add(geometry,materials.wire,new THREE.Vector3());
  }

  for(const pole of layout.poles){
    const road=state.tiles[pole.id]?.kind==='road';
    const offset=road?.36:0;
    const x=pole.x-half+.5+offset,z=pole.z-half+.5+offset,y=pole.elevation;
    centers.set(pole.id,new THREE.Vector3(x,y,z));
    box(materials.base,x,y+.037,z,.115,.074,.115);
    add(primitive.mast,materials.pole,new THREE.Vector3(x,y+POLE_HEIGHT/2+.03,z));
    for(const height of [.11,.67,1.02])add(primitive.collar,materials.metal,new THREE.Vector3(x,y+height,z));
    for(const dx of [-.034,.034])for(const dz of [-.034,.034])box(materials.metal,x+dx,y+.078,z+dz,.014,.018,.014);
    const alongX=pole.directions.some(([dx])=>dx!==0),alongZ=pole.directions.some(([,dz])=>dz!==0);
    // Both arms are present at a junction, so every outgoing conductor lands
    // on a real ceramic contact rather than ending in the air.
    const arms:Array<[number,number]>=[];
    if(alongZ||!alongX)arms.push([1,0]);
    if(alongX)arms.push([0,1]);
    for(const [ax,az]of arms){
      box(materials.metal,x,y+ARM_HEIGHT,z,ax?.40:.042,.042,az?.40:.042);
      for(const side of [-1,1]){
        const end=new THREE.Vector3(x+ax*WIRE_SEPARATION*side,y+ARM_HEIGHT,z+az*WIRE_SEPARATION*side);
        rod(new THREE.Vector3(x,y+1.07,z),end,.012,materials.metal);
        insulator(end.x,y+CONTACT_HEIGHT,end.z);
      }
    }
    // A service cleat below the main arms gives each building drop a definite
    // anchor independent of the street's main conductor direction.
    box(materials.metal,x,y+1.17,z+.047,.07,.036,.094);
    insulator(x,y+1.245,z+.077);
    if(servicePoles.has(pole.id)){
      const transformer=new THREE.CylinderGeometry(.066,.066,.20,10);own.add(transformer);
      add(transformer,materials.box,new THREE.Vector3(x+.075,y+.97,z));
      box(materials.metal,x+.075,y+1.08,z,.15,.025,.14);
      for(let k=-1;k<=1;k++)box(materials.metal,x+.134,y+.94+k*.035,z,.017,.019,.11);
      insulator(x+.075,y+1.18,z);
      const [armX,armZ]=arms[0];
      cable(new THREE.Vector3(x+armX*WIRE_SEPARATION,y+CONTACT_HEIGHT,z+armZ*WIRE_SEPARATION),new THREE.Vector3(x+.075,y+1.18,z),.006,.015);
      cable(new THREE.Vector3(x+.075,y+1.09,z+.04),new THREE.Vector3(x,y+1.245,z+.077),.007,.018);
    }
  }

  for(const span of layout.spans){
    const a=centers.get(span.from),b=centers.get(span.to);if(!a||!b)continue;
    const ax=poles.get(span.from)!,bx=poles.get(span.to)!;
    const dx=Math.sign(bx.x-ax.x),dz=Math.sign(bx.z-ax.z);
    // Spans are compressed only across straight explicit line cells. Corners
    // are real pole nodes, keeping both conductors attached at turns.
    const perpendicular=new THREE.Vector3(dz,0,-dx).normalize();
    for(const side of [-1,1]){
      const start=a.clone().add(new THREE.Vector3(0,CONTACT_HEIGHT,0)).addScaledVector(perpendicular,side*WIRE_SEPARATION);
      const end=b.clone().add(new THREE.Vector3(0,CONTACT_HEIGHT,0)).addScaledVector(perpendicular,side*WIRE_SEPARATION);
      cable(start,end,.008,Math.min(.20,.035+start.distanceTo(end)*.042));
    }
  }
  for(const service of layout.services){
    const pole=centers.get(service.pole);if(!pole)continue;
    const building=state.tiles[service.building];
    const source=building?.kind==='power'||building?.kind==='wind'||building?.kind==='solar';
    const placement=powerServiceModelPlacement(state,service,pole);
    const {x,y,z}=placement.cabinet;
    const height=source?.42:.31,width=source?.20:.105,depth=source?.16:.07;
    const angle=Math.atan2(pole.x-x,pole.z-z);
    box(materials.base,x,y+.025,z,width+.055,.05,depth+.055,angle);
    box(materials.box,x,y+height/2+.045,z,width,height,depth,angle);
    box(materials.metal,x,y+height+.055,z,width+.022,.025,depth+.025,angle);
    // Meter face and live-status lamp face the incoming line.
    const facing=new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
    box(materials.metal,x+facing.x*(depth/2+.007),y+height*.65,z+facing.z*(depth/2+.007),width*.62,height*.30,.014,angle);
    box(service.powered?materials.live:materials.idle,x+facing.x*(depth/2+.017),y+height*.68,z+facing.z*(depth/2+.017),width*.30,.026,.012,angle);
    const contact=placement.contact;
    if(placement.driveway&&placement.overhead)rod(new THREE.Vector3(x,y+height+.06,z),new THREE.Vector3(x,contact.y-.08,z),.014,materials.metal);
    if(placement.overhead){
      const start=placement.cableStart,ordinaryHeight=pole.y+1.245,priorHeight=serviceRiserHeights.get(service.pole)??ordinaryHeight;
      if(start.y>priorHeight+.001){
        rod(new THREE.Vector3(start.x,priorHeight-.075,start.z),new THREE.Vector3(start.x,start.y-.08,start.z),.024,materials.pole);
        serviceRiserHeights.set(service.pole,start.y);
      }
      if(start.y>ordinaryHeight+.001)insulator(start.x,start.y,start.z);
      insulator(contact.x,contact.y,contact.z);cable(start,contact,.007,.055);
    }
    else rod(placement.cableStart,pole.clone().add(new THREE.Vector3(0,.055,.077)),.011,materials.metal);
    // Cable visibly reaches the meter and then enters the foundation through
    // a conduit. No imaginary cable continues through neighboring buildings.
    rod(new THREE.Vector3(x-facing.x*(depth/2+.018),y+.19,z-facing.z*(depth/2+.018)),new THREE.Vector3(x-facing.x*(depth/2+.018),y+.025,z-facing.z*(depth/2+.018)),.011,materials.metal);
  }

  for(const [material,parts]of batches){
    const geometry=mergeGeometries(parts,false);for(const part of parts)part.dispose();
    if(!geometry)continue;
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;output.add(mesh);
  }
  for(const geometry of own)geometry.dispose();
  return output;
}
