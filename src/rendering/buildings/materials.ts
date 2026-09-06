import { updateOpeningNight, updateOpeningWet } from './facade-openings';
import { updateCommercialFacadeNight, updateCommercialFacadeWet } from './commercial-facades';
import * as THREE from 'three';
import { setRoadSurfaceWet } from '../infrastructure/road-surface';
export const palette = {
  stone: 0xe4d9bf,
  cream: 0xf6e8ca,
  white: 0xfff9e8,
  concrete: 0xbfc4b6,
  sidewalk: 0xc3c5b4,
  asphalt: 0x53626a,
  line: 0xf2e8ba,
  dark: 0x334852,
  terracotta: 0xb36f50,
  rust: 0x965746,
  roof: 0x637c80,
  glass: 0x588c9c,
  glassLight: 0x80afba,
  glassDark: 0x396b7c,
  blue: 0x367d9a,
  red: 0xc75948,
  yellow: 0xe5b65e,
  green: 0x68935d,
  grass: 0x8fb777,
  forest: 0x3e7657,
  leaf: 0x658c56,
  leafLight: 0x91a35a,
  trunk: 0x7c634a,
  water: 0x63b4c5,
  metal: 0x9aaba9,
  rail: 0x6b7777,
  wood: 0x937855,
  violet: 0x927e9e,
  solarCell: 0x1b3d56,
};
const materialCache = new Map<number, THREE.MeshStandardMaterial>();
let modelNightBlend = 0;
let modelWet = false;
let facilityPavingMaterial: THREE.MeshStandardMaterial | undefined;
function updateWetMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  const isGlass = [palette.glass, palette.glassLight, palette.glassDark].includes(color);
  const wettable = [
    palette.asphalt,
    palette.roof,
    palette.concrete,
    palette.sidewalk,
    palette.stone,
    palette.terracotta,
  ].includes(color);
  material.roughness = isGlass
    ? 0.27
    : modelWet && wettable
      ? color === palette.asphalt
        ? 0.18
        : color === palette.roof
          ? 0.29
          : 0.36
      : 0.84;
  material.metalness = isGlass ? 0.23 : modelWet && wettable ? 0.09 : 0.02;
}
export function setModelWet(wet: boolean): void {
  modelWet = wet;
  updateOpeningWet(wet);
  updateCommercialFacadeWet(wet);
  setRoadSurfaceWet(wet);
  for (const [color, material] of materialCache) updateWetMaterial(material, color);
  if (facilityPavingMaterial) updateWetMaterial(facilityPavingMaterial, palette.asphalt);
}
function updateNightMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  if ([palette.glass, palette.glassLight, palette.glassDark].includes(color)) {
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  }
}
export function setModelNightBlend(blend: number): void {
  modelNightBlend = Number.isFinite(blend) ? Math.max(0, Math.min(1, blend)) : 0;
  updateOpeningNight(modelNightBlend);
  updateCommercialFacadeNight(modelNightBlend);
  for (const [color, material] of materialCache) updateNightMaterial(material, color);
  for (const [color, material] of buildingWindowMaterials)
    updateBuildingWindowMaterial(material, color);
}
export function setModelNight(night: boolean): void {
  setModelNightBlend(night ? 1 : 0);
}
export function modelMaterial(color: number): THREE.MeshStandardMaterial {
  let material = materialCache.get(color);
  if (!material) {
    const isGlass = [palette.glass, palette.glassLight, palette.glassDark].includes(color);
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: isGlass ? 0.27 : 0.84,
      metalness: isGlass ? 0.23 : 0.02,
    });
    material.forceSinglePass = true;
    if (isGlass) material.userData.glazing = true;
    updateNightMaterial(material, color);
    updateWetMaterial(material, color);
    materialCache.set(color, material);
  }
  return material;
}
const buildingWindowMaterials = new Map<number, THREE.MeshStandardMaterial>();
function updateBuildingWindowMaterial(material: THREE.MeshStandardMaterial, color: number): void {
  material.color.setHex(color).lerp(new THREE.Color(0xffd59a), Math.sqrt(modelNightBlend) * 0.88);
  material.emissive.setHex(0xffd39a);
  material.emissiveIntensity = modelNightBlend * 0.2;
}
export function buildingWindowMaterial(color: number): THREE.MeshStandardMaterial {
  let material = buildingWindowMaterials.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.27, metalness: 0.23 });
    material.userData.buildingWindowLight = true;
    material.forceSinglePass = true;
    buildingWindowMaterials.set(color, material);
    updateBuildingWindowMaterial(material, color);
  }
  return material;
}
// Small, deterministic lit panes sit on the original opaque v1 facades. They
export function getFacilityPavingMaterial(): THREE.MeshStandardMaterial {
  if (!facilityPavingMaterial) {
    facilityPavingMaterial = modelMaterial(palette.asphalt).clone();
    facilityPavingMaterial.polygonOffset = true;
    facilityPavingMaterial.polygonOffsetFactor = -1;
    facilityPavingMaterial.polygonOffsetUnits = -1;
  }
  return facilityPavingMaterial;
}
