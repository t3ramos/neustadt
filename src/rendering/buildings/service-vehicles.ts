import * as THREE from 'three';
import { box } from './primitives';
import { palette } from './materials';
import { createDetailedCar } from '../vehicles/model';
import { tr } from '../../i18n/index';
export function createCar(color: number): THREE.Group {
  return createDetailedCar(color);
}
export type FacilityServiceVehicleKind = 'firetruck' | 'ambulance' | 'police';
export function refreshFacilityServiceVehicleLabel(car: THREE.Object3D): void {
  const kind = car.userData.vehicleKind as FacilityServiceVehicleKind;
  const label =
    kind === 'firetruck'
      ? tr('Feuerwehrwagen', 'Fire engine')
      : kind === 'ambulance'
        ? tr('Krankenwagen', 'Ambulance')
        : kind === 'police'
          ? tr('Polizeiwagen', 'Police car')
          : undefined;
  if (label) car.userData.vehicleLabel = car.userData.label = label;
}
/** Road-going service vehicles share the same +Z chassis and contact metadata. */
export function createFacilityServiceVehicle(kind: FacilityServiceVehicleKind): THREE.Group {
  const car = createDetailedCar(
    kind === 'firetruck' ? palette.red : palette.white,
    kind === 'firetruck' ? 'truck' : kind === 'ambulance' ? 'van' : 'sedan',
  );
  car.name = `city-service-${kind}`;
  if (kind === 'firetruck') {
    box(car, palette.red, 0, 0.218, -0.102, 0.208, 0.205, 0.35);
    for (const side of [-1, 1]) {
      box(car, palette.white, side * 0.105, 0.153, -0.1, 0.003, 0.024, 0.33);
      for (const z of [-0.209, -0.105, -0.001]) {
        box(car, palette.metal, side * 0.106, 0.245, z, 0.003, 0.096, 0.087);
        box(car, palette.dark, side * 0.108, 0.197, z, 0.003, 0.007, 0.046);
      }
      box(car, palette.metal, side * 0.057, 0.34, -0.075, 0.011, 0.014, 0.366);
    }
    for (let i = 0; i < 9; i++)
      box(car, palette.white, 0, 0.34, -0.234 + i * 0.038, 0.114, 0.01, 0.01);
    box(car, palette.white, 0, 0.28, 0.135, 0.116, 0.014, 0.025);
  } else if (kind === 'ambulance') {
    for (const side of [-1, 1]) {
      box(car, palette.red, side * 0.088, 0.119, -0.05, 0.003, 0.025, 0.211);
      box(car, palette.red, side * 0.089, 0.183, -0.067, 0.003, 0.022, 0.065);
      box(car, palette.red, side * 0.09, 0.183, -0.067, 0.003, 0.067, 0.022);
    }
    box(car, palette.red, 0, 0.19, -0.184, 0.085, 0.016, 0.002);
    box(car, palette.red, 0, 0.19, -0.185, 0.016, 0.062, 0.002);
  } else {
    for (const side of [-1, 1])
      box(car, palette.blue, side * 0.081, 0.079, -0.011, 0.003, 0.03, 0.15);
    box(car, palette.blue, 0, 0.093, 0.119, 0.093, 0.008, 0.04);
  }
  const lightY = kind === 'firetruck' ? 0.289 : kind === 'ambulance' ? 0.24 : 0.18;
  box(
    car,
    palette.dark,
    0,
    lightY - 0.009,
    kind === 'firetruck' ? 0.133 : 0.005,
    0.135,
    0.012,
    0.031,
  );
  for (const side of [-1, 1]) {
    const light = box(
      car,
      palette.blue,
      side * 0.047,
      lightY,
      kind === 'firetruck' ? 0.133 : 0.005,
      0.039,
      0.02,
      0.034,
    );
    light.name = `service-beacon-${side}`;
    light.userData.serviceBeacon = true;
  }
  car.userData.vehicleKind = kind;
  refreshFacilityServiceVehicleLabel(car);
  car.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(car);
  // The shared chassis includes a small modeling offset beneath the wheels.
  // Service routes provide their own road clearance, so their root is the tire
  // contact plane instead of adding both offsets and visibly hovering.
  for (const part of car.children) part.position.y -= bounds.min.y;
  car.updateMatrixWorld(true);
  bounds.setFromObject(car);
  const size = bounds.getSize(new THREE.Vector3());
  car.userData.vehicleDimensions = {
    ...car.userData.vehicleDimensions,
    width: size.x,
    length: size.z,
    height: bounds.max.y,
  };
  car.userData.collisionHalfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  car.userData.collisionHalfLength = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  return car;
}
