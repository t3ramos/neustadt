import * as THREE from 'three';
import { sampleGroundHeight } from './terrain-graphics';
import type { CityState, Tile } from './types';

export type AnimalSpecies = 'cat'|'dog'|'deer'|'rabbit';
export const ANIMAL_LIMITS:Readonly<Record<AnimalSpecies,number>> = {cat:3,dog:2,deer:4,rabbit:6};
export interface AnimalObservation {species:AnimalSpecies;x:number;z:number;}
export interface AnimalPosition extends AnimalObservation {id:number;y:number;heading:number;moving:boolean;fleeing:boolean;height:number;}
type Vec = {x:number;z:number};
type Shape = 'sphere'|'cylinder'|'cone';
type Motion = 'leg'|'tail'|'head'|'ear';
type Triple = [number,number,number];
interface Part {shape:Shape;position:Triple;scale:Triple;color:number;rotation?:Triple;motion?:Motion;pivot?:Triple;phase?:number;}
interface Habitat {cat:Uint8Array;dog:Uint8Array;deer:Uint8Array;rabbit:Uint8Array;}
interface Animal extends AnimalPosition {home:Vec;target:Vec;wait:number;phase:number;steps:number;distance:number;}
interface Instance {animal:Animal;part:Part;index:number;rest:THREE.Matrix4;}
interface Batch {mesh:THREE.InstancedMesh;instances:Instance[];}
const speciesList:AnimalSpecies[] = ['cat','dog','deer','rabbit'];
const HEIGHTS:Record<AnimalSpecies,number> = {cat:.065,dog:.087,deer:.195,rabbit:.064};
const SPEEDS:Record<AnimalSpecies,number> = {cat:.07,dog:.1,deer:.105,rabbit:.09};
const RADII:Record<AnimalSpecies,number> = {cat:1.5,dog:1.8,deer:3.5,rabbit:2};
const COLORS = {cream:0xe8dfc6,ginger:0xb47b47,dark:0x29272a,grey:0x6c7275,brown:0x936344,pink:0xba8682,white:0xf3eee4,collar:0x488795};
const random=(seed:number,salt:number)=>{let n=Math.imul((seed^salt)>>>0,0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;};
const tileAt=(state:CityState,x:number,z:number):Tile|undefined=>x<0||z<0||x>=state.size||z>=state.size?undefined:state.tiles[z*state.size+x];
const natural=(t:Tile|undefined)=>!!t&&t.elevation>=0&&!t.fire&&(t.kind==='empty'||t.kind==='tree');
const built=(t:Tile)=>!['empty','water','tree','rubble'].includes(t.kind);

/** Habitat masks are rebuilt on construction/terrain changes, never every frame. */
function habitats(state:CityState):Habitat {
  const masks:Habitat={cat:new Uint8Array(state.tiles.length),dog:new Uint8Array(state.tiles.length),deer:new Uint8Array(state.tiles.length),rabbit:new Uint8Array(state.tiles.length)};
  for(const tile of state.tiles) {
    if(tile.elevation<0||tile.fire||!['empty','tree','park'].includes(tile.kind))continue;
    let houses=Infinity,roads=Infinity,development=Infinity,trees=0;
    for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++) {
      const neighbor=tileAt(state,tile.x+dx,tile.z+dz);if(!neighbor)continue;
      const d=Math.max(Math.abs(dx),Math.abs(dz));
      if(neighbor.kind==='residential'&&neighbor.level>0)houses=Math.min(houses,d);
      if(neighbor.kind==='road')roads=Math.min(roads,d);
      if(built(neighbor))development=Math.min(development,d);
      if(neighbor.kind==='tree'&&d<=3)trees++;
    }
    const i=tile.z*state.size+tile.x;
    // Pets live in occupied neighborhoods. A bare new map never creates stray pets.
    masks.cat[i]=Number(houses<=3&&(tile.kind==='park'||tile.kind==='empty')&&(roads<=3||tile.kind==='park'));
    masks.dog[i]=Number(houses<=4&&(tile.kind==='park'||tile.kind==='empty'&&roads<=1));
    const woodland=natural(tile)&&development>3&&trees>=4;
    masks.deer[i]=Number(woodland);masks.rabbit[i]=Number(woodland);
  }
  return masks;
}

function safePosition(state:CityState,masks:Habitat,species:AnimalSpecies,x:number,z:number):boolean {
  const gx=Math.floor(x+state.size/2),gz=Math.floor(z+state.size/2),tile=tileAt(state,gx,gz);
  if(!tile||!masks[species][gz*state.size+gx]||sampleGroundHeight(state,x,z)<-.005)return false;
  const dx=x-(gx-state.size/2+.5),dz=z-(gz-state.size/2+.5);
  // Keep actual model volume off lot boundaries, tree trunks and park furniture.
  const clearance=species==='deer'?.065:.045;
  const compatible=(xx:number,zz:number)=>{const neighbor=tileAt(state,xx,zz);return !!neighbor&&masks[species][zz*state.size+xx]&&Math.abs(neighbor.elevation-tile.elevation)<.51;};
  if(Math.abs(dx)>.5-clearance&&!compatible(gx+Math.sign(dx),gz)||Math.abs(dz)>.5-clearance&&!compatible(gx,gz+Math.sign(dz)))return false;
  if(tile.kind==='tree'&&Math.hypot(dx,dz)<.25)return false;
  if(tile.kind==='park'&&Math.min(Math.abs(dx),Math.abs(dz))>.047)return false;
  const h=sampleGroundHeight(state,x,z);
  return Math.abs(sampleGroundHeight(state,x+.06,z)-h)<.09&&Math.abs(sampleGroundHeight(state,x,z+.06)-h)<.09;
}

function groundHeight(state:CityState,x:number,z:number):number {
  const tile=tileAt(state,Math.floor(x+state.size/2),Math.floor(z+state.size/2));
  return Math.max(0,sampleGroundHeight(state,x,z))+(tile?.kind==='park'?.043:.003);
}

function candidatePosition(state:CityState,masks:Habitat,species:AnimalSpecies,index:number,salt:number):Vec|null {
  const tile=state.tiles[index],half=state.size/2;
  for(let attempt=0;attempt<12;attempt++) {
    const a=random(state.seed,index*97+salt+attempt*17),b=random(state.seed,index*101+salt+attempt*31);
    let x=tile.x-half+.5+(a-.5)*.74,z=tile.z-half+.5+(b-.5)*.74;
    if(tile.kind==='park'){if(a>.5)x=tile.x-half+.5;else z=tile.z-half+.5;}
    if(safePosition(state,masks,species,x,z))return {x,z};
  }
  return null;
}

function spawnAnimals(state:CityState,masks:Habitat):Animal[] {
  const animals:Animal[]=[];
  for(const [speciesIndex,species] of speciesList.entries()) {
    const candidates=state.tiles.filter(t=>masks[species][t.z*state.size+t.x]).map(t=>t.z*state.size+t.x);
    candidates.sort((a,b)=>random(state.seed,a*41+speciesIndex*827)-random(state.seed,b*41+speciesIndex*827));
    const urban=species==='cat'||species==='dog';
    const target=Math.min(ANIMAL_LIMITS[species],urban?Math.ceil(candidates.length/(species==='cat'?16:22)):Math.floor(candidates.length/(species==='deer'?45:25)));
    const selected:Vec[]=[];
    // Wildlife shares a small woodland patch, instead of evenly covering the map.
    let woodlandHome:Vec|null=null;
    for(const index of candidates) {
      if(selected.length>=target)break;
      const p=candidatePosition(state,masks,species,index,701+speciesIndex*1301);if(!p)continue;
      if(urban&&selected.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<5))continue;
      if(!urban&&woodlandHome&&Math.hypot(woodlandHome.x-p.x,woodlandHome.z-p.z)>6)continue;
      if(selected.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<.6))continue;
      woodlandHome??=p;selected.push(p);
      const id=speciesIndex*100+selected.length;
      animals.push({id,species,...p,y:groundHeight(state,p.x,p.z),heading:random(state.seed,id*79)*Math.PI*2,height:HEIGHTS[species],moving:false,fleeing:false,home:{...p},target:{...p},wait:random(state.seed,id*191)*5,phase:random(state.seed,id*137)*Math.PI*2,steps:0,distance:0});
    }
  }
  return animals;
}

/** Original small animal sculptures, authored in world units (one tile ≈ 10 m). */
function model(species:AnimalSpecies):Part[] {
  const parts:Part[]=[];
  const add=(shape:Shape,position:Triple,scale:Triple,color:number,extra:Partial<Part>={})=>parts.push({shape,position,scale,color,...extra});
  const ball=(position:Triple,scale:Triple,color:number,extra:Partial<Part>={})=>add('sphere',position,scale,color,extra);
  const segment=(from:Triple,to:Triple,radius:number,color:number,motion?:Motion,pivot?:Triple,phase=0)=>{
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),delta=b.clone().sub(a),rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()));
    add('cylinder',a.add(b).multiplyScalar(.5).toArray() as Triple,[radius,delta.length(),radius],color,{rotation:[rotation.x,rotation.y,rotation.z],motion,pivot,phase});
  };
  const cat=species==='cat',dog=species==='dog',deer=species==='deer',rabbit=species==='rabbit';
  const coat=cat?COLORS.ginger:dog?COLORS.cream:deer?COLORS.brown:COLORS.grey;
  const body:Triple=cat?[.027,.025,.061]:dog?[.037,.038,.084]:deer?[.049,.06,.119]:[.031,.031,.044];
  const centerY=cat?.030:dog?.042:deer?.112:.022;
  const headZ=cat?.033:dog?.049:deer?.071:.024;
  const headY=cat?.047:dog?.066:deer?.163:.034;
  const head:Triple=cat?[.024,.023,.022]:dog?[.031,.03,.033]:deer?[.03,.036,.048]:[.025,.025,.026];
  const neckPivot:Triple=[0,centerY,headZ*.68];
  ball([0,centerY,0],body,coat);
  ball([0,centerY-.003,-body[2]*.25],[body[0]*1.02,body[1]*.95,body[2]*.45],coat);
  if(deer)ball([0,.14,.050],[.028,.067,.035],coat,{rotation:[.34,0,0]});
  ball([0,headY,headZ],head,coat,{motion:'head',pivot:neckPivot});
  const muzzleZ=headZ+head[2]*.39,muzzleY=headY-head[1]*.15;
  ball([0,muzzleY,muzzleZ],[head[0]*.65,head[1]*.46,head[2]*.61],deer?COLORS.brown:COLORS.cream,{motion:'head',pivot:neckPivot});
  ball([0,muzzleY+.001,muzzleZ+head[2]*.30],[cat?.005:.006,cat?.003:.004,.0035],cat||rabbit?COLORS.pink:COLORS.dark,{motion:'head',pivot:neckPivot});
  for(const side of [-1,1]) {
    ball([side*head[0]*.29,headY+head[1]*.075,headZ+head[2]*.39],[.003,.0035,.0025],COLORS.dark,{motion:'head',pivot:neckPivot});
    if(cat) {
      add('cone',[side*.008,headY+.010,headZ-.001],[.012,.016,.009],coat,{rotation:[-.12,0,side*-.15],motion:'head',pivot:neckPivot});
      add('cone',[side*.008,headY+.011,headZ+.002],[.006,.009,.003],COLORS.pink,{motion:'head',pivot:neckPivot});
      for(const line of [-1,0,1])segment([side*.005,muzzleY,muzzleZ+.004],[side*.019,muzzleY+line*.003,muzzleZ+.003],.0007,COLORS.cream,'head',neckPivot);
    } else if(dog) {
      ball([side*.015,headY+.003,headZ-.003],[.012,.031,.016],COLORS.brown,{rotation:[-.10,0,side*-.22],motion:'head',pivot:neckPivot});
    } else if(deer) {
      ball([side*.023,headY+.016,headZ-.009],[.016,.011,.031],coat,{rotation:[-.25,side*.8,0],motion:'head',pivot:neckPivot});
      ball([side*.023,headY+.019,headZ-.008],[.01,.005,.023],COLORS.cream,{rotation:[-.25,side*.8,0],motion:'head',pivot:neckPivot});
      // Small branching antlers read clearly without oversizing the animal.
      segment([side*.009,.175,.061],[side*.017,.193,.051],.003,COLORS.cream,'head',neckPivot);
      segment([side*.014,.185,.055],[side*.026,.19,.059],.002,COLORS.cream,'head',neckPivot);
      segment([side*.017,.188,.053],[side*.01,.194,.046],.002,COLORS.cream,'head',neckPivot);
    } else {
      ball([side*.006,.047,.018],[.008,.030,.009],COLORS.grey,{rotation:[-.16,0,side*-.10],motion:'ear',pivot:[side*.006,.036,.018],phase:side});
      ball([side*.006,.048,.022],[.004,.022,.003],COLORS.pink,{rotation:[-.16,0,side*-.10],motion:'ear',pivot:[side*.006,.036,.018],phase:side});
    }
  }
  if(dog) {
    add('cylinder',[0,.059,.039],[.031,.004,.026],COLORS.collar,{rotation:[Math.PI/2,0,0]});
    ball([0,.044,.043],[.004,.005,.002],0xd1aa4f);
    ball([-.013,centerY+.009,-.021],[.016,.021,.033],COLORS.brown);
  }
  if(cat)for(const z of [-.016,-.006,.004])ball([0,.042,z],[.024,.0025,.004],COLORS.brown);
  if(deer) {
    ball([0,.092,-.012],[.037,.027,.083],COLORS.cream);
    ball([0,.115,-.057],[.029,.04,.011],COLORS.cream);
  }
  for(const front of [-1,1])for(const side of [-1,1]) {
    const x=side*body[0]*(rabbit?.28:.31),z=front*body[2]*.29,top=centerY-(deer?.016:.006);
    const pivot:Triple=[x,top,z],phase=front*side;
    if(rabbit&&front<0)ball([x,.019,z],[.02,.025,.023],coat,{motion:'leg',pivot,phase});
    segment([x,top,z],[x,.009,z+(front<0?.003:0)],deer?.007:cat?.0065:.009,coat,'leg',pivot,phase);
    ball([x,.005,z+.004],[deer?.009:cat?.008:.012,.009,rabbit?.019:.014],deer?COLORS.dark:COLORS.cream,{motion:'leg',pivot,phase});
  }
  const tailRoot:Triple=[0,centerY+body[1]*.10,-body[2]*.44];
  if(cat) {
    segment(tailRoot,[0,.042,-.059],.0055,coat,'tail',tailRoot);
    segment([0,.042,-.059],[0,.055,-.071],.0045,coat,'tail',tailRoot);
    segment([0,.055,-.071],[0,.058,-.076],.004,COLORS.brown,'tail',tailRoot);
  } else if(dog) {
    segment(tailRoot,[0,.061,-.067],.009,coat,'tail',tailRoot);
    segment([0,.061,-.067],[0,.068,-.079],.0065,COLORS.white,'tail',tailRoot);
  } else if(deer)ball([0,.13,-.066],[.017,.014,.027],COLORS.cream,{motion:'tail',pivot:tailRoot});
  else ball([0,.024,-.027],[.015,.015,.015],COLORS.white,{motion:'tail',pivot:tailRoot});
  return parts;
}

export function createAnimalSystem(initialState:CityState) {
  const group=new THREE.Group();group.name='Neighborhood pets and woodland wildlife';
  let state=initialState,masks=habitats(state),animals=spawnAnimals(state,masks),disposed=false,vehicle:({speed:number}&Vec)|null=null;
  const geometries:Record<Shape,THREE.BufferGeometry>={sphere:new THREE.SphereGeometry(.5,16,12),cylinder:new THREE.CylinderGeometry(.5,.5,1,10),cone:new THREE.ConeGeometry(.5,1,6)};
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92,metalness:0});
  const templates=Object.fromEntries(speciesList.map(species=>[species,model(species)])) as Record<AnimalSpecies,Part[]>;
  const batches:Batch[]=[];
  const object=new THREE.Object3D(),root=new THREE.Matrix4(),local=new THREE.Matrix4(),motion=new THREE.Matrix4(),left=new THREE.Matrix4(),right=new THREE.Matrix4(),axis=new THREE.Vector3(1,0,0),color=new THREE.Color();
  const quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),origin=new THREE.Vector3();
  function signature(next:CityState):number {let value=next.seed^next.size;for(const tile of next.tiles){const code=tile.kind==='empty'?1:tile.kind==='tree'?2:tile.kind==='park'?3:tile.kind==='residential'?(tile.level>0?5:4):tile.kind==='road'?6:tile.kind==='water'?7:8;value=Math.imul(value^code^Math.round(tile.elevation*100)^(tile.fire>0?512:0),16777619);}return value;}
  let lastSignature=signature(state);
  function rebuildBatches():void {
    for(const batch of batches){group.remove(batch.mesh);batch.mesh.dispose();}batches.length=0;
    for(const shape of Object.keys(geometries) as Shape[]) {
      const instances:Instance[]=[];
      for(const animal of animals)for(const part of templates[animal.species])if(part.shape===shape) {
        object.position.set(...part.position);object.scale.set(...part.scale);object.rotation.set(...(part.rotation??[0,0,0]));object.updateMatrix();
        instances.push({animal,part,index:instances.length,rest:object.matrix.clone()});
      }
      if(!instances.length)continue;
      const mesh=new THREE.InstancedMesh(geometries[shape],material,instances.length);mesh.name=`Animal ${shape} instances`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for(const instance of instances)mesh.setColorAt(instance.index,color.setHex(instance.part.color));
      mesh.userData.ambientAnimals=true;group.add(mesh);batches.push({mesh,instances});
    }
  }
  function chooseTarget(animal:Animal,flee=false):boolean {
    const radius=RADII[animal.species];
    for(let attempt=0;attempt<20;attempt++) {
      const salt=animal.id*1301+(animal.steps++)*71;
      let x=animal.home.x+(random(state.seed,salt)-.5)*radius*2,z=animal.home.z+(random(state.seed,salt+33)-.5)*radius*2;
      if(flee&&vehicle) {
        const dx=animal.x-vehicle.x,dz=animal.z-vehicle.z,length=Math.hypot(dx,dz)||1;
        x=animal.x+dx/length*(.3+random(state.seed,salt))+(random(state.seed,salt+8)-.5)*.5;
        z=animal.z+dz/length*(.3+random(state.seed,salt))+(random(state.seed,salt+9)-.5)*.5;
      }
      const tile=tileAt(state,Math.floor(x+state.size/2),Math.floor(z+state.size/2));
      if(tile?.kind==='park'){if(random(state.seed,salt)>.5)x=tile.x-state.size/2+.5;else z=tile.z-state.size/2+.5;}
      if(!safePosition(state,masks,animal.species,x,z))continue;
      // Every segment is checked, so a valid destination cannot cross a road or a house.
      const count=Math.ceil(Math.hypot(x-animal.x,z-animal.z)/.05);let valid=count>0;
      for(let i=1;i<=count&&valid;i++)valid=safePosition(state,masks,animal.species,animal.x+(x-animal.x)*i/count,animal.z+(z-animal.z)*i/count);
      if(valid){animal.target={x,z};animal.wait=0;return true;}
    }
    animal.wait=.7+random(state.seed,animal.id*41+animal.steps)*1.8;return false;
  }
  function draw(time:number):void {
    for(const batch of batches) {
      for(const {animal,part,index,rest} of batch.instances) {
        const gait=animal.distance*(animal.species==='deer'?58:125)+animal.phase,bounce=animal.moving?(animal.species==='rabbit'?Math.abs(Math.sin(gait))*.006:Math.sin(gait*2)*.0007):0;
        origin.set(animal.x,animal.y+bounce,animal.z);quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,animal.heading);root.compose(origin,quaternion,scale);
        local.copy(rest);
        if(part.motion&&part.pivot) {
          let angle=0;axis.set(1,0,0);
          if(part.motion==='leg')angle=animal.moving?Math.sin(gait+(part.phase===1?Math.PI:0))*(animal.species==='rabbit'?.24:.40):0;
          if(part.motion==='tail'){axis.set(0,1,0);angle=Math.sin(time*(animal.species==='dog'?7:1.6)+animal.phase)*(animal.species==='dog'?.55:.17);}
          if(part.motion==='head')angle=Math.sin(time*.65+animal.phase)*(animal.moving?.035:.11);
          if(part.motion==='ear')angle=Math.sin(time*1.3+animal.phase+(part.phase??0))*.07;
          motion.makeRotationAxis(axis,angle);left.makeTranslation(...part.pivot);right.makeTranslation(-part.pivot[0],-part.pivot[1],-part.pivot[2]);
          local.premultiply(right).premultiply(motion).premultiply(left);
        }
        batch.mesh.setMatrixAt(index,local.premultiply(root));
      }
      batch.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  rebuildBatches();draw(0);
  return {
    group,
    update(next:CityState):void {
      if(disposed)return;state=next;const currentSignature=signature(next);if(currentSignature===lastSignature)return;
      lastSignature=currentSignature;masks=habitats(state);animals=spawnAnimals(state,masks);rebuildBatches();draw(0);
    },
    setVehicle(next:({speed:number}&Vec)|null):void {vehicle=next;},
    animate(dt:number,time:number,_focus?:Vec):void {
      if(disposed)return;const step=Math.min(.08,Math.max(0,Number.isFinite(dt)?dt:0));
      for(const animal of animals) {
        const wasFleeing=animal.fleeing;
        animal.fleeing=!!vehicle&&Math.abs(vehicle.speed)>.2&&Math.hypot(animal.x-vehicle.x,animal.z-vehicle.z)<1.3;
        animal.moving=false;if(!state.speed&&!animal.fleeing)continue;
        animal.wait-=step;
        if(animal.fleeing&&(!wasFleeing||Math.hypot(animal.target.x-animal.x,animal.target.z-animal.z)<.02))chooseTarget(animal,true);
        else if(animal.wait>0)continue;
        const dx=animal.target.x-animal.x,dz=animal.target.z-animal.z,distance=Math.hypot(dx,dz);
        if(distance<.015){if(animal.wait<=0){chooseTarget(animal);if(random(state.seed,animal.steps*151+animal.id)<.3)animal.wait=1+random(state.seed,animal.id+animal.steps)*4;}continue;}
        const speed=SPEEDS[animal.species]*(animal.fleeing?3:1),move=Math.min(distance,speed*step),x=animal.x+dx/distance*move,z=animal.z+dz/distance*move;
        if(!safePosition(state,masks,animal.species,x,z)){animal.target={x:animal.x,z:animal.z};animal.wait=.4;continue;}
        animal.x=x;animal.z=z;animal.y=groundHeight(state,x,z);animal.moving=true;animal.distance+=move;
        const desired=Math.atan2(dx,dz),difference=Math.atan2(Math.sin(desired-animal.heading),Math.cos(desired-animal.heading));animal.heading+=THREE.MathUtils.clamp(difference,-step*5,step*5);
      }
      draw(Number.isFinite(time)?time:0);
    },
    getObservations():AnimalObservation[] {return animals.map(({species,x,z})=>({species,x,z}));},
    getDebug(){return {count:animals.length,counts:Object.fromEntries(speciesList.map(species=>[species,animals.filter(a=>a.species===species).length])) as Record<AnimalSpecies,number>,positions:animals.map(({id,species,x,y,z,heading,moving,fleeing,height})=>({id,species,x,y,z,heading,moving,fleeing,height})),drawCalls:batches.length,instances:batches.reduce((sum,batch)=>sum+batch.instances.length,0)};},
    dispose():void {if(disposed)return;disposed=true;for(const batch of batches)batch.mesh.dispose();for(const geometry of Object.values(geometries))geometry.dispose();material.dispose();group.clear();batches.length=0;animals=[];vehicle=null;},
  };
}
