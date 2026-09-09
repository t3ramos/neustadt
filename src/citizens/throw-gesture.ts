import { Vector3 } from 'three';

type Sample = { time: number; position: Vector3 };
/** A release is a gesture, not the velocity of its last (often tiny) DOM event. */
export class ThrowGesture {
  private samples: Sample[] = [];
  private motionTime = -Infinity;
  private readonly position = new Vector3();

  reset(position: { x: number; y: number; z: number }, time: number): void {
    this.position.copy(position);
    this.samples = [{ time, position: this.position.clone() }];
    this.motionTime = -Infinity;
  }

  move(delta: { x: number; y: number; z: number }, time: number): void {
    if (!Number.isFinite(time) || ![delta.x, delta.y, delta.z].every(Number.isFinite)) return;
    const previous = this.samples.at(-1);
    // No DOM movement events are emitted while a held pointer is stationary.
    // A fresh flick must not be averaged across that entire silent hold.
    if (previous && time - previous.time > 100) {
      this.samples = [{ time: time - 20, position: this.position.clone() }];
    }
    this.position.add(delta);
    if (Math.hypot(delta.x, delta.y, delta.z) > 1e-5) this.motionTime = time;
    // Coalesced events can share timestamps; retain their final position.
    if (previous && time <= previous.time) previous.position.copy(this.position);
    else this.samples.push({ time, position: this.position.clone() });
    while (this.samples.length > 2 && this.samples[1].time < time - 100) this.samples.shift();
    if (this.samples.length > 64) this.samples.splice(1, this.samples.length - 64);
  }

  velocity(time: number, limit: number): Vector3 {
    if (time - this.motionTime > 140 || this.samples.length < 2) return new Vector3();
    const last = this.samples.at(-1)!;
    const cutoff = Math.max(this.samples[0].time, last.time - 80);
    let first = this.samples[0];
    for (let i = 1; i < this.samples.length; i++) {
      const next = this.samples[i];
      if (next.time <= cutoff) {
        first = next;
        continue;
      }
      if (first.time < cutoff) {
        const blend = (cutoff - first.time) / (next.time - first.time);
        first = { time: cutoff, position: first.position.clone().lerp(next.position, blend) };
      }
      break;
    }
    const velocity = last.position
      .clone()
      .sub(first.position)
      .divideScalar(Math.max(0.008, (last.time - first.time) / 1000));
    if (velocity.length() > limit) velocity.setLength(limit);
    return velocity;
  }
}
