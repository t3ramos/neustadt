import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CITIZEN_SCALE, createCitizens, type CitizenSystem } from '../../src/citizens/system.ts';
import {
  applyCitizenIncident,
  createCity,
  recalculate,
} from '../../src/simulation/city-simulation.ts';
import type { CitizenIncident, CityState } from '../../src/domain/types.ts';

type Point = { x: number; y: number; z: number };
type Incident = Omit<CitizenIncident, 'id' | 'month'>;
const TORSO_HEIGHT = 0.32 * CITIZEN_SCALE;

/** One actual remaining resident keeps witnesses and population assertions exact. */
function isolatedCity(segments: readonly (readonly [number, number])[], police = false): CityState {
  const state = createCity(91, true, 40);
  for (const tile of state.tiles) {
    tile.kind = 'empty';
    tile.elevation = 1;
    tile.anchor = -1;
    tile.level = 0;
    tile.fire = 0;
    tile.hasPipe = false;
    tile.hasPowerLine = false;
  }
  for (const [first, last] of segments)
    for (let x = first; x <= last; x++) {
      state.tiles[10 * state.size + x].kind = 'road';
      const home = state.tiles[11 * state.size + x];
      home.kind = 'residential';
      home.level = 1;
    }
  if (police) {
    const anchor = 7 * state.size + 10;
    for (let z = 7; z <= 8; z++)
      for (let x = 10; x <= 11; x++) {
        const tile = state.tiles[z * state.size + x];
        tile.kind = 'police';
        tile.level = 1;
        tile.anchor = anchor;
      }
  }
  recalculate(state);
  state.citizenEffects.populationLoss = state.stats.population - 1;
  recalculate(state);
  assert.equal(state.stats.population, 1);
  return state;
}

/** Public pointer calls and animation frames, using a camera-facing vertical plane. */
function hand(system: CitizenSystem, position: Point) {
  let time = 0;
  let cursor = { x: position.x, y: position.y + TORSO_HEIGHT, z: position.z };
  const ray = (point: Point) =>
    new THREE.Ray(new THREE.Vector3(point.x, point.y, point.z - 1), new THREE.Vector3(0, 0, 1));
  assert.equal(system.pointerDown(ray(cursor), new THREE.Vector3(0, -0.7, 0.7), time), true);
  return {
    moveTo(target: Point, seconds: number) {
      const start = { ...cursor },
        frames = Math.ceil(seconds * 60),
        dt = seconds / frames;
      for (let frame = 1; frame <= frames; frame++) {
        const t = frame / frames;
        cursor = {
          x: start.x + (target.x - start.x) * t,
          y: start.y + (target.y - start.y) * t,
          z: target.z,
        };
        time += dt * 1000;
        assert.equal(system.pointerMove(ray(cursor), time), true);
        system.animate(dt, false);
      }
    },
    wait(seconds: number, walking = false) {
      const frames = Math.ceil(seconds * 60),
        dt = seconds / frames;
      for (let frame = 0; frame < frames; frame++) {
        time += dt * 1000;
        system.animate(dt, walking);
      }
    },
    release() {
      time++;
      assert.equal(system.pointerUp(time), true);
    },
  };
}

test('grabbing, lifting and throwing applies exactly one witnessed casualty to the city', () => {
  const state = isolatedCity([[8, 12]], true),
    before = {
      population: state.stats.population,
      happiness: state.stats.happiness,
      loss: state.citizenEffects.populationLoss,
    };
  const incidents: Incident[] = [];
  const system = createCitizens(state, (incident) => {
    incidents.push(incident);
    assert.equal(applyCitizenIncident(state, incident).ok, true);
    system.update(state);
  });
  try {
    system.setEnabled(true);
    assert.equal(system.getDebug().count, 1);
    const person = system.getDebug().positions[0],
      drag = hand(system, person);
    drag.moveTo({ x: person.x, y: person.y + 3, z: person.z }, 1);
    drag.wait(0.3);
    // A deliberate downward flick, followed immediately by release.
    drag.moveTo({ x: person.x, y: person.y + 2.4, z: person.z }, 0.06);
    drag.release();
    drag.wait(4);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].kind, 'impact');
    assert.equal(incidents[0].witnessed, true);
    assert.equal(state.stats.population, before.population - 1);
    assert.equal(state.citizenEffects.populationLoss, before.loss + 1);
    assert.equal(state.citizenEffects.happinessPenalty, 2);
    assert.equal(state.stats.happiness, before.happiness - 2);
    assert.equal(state.citizenEffects.incidents.length, 1);
    assert.equal(system.getDebug().count, 0);
    assert.equal(system.getDebug().ragdolls, 0);
    assert.equal(system.group.getObjectByName('persistent-citizen-splatters')?.children.length, 1);
    drag.wait(2);
    assert.equal(incidents.length, 1);
  } finally {
    system.dispose();
  }
});

test('carrying an isolated resident beyond the map and releasing records an unwitnessed abduction', () => {
  const state = isolatedCity([[8, 12]]),
    before = {
      population: state.stats.population,
      happiness: state.stats.happiness,
      loss: state.citizenEffects.populationLoss,
    };
  const incidents: Incident[] = [];
  const system = createCitizens(state, (incident) => {
    incidents.push(incident);
    assert.equal(applyCitizenIncident(state, incident).ok, true);
    system.update(state);
  });
  try {
    system.setEnabled(true);
    assert.equal(system.getDebug().count, 1);
    const person = system.getDebug().positions[0],
      drag = hand(system, person);
    drag.moveTo({ x: person.x, y: person.y + 3, z: person.z }, 1);
    drag.moveTo({ x: -state.size / 2 - 1, y: person.y + 3, z: person.z }, 3);
    drag.wait(0.5);
    assert.equal(incidents.length, 0);
    drag.release();
    drag.wait(3);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].kind, 'abduction');
    assert.equal(incidents[0].witnessed, false);
    assert.equal(state.stats.population, before.population - 1);
    assert.equal(state.citizenEffects.populationLoss, before.loss + 1);
    assert.equal(state.citizenEffects.happinessPenalty, 0);
    assert.equal(state.stats.happiness, before.happiness);
    assert.equal(state.citizenEffects.incidents.length, 1);
    assert.equal(system.getDebug().count, 0);
    assert.equal(system.holding, false);
    assert.equal(system.group.getObjectByName('persistent-citizen-splatters')?.children.length, 0);
  } finally {
    system.dispose();
  }
});

test('gently relocated residents resume walking on their new disconnected street', () => {
  const state = isolatedCity([
      [5, 10],
      [28, 33],
    ]),
    incidents: Incident[] = [];
  const system = createCitizens(state, (incident) => incidents.push(incident));
  try {
    system.setEnabled(true);
    assert.equal(system.getDebug().count, 1);
    const person = system.getDebug().positions[0];
    const [first, last] = person.x < 0 ? [28, 33] : [5, 10];
    const targetX = (first + last) / 2 - state.size / 2 + 0.5;
    const drag = hand(system, person);
    drag.moveTo({ x: person.x, y: person.y + 3, z: person.z }, 1);
    drag.moveTo({ x: targetX, y: person.y + 3, z: person.z }, 4);
    drag.moveTo({ x: targetX, y: person.y + TORSO_HEIGHT, z: person.z }, 2);
    drag.wait(0.4);
    drag.release();
    assert.equal(system.getDebug().ragdolls, 0);
    assert.equal(incidents.length, 0);
    const landing = system.getDebug().positions[0];
    assert.ok(
      Math.abs(landing.x - targetX) < 0.7,
      'Resident should be placed on the destination street',
    );
    const visited: number[] = [];
    for (let frame = 0; frame < 900; frame++) {
      system.animate(1 / 60, true);
      const point = system.getDebug().positions[0];
      visited.push(point.x);
      assert.ok(
        point.x >= first - state.size / 2 && point.x <= last - state.size / 2 + 1,
        `Resident left the destination street for the old neighbourhood at x=${point.x}`,
      );
      assert.ok(Math.abs(point.z - person.z) < 0.5);
    }
    assert.ok(
      Math.max(...visited) - Math.min(...visited) > 0.5,
      'Resident should resume walking, not freeze at the drop location',
    );
    assert.equal(incidents.length, 0);
    assert.equal(state.stats.population, 1);
  } finally {
    system.dispose();
  }
});
