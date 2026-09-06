import type { BuildOptions, BuildPreview, BuildResult, CitizenIncident, CityState, DisasterKind, GameEvent, Point, Stats, Tile, TileKind, Tool, ToolDefinition } from './types';
import { getTerrainElevation, legacyWaterTerrain, MAX_ELEVATION, MIN_ELEVATION, TERRAIN_STEP } from './terrain';
import { createProgression, getRank, isToolUnlocked, normalizeProgression, recordBuild, updateProgression } from './progression';
import { eventText, formatNumber, tr } from './i18n';
import { applyFacilityPowerFeeds } from './power-service';
import { getPowerBlockMask } from './power-block';
export { isWaterTerrain } from './terrain';

type BilingualText = readonly [string, string];
const definition=(name:BilingualText,cost:number,upkeep:number,category:ToolDefinition['category'],color:string,icon:string,description:BilingualText,footprint?:[number,number]):ToolDefinition=>({get name(){return tr(...name);},cost,upkeep,category,color,icon,get description(){return tr(...description);},...(footprint?{footprint}:{})});
export const TOOL_DEFS:Partial<Record<Tool,ToolDefinition>>={
 residential:definition(['Wohngebiet','Residential zone'],40,0,'zones','#75b87c','House',['Wohnraum wächst bei Straßen-, Wasser- und Stromanschluss des zusammenhängenden Blocks.','Homes grow when connected to roads, a powered city block and water.']),
 commercial:definition(['Gewerbegebiet','Commercial zone'],60,0,'zones','#68a8dc','Store',['Geschäfte, Büros und Arbeitsplätze. Benötigt Kunden und Versorgung.','Shops, offices and jobs. Needs customers and utility connections.']),
 industrial:definition(['Industriegebiet','Industrial zone'],70,0,'zones','#d7b35c','Factory',['Fabriken, Lagerhallen und Werkstätten schaffen Jobs und Umweltbelastung.','Factories, warehouses and workshops provide jobs and create pollution.']),
 road:definition(['Straße','Road'],18,.4,'transport','#899398','Route',['Erschließt Grundstücke. Stromleitungen und Wasserrohre werden separat verlegt. Über Wasser entsteht eine Brücke.','Provides access to lots. Power lines and water pipes are built separately. Becomes a bridge over water.']),
 rail:definition(['Bahnstrecke','Railway'],35,.6,'transport','#a4abb0','TrainFront',['Entlastet den Straßenverkehr im Umkreis. Brückenbau über Wasser möglich.','Reduces nearby road traffic. Bridges can be built over water.']),
 pipe:definition(['Wasserrohr','Water pipe'],8,.08,'utilities','#63bdd1','Droplets',['Unterirdisches Leitungsnetz. Versorgt Grundstücke bis zwei Felder Abstand. Mit dem Wasserwerk verbinden.','Underground network. Supplies lots within two tiles. Connect it to a waterworks.']),
 powerline:definition(['Stromleitung','Power line'],12,.08,'utilities','#edbd67','Cable',['Verbinde eine Kante jedes von Straßen umschlossenen Blocks. Im offenen Gelände müssen die Gebiete einander berühren. Große Anlagen erhalten sichtbare Anschlüsse ohne Straßenquerung. Verlegte Stromleitungen dürfen Straßen kreuzen.','Connect one edge of each enclosed street block. In open terrain, zones must touch. Large facilities have visible service cables that never cross roads. Explicit power lines can cross roads.']),
 power:definition(['Kraftwerk','Power plant'],6500,320,'utilities','#edbd67','Zap',['4 × 4 Felder. Liefert 6.000 Stromeinheiten an angeschlossene Leitungen.','4 × 4 tiles. Supplies 6,000 power units to connected lines.'],[4,4]),
 waterpump:definition(['Wasserwerk','Waterworks'],2200,180,'utilities','#63bdd1','Droplets',['2 × 2 Felder. Mit Stromanschluss 6.000 Einheiten Wasser im eigenen Rohrnetz.','2 × 2 tiles. Supplies 6,000 water units to its own pipe network when powered.'],[2,2]),
 wind:definition(['Windpark','Wind farm'],3600,65,'utilities','#b6d2c3','Wind',['2 × 2 Felder. Sauberer Strom: 1.200 Einheiten ohne Luftbelastung.','2 × 2 tiles. Clean power: 1,200 units without air pollution.'],[2,2]),
 solar:definition(['Solarpark','Solar farm'],6200,100,'utilities','#84a9d1','Sun',['4 × 3 Felder. Saubere Energie mit Speichersystem: 3.200 Einheiten.','4 × 3 tiles. Clean energy with storage: 3,200 units.'],[4,3]),
 park:definition(['Stadtpark','City park'],150,5,'nature','#7faf71','Trees',['Erhöht Grundstückswert und Lebensqualität in der Nachbarschaft.','Increases local land values and quality of life.']),
 tree:definition(['Bäume','Trees'],12,0,'nature','#608765','TreePine',['Begrünt freie Flächen und verbessert die lokale Luftqualität.','Adds greenery to open land and improves local air quality.']),
 police:definition(['Polizeiwache','Police station'],1900,125,'services','#79a8c1','Shield',['2 × 2 Felder. Sicherheit im Umkreis, abhängig von Versorgung und Polizeibudget.','2 × 2 tiles. Local safety depends on utilities and the police budget.'],[2,2]),
 fire:definition(['Feuerwache','Fire station'],1600,95,'services','#d58569','Flame',['3 × 2 Felder. Versorgte Löschzüge verhindern Brandschäden in der Nachbarschaft.','3 × 2 tiles. Supplied fire crews prevent fire damage in the neighborhood.'],[3,2]),
 hospital:definition(['Klinik','Hospital'],3200,150,'services','#cf97a9','HeartPulse',['3 × 3 Felder. Gesundheitsversorgung für die umliegenden Stadtviertel.','3 × 3 tiles. Healthcare for the surrounding districts.'],[3,3]),
 school:definition(['Schule','School'],1800,100,'services','#bba5cf','GraduationCap',['3 × 2 Felder. Bildung fördert Wachstum und Zufriedenheit.','3 × 2 tiles. Education promotes growth and happiness.'],[3,2]),
 university:definition(['Universität','University'],12000,280,'services','#bba5cf','BookOpen',['5 × 4 Felder. Forschung, 160 Arbeitsplätze und höhere Bildung im weiten Umkreis.','5 × 4 tiles. Research, 160 jobs and higher education over a wide area.'],[5,4]),
 recycling:definition(['Recyclinghof','Recycling center'],5200,110,'services','#89b394','Recycle',['3 × 3 Felder. Reduziert die Umweltbelastung in einem großen Umkreis.','3 × 3 tiles. Reduces pollution over a wide area.'],[3,3]),
 stadium:definition(['Stadion','Stadium'],9000,180,'special','#b7c08a','Trophy',['6 × 5 Felder. Sportarena mit 120 Jobs und höherer Wohnraumnachfrage.','6 × 5 tiles. Sports arena with 120 jobs and increased housing demand.'],[6,5]),
 airport:definition(['Flughafen','Airport'],16000,290,'special','#abc2cf','Plane',['10 × 6 Felder. Terminal und Startbahn, 180 Jobs und höhere Gewerbenachfrage.','10 × 6 tiles. Terminal and runway, 180 jobs and increased commercial demand.'],[10,6]),
 seaport:definition(['Hafen','Seaport'],9500,160,'special','#81aeb8','Ship',['5 × 3 Felder. Kaimauer muss direkt ans Wasser grenzen. Mit R drehen. 120 Jobs und Industriebonus.','5 × 3 tiles. The quay must directly border water. Rotate with R. 120 jobs and an industry bonus.'],[5,3]),
 raise:definition(['Gelände anheben','Raise terrain'],35,0,'terrain','#adba88','Mountain',['Hebt freies Gelände um 5 Meter an. Wasser lässt sich zu Bauland aufschütten.','Raises open terrain by 5 meters. Water can be filled to create building land.']),
 lower:definition(['Gelände absenken','Lower terrain'],35,0,'terrain','#8aaab6','ArrowDownToLine',['Senkt freies Gelände um 5 Meter ab. Unter dem Meeresspiegel entsteht Wasser.','Lowers open terrain by 5 meters. Creates water below sea level.']),
 level:definition(['Gelände einebnen','Level terrain'],35,0,'terrain','#bcab85','AlignVerticalDistributeCenter',['Gleicht freies Gelände an die Höhe des zuerst angeklickten Felds an. 35 € je 5 Meter und Feld.','Levels open terrain to the height of the first tile selected. €35 per 5 meters per tile.']),
};
const ZONES:TileKind[]=['residential','commercial','industrial'];
const KINDS:TileKind[]=['empty','water','tree','road','rail','residential','commercial','industrial','power','waterpump','park','police','fire','hospital','school','stadium','airport','seaport','rubble','wind','solar','university','recycling'];
const POP=[0,12,28,52,88],COM_JOBS=[0,10,26,50,88],IND_JOBS=[0,24,48,80,112];
const clamp=(v:number,min=0,max=100)=>Math.max(min,Math.min(max,v));
const inBounds=(state:CityState,x:number,z:number)=>Number.isInteger(x)&&Number.isInteger(z)&&x>=0&&z>=0&&x<state.size&&z<state.size;
const tileAt=(state:CityState,x:number,z:number):Tile|undefined=>inBounds(state,x,z)?state.tiles[z*state.size+x]:undefined;
const isZone=(kind:TileKind)=>ZONES.includes(kind);
const isFacility=(kind:TileKind)=>!!TOOL_DEFS[kind]?.footprint;
const isBuilding=(kind:TileKind)=>isZone(kind)||isFacility(kind);
const hasStructure=(tile:Tile)=>isBuilding(tile.kind)&&(!isZone(tile.kind)||tile.level>0);
const point=(t:Point):Point=>({x:t.x,z:t.z});
const terrainKind=(t:Tile):TileKind=>t.elevation<0?'water':'empty';
function random(seed:number,a:number,b=0,c=0):number {let n=(seed^Math.imul(a+31,374761393)^Math.imul(b+17,668265263)^Math.imul(c+1,1274126177))|0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
function newTile(x:number,z:number,seed:number,elevation:number,kind:TileKind= elevation<0?'water':'empty'):Tile {return {x,z,kind,level:0,variation:Math.floor(random(seed,x,z)*1000),powered:false,watered:false,connected:false,pollution:0,landValue:55,traffic:0,fire:0,age:0,elevation,hasPipe:false,hasPowerLine:false,anchor:-1,rotation:0};}
function blankStats():Stats {return {population:0,jobs:0,happiness:70,income:0,expenses:0,balance:0,powerSupply:0,powerDemand:0,waterSupply:0,waterDemand:0,residentialDemand:80,commercialDemand:15,industrialDemand:55,pollution:0,traffic:0,education:25,health:35,safety:35,parks:0};}
function addEvent(state:CityState,title:BilingualText,message:BilingualText,type:GameEvent['type']='info'):void {state.events.unshift({id:(state.events[0]?.id??0)+1,month:state.month,...eventText(title[0],title[1],message[0],message[1]),type});state.events=state.events.slice(0,40);}
export function isBuildingAnchor(state:CityState,tile:Tile):boolean {return tile.anchor<0||tile.anchor===tile.z*state.size+tile.x;}
export function getFootprint(state:CityState,tile:Tile):Point[] {
 if(tile.anchor<0)return [point(tile)];
 const root=state.tiles[tile.anchor];if(!root)return [point(tile)];
 const [w,d]=dimensions(root.kind,root.rotation),out:Point[]=[];
 for(let z=root.z;z<root.z+d;z++)for(let x=root.x;x<root.x+w;x++){const t=tileAt(state,x,z);if(t&&t.anchor===tile.anchor)out.push({x,z});}
 return out.length?out:[point(tile)];
}
function dimensions(tool:Tool,rotation=0):[number,number] {const [w,d]=TOOL_DEFS[tool]?.footprint??[1,1];return rotation%2?[d,w]:[w,d];}
function rootTile(state:CityState,t:Tile):Tile {return t.anchor>=0?state.tiles[t.anchor]??t:t;}
function clearTile(t:Tile,clearUtilities=false):void {t.kind=terrainKind(t);t.level=0;t.age=0;t.fire=0;t.anchor=-1;t.rotation=0;if(clearUtilities){t.hasPipe=false;t.hasPowerLine=false;}}
function placeFacility(state:CityState,p:Point,kind:TileKind,rotation:0|1|2|3=0):void {const [w,d]=dimensions(kind,rotation),anchor=p.z*state.size+p.x;for(let z=p.z;z<p.z+d;z++)for(let x=p.x;x<p.x+w;x++){const t=tileAt(state,x,z)!;t.kind=kind;t.anchor=anchor;t.rotation=rotation;t.level=1;t.fire=0;t.age=0;}}
function connectFacility(state:CityState,p:Point):void {
 const root=tileAt(state,p.x,p.z)!;const members=getFootprint(state,root);let best:Point|null=null,edge:Point=p,distance=Infinity;
 const roads=state.tiles.filter(t=>t.kind==='road');
 for(const a of members)for(const r of roads){const d=Math.abs(a.x-r.x)+Math.abs(a.z-r.z);if(d<distance){distance=d;best=point(r);edge=a;}}
 if(!best)return;
 let x=edge.x,z=edge.z;
 const connect=()=>{const t=tileAt(state,x,z)!;t.hasPipe=true;t.hasPowerLine=true;if(['empty','tree','rubble'].includes(t.kind))t.kind='road';};
 connect();while(x!==best.x){x+=Math.sign(best.x-x);connect();}while(z!==best.z){z+=Math.sign(best.z-z);connect();}
}
export function createCity(seed=2026,empty=false,size=128):CityState {
 seed=Number.isFinite(seed)?Math.trunc(seed)>>>0:2026;if(![40,64,96,128].includes(size))size=128;
 const state:CityState={version:2,citizenEffects:{populationLoss:0,happinessPenalty:0,incidents:[]},name:'Lindenbucht',size,seed,tiles:[],money:85000,month:0,speed:1,tax:9,funding:{police:100,fire:100,health:100,education:100},loan:0,stats:blankStats(),events:[],history:[],revision:0,milestone:0,progression:createProgression(),settings:{disastersEnabled:false,weather:'clear',dayNightCycle:true,timeOfDay:14,buildingLights:true}};
 const offset=Math.floor((size-40)*.4);
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){const elevation=getTerrainElevation(x,z,size,seed);const forest=!empty&&elevation>=0&&!(x>=offset+7&&x<=offset+29&&z>=offset+7&&z<=offset+29)&&random(seed,x,z)<.22+.15*Math.sin(x*.17+z*.13);state.tiles.push(newTile(x,z,seed,elevation,forest?'tree':elevation<0?'water':'empty'));}
 if(!empty){
  for(let z=8;z<=28;z++)for(let x=8;x<=28;x++){
   const t=tileAt(state,x+offset,z+offset)!;t.elevation=0;
   if((x-8)%5===0||(z-8)%5===0){t.kind='road';t.hasPipe=true;t.hasPowerLine=true;continue;}
   const r=random(seed,x,z,3),downtown=Math.abs(x-18)+Math.abs(z-17);
   if(x>=24&&z>=23&&r<.84){t.kind='industrial';t.level=r<.35?2:1;}
   else if(downtown<8&&r<.48){t.kind='commercial';t.level=downtown<4?3:2;}
   else if(r<.55&&!(x>=24&&z>=20)){t.kind='residential';t.level=downtown<6?(r<.25?4:3):downtown<12?2:1;}
   else if(r>.83)t.kind='tree';t.age=t.level?12:0;
  }
  for(const [x,z] of [[17,17],[19,17],[17,19],[12,12],[22,12],[12,22],[22,22],[27,12]]){const t=tileAt(state,x+offset,z+offset)!;t.kind='park';t.level=0;}
  for(const [x,z,kind] of [[14,3,'power'],[24,4,'waterpump'],[3,11,'school'],[3,17,'police'],[3,21,'fire'],[14,30,'hospital']] as const){const p={x:x+offset,z:z+offset};const [w,d]=dimensions(kind);for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)tileAt(state,p.x+dx,p.z+dz)!.elevation=0;placeFacility(state,p,kind);connectFacility(state,p);}
  for(const t of state.tiles)if(isZone(t.kind))t.level=Math.min(t.level,2);
  let population=state.tiles.reduce((s,t)=>s+(t.kind==='residential'?POP[t.level]:0),0);
  for(const t of state.tiles.filter(t=>t.kind==='residential').sort((a,b)=>a.level-b.level)){if(population<=2200)break;if(t.level===1){population-=POP[t.level];t.kind='tree';t.level=0;}else {population-=POP[t.level]-POP[t.level-1];t.level--;}}
  for(const t of state.tiles){if(population>=2000)break;if(t.kind==='residential'&&t.level<2){population+=POP[t.level+1]-POP[t.level];t.level++;}}
  addEvent(state,['Willkommen in Lindenbucht','Welcome to Lindenbucht'],['Deine Stadt ist bereit. Neue Viertel, Forschung und Stadtaufträge warten auf dich. Straßen, Stromleitungen und Wasserrohre bilden eigene Netze.','Your city is ready. New districts, research and city missions await. Roads, power lines and water pipes form separate networks.'],'good');
 }else addEvent(state,['Ein neuer Anfang','A fresh start'],['Baue Straßen, Kraftwerk und Wasserwerk. Verbinde Stromleitungen und Wasserrohre mit den Anlagen und erschließe Wohn- und Arbeitsgebiete.','Build roads, a power plant and a waterworks. Connect power lines and water pipes to the facilities and provide access to housing and workplaces.']);
 recalculate(state);state.progression=createProgression(state);updateProgression(state);state.history.push({month:0,population:state.stats.population,money:state.money,happiness:state.stats.happiness});state.revision=0;return state;
}

const OFFSETS=[[-1,0],[1,0],[0,-1],[0,1]] as const;
interface Network {membership:Int32Array;supply:number[];demand:number[];}
function makeNetwork(state:CityState,predicate:(t:Tile)=>boolean):Network {
 const membership=new Int32Array(state.tiles.length).fill(-1),supply:number[]=[],demand:number[]=[];
 for(let i=0;i<state.tiles.length;i++){if(membership[i]>=0||!predicate(state.tiles[i]))continue;const id=supply.length,queue=[i];supply.push(0);demand.push(0);membership[i]=id;for(let p=0;p<queue.length;p++){const t=state.tiles[queue[p]];for(const [dx,dz]of OFFSETS){const neighbor=tileAt(state,t.x+dx,t.z+dz);if(!neighbor)continue;const j=neighbor.z*state.size+neighbor.x;if(membership[j]<0&&predicate(neighbor)){membership[j]=id;queue.push(j);}}}}
 return {membership,supply,demand};
}
function findNetwork(state:CityState,network:Network,tile:Tile):number {
 let best=-1,bestSupply=-1;
 for(const p of getFootprint(state,tile))for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){if(Math.abs(dx)+Math.abs(dz)>2)continue;const t=tileAt(state,p.x+dx,p.z+dz);if(!t)continue;const id=network.membership[t.z*state.size+t.x];if(id>=0&&network.supply[id]>bestSupply){best=id;bestSupply=network.supply[id];}}
 return best;
}
function utilityUse(t:Tile):[number,number] {if(t.kind==='residential')return [6+t.level*8,5+t.level*7];if(t.kind==='commercial')return [8+t.level*14,6+t.level*9];if(t.kind==='industrial')return [12+t.level*18,10+t.level*15];if(['power','wind','solar'].includes(t.kind))return [0,0];if(t.kind==='waterpump')return [80,0];if(isFacility(t.kind))return [50,35];return [0,0];}
function capacity(kind:TileKind):number {return kind==='power'?6000:kind==='wind'?1200:kind==='solar'?3200:0;}
function stamp(state:CityState,field:Float32Array,t:Point,radius:number,strength:number,maximum=false):void {for(let z=Math.max(0,t.z-radius+1);z<=Math.min(state.size-1,t.z+radius-1);z++)for(let x=Math.max(0,t.x-radius+1);x<=Math.min(state.size-1,t.x+radius-1);x++){const d=Math.abs(x-t.x)+Math.abs(z-t.z);if(d>=radius)continue;const id=z*state.size+x,v=strength*(1-d/radius);field[id]=maximum?Math.max(field[id],v):field[id]+v;}}
/** Every influence field is stamped locally. No all-tiles × all-buildings loops. */
export function recalculate(state:CityState):void {
 state.tax=clamp(state.tax,0,25);for(const key of Object.keys(state.funding) as (keyof CityState['funding'])[])state.funding[key]=clamp(state.funding[key],0,150);
 const n=state.tiles.length,stats=blankStats(),anchors=state.tiles.filter(t=>isBuildingAnchor(state,t)),buildings=anchors.filter(t=>isBuilding(t.kind));
 const roadAccess=new Float32Array(n);for(const t of state.tiles)if(t.kind==='road')stamp(state,roadAccess,t,3,1,true);
 const blockMask=getPowerBlockMask(state);
 const power=makeNetwork(state,t=>t.fire===0&&(t.hasPowerLine||isBuilding(t.kind)||blockMask[t.z*state.size+t.x]===1)),water=makeNetwork(state,t=>t.hasPipe||t.kind==='waterpump');
 for(const t of buildings){const supply=t.fire===0?capacity(t.kind):0;stats.powerSupply+=supply;if(supply){const id=power.membership[t.z*state.size+t.x];if(id>=0)power.supply[id]+=supply;}}
 applyFacilityPowerFeeds(state,power,buildings.filter(t=>isFacility(t.kind)),t=>getFootprint(state,t),hasStructure);
 const powerAssigned=new Int32Array(n).fill(-1),waterAssigned=new Int32Array(n).fill(-1);
 let commercialJobs=0,industrialJobs=0;
 for(const t of anchors){const i=t.z*state.size+t.x;const [p,w]=utilityUse(t);stats.powerDemand+=p;stats.waterDemand+=w;const id=power.membership[i];powerAssigned[i]=id;if(id>=0)power.demand[id]+=p;if(t.kind==='residential')stats.population+=POP[t.level];if(t.kind==='commercial')commercialJobs+=COM_JOBS[t.level];if(t.kind==='industrial')industrialJobs+=IND_JOBS[t.level];if(t.kind==='park')stats.parks++;}
 for(const t of anchors){const i=t.z*state.size+t.x,id=powerAssigned[i],source=capacity(t.kind)>0&&t.fire===0;t.connected=getFootprint(state,t).some(p=>roadAccess[p.z*state.size+p.x]>0);t.powered=t.fire===0&&(source||id>=0&&power.supply[id]>0&&random(state.seed,t.x,t.z,111)<Math.min(1,power.supply[id]/Math.max(1,power.demand[id])));if(t.kind==='waterpump'&&t.powered){const w=water.membership[i];if(w>=0){water.supply[w]+=6000;stats.waterSupply+=6000;}}}
 for(const t of anchors){const i=t.z*state.size+t.x,id=findNetwork(state,water,t);waterAssigned[i]=id;if(id>=0)water.demand[id]+=utilityUse(t)[1];}
 for(const t of anchors){const i=t.z*state.size+t.x,id=waterAssigned[i];t.watered=t.fire===0&&id>=0&&water.supply[id]>0&&random(state.seed,t.x,t.z,222)<Math.min(1,water.supply[id]/Math.max(1,water.demand[id]));for(const p of getFootprint(state,t)){const f=state.tiles[p.z*state.size+p.x];f.connected=t.connected;f.powered=t.powered;f.watered=t.watered;}}
 const green=new Float32Array(n),pollutionField=new Float32Array(n),movement=new Float32Array(n),railField=new Float32Array(n),policeField=new Float32Array(n),fireField=new Float32Array(n),hospitalField=new Float32Array(n),schoolField=new Float32Array(n),coast=new Float32Array(n);
 const functional=(kind:TileKind)=>buildings.filter(t=>t.kind===kind&&t.connected&&t.powered&&t.watered&&t.fire===0);
 const police=functional('police'),fire=functional('fire'),hospitals=functional('hospital'),schools=functional('school'),universities=functional('university'),recycling=functional('recycling');
 for(const t of state.tiles){if(t.kind==='tree'||t.kind==='park')stamp(state,green,t,5,t.kind==='park'?7:1.6);if(t.kind==='rail')stamp(state,railField,t,5,1,true);if(t.elevation<0)stamp(state,coast,t,3,10,true);}
 for(const t of buildings){if(t.kind==='industrial'&&t.level>0||t.kind==='power'||t.kind==='airport')stamp(state,pollutionField,t,t.kind==='power'?9:6,t.kind==='power'?55:t.kind==='airport'?38:20+t.level*9);stamp(state,movement,t,3,t.kind==='residential'?POP[t.level]*.13:t.kind==='commercial'?COM_JOBS[t.level]*.18:t.kind==='industrial'?IND_JOBS[t.level]*.2:2);}
 for(const t of police)stamp(state,policeField,t,18,1,true);for(const t of fire)stamp(state,fireField,t,18,1,true);for(const t of hospitals)stamp(state,hospitalField,t,20,1,true);for(const t of schools)stamp(state,schoolField,t,19,1,true);for(const t of universities)stamp(state,schoolField,t,30,1.25,true);for(const t of recycling)stamp(state,green,t,14,24);
 const stadiums=functional('stadium').length,airports=functional('airport').length,seaports=functional('seaport').length;
 stats.jobs=commercialJobs+industrialJobs+stadiums*120+airports*180+seaports*120+police.length*12+fire.length*12+hospitals.length*35+schools.length*20+universities.length*160+recycling.length*25;
 let peopleWeight=0,edu=0,health=0,safety=0,pollution=0,traffic=0,utilityCoverage=0,parkAccess=0;
 for(let i=0;i<n;i++){const t=state.tiles[i];t.pollution=Math.round(clamp(pollutionField[i]-green[i]));t.traffic=Math.round(clamp(movement[i]*(railField[i]>0?.6:1)*(t.kind==='road'?1.4:.8)));t.landValue=Math.round(clamp(58+green[i]*1.2+coast[i]+policeField[i]*10+schoolField[i]*10-t.pollution*.6-t.traffic*.12));
  if(t.kind==='residential'&&t.level>0){const weight=POP[t.level];peopleWeight+=weight;edu+=(25+schoolField[i]*65*state.funding.education/100)*weight;health+=(35+hospitalField[i]*65*state.funding.health/100-t.pollution*.15)*weight;safety+=(35+policeField[i]*65*state.funding.police/100)*weight;pollution+=t.pollution*weight;traffic+=t.traffic*weight;utilityCoverage+=(t.powered&&t.watered&&t.connected?1:0)*weight;parkAccess+=clamp(green[i]/20,0,1)*weight;}
 }
 stats.education=Math.round(clamp(peopleWeight?edu/peopleWeight:25));stats.health=Math.round(clamp(peopleWeight?health/peopleWeight:35));stats.safety=Math.round(clamp(peopleWeight?safety/peopleWeight:35));stats.pollution=Math.round(peopleWeight?pollution/peopleWeight:0);stats.traffic=Math.round(peopleWeight?traffic/peopleWeight:0);
 stats.population=Math.max(0,stats.population-state.citizenEffects.populationLoss);
 const jobRatio=stats.jobs/Math.max(50,stats.population*.48);
 stats.happiness=Math.round(clamp(50+Math.min(1,jobRatio)*16+(stats.education+stats.health+stats.safety-135)*.1+(peopleWeight?utilityCoverage/peopleWeight:1)*12+(peopleWeight?parkAccess/peopleWeight:0)*8-(state.tax-9)*2.4-stats.pollution*.25-Math.max(0,stats.traffic-55)*.15-(peopleWeight&&utilityCoverage/peopleWeight<.75?20:0)-state.citizenEffects.happinessPenalty));
 stats.residentialDemand=Math.round(clamp(45+(jobRatio-1)*30+(stats.happiness-65)*.9-(state.tax-9)*2+stadiums*10,-100,100));if(stats.population>=120)stats.residentialDemand=Math.min(stats.residentialDemand,Math.round((jobRatio-.55)*120));
 stats.commercialDemand=Math.round(clamp(40+(stats.population*.18-commercialJobs)/Math.max(60,stats.population*.18)*60+(stats.education-50)*.35-(state.tax-9)*3+airports*18,-100,100));stats.industrialDemand=Math.round(clamp(40+(stats.population*.34-industrialJobs)/Math.max(90,stats.population*.34)*60-(state.tax-9)*3+seaports*18,-100,100));if(stats.population===0){stats.residentialDemand=80;stats.commercialDemand=15;stats.industrialDemand=55;}
 stats.income=Math.round(stats.population*state.tax*.14+(commercialJobs+industrialJobs)*state.tax*.04+stadiums*120+airports*180+seaports*120);
 let upkeep=0;for(const t of anchors){let cost=TOOL_DEFS[t.kind]?.upkeep??0;if(t.kind==='police')cost*=state.funding.police/100;if(t.kind==='fire')cost*=state.funding.fire/100;if(t.kind==='hospital')cost*=state.funding.health/100;if(t.kind==='school'||t.kind==='university')cost*=state.funding.education/100;upkeep+=cost;}for(const t of state.tiles)upkeep+=(t.hasPipe?.08:0)+(t.hasPowerLine?.08:0);
 stats.expenses=Math.ceil(upkeep+state.loan*.005);stats.balance=stats.income-stats.expenses;state.stats=stats;state.revision++;
}

interface PlannedChange {points:Point[];cost:number;elevation?:number;}
interface BuildPlan extends BuildPreview {changes:PlannedChange[];rotation:0|1|2|3;}
function buildUnit(tool:Tool,count:number):string {return TOOL_DEFS[tool]?.footprint?tr('Gebäude',count===1?'building':'buildings'):tr(count===1?'Feld':'Felder',count===1?'tile':'tiles');}
function planBuild(state:CityState,points:Point[],tool:Tool,options:BuildOptions={}):BuildPlan {
 const rotation=options.rotation??0,out:BuildPlan={cost:0,valid:[],invalid:[],message:tr('Hier ist kein Bau möglich.','You cannot build here.'),count:0,changes:[],rotation};
 if(![0,1,2,3].includes(rotation)){out.message=tr('Ungültige Ausrichtung.','Invalid orientation.');return out;}
 if(tool==='inspect'||tool==='pan'||tool!=='bulldoze'&&!TOOL_DEFS[tool]){out.message=tr('Wähle ein Bauwerkzeug.','Select a construction tool.');return out;}
 if(!isToolUnlocked(state,tool)){out.message=tr('Dieses Bauwerk wird durch den Stadtaufstieg freigeschaltet.','This building is unlocked by city progression.');out.invalid=points.map(point);return out;}
 const terrain=['raise','lower','level'].includes(tool),seen=new Set<number>();
 const reject=(p:Point,message:string)=>{out.invalid.push(point(p));out.message=message;};
 const add=(change:PlannedChange)=>{out.changes.push(change);out.valid.push(...change.points);out.cost+=change.cost;out.count++;};
 const target=options.targetElevation??(points[0]?tileAt(state,points[0].x,points[0].z)?.elevation:undefined);
 if(tool==='level'&&(target===undefined||!Number.isFinite(target)||target<MIN_ELEVATION||target>MAX_ELEVATION||Math.abs(target/TERRAIN_STEP-Math.round(target/TERRAIN_STEP))>.001)){out.message=tr('Wähle eine gültige Geländehöhe in 5-Meter-Schritten.','Choose a valid terrain height in 5-meter steps.');out.invalid=points.map(point);return out;}
 if(TOOL_DEFS[tool]?.footprint){
  const p=points[0];if(!p)return out;const [w,d]=dimensions(tool,rotation),members:Point[]=[];const base=tileAt(state,p.x,p.z)?.elevation;
  for(let z=p.z;z<p.z+d;z++)for(let x=p.x;x<p.x+w;x++){const p2={x,z};members.push(p2);const t=tileAt(state,x,z);if(!t)reject(p2,tr('Das gesamte Gebäude muss innerhalb der Karte liegen.','The entire building must fit inside the map.'));else if(t.elevation<0)reject(p2,tr('Das Gebäude benötigt eine vollständig trockene Grundfläche.','The building needs a completely dry footprint.'));else if(!['empty','tree','rubble'].includes(t.kind))reject(p2,tr('Das gesamte Baufeld muss frei sein. Reiße die Bebauung zuerst ab.','The entire site must be clear. Demolish existing buildings first.'));else if(Math.abs(t.elevation-(base??0))>.001)reject(p2,tr('Ebne die gesamte Grundfläche vor dem Bau ein.','Level the entire footprint before building.'));}
  if(!out.invalid.length&&tool==='seaport'){
   const edge:Point[]=[];if(rotation===0)for(let x=p.x;x<p.x+w;x++)edge.push({x,z:p.z+d});if(rotation===1)for(let z=p.z;z<p.z+d;z++)edge.push({x:p.x-1,z});if(rotation===2)for(let x=p.x;x<p.x+w;x++)edge.push({x,z:p.z-1});if(rotation===3)for(let z=p.z;z<p.z+d;z++)edge.push({x:p.x+w,z});
   if(edge.filter(e=>(tileAt(state,e.x,e.z)?.elevation??0)<0).length<2){out.invalid=members;out.message=tr('Die Kaimauer muss mit mindestens zwei Feldern direkt ans Wasser grenzen. Drehe den Hafen mit R.','At least two quay tiles must directly border water. Rotate the seaport with R.');}
  }
  if(out.invalid.length){out.valid=members.filter(p=>!out.invalid.some(i=>i.x===p.x&&i.z===p.z));return out;}
  add({points:members,cost:TOOL_DEFS[tool]!.cost+members.reduce((sum,p)=>sum+(tileAt(state,p.x,p.z)!.kind==='tree'?2:0),0)});
 }else for(const p of points){
  if(!inBounds(state,p.x,p.z)){reject(p,tr('Außerhalb des Stadtgebiets.','Outside the city limits.'));continue;}const t=tileAt(state,p.x,p.z)!,id=p.z*state.size+p.x;if(seen.has(id))continue;seen.add(id);
  if(tool==='bulldoze'){
   const root=rootTile(state,t),rootId=root.z*state.size+root.x;if(rootId!==id&&seen.has(rootId))continue;seen.add(rootId);
   if(['empty','water'].includes(t.kind)&&!t.hasPipe&&!t.hasPowerLine){reject(p,tr('Hier gibt es nichts abzureißen.','There is nothing to demolish here.'));continue;}
   const members=getFootprint(state,t);for(const m of members)seen.add(m.z*state.size+m.x);add({points:members,cost:t.kind==='tree'?2:isBuilding(t.kind)?25:5});continue;
  }
  if(tool==='pipe'||tool==='powerline'){
   if(tool==='pipe'?t.hasPipe:t.hasPowerLine){reject(p,tr('Diese Leitung ist bereits vorhanden.','This utility line already exists.'));continue;}add({points:[point(p)],cost:TOOL_DEFS[tool]!.cost+(t.elevation<0?12:0)});continue;
  }
  if(terrain){
   if(!['empty','tree','water'].includes(t.kind)){reject(p,tr('Gelände unter Bebauung kann nicht verändert werden.','Terrain beneath buildings cannot be changed.'));continue;}
   const elevation=tool==='level'?target!:t.elevation+(tool==='raise'?TERRAIN_STEP:-TERRAIN_STEP);
   if(elevation<MIN_ELEVATION||elevation>MAX_ELEVATION){reject(p,tr('Die maximale Geländehöhe oder Wassertiefe ist erreicht.','The maximum terrain height or water depth has been reached.'));continue;}
   if(Math.abs(elevation-t.elevation)<.001){reject(p,tr('Dieses Feld hat bereits die Zielhöhe.','This tile is already at the target height.'));continue;}
   add({points:[point(p)],cost:Math.round(Math.abs(elevation-t.elevation)/TERRAIN_STEP)*TOOL_DEFS[tool]!.cost,elevation});continue;
  }
  if(t.kind===tool){reject(p,tr('Dieses Grundstück ist bereits bebaut.','This lot is already developed.'));continue;}
  if(t.elevation<0&&tool!=='road'&&tool!=='rail'){reject(p,tr('Hier ist Wasser. Baue an Land oder errichte eine Brücke.','This is water. Build on land or construct a bridge.'));continue;}
  if(!['empty','tree','rubble','water'].includes(t.kind)){reject(p,tr('Reiße die vorhandene Bebauung zuerst ab.','Demolish the existing structures first.'));continue;}
  add({points:[point(p)],cost:TOOL_DEFS[tool]!.cost+(t.elevation<0?90:t.kind==='tree'?2:0)});
 }
 if(out.count){out.message=state.money<out.cost?tr(`Nicht genügend Geld. Benötigt: ${formatNumber(out.cost)} €.`,`Not enough money. Required: €${formatNumber(out.cost)}.`):`${formatNumber(out.count)} ${buildUnit(tool,out.count)} · ${formatNumber(out.cost)} €${out.invalid.length?tr(` · ${formatNumber(out.invalid.length)} Felder nicht bebaubar`,` · ${formatNumber(out.invalid.length)} tiles cannot be built on`):''}`;}
 return out;
}
export function previewBuild(state:CityState,points:Point[],tool:Tool,options:BuildOptions={}):BuildPreview {const {changes:_changes,rotation:_rotation,...preview}=planBuild(state,points,tool,options);return preview;}
function result(ok:boolean,message:string,cost=0,count=0):BuildResult {return {ok,message,cost,count};}
export function build(state:CityState,points:Point[],tool:Tool,options:BuildOptions={}):BuildResult {
 const plan=planBuild(state,points,tool,options);if(!plan.count||plan.cost>state.money)return result(false,plan.message,plan.cost);
 for(const change of plan.changes){if(TOOL_DEFS[tool]?.footprint){placeFacility(state,change.points[0],tool as TileKind,plan.rotation);continue;}for(const p of change.points){const t=tileAt(state,p.x,p.z)!;if(tool==='bulldoze')clearTile(t,true);else if(tool==='pipe')t.hasPipe=true;else if(tool==='powerline')t.hasPowerLine=true;else if(change.elevation!==undefined){t.elevation=change.elevation;if(t.elevation<0)t.kind='water';else if(t.kind==='water')t.kind='empty';}else {t.kind=tool as TileKind;t.level=0;t.age=0;t.fire=0;t.anchor=-1;t.rotation=0;}}}
 state.money-=plan.cost;recalculate(state);recordBuild(state,tool,plan.count);updateProgression(state);
 const label=tool==='bulldoze'?tr('abgerissen','demolished'):['raise','lower','level'].includes(tool)?tr('bearbeitet','modified'):tr('gebaut','built');return result(true,`${formatNumber(plan.count)} ${buildUnit(tool,plan.count)} ${label} · ${formatNumber(plan.cost)} €`,plan.cost,plan.count);
}

function fireProtection(state:CityState,tile:Tile,stations:Tile[]):number {return stations.reduce((best,t)=>Math.max(best,clamp(1-(Math.abs(t.x-tile.x)+Math.abs(t.z-tile.z))/18,0,1)*state.funding.fire/100),0);}
function destroyBuilding(state:CityState,t:Tile):void {for(const p of getFootprint(state,t)){const f=tileAt(state,p.x,p.z)!;f.kind='rubble';f.level=0;f.fire=0;f.age=0;f.anchor=-1;f.rotation=0;f.hasPowerLine=false;f.hasPipe=false;}}
export function tick(state:CityState):void {
 state.month++;recalculate(state);const oldPopulation=state.stats.population,fireSpread:Tile[]=[];let destroyed=0;
 const growthCap=[2,3,4][getRank(state).id]??2;
 const fireStations=state.tiles.filter(t=>t.kind==='fire'&&isBuildingAnchor(state,t)&&t.fire===0&&t.connected&&t.powered&&t.watered);
 for(const tile of state.tiles){
  if(!isBuildingAnchor(state,tile))continue;
  if(tile.fire>0){const protection=fireProtection(state,tile,fireStations);tile.fire=Math.max(0,tile.fire-(protection>.15?Math.ceil(1+protection*4):1));
   for(const p of getFootprint(state,tile))tileAt(state,p.x,p.z)!.fire=tile.fire;
   if(tile.fire===0){if(protection<.3&&random(state.seed,state.month,tile.x,tile.z)<.8){destroyBuilding(state,tile);destroyed++;}}
   else if(protection<.2&&random(state.seed,state.month,tile.x,tile.z+100)<.25){for(const [dx,dz]of OFFSETS){const t=tileAt(state,tile.x+dx,tile.z+dz);if(t&&hasStructure(t)&&t.fire===0)fireSpread.push(rootTile(state,t));}}continue;
  }
  if(!isZone(tile.kind))continue;tile.age++;const demand=tile.kind==='residential'?state.stats.residentialDemand:tile.kind==='commercial'?state.stats.commercialDemand:state.stats.industrialDemand;const viable=tile.connected&&tile.powered&&tile.watered,roll=random(state.seed,state.month,tile.x,tile.z);
  if((!viable||demand<-35||state.stats.happiness<25)&&tile.level>0&&tile.age>=3&&roll<(!viable?.32:.14)){tile.level--;tile.age=0;}
  else if(viable&&demand>0&&state.stats.happiness>=35&&tile.level<growthCap&&tile.age>=2){const growthChance=(tile.level===0?.32:.045)+demand*.0013+(tile.kind==='residential'?tile.landValue*.00045:0);if(roll<growthChance){tile.level++;tile.age=0;}}
 }
 for(const t of fireSpread)for(const p of getFootprint(state,t))tileAt(state,p.x,p.z)!.fire=4;
 if(destroyed)addEvent(state,['Brandschäden','Fire damage'],[`${destroyed} Gebäude wurden zerstört. Räume die Grundstücke und baue die Feuerwehr aus.`,`${destroyed} buildings were destroyed. Clear the lots and expand fire protection.`],'warning');
 recalculate(state);state.money=clamp(state.money+state.stats.balance,-100000,1000000000);
 const milestones=[2500,5000,10000,20000,40000];while(state.milestone<milestones.length&&state.stats.population>=milestones[state.milestone]){const population=milestones[state.milestone],reward=[5000,10000,15000,25000,40000][state.milestone];state.money=Math.min(1000000000,state.money+reward);state.milestone++;addEvent(state,['Eine Stadt wächst','A growing city'],[`${population.toLocaleString('de-DE')} Einwohner! Das Land fördert deine Stadt mit ${reward.toLocaleString('de-DE')} €.`,`${population.toLocaleString('en-US')} residents! Your city receives a grant of €${reward.toLocaleString('en-US')}.`], 'good');}
 if(state.month%12===0)addEvent(state,['Jahresbericht','Annual report'],[`${state.stats.population.toLocaleString('de-DE')} Einwohner · ${state.stats.happiness} % Zufriedenheit · ${state.stats.balance>=0?'+':''}${state.stats.balance.toLocaleString('de-DE')} € monatlich.`,`${state.stats.population.toLocaleString('en-US')} residents · ${state.stats.happiness}% happiness · ${state.stats.balance>=0?'+':''}€${state.stats.balance.toLocaleString('en-US')} per month.`],state.stats.balance>=0?'good':'warning');
 if(state.money<0&&state.month%3===0)addEvent(state,['Die Stadtkasse ist im Minus','The treasury is overdrawn'],['Erhöhe Steuern, reduziere Ausgaben oder nimm einen Kredit auf.','Raise taxes, reduce spending or take out a loan.'],'warning');
 if(oldPopulation>100&&state.stats.population<oldPopulation*.9&&state.month%3===0)addEvent(state,['Einwohner ziehen fort','Residents are moving away'],['Prüfe Straßenanschluss, Stromleitungen, Wasserrohre und Arbeitsplätze.','Check road access, power lines, water pipes and jobs.'],'warning');
 updateProgression(state,{monthly:true});state.history.push({month:state.month,population:state.stats.population,money:state.money,happiness:state.stats.happiness});state.history=state.history.slice(-120);state.revision++;
}
export function takeLoan(state:CityState):BuildResult {if(state.loan>=50000)return result(false,tr('Das Kreditlimit von 50.000 € ist erreicht.','The €50,000 credit limit has been reached.'));const amount=Math.min(10000,50000-state.loan);state.loan+=amount;state.money=Math.min(1000000000,state.money+amount);state.progression.counters.loansTaken=(state.progression.counters.loansTaken??0)+1;recalculate(state);addEvent(state,['Kredit ausgezahlt','Loan paid out'],[`${amount.toLocaleString('de-DE')} € wurden ausgezahlt. Monatlicher Zins: 0,5 %.`,`€${amount.toLocaleString('en-US')} paid out. Monthly interest: 0.5%.`]);return result(true,tr(`${formatNumber(amount)} € Kredit aufgenommen.`,`Borrowed €${formatNumber(amount)}.`),-amount,1);}
export function repayLoan(state:CityState):BuildResult {if(state.loan<=0)return result(false,tr('Die Stadt hat keine offenen Kredite.','The city has no outstanding loans.'));const amount=Math.min(10000,state.loan);if(state.money<amount)return result(false,tr('Nicht genügend Geld für die Rückzahlung.','Not enough money to repay the loan.'),amount);state.loan-=amount;state.money-=amount;recalculate(state);return result(true,tr(`${formatNumber(amount)} € Kredit zurückgezahlt.`,`Repaid €${formatNumber(amount)}.`),amount,1);}
export function triggerDisaster(state:CityState,kind:DisasterKind):BuildResult {
 if(!state.settings.disastersEnabled)return result(false,tr('Aktiviere zuerst den Katastrophenmodus in den Einstellungen.','Enable disaster mode in settings first.'));
 if(!['fire','earthquake','flood','storm'].includes(kind))return result(false,tr('Diese Katastrophe ist nicht verfügbar.','This disaster is not available.'));
 const candidates=state.tiles.filter(t=>hasStructure(t)&&isBuildingAnchor(state,t));
 if(!candidates.length){addEvent(state,['Keine Schäden','No damage'],['Im betroffenen Gebiet stehen noch keine Gebäude.','There are no buildings in the affected area yet.']);state.revision++;return result(false,tr('Es gibt noch keine Gebäude.','There are no buildings yet.'));}
 let target=candidates[Math.floor(random(state.seed,state.month,state.revision,451)*candidates.length)];
 if(kind==='flood'){const shore=new Float32Array(state.tiles.length);for(const t of state.tiles)if(t.elevation<0)stamp(state,shore,t,12,1,true);target=[...candidates].sort((a,b)=>(shore[b.z*state.size+b.x]-b.elevation*.05)-(shore[a.z*state.size+a.x]-a.elevation*.05))[0];state.settings.weather='rain';}
 if(kind==='fire'){for(const p of getFootprint(state,target))tileAt(state,p.x,p.z)!.fire=6;addEvent(state,['Brand in der Stadt','Fire in the city'],[`Ein Gebäude bei ${target.x}, ${target.z} brennt. Eine versorgte Feuerwache begrenzt die Schäden.`,`A building at ${target.x}, ${target.z} is on fire. A supplied fire station can limit the damage.`],'warning');}
 else {let count=0;const radius=kind==='storm'?8:kind==='flood'?5:6;const victims=candidates.filter(t=>Math.abs(t.x-target.x)+Math.abs(t.z-target.z)<=radius&&(t===target||random(state.seed,t.x,t.z,state.month+1)<(kind==='storm'?.25:.65)));
  for(const t of victims){destroyBuilding(state,t);count++;}
  let broken=0;for(const t of state.tiles){if(Math.abs(t.x-target.x)+Math.abs(t.z-target.z)>radius)continue;if(t.hasPowerLine||t.hasPipe){if(kind==='storm')t.hasPowerLine=false;else {t.hasPowerLine=false;t.hasPipe=false;}broken++;}if(kind==='earthquake'&&['road','rail'].includes(t.kind)&&random(state.seed,t.x,t.z,state.month+3)<.45){t.kind='rubble';t.level=0;}}
  if(kind==='storm')state.settings.weather='rain';
  const label:BilingualText=kind==='earthquake'?['Erdbeben','Earthquake']:kind==='flood'?['Überschwemmung','Flood']:['Schwerer Sturm','Severe storm'];addEvent(state,label,[`${count} Gebäude beschädigt, ${broken} Leitungsfelder unterbrochen. Räume Trümmer, repariere die Netze und stelle die Versorgung wieder her.`,`${count} buildings damaged, ${broken} utility tiles disrupted. Clear rubble, repair the networks and restore service.`],'warning');
 }
 state.progression.counters.disastersTriggered=(state.progression.counters.disastersTriggered??0)+1;recalculate(state);updateProgression(state);return result(true,tr('Katastrophe ausgelöst.','Disaster triggered.'),0,1);
}

/** Enlarge without moving or discarding the existing city. Legacy one-tile facilities get real plots. */
export function expandCity(original:CityState,newSize=128):CityState {
 if(![64,96,128].includes(newSize)||newSize<original.size)throw new Error(tr('Eine Stadt kann nur auf 64, 96 oder 128 Felder erweitert werden.','A city can only be expanded to 64, 96 or 128 tiles.'));
 if(newSize===original.size)return structuredClone(original);
 const state=structuredClone(original),oldSize=state.size,oldTiles=state.tiles;state.size=newSize;state.tiles=[];
 const oldSouthCoast=oldTiles.slice((oldSize-1)*oldSize).find(t=>t.elevation<0)?.x??oldSize;
 for(let z=0;z<newSize;z++)for(let x=0;x<newSize;x++){
  if(x<oldSize&&z<oldSize){const t={...oldTiles[z*oldSize+x]};if(t.anchor>=0)t.anchor=Math.floor(t.anchor/oldSize)*newSize+t.anchor%oldSize;state.tiles.push(t);continue;}
  let elevation=getTerrainElevation(x,z,newSize,state.seed);
  if(oldSize===40){const oldEdge=oldTiles[(oldSize-1)*oldSize+Math.min(x,oldSize-1)];if(z<40&&x>=40)elevation=-1;else if(z>=40&&z<76){const shoreline=oldSouthCoast+(z-40)/36*(newSize*.79-oldSouthCoast);if(x<40&&z===40)elevation=oldEdge.elevation;else if(x>=shoreline)elevation=-1;}}
  const forest=elevation>=0&&random(state.seed,x,z)<.25+.12*Math.sin(x*.17+z*.13);state.tiles.push(newTile(x,z,state.seed,elevation,forest?'tree':elevation<0?'water':'empty'));
 }
 const compact=state.tiles.filter(t=>isFacility(t.kind)&&isBuildingAnchor(state,t)&&getFootprint(state,t).length===1),legacyKinds=compact.map(t=>t.kind);
 for(const old of compact){const kind=old.kind,rotation=old.rotation,[w,d]=dimensions(kind,rotation),origin=point(old),fire=old.fire,age=old.age;let chosen:Point|null=null;
  clearTile(old); // Preserve utilities at the old address; no neighboring homes are altered.
  const available=(x:number,z:number)=>{if(x<0||z<0||x+w>newSize||z+d>newSize)return false;for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++){const t=tileAt(state,x+dx,z+dz)!;if(t.elevation<0||!['empty','tree','rubble'].includes(t.kind))return false;}if(kind==='seaport'){let edges=0;for(let dx=0;dx<w;dx++)if((tileAt(state,x+dx,z+d)?.elevation??0)<0)edges++;return edges>=2;}return true;};
  outer:for(let radius=0;radius<newSize*2;radius++)for(let dz=-radius;dz<=radius;dz++){const dx=radius-Math.abs(dz);for(const sign of dx===0?[1]:[-1,1]){const x=origin.x+dx*sign,z=origin.z+dz;if(available(x,z)){chosen={x,z};break outer;}}}
  if(!chosen){old.kind=kind;old.anchor=old.z*newSize+old.x;old.level=1;old.rotation=rotation;old.fire=fire;old.age=age;continue;}
  const elevation=tileAt(state,chosen.x,chosen.z)!.elevation;for(let dz=0;dz<d;dz++)for(let dx=0;dx<w;dx++)tileAt(state,chosen.x+dx,chosen.z+dz)!.elevation=elevation;
  placeFacility(state,chosen,kind,rotation);for(const p of getFootprint(state,tileAt(state,chosen.x,chosen.z)!)){const t=tileAt(state,p.x,p.z)!;t.fire=fire;t.age=age;}connectFacility(state,chosen);
 }
 // Sources that moved during migration must reach the existing road-side utility trunks.
 recalculate(state);state.money=original.money;state.month=original.month;state.progression.unlocked=[...new Set([...state.progression.unlocked,...legacyKinds])];
 addEvent(state,['Neue Horizonte','New horizons'],[`Das Stadtgebiet umfasst jetzt ${newSize} × ${newSize} Felder. Bestehende Wohn- und Arbeitsgebiete wurden erhalten; öffentliche Gebäude haben eigene große Grundstücke.`,`The city now covers ${newSize} × ${newSize} tiles. Existing housing and workplaces were preserved; public buildings have their own large lots.`],'good');state.revision++;return state;
}
function validateCitizenIncident(value:unknown,size:number):Omit<CitizenIncident,'id'|'month'> {
 const data=requireRecord(value,tr('Einwohnerereignis','Resident incident'));
 requireNumber(data.x,tr('Ereignisposition X','Incident position X'),-8,size+8);requireNumber(data.z,tr('Ereignisposition Z','Incident position Z'),-8,size+8);requireNumber(data.y,tr('Ereignishöhe','Incident height'),-16,128);
 for(const axis of ['nx','ny','nz'])requireNumber(data[axis],tr('Oberflächennormale','Surface normal'),-1,1);
 if(Math.hypot(data.nx as number,data.ny as number,data.nz as number)<.001)throw new Error(tr('Ungültiger Spielstand: Oberflächennormale.','Invalid saved game: surface normal.'));
 requireBoolean(data.witnessed,tr('Zeugenstatus','Witness status'));if(!['impact','abduction'].includes(data.kind as string))throw new Error(tr('Ungültiger Spielstand: Einwohnerereignis.','Invalid saved game: resident incident.'));
 return data as unknown as Omit<CitizenIncident,'id'|'month'>;
}
function validateCitizenEffects(value:unknown,size:number,month:number):void {
 const effects=requireRecord(value,tr('Einwohnerereignisse','Resident incidents'));requireNumber(effects.populationLoss,tr('Einwohnerverluste','Residents lost'),0,2000000,true);requireNumber(effects.happinessPenalty,tr('Stimmungseinfluss','Happiness impact'),0,30,true);
 if(!Array.isArray(effects.incidents)||effects.incidents.length>64)throw new Error(tr('Ungültiger Spielstand: Einwohnerereignisliste.','Invalid saved game: resident incident list.'));
 let previousId=0,previousMonth=0;for(const value of effects.incidents){validateCitizenIncident(value,size);const data=requireRecord(value,tr('Einwohnerereignis','Resident incident'));const id=requireNumber(data.id,tr('Ereignisnummer','Incident number'),1,Number.MAX_SAFE_INTEGER,true),eventMonth=requireNumber(data.month,tr('Ereignismonat','Incident month'),0,month,true);if(id<=previousId||eventMonth<previousMonth)throw new Error(tr('Ungültiger Spielstand: Ereignisreihenfolge.','Invalid saved game: incident order.'));previousId=id;previousMonth=eventMonth;}
}
/** Effects are counters independent of tile capacity, so one incident removes exactly one resident. */
export function applyCitizenIncident(state:CityState,incident:Omit<CitizenIncident,'id'|'month'>):BuildResult {
 try{validateCitizenIncident(incident,state.size);}catch{return result(false,tr('Ungültiges Einwohnerereignis.','Invalid resident incident.'));}
 const basePopulation=state.tiles.reduce((sum,t)=>sum+(t.kind==='residential'?POP[t.level]:0),0),effects=state.citizenEffects,nextId=(state.citizenEffects.incidents.at(-1)?.id??0)+1;
 if(!Number.isSafeInteger(nextId))return result(false,tr('Der Ereigniszähler ist ausgeschöpft.','The incident counter has reached its limit.'));
 if(basePopulation-effects.populationLoss<=0)return result(false,tr('Die Stadt hat keine Einwohner.','The city has no residents.'));
 effects.populationLoss=Math.min(basePopulation,effects.populationLoss+1);
 if(incident.witnessed)effects.happinessPenalty=Math.min(30,effects.happinessPenalty+2);
 const normalLength=Math.hypot(incident.nx,incident.ny,incident.nz);
 effects.incidents.push({id:nextId,month:state.month,x:incident.x,y:incident.y,z:incident.z,nx:incident.nx/normalLength,ny:incident.ny/normalLength,nz:incident.nz/normalLength,witnessed:incident.witnessed,kind:incident.kind});effects.incidents=effects.incidents.slice(-64);
 recalculate(state);updateProgression(state);
 return result(true,incident.witnessed?tr('Einwohner verloren. Die Zeugen sind beunruhigt.','A resident was lost. Witnesses are distressed.'):tr('Ein Einwohner ist verschwunden.','A resident has disappeared.'),0,1);
}
const SAVE_FIELD_LABELS:Record<string,BilingualText>={
 police:['Polizei','Police'],fire:['Feuerwehr','Fire protection'],health:['Gesundheit','Health'],education:['Bildung','Education'],
 population:['Einwohnerzahl','Population'],jobs:['Arbeitsplätze','Jobs'],happiness:['Zufriedenheit','Happiness'],income:['Einnahmen','Income'],expenses:['Ausgaben','Expenses'],balance:['Bilanz','Balance'],
 powerSupply:['Stromangebot','Power supply'],powerDemand:['Strombedarf','Power demand'],waterSupply:['Wasserangebot','Water supply'],waterDemand:['Wasserbedarf','Water demand'],
 residentialDemand:['Wohnraumnachfrage','Housing demand'],commercialDemand:['Gewerbenachfrage','Commercial demand'],industrialDemand:['Industrienachfrage','Industrial demand'],
 pollution:['Umweltbelastung','Pollution'],traffic:['Verkehr','Traffic'],safety:['Sicherheit','Safety'],parks:['Parks','Parks'],landValue:['Grundstückswert','Land value'],
};
function saveFieldLabel(key:string):string {const label=SAVE_FIELD_LABELS[key];return label?tr(...label):key;}
function requireRecord(value:unknown,label:string):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(tr(`Ungültiger Spielstand: ${label}.`,`Invalid saved game: ${label}.`));return value as Record<string,unknown>;}
function requireNumber(value:unknown,label:string,min:number,max:number,integer=false):number {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error(tr(`Ungültiger Spielstand: ${label}.`,`Invalid saved game: ${label}.`));return value;}
function requireString(value:unknown,label:string,max:number):string {if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(tr(`Ungültiger Spielstand: ${label}.`,`Invalid saved game: ${label}.`));return value;}
function requireBoolean(value:unknown,label:string):void {if(typeof value!=='boolean')throw new Error(tr(`Ungültiger Spielstand: ${label}.`,`Invalid saved game: ${label}.`));}
function validateProgression(value:unknown,month:number):void {
 const p=requireRecord(value,tr('Stadtfortschritt','City progression'));requireNumber(p.xp,tr('Erfahrung','Experience'),0,1000000000);requireNumber(p.rank,tr('Stadtrang','City rank'),0,20,true);requireBoolean(p.victory,tr('Kampagnenziel','Campaign goal'));
 for(const key of ['completedQuests','claimedQuests','unlocked','completedChallenges']){if(!Array.isArray(p[key])||p[key].length>200)throw new Error(tr('Ungültiger Spielstand: Fortschrittsliste.','Invalid saved game: progression list.'));for(const id of p[key] as unknown[])requireString(id,tr('Fortschrittskennung','Progression identifier'),100);}
 const tools=[...Object.keys(TOOL_DEFS),'empty','water','rubble','inspect','bulldoze','pan','citizen'];if((p.unlocked as string[]).some(t=>!tools.includes(t)))throw new Error(tr('Ungültiger Spielstand: Bauwerkzeug.','Invalid saved game: construction tool.'));
 const counters=requireRecord(p.counters,tr('Fortschrittszähler','Progression counter'));if(Object.keys(counters).length>200)throw new Error(tr('Ungültiger Spielstand: Fortschrittszähler.','Invalid saved game: progression counter.'));for(const [key,v]of Object.entries(counters)){requireString(key,tr('Zählername','Counter name'),100);requireNumber(v,tr('Fortschrittszähler','Progression counter'),-1000000000,1000000000);}
 if(p.activeChallenge!==null){const c=requireRecord(p.activeChallenge,tr('Herausforderung','Challenge'));requireString(c.id,tr('Herausforderung','Challenge'),100);requireNumber(c.startedMonth,tr('Startmonat','Start month'),0,month,true);if(!['active','completed','failed'].includes(c.status as string))throw new Error(tr('Ungültiger Spielstand: Herausforderung.','Invalid saved game: challenge.'));}
}
export function deserializeCity(raw:string):CityState {
 if(typeof raw!=='string'||raw.length>12000000)throw new Error(tr('Der Spielstand ist zu groß oder ungültig.','The saved game is too large or invalid.'));let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Error(tr('Der Spielstand enthält kein gültiges JSON.','The saved game does not contain valid JSON.'));}
 const data=requireRecord(parsed,tr('Dateiformat','File format')),legacy=data.version===1,size=data.size as number;if(!legacy&&data.version!==2||legacy&&size!==40||![40,64,96,128].includes(size))throw new Error(tr('Dieser Spielstand wird nicht unterstützt.','This saved game is not supported.'));
 requireString(data.name,tr('Stadtname','City name'),64);requireNumber(data.seed,tr('Zufallswert','Random seed'),0,4294967295,true);requireNumber(data.money,tr('Stadtkasse','Treasury'),-100000,1000000000);requireNumber(data.month,tr('Monat','Month'),0,1000000,true);requireNumber(data.speed,tr('Geschwindigkeit','Speed'),0,3,true);requireNumber(data.tax,tr('Steuern','Taxes'),0,25);requireNumber(data.loan,tr('Kredit','Loan'),0,50000);requireNumber(data.revision,tr('Version','Version'),0,Number.MAX_SAFE_INTEGER,true);requireNumber(data.milestone,tr('Meilenstein','Milestone'),0,5,true);
 const funding=requireRecord(data.funding,tr('Budget','Budget'));for(const key of ['police','fire','health','education'])requireNumber(funding[key],`Budget ${saveFieldLabel(key)}`,0,150);
 if(!Array.isArray(data.tiles)||data.tiles.length!==size*size)throw new Error(tr('Ungültiger Spielstand: Kartenfelder.','Invalid saved game: map tiles.'));
 for(let i=0;i<data.tiles.length;i++){
  const t=requireRecord(data.tiles[i],tr('Grundstück','Lot')),kind=t.kind as TileKind;if(t.x!==i%size||t.z!==Math.floor(i/size)||!KINDS.includes(kind))throw new Error(tr('Ungültiger Spielstand: Grundstückskoordinaten oder Gebäude.','Invalid saved game: lot coordinates or building.'));
  requireNumber(t.level,tr('Gebäudestufe','Building level'),0,4,true);requireNumber(t.variation,tr('Gebäudevariante','Building variation'),0,1000000,true);requireNumber(t.age,tr('Gebäudealter','Building age'),0,1000001,true);requireNumber(t.fire,tr('Brand','Fire'),0,100,true);for(const key of ['pollution','landValue','traffic'])requireNumber(t[key],saveFieldLabel(key),0,100);for(const key of ['powered','watered','connected'])requireBoolean(t[key],tr('Versorgungsdaten','Utility data'));
  if(legacy){const water=legacyWaterTerrain(t.x as number,t.z as number);if(kind==='water'&&!water||water&&!['water','road','rail','rubble'].includes(kind))throw new Error(tr('Ungültiger Spielstand: Wasserfläche.','Invalid saved game: water area.'));Object.assign(t,{elevation:water?-1:0,hasPipe:kind==='road',hasPowerLine:kind==='road',anchor:isFacility(kind)?i:-1,rotation:0});}
  else {requireNumber(t.elevation,tr('Geländehöhe','Terrain height'),MIN_ELEVATION,MAX_ELEVATION);if(Math.abs((t.elevation as number)/TERRAIN_STEP-Math.round((t.elevation as number)/TERRAIN_STEP))>.001)throw new Error(tr('Ungültiger Spielstand: Geländestufen.','Invalid saved game: terrain steps.'));requireBoolean(t.hasPipe,tr('Wasserrohr','Water pipe'));requireBoolean(t.hasPowerLine,tr('Stromleitung','Power line'));requireNumber(t.anchor,tr('Gebäudegrundfläche','Building footprint'),-1,size*size-1,true);requireNumber(t.rotation,tr('Gebäudeausrichtung','Building orientation'),0,3,true);if(kind==='water'&&(t.elevation as number)>=0||(t.elevation as number)<0&&!['water','road','rail','rubble'].includes(kind))throw new Error(tr('Ungültiger Spielstand: Bebauung im Wasser.','Invalid saved game: construction in water.'));}
  if(!isBuilding(kind)&&t.level!==0||isFacility(kind)&&t.level!==1)throw new Error(tr('Ungültiger Spielstand: Gebäudestufe.','Invalid saved game: building level.'));
  if(isFacility(kind)?(t.anchor as number)<0:t.anchor!==-1)throw new Error(tr('Ungültiger Spielstand: Gebäudeanker.','Invalid saved game: building anchor.'));
 }
 const state=data as unknown as CityState;
 for(const t of state.tiles){if(t.anchor<0)continue;const anchor=state.tiles[t.anchor];if(!anchor||anchor.anchor!==t.anchor||anchor.kind!==t.kind||anchor.rotation!==t.rotation||anchor.elevation!==t.elevation)throw new Error(tr('Ungültiger Spielstand: Zusammengehörige Gebäudeteile.','Invalid saved game: linked building parts.'));const [w,d]=dimensions(t.kind,t.rotation);if(t.x<anchor.x||t.z<anchor.z||t.x>=anchor.x+w||t.z>=anchor.z+d)throw new Error(tr('Ungültiger Spielstand: Gebäudegrundfläche.','Invalid saved game: building footprint.'));}
 for(const t of state.tiles){if(!isFacility(t.kind)||!isBuildingAnchor(state,t))continue;const [w,d]=dimensions(t.kind,t.rotation),count=getFootprint(state,t).length;if(count!==1&&count!==w*d)throw new Error(tr('Ungültiger Spielstand: Unvollständiges Gebäude.','Invalid saved game: incomplete building.'));}
 const stats=requireRecord(data.stats,tr('Statistik','Statistics'));for(const key of Object.keys(blankStats()))requireNumber(stats[key],tr(`Statistik ${saveFieldLabel(key)}`,`Statistics ${saveFieldLabel(key)}`),-1000000000,1000000000);
 if(!Array.isArray(data.events)||data.events.length>40)throw new Error(tr('Ungültiger Spielstand: Meldungen.','Invalid saved game: events.'));for(const item of data.events){const e=requireRecord(item,tr('Meldung','Event'));requireNumber(e.id,tr('Meldungsnummer','Event number'),0,Number.MAX_SAFE_INTEGER,true);requireNumber(e.month,tr('Meldungsmonat','Event month'),0,data.month as number,true);requireString(e.title,tr('Meldungstitel','Event title'),180);requireString(e.message,tr('Meldungstext','Event message'),2000);if(e.titleEn!==undefined)requireString(e.titleEn,tr('Englischer Meldungstitel','English event title'),180);if(e.messageEn!==undefined)requireString(e.messageEn,tr('Englischer Meldungstext','English event message'),2000);if(!['info','good','warning'].includes(e.type as string))throw new Error(tr('Ungültiger Meldungstyp.','Invalid event type.'));}
 if(!Array.isArray(data.history)||data.history.length>120)throw new Error(tr('Ungültiger Spielstand: Verlauf.','Invalid saved game: history.'));let previousMonth=-1;for(const item of data.history){const p=requireRecord(item,tr('Verlauf','History')),month=requireNumber(p.month,tr('Verlaufsmonat','History month'),0,data.month as number,true);if(month<=previousMonth)throw new Error(tr('Ungültige Reihenfolge im Verlauf.','Invalid history order.'));previousMonth=month;requireNumber(p.population,tr('Einwohnerzahl','Population'),0,2000000,true);requireNumber(p.money,tr('Kontostand','Account balance'),-100000,1000000000);requireNumber(p.happiness,tr('Zufriedenheit','Happiness'),0,100);}
 if(legacy){state.version=2;state.settings={disastersEnabled:false,weather:'clear',dayNightCycle:true,timeOfDay:14,buildingLights:true};state.progression=createProgression(state);}else {const settings=requireRecord(data.settings,tr('Einstellungen','Settings'));requireBoolean(settings.disastersEnabled,tr('Katastrophenmodus','Disaster mode'));if(settings.buildingLights===undefined)settings.buildingLights=true;requireBoolean(settings.buildingLights,tr('Gebäudelichter','Building lights'));if(settings.dayNightCycle===undefined)settings.dayNightCycle=true;if(settings.timeOfDay===undefined)settings.timeOfDay=14;requireBoolean(settings.dayNightCycle,tr('Tag-Nacht-Zyklus','Day-night cycle'));requireNumber(settings.timeOfDay,tr('Tageszeit','Time of day'),0,24);if((settings.timeOfDay as number)>=24)throw new Error(tr('Ungültiger Spielstand: Tageszeit.','Invalid saved game: time of day.'));if(!['clear','rain'].includes(settings.weather as string))throw new Error(tr('Ungültiger Spielstand: Wetter.','Invalid saved game: weather.'));validateProgression(data.progression,data.month as number);}
 if(data.citizenEffects===undefined)state.citizenEffects={populationLoss:0,happinessPenalty:0,incidents:[]};else validateCitizenEffects(data.citizenEffects,size,state.month);
 const savedRevision=state.revision;recalculate(state);normalizeProgression(state);state.revision=savedRevision;return state;
}
export function serializeCity(state:CityState):string {const raw=JSON.stringify(state);deserializeCity(raw);return raw;}
