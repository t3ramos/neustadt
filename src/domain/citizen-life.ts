/** Browser-independent visual life state; never persisted in CityState. */
export type CitizenEventKind = 'gathering' | 'festival';
export interface CitizenLifeEvent {
  kind: CitizenEventKind;
  x: number;
  z: number;
  invited: number;
  arrived: number;
  /** Seconds on the walking-only clock. */
  remaining: number;
}
export interface CitizenLifeSnapshot {
  counts: { work: number; home: number; leisure: number; social: number; wandering: number };
  event: CitizenLifeEvent | null;
  cooldownSeconds: number;
  total: number;
}
export interface CitizenEventRequest {
  kind: CitizenEventKind;
  near: { x: number; z: number };
}
export type CitizenEventResult =
  | { ok: true; event: CitizenLifeEvent }
  | { ok: false; reason: 'no-place' | 'no-people' | 'cooldown' | 'active' };
