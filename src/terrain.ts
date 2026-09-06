/** Heights are persisted per tile. These deterministic functions are only used at generation. */
export const TERRAIN_STEP = 0.5;
export const MIN_ELEVATION = -2;
export const MAX_ELEVATION = 12;

export function legacyWaterTerrain(x:number,z:number):boolean {
  const shoreline=32+Math.round(Math.sin((z+4)*.19)*1.7+Math.sin(z*.53)*.6);
  return x>=shoreline||(z>=34&&x>=29-Math.floor((z-34)/2));
}

export function getTerrainElevation(x:number,z:number,size=128,seed=2026):number {
  if(size===40)return legacyWaterTerrain(x,z)?-1:0;
  const coast=size*.79+Math.sin((z+4)*.061)*size*.028+Math.sin(z*.17)*1.2;
  const inlet=Math.max(0,(z-size*.79)*.48);
  const distance=coast-inlet-x;
  if(distance<0)return Math.max(MIN_ELEVATION,Math.floor(distance*.2-1)*.5);
  // A broad buildable plain opens into gently terraced wooded hills to the south.
  const south=Math.max(0,(z-size*.60)/(size*.32));
  const west=Math.max(0,(size*.08-x)/(size*.09));
  const phase=(seed%1000)*.001;
  const ridge=(Math.sin(x*.09+phase)*.5+.5)*2+Math.sin(z*.12+phase)*.6;
  const hill=Math.max(0,south*(3+ridge)+west*1.3);
  return Math.min(MAX_ELEVATION,Math.round(hill*2)/2);
}

/** Compatibility helper. Live construction/rendering must instead read tile.elevation. */
export function isWaterTerrain(x:number,z:number,size=40,seed=2026):boolean {
  return getTerrainElevation(x,z,size,seed)<0;
}
