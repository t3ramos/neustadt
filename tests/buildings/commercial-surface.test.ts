import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  commercialFacadeMaterial,
  updateCommercialFacadeNight,
  updateCommercialFacadeWet,
  type CommercialFamily,
} from '../../src/rendering/buildings/commercial-facades';

const families: CommercialFamily[] = ['curtain', 'brick', 'limestone', 'charcoal', 'campus'];

function data(map: THREE.Texture | null): Uint8Array {
  assert.ok(map instanceof THREE.DataTexture);
  assert.ok(map.image.data instanceof Uint8Array);
  return map.image.data;
}

test('all commercial styles use bounded shared maps with mipmaps and correct color spaces', () => {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  let bytes = 0;
  for (const family of families)
    for (const medium of [false, true]) {
      const material = commercialFacadeMaterial(family, medium);
      assert.equal(material, commercialFacadeMaterial(family, medium));
      materials.add(material);
      assert.equal(material.metalnessMap, material.roughnessMap);
      for (const map of [
        material.map,
        material.emissiveMap,
        material.roughnessMap,
        material.normalMap,
      ]) {
        assert.ok(map instanceof THREE.DataTexture);
        assert.equal(map.image.width, 256);
        assert.equal(map.image.height, medium ? 256 : 512);
        assert.equal(map.generateMipmaps, true);
        assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
        assert.equal(map.magFilter, THREE.LinearFilter);
        assert.equal(map.anisotropy, 8);
        assert.equal(
          map.colorSpace,
          map === material.map || map === material.emissiveMap
            ? THREE.SRGBColorSpace
            : THREE.NoColorSpace,
        );
        assert.ok(!textures.has(map), 'different styles and scales must own their atlas');
        textures.add(map);
        bytes += data(map).byteLength;
      }
    }
  assert.equal(materials.size, 10);
  assert.equal(textures.size, 40);
  assert.ok(
    (bytes * 4) / 3 <= 20 * 1024 * 1024,
    'all resident facade maps including mipmaps fit in 20 MiB',
  );
});

test('facades retain dielectric glass, sparse varied interiors, and valid relief normals', () => {
  for (const family of families)
    for (const medium of [false, true]) {
      const material = commercialFacadeMaterial(family, medium);
      const albedo = data(material.map),
        lights = data(material.emissiveMap),
        surface = data(material.roughnessMap),
        normals = data(material.normalMap);
      let glass = 0,
        wall = 0,
        lit = 0,
        relief = 0;
      const paneColors = new Set<number>(),
        lightLevels = new Set<number>();
      for (let i = 0; i < albedo.length; i += 4) {
        assert.equal(albedo[i + 3], 255);
        const nx = (normals[i] / 255) * 2 - 1,
          ny = (normals[i + 1] / 255) * 2 - 1,
          nz = (normals[i + 2] / 255) * 2 - 1;
        assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.015);
        assert.ok(nz > 0, 'no inverted tangent normals');
        if (Math.abs(nx) > 0.03 || Math.abs(ny) > 0.03) relief++;
        if (surface[i + 1] < 64) {
          glass++;
          assert.equal(surface[i + 2], 0, 'glass must remain nonmetallic');
          paneColors.add((albedo[i] << 16) | (albedo[i + 1] << 8) | albedo[i + 2]);
        } else wall++;
        if (lights[i]) {
          lit++;
          lightLevels.add(lights[i]);
          assert.ok(surface[i + 1] < 64, 'only interior glass pixels emit');
          assert.ok(lights[i] > lights[i + 2], 'warm occupied rooms');
        }
      }
      assert.ok(glass > 0 && wall > 0);
      assert.ok(lit > 0 && lit < (albedo.length / 4) * 0.2);
      assert.ok(relief > (albedo.length / 4) * 0.03);
      assert.ok(paneColors.size > 100, `${family} requires more than flat-colored panes`);
      assert.ok(lightLevels.size > 1, 'curtains and furnishings modulate room lighting');
    }
});

test('weather and night transitions reuse maps and retain standard pathtracer material slots', () => {
  try {
    updateCommercialFacadeNight(0.5);
    updateCommercialFacadeWet(true);
    for (const family of families) {
      const material = commercialFacadeMaterial(family);
      const maps = [material.map, material.emissiveMap, material.roughnessMap, material.normalMap];
      assert.equal(material.emissiveIntensity, 0.075);
      assert.equal(material.roughness, 0.65);
      assert.equal(material.transparent, false);
      assert.equal(material.opacity, 1);
      const cloned = material.clone();
      assert.equal(cloned.normalMap, material.normalMap);
      assert.equal(cloned.metalnessMap, material.roughnessMap);
      assert.deepEqual(cloned.normalScale, material.normalScale);
      assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
      cloned.dispose();
      updateCommercialFacadeNight(1);
      updateCommercialFacadeWet(false);
      assert.equal(material.emissiveIntensity, 0.15);
      assert.equal(material.roughness, 1);
      assert.deepEqual(
        [material.map, material.emissiveMap, material.roughnessMap, material.normalMap],
        maps,
      );
      updateCommercialFacadeNight(0.5);
      updateCommercialFacadeWet(true);
    }
  } finally {
    updateCommercialFacadeNight(0);
    updateCommercialFacadeWet(false);
  }
});
