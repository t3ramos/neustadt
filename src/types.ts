export type TileKind = 'empty'|'water'|'tree'|'road'|'rail'|'residential'|'commercial'|'industrial'|'power'|'waterpump'|'park'|'police'|'fire'|'hospital'|'school'|'stadium'|'airport'|'seaport'|'rubble'|'wind'|'solar'|'university'|'recycling';
export type Tool = TileKind|'inspect'|'bulldoze'|'pan'|'raise'|'lower'|'level'|'pipe'|'powerline'|'citizen';
export type Overlay = 'none'|'power'|'water'|'landvalue'|'pollution'|'traffic'|'terrain';
export type Weather = 'clear'|'rain';
export type DisasterKind = 'fire'|'earthquake'|'flood'|'storm';
export interface Tile {
  x:number; z:number; kind:TileKind; level:number; variation:number;
  powered:boolean; watered:boolean; connected:boolean; pollution:number; landValue:number; traffic:number; fire:number; age:number;
  elevation:number; hasPipe:boolean; hasPowerLine:boolean; anchor:number; rotation:0|1|2|3;
}
export interface Stats { population:number; jobs:number; happiness:number; income:number; expenses:number; balance:number; powerSupply:number; powerDemand:number; waterSupply:number; waterDemand:number; residentialDemand:number; commercialDemand:number; industrialDemand:number; pollution:number; traffic:number; education:number; health:number; safety:number; parks:number; }
export interface GameEvent { id:number; month:number; title:string; message:string;titleEn?:string;messageEn?:string; type:'info'|'good'|'warning'; }
export interface HistoryPoint { month:number; population:number; money:number; happiness:number; }
export interface ActiveChallenge { id:string; startedMonth:number; status:'active'|'completed'|'failed'; }
export interface ProgressionState { xp:number; rank:number; completedQuests:string[]; claimedQuests:string[]; unlocked:Tool[]; counters:Record<string,number>; activeChallenge:ActiveChallenge|null; completedChallenges:string[]; victory:boolean; }
export interface CitizenIncident { id:number; month:number; x:number; y:number; z:number; nx:number; ny:number; nz:number; witnessed:boolean; kind:'impact'|'abduction'; }
export interface CitizenEffects { populationLoss:number; happinessPenalty:number; incidents:CitizenIncident[]; }
export interface CityState { version:2; citizenEffects:CitizenEffects; name:string; size:number; seed:number; tiles:Tile[]; money:number; month:number; speed:0|1|2|3; tax:number; funding:{police:number;fire:number;health:number;education:number}; loan:number; stats:Stats; events:GameEvent[]; history:HistoryPoint[]; revision:number; milestone:number; progression:ProgressionState; settings:{disastersEnabled:boolean;weather:Weather;dayNightCycle:boolean;timeOfDay:number;buildingLights:boolean}; }
export interface BuildResult { ok:boolean; message:string; cost:number; count:number; }
export interface ToolDefinition { name:string; cost:number; upkeep:number; description:string; category:'zones'|'transport'|'utilities'|'services'|'nature'|'special'|'terrain'; color:string; icon:string; footprint?:[number,number]; unlockRank?:number; }
export type Point = {x:number;z:number};
export interface BuildOptions { rotation?:0|1|2|3; targetElevation?:number; }
export interface BuildPreview { cost:number; valid:Point[]; invalid:Point[]; message:string; count:number; }
export interface PreviewInfo extends BuildPreview { screenX:number;screenY:number; tool:Tool; footprint?:[number,number]; area?:[number,number]; elevation?:number; }
export interface DrivingStatus { active:boolean; speed:number; label:string; blocked?:string;drifting?:boolean;speedLimit?:number;collisionCount?:number; }
export interface VehicleHover { id:number; screenX:number;screenY:number;label:string; }
export interface SceneCallbacks { onHover:(point:Point|null)=>void; onPaint:(points:Point[],options?:BuildOptions)=>void; onSelect:(point:Point)=>void; onPreview?:(info:PreviewInfo|null)=>void; onCitizenIncident?:(incident:Omit<CitizenIncident,'id'|'month'>)=>void; onVehicleHover?:(info:VehicleHover|null)=>void;onDriveStatus?:(info:DrivingStatus)=>void; }
export interface InteractionTarget { id:number; screenX:number; screenY:number; }
export interface CitySceneApi { cancelInteraction:()=>boolean; refreshLocale:()=>void; getDiagnostics?:()=>Record<string,unknown>; getInteractionTargets?:()=>{cars:InteractionTarget[];citizens:InteractionTarget[]}; enterDrive:(id:number)=>boolean;exitDrive:()=>void;getDrivingStatus:()=>DrivingStatus;setDayNightCycle:(enabled:boolean)=>void;setBuildingLights:(enabled:boolean)=>void;setTimeOfDay:(hour:number)=>void;getTimeOfDay:()=>number; setGraphicsQuality:(value:'performance'|'balanced'|'ultra')=>void; update:(state:CityState)=>void; setTool:(tool:Tool,brush:number,rotation?:0|1|2|3)=>void; setOverlay:(overlay:Overlay)=>void; setNight:(night:boolean)=>void; setWeather:(weather:Weather)=>void; setGrid:(show:boolean)=>void; zoom:(direction:number)=>void; rotate:(direction:number)=>void; resetCamera:()=>void; overview:()=>void; focus:(x:number,z:number)=>void; screenshot:()=>string; dispose:()=>void; }
