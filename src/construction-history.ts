import type { BuildResult, CityState, Tile, Tool } from './types';
import { recalculate } from './simulation';
import { getQuestProgress, recordBuild, updateProgression } from './progression';
import { tr } from './i18n';

// Derived network, traffic, and land-value fields belong to the live simulation.
const tileFields = ['x','z','kind','level','variation','fire','age','elevation','hasPipe','hasPowerLine','anchor','rotation'] as const;
type TileField = typeof tileFields[number];
type ConstructionTile = Pick<Tile, TileField>;
const structureFields:TileField[] = ['kind','level','fire','age','anchor','rotation'];
const isZone = (tile:ConstructionTile) => ['residential','commercial','industrial'].includes(tile.kind);

export interface ConstructionSnapshot {
  readonly city:CityState;
  readonly size:number;
  readonly seed:number;
  readonly tiles:ConstructionTile[];
  readonly completedQuests:string[];
  readonly claimedQuests:string[];
  readonly disastersTriggered:number;
}

interface TileEdit {
  index:number;
  before:ConstructionTile;
  after:ConstructionTile;
  fields:TileField[];
}

export interface ConstructionEdit {
  readonly city:CityState;
  readonly size:number;
  readonly seed:number;
  readonly tiles:TileEdit[];
  readonly cost:number;
  readonly count:number;
  readonly xp:number;
  readonly counters:Record<string,number>;
  readonly completedQuestsBefore:string[];
  readonly claimedQuestsBefore:string[];
  readonly disastersTriggered:number;
}

/** In-session construction edits, oldest first. Save files deliberately contain no undo stack. */
export type ConstructionHistory = ConstructionEdit[];

const copyTile = (tile:Tile):ConstructionTile => ({
  x:tile.x,z:tile.z,kind:tile.kind,level:tile.level,variation:tile.variation,
  fire:tile.fire,age:tile.age,elevation:tile.elevation,hasPipe:tile.hasPipe,
  hasPowerLine:tile.hasPowerLine,anchor:tile.anchor,rotation:tile.rotation,
});

/** Capture immediately before the synchronous build() call; no economy or settings snapshot. */
export function captureConstructionState(city:CityState):ConstructionSnapshot {
  return {
    city,size:city.size,seed:city.seed,tiles:city.tiles.map(copyTile),
    completedQuests:[...city.progression.completedQuests],
    claimedQuests:[...city.progression.claimedQuests],
    disastersTriggered:city.progression.counters.disastersTriggered??0,
  };
}

export function clearConstructionHistory(history:ConstructionHistory):void { history.length=0; }
export function canUndoConstruction(history:ConstructionHistory):boolean { return history.length>0; }

/** Record only a successful build, using its explicit cost rather than the treasury difference. */
export function recordConstruction(history:ConstructionHistory,before:ConstructionSnapshot,city:CityState,tool:Tool,result:BuildResult):boolean {
  if (!result.ok) return false;
  if (before.city!==city||before.size!==city.size||before.seed!==city.seed||before.tiles.length!==city.tiles.length||!Number.isFinite(result.cost)||result.cost<0) {
    clearConstructionHistory(history);
    return false;
  }
  const fields:TileField[] = tool==='pipe'?['hasPipe']:tool==='powerline'?['hasPowerLine']:
    ['raise','lower','level'].includes(tool)?['elevation','kind']:
    tool==='bulldoze'?[...structureFields,'hasPipe','hasPowerLine']:structureFields;
  const edits:TileEdit[]=[];
  for (let index=0;index<city.tiles.length;index++) {
    const previous=before.tiles[index],after=copyTile(city.tiles[index]);
    if (!tileFields.some(key=>previous[key]!==after[key])) continue;
    // Undo must never resurrect a fire that construction has just cleared.
    if (previous.fire!==0||after.fire!==0) {
      clearConstructionHistory(history);
      return false;
    }
    edits.push({index,before:previous,after,fields});
  }
  if (!edits.length) return false;
  // Reuse the progression rules without counting quest/challenge rewards as building XP.
  const earned={...city,progression:{...city.progression,xp:0,counters:{}}};
  recordBuild(earned,tool,result.count);
  history.push({
    city,size:city.size,seed:city.seed,tiles:edits,cost:result.cost,count:result.count,
    xp:earned.progression.xp,counters:earned.progression.counters,
    completedQuestsBefore:before.completedQuests,claimedQuestsBefore:before.claimedQuests,
    disastersTriggered:before.disastersTriggered,
  });
  if (history.length>10) history.splice(0,history.length-10);
  return true;
}

function matches(city:CityState,entry:ConstructionEdit):boolean {
  if (entry.city!==city||entry.size!==city.size||entry.seed!==city.seed||
    entry.disastersTriggered!==(city.progression.counters.disastersTriggered??0)||
    entry.claimedQuestsBefore.length!==city.progression.claimedQuests.length||
    entry.claimedQuestsBefore.some(id=>!city.progression.claimedQuests.includes(id))) return false;
  return entry.tiles.every(edit=>{
    const current=city.tiles[edit.index];
    if (!current||current.fire!==0) return false;
    return tileFields.every(key=>{
      // Zone development belongs to the simulation, including decline. For utilities it
      // stays untouched; removing the zone itself restores its original vacant plot.
      if ((key==='age'||key==='level')&&isZone(edit.after)&&current.kind===edit.after.kind) return true;
      return current[key]===edit.after[key];
    });
  });
}

/** Reverse one atomic edit while retaining the current month, economy, and unrelated city state. */
export function undoConstruction(city:CityState,history:ConstructionHistory):BuildResult {
  const entry=history.at(-1);
  if (!entry) return {ok:false,message:tr('Es gibt noch keinen Bau zum Rückgängigmachen.','There is no construction to undo yet.'),cost:0,count:0};
  if (!matches(city,entry)) {
    clearConstructionHistory(history);
    return {ok:false,message:tr('Dieser Bau wurde inzwischen verändert. Rückgängig ist nicht mehr möglich.','This construction has changed since it was built and can no longer be undone.'),cost:0,count:0};
  }
  // Validate the entire footprint above before touching any tile or refunding money.
  for (const edit of entry.tiles) {
    const target=city.tiles[edit.index];
    for (const key of edit.fields) Object.assign(target,{[key]:edit.before[key]});
  }
  city.money=Math.min(1_000_000_000,city.money+entry.cost);
  city.progression.xp=Math.max(0,city.progression.xp-entry.xp);
  for (const [key,amount] of Object.entries(entry.counters)) {
    city.progression.counters[key]=Math.max(0,(city.progression.counters[key]??0)-amount);
  }
  recalculate(city);
  const actualProgress={...city,progression:{...city.progression,completedQuests:[]}};
  city.progression.completedQuests=city.progression.completedQuests.filter(id=>
    entry.completedQuestsBefore.includes(id)||city.progression.claimedQuests.includes(id)||getQuestProgress(actualProgress,id).complete);
  // Earned ranks, claimed rewards, challenge badges/rewards, and monthly streaks stay current.
  updateProgression(city);
  history.pop();
  return {ok:true,message:tr('Letzten Bau rückgängig gemacht.','Last construction undone.'),cost:-entry.cost,count:entry.count};
}
