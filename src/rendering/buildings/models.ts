import { addFourSidedOpenings } from './facade-openings';
import { buildBeach } from './beach';
import { isRuralCommercial } from '../../world/rural';
import { buildRuralCommercial } from './rural';
import * as THREE from 'three';
import type { CityState, Tile } from '../../domain/types';
import { box, slab, tree, zone, mesh, crownGeometry } from './primitives';
import { palette } from './materials';
import { facilityFrame, FACILITY_FOOTPRINTS } from './facility-frame';
import { buildingVariant, zoneLotDimensions } from '../../buildings/lots';
import { createEasterEggBuilding, isEasterEggBuilding } from './easter-egg';
import { getFacilityAccess } from '../../buildings/facility-access';
import { zoneArchitecture, industrial } from './architecture';
import { road, rail } from './infrastructure-models';
import { connectFacilityModel } from './facility-access-model';
import { addBuildingWindowLights } from './window-lights';
import {
  powerPlant,
  waterPump,
  service,
  park,
  stadium,
  airport,
  seaport,
  windPlant,
  solarPlant,
  university,
  recyclingPlant,
  facilityArchitecture,
} from './facilities';
export { modelMaterial, setModelWet, setModelNight, setModelNightBlend } from './materials';
export { getModelFootprint } from './facility-frame';
export { createFacilityActors, updateFacilityActors } from './facility-actors';
export {
  createCar,
  createFacilityServiceVehicle,
  refreshFacilityServiceVehicleLabel,
  type FacilityServiceVehicleKind,
} from './service-vehicles';
export function createTileModel(tile: Tile, state: CityState): THREE.Group {
  const g = new THREE.Group();
  g.name = `${tile.kind}:${tile.x},${tile.z}`;
  g.userData.buildingVariant = buildingVariant(tile);
  if (tile.anchor >= 0 && tile.anchor !== tile.z * state.size + tile.x) return g;
  if (tile.level === 0 && tile.lotWidth) {
    const [w, d] = zoneLotDimensions(tile);
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const plot = new THREE.Group();
        plot.position.set(x, 0, z);
        zone(
          plot,
          tile.kind === 'residential' ? 0x66a276 : tile.kind === 'commercial' ? 0x548fac : 0xc6a958,
          tile.variation,
        );
        g.add(plot);
      }
    return g;
  }
  const access =
    FACILITY_FOOTPRINTS[tile.kind] || (tile.kind === 'industrial' && tile.level > 0)
      ? getFacilityAccess(state, tile)
      : null;
  const connectedIndustry = tile.kind === 'industrial' && access?.connected;
  const facility = FACILITY_FOOTPRINTS[tile.kind]
    ? facilityFrame(g, tile)
    : connectedIndustry
      ? facilityFrame(g, { ...tile, rotation: access.rotation as Tile['rotation'] })
      : g;
  switch (tile.kind) {
    case 'road':
      road(g, tile, state);
      break;
    case 'rail':
      rail(g, tile, state);
      break;
    case 'tree': {
      tree(g, -0.12, -0.09, 0.94 + (Math.abs(tile.variation) % 4) * 0.1, tile.variation);
      if (tile.variation % 2) tree(g, 0.24, 0.18, 0.53, tile.variation + 1);
      break;
    }
    case 'residential':
    case 'commercial':
      if (isRuralCommercial(state, tile)) {
        g.add(buildRuralCommercial(tile));
        break;
      }
      if (tile.level > 0 && isEasterEggBuilding(tile)) {
        const model = createEasterEggBuilding();
        if (model) {
          const [w, d] = zoneLotDimensions(tile),
            frame = new THREE.Group();
          frame.name = 'Easter Egg street-facing offices';
          frame.position.set((w - 1) / 2, 0, (d - 1) / 2);
          frame.rotation.y = (-tile.rotation * Math.PI) / 2;
          model.position.set(0, 0, 0);
          frame.add(model);
          g.add(frame);
          slab(frame, palette.sidewalk, 2.96, 1.96);
          box(frame, palette.concrete, 0, 0.044, 0.78, 0.48, 0.018, 0.4);
        } else zoneArchitecture(g, tile);
      } else if (tile.level > 0) zoneArchitecture(g, tile);
      else zone(g, tile.kind === 'residential' ? 0x66a276 : 0x548fac, tile.variation);
      break;
    case 'industrial':
      if (tile.level > 0 && (buildingVariant(tile) !== 0 || tile.lotWidth))
        zoneArchitecture(facility, tile, !!connectedIndustry);
      else industrial(facility, tile, !!connectedIndustry);
      break;
    case 'power':
      powerPlant(facility);
      break;
    case 'waterpump':
      waterPump(facility);
      break;
    case 'police':
    case 'fire':
    case 'hospital':
    case 'school':
      service(facility, tile.kind);
      break;
    case 'beach':
      g.add(buildBeach(tile));
      break;
    case 'park':
      park(g, tile);
      break;
    case 'stadium':
      stadium(facility);
      break;
    case 'airport':
      airport(facility);
      break;
    case 'seaport':
      seaport(facility);
      break;
    case 'wind':
      windPlant(facility);
      break;
    case 'solar':
      solarPlant(facility);
      break;
    case 'university':
      university(facility);
      break;
    case 'recycling':
      recyclingPlant(facility);
      break;
    case 'rubble':
      slab(g, 0x9c927f);
      for (let i = 0; i < 5; i++) {
        const n = (Math.abs(tile.variation) + i * 37) % 100;
        mesh(
          g,
          crownGeometry,
          i % 2 ? palette.concrete : palette.stone,
          (((n * 7) % 61) - 30) / 100,
          0.08 + (n % 3) * 0.04,
          (((n * 13) % 61) - 30) / 100,
          0.18 + (n % 4) * 0.04,
          0.16 + (n % 3) * 0.07,
          0.18 + (n % 4) * 0.03,
          n,
        );
      }
      break;
    default:
      break;
  }
  if (FACILITY_FOOTPRINTS[tile.kind]) facilityArchitecture(facility, tile);
  if (
    !isEasterEggBuilding(tile) &&
    !isRuralCommercial(state, tile) &&
    (tile.kind !== 'commercial' || tile.level < 2) &&
    (FACILITY_FOOTPRINTS[tile.kind] ||
      (tile.level > 0 && ['residential', 'commercial', 'industrial'].includes(tile.kind)))
  )
    addFourSidedOpenings(g);
  if (access?.connected) connectFacilityModel(g, facility, access, tile, state);
  if (
    FACILITY_FOOTPRINTS[tile.kind] ||
    (tile.level > 0 && ['residential', 'commercial', 'industrial'].includes(tile.kind))
  )
    addBuildingWindowLights(g, tile);
  // Burning buildings retain their geometry; fire-effects owns animated flames,
  // smoke and embers independently of these shared static model primitives.
  return g;
}
