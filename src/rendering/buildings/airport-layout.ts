import * as THREE from 'three';
import { box, roof, cylinder } from './primitives';
import { palette } from './materials';

/** All airside coordinates are local to facilityFrame, before rotation/access scaling.
 * Runway z=-1.60, taxiway z=-.31. Tall architecture stays on the terminal
 * roof at z>=1.18; the banked return circuit occupies z<=.20 at cruise height.
 */
export function airportArchitecture(g: THREE.Group, variant: number): void {
  if (!variant) return;
  const terminal = new THREE.Group();
  terminal.name = `architecture-${variant}`;
  g.add(terminal);
  if (variant === 1) {
    // Three shallow terminal vaults; no upright wheel across the airfield.
    for (let i = 0; i < 3; i++)
      roof(terminal, palette.white, -2.25 + i * 1.5, 0.94, 1.77, 1.42, 0.28, 1.12);
  } else if (variant === 2) {
    box(terminal, palette.glassDark, -0.71, 1.04, 1.77, 2.72, 0.25, 0.93);
    box(terminal, palette.white, -0.71, 1.19, 1.77, 2.92, 0.07, 1.05);
    for (const x of [-1.75, -0.71, 0.33])
      box(terminal, palette.white, x, 1.04, 1.77, 0.06, 0.29, 0.95);
  } else if (variant === 3) {
    for (let i = 0; i < 3; i++) {
      box(
        terminal,
        palette.stone,
        -2.24 + i * 1.51,
        0.98 + i * 0.08,
        1.77,
        1.43,
        0.15 + i * 0.16,
        1.04,
      );
      box(terminal, palette.green, -2.24 + i * 1.51, 1.075 + i * 0.16, 1.77, 1.36, 0.035, 0.96);
    }
  } else {
    roof(terminal, palette.metal, -0.71, 0.94, 1.77, 4.73, 0.25, 1.12);
    // Radar is a small horizontal dome on the existing landside tower.
    cylinder(terminal, palette.white, 2.75, 1.97, 1.72, 0.47, 0.2);
    box(terminal, palette.blue, -0.71, 1.0, 2.34, 3.62, 0.09, 0.025);
  }
}

export const AIRPORT_FLIGHT_PERIOD = 52;
export function updateAirportAircraft(plane: THREE.Object3D, time: number): void {
  // Closed racetrack: accelerate along the runway, climb, fly a banked
  // circuit and return for landing. Position and heading are continuous.
  const phase =
    (((time % AIRPORT_FLIGHT_PERIOD) + AIRPORT_FLIGHT_PERIOD) % AIRPORT_FLIGHT_PERIOD) /
    AIRPORT_FLIGHT_PERIOD;
  if (phase < 0.45) {
    const t = phase / 0.45,
      climb = Math.max(0, (t - 0.45) / 0.55);
    const lift = climb * climb * (3 - 2 * climb);
    plane.position.set(-3.45 + t * 6.9, 0.115 + lift * 2.085, -1.6);
    plane.rotation.set(0, 0, Math.sin(climb * Math.PI) * 0.24);
  } else if (phase < 0.58) {
    const t = (phase - 0.45) / 0.13,
      angle = -Math.PI / 2 + t * Math.PI;
    plane.position.set(3.45 + Math.cos(angle) * 0.9, 2.2, -0.7 + Math.sin(angle) * 0.9);
    plane.rotation.set(Math.sin(t * Math.PI) * -0.25, -t * Math.PI, 0);
  } else if (phase < 0.87) {
    const t = (phase - 0.58) / 0.29;
    plane.position.set(3.45 - t * 6.9, 2.2, 0.2);
    plane.rotation.set(0, -Math.PI, 0);
  } else {
    const t = (phase - 0.87) / 0.13,
      angle = Math.PI / 2 + t * Math.PI;
    const landing = t * t * (3 - 2 * t);
    plane.position.set(
      -3.45 + Math.cos(angle) * 0.9,
      2.2 - landing * 2.085,
      -0.7 + Math.sin(angle) * 0.9,
    );
    plane.rotation.set(
      Math.sin(t * Math.PI) * -0.2,
      -Math.PI - t * Math.PI,
      -Math.sin(t * Math.PI) * 0.25,
    );
  }
}
