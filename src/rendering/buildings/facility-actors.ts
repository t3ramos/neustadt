import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import { box, cylinder, mesh, sphereGeometry } from './primitives';
import { palette } from './materials';
import { facilityFrame } from './facility-frame';
import { aircraft } from './facilities';
import { updateAirportAircraft } from './airport-layout';
import { getFacilityAccess } from '../../buildings/facility-access';
export function createFacilityActors(tile: Tile, _state: CityState): THREE.Group | null {
  if (tile.anchor >= 0 && tile.anchor !== tile.z * _state.size + tile.x) return null;
  // Emergency vehicles belong to the scene's real road fleet. A second set of
  // decorative cars used to slide along the apron without ever reaching a road.
  if (!['wind', 'stadium', 'airport', 'seaport'].includes(tile.kind)) return null;
  const g = new THREE.Group();
  g.name = `actors:${tile.kind}:${tile.x},${tile.z}`;
  const frame = facilityFrame(g, tile);
  const access = getFacilityAccess(_state, tile);
  if (access?.connected) {
    frame.scale.set(access.contentScale.x, 1, access.contentScale.z);
    frame.position.y = -0.031;
  }
  g.userData.kind = tile.kind;
  g.userData.seed = Math.abs(tile.variation);
  if (tile.kind === 'wind') {
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    rotor.position.set(0, 2.52, 0.16);
    cylinder(rotor, palette.white, 0, 0, 0, 0.18, 0.19).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Group();
      blade.rotation.z = (i * Math.PI * 2) / 3;
      const fin = box(blade, palette.white, 0.038, 0.46, 0, 0.13, 0.84, 0.035);
      fin.rotation.z = -0.06;
      rotor.add(blade);
    }
    frame.add(rotor);
  } else if (tile.kind === 'stadium') {
    for (let i = 0; i < 12; i++) {
      const player = new THREE.Group();
      player.name = `player:${i}`;
      cylinder(player, i < 6 ? palette.red : palette.blue, 0, 0.08, 0, 0.054, 0.1);
      mesh(player, sphereGeometry, palette.cream, 0, 0.159, 0, 0.049, 0.049, 0.049);
      for (const x of [-0.02, 0.02]) box(player, palette.dark, x, 0.032, 0, 0.017, 0.057, 0.021);
      frame.add(player);
    }
    mesh(frame, sphereGeometry, palette.white, 0, 0.19, 0, 0.052, 0.052, 0.052).name = 'ball';
  } else if (tile.kind === 'airport') {
    const plane = aircraft();
    plane.name = 'aircraft';
    frame.add(plane);
  } else if (tile.kind === 'seaport') {
    for (const x of [1.7, 0.1]) {
      const hook = new THREE.Group();
      hook.name = `hook:${x}`;
      hook.position.set(x, 0, 1.18);
      cylinder(hook, palette.dark, 0, 0.9, 0, 0.016, 1.15);
      box(hook, palette.yellow, 0, 0.31, 0, 0.46, 0.045, 0.27);
      frame.add(hook);
    }
  }
  return g;
}
export function updateFacilityActors(g: THREE.Group, elapsed: number, state: CityState): void {
  const frame = g.children[0];
  if (!frame) return;
  const seed = Number(g.userData.seed ?? 0);
  const time = elapsed + (seed % 29);
  switch (g.userData.kind) {
    case 'wind': {
      const rotor = frame.getObjectByName('rotor');
      if (rotor) rotor.rotation.z = -elapsed * 1.05;
      break;
    }
    case 'stadium': {
      for (let i = 0; i < 12; i++) {
        const player = frame.getObjectByName(`player:${i}`);
        if (!player) continue;
        const side = i < 6 ? -1 : 1;
        const phase = time * 0.57 + i * 2.17;
        player.position.set(
          side * (0.53 + (i % 3) * 0.34) + Math.sin(phase) * 0.26,
          0.165 + Math.abs(Math.sin(phase * 5)) * 0.013,
          ((i % 6) / 5 - 0.5) * 1.62 + Math.cos(phase * 0.71) * 0.17,
        );
      }
      const ball = frame.getObjectByName('ball');
      if (ball)
        ball.position.set(
          Math.sin(time * 0.49) * 1.38,
          0.19 + Math.abs(Math.sin(time * 2.1)) * 0.05,
          Math.cos(time * 0.77) * 0.67,
        );
      break;
    }
    case 'airport': {
      const plane = frame.getObjectByName('aircraft');
      if (!plane) break;
      updateAirportAircraft(plane, time);
      break;
    }
    case 'seaport':
      for (let i = 0; i < frame.children.length; i++) {
        const hook = frame.children[i];
        hook.position.y = Math.sin(time * 0.45 + i) * 0.16;
        hook.position.z = 1.02 + Math.sin(time * 0.28 + i * 2) * 0.21;
      }
      break;
  }
  g.visible = true;
  // The caller owns the simulation clock. Passing a constant elapsed value
  // during pause/photo mode freezes every actor for stable path tracing.
  void state;
}
