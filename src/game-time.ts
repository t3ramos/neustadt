/** The simulation's historical `month` field remains a stable save/progression tick index. */
export const ECONOMY_STEP_SECONDS=5;
export const ECONOMY_STEPS_PER_MINUTE=60/ECONOMY_STEP_SECONDS;
export const perMinute=(perStep:number):number=>perStep*ECONOMY_STEPS_PER_MINUTE;
export function playTime(seconds:number):string {
  const total=Math.max(0,Math.floor(seconds));
  const minutes=Math.floor(total/60),remainder=String(total%60).padStart(2,'0');
  return minutes<60?`${minutes}:${remainder}`:`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${remainder}`;
}
export const stepTime=(step:number):string=>playTime(step*ECONOMY_STEP_SECONDS);
