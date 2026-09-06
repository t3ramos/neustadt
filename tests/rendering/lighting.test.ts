import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createCityLighting,
  getLightingProfile,
  stabilizeShadowAnchor,
} from '../../src/rendering/lighting/environment.ts';

function near(actual: number, expected: number, message: string, epsilon = 1e-8): void {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test('lighting wraps the clock in both directions and falls back to noon for NaN', () => {
  for (const [input, expected] of [
    [0, 0],
    [24, 0],
    [48.5, 0.5],
    [-1, 23],
    [-49, 23],
    [12, 12],
  ]) {
    const profile = getLightingProfile(input);
    near(profile.hour, expected, `Normalized hour for ${input}`);
    assert.deepEqual(
      profile,
      getLightingProfile(expected),
      'Equivalent times must render the same lighting',
    );
  }
  assert.deepEqual(getLightingProfile(Number.NaN), getLightingProfile(12));
});

test('the sun rises, crosses the sky, sets, and stays below the horizon at midnight', () => {
  const dawn = getLightingProfile(6),
    morning = getLightingProfile(9);
  const noon = getLightingProfile(12),
    afternoon = getLightingProfile(15);
  const dusk = getLightingProfile(18),
    midnight = getLightingProfile(0);
  near(dawn.sunDirection.y, 0, 'Sunrise lies on the horizon');
  near(dusk.sunDirection.y, 0, 'Sunset lies on the horizon');
  assert.ok(morning.sunDirection.y > 0 && afternoon.sunDirection.y > 0);
  assert.ok(
    noon.sunDirection.y > morning.sunDirection.y && noon.sunDirection.y > afternoon.sunDirection.y,
  );
  assert.ok(midnight.sunDirection.y < 0);
  assert.ok(
    morning.sunDirection.x * afternoon.sunDirection.x < 0,
    'Sun must cross from one side of the sky to the other',
  );
  near(noon.sunDirection.x, 0, 'Noon is halfway through the east-west arc');
  assert.ok(noon.daylight > 0.95 && midnight.daylight < 0.05);
  assert.equal(noon.night, false);
  assert.equal(midnight.night, true);
});

test('sun, moon, and active light directions stay normalized throughout the day', () => {
  for (let hour = 0; hour < 24; hour += 0.125) {
    const profile = getLightingProfile(hour);
    near(profile.sunDirection.length(), 1, `Sun direction at ${hour}`);
    near(profile.moonDirection.length(), 1, `Moon direction at ${hour}`);
    near(profile.lightDirection.length(), 1, `Active light direction at ${hour}`);
    near(profile.sunDirection.dot(profile.moonDirection), -1, `Opposite sun and moon at ${hour}`);
    assert.ok(
      profile.lightDirection.y >= -1e-8,
      `Active light must be above the horizon at ${hour}`,
    );
    const selected = profile.sunDirection.y >= 0 ? profile.sunDirection : profile.moonDirection;
    assert.ok(
      profile.lightDirection.distanceTo(selected) < 1e-8,
      `Active light must follow the visible sun or moon at ${hour}`,
    );
  }
});

test('dawn, dusk, and midnight do not produce abrupt brightness or exposure changes', () => {
  const continuousValues = [
    'daylight',
    'nightBlend',
    'sunIntensity',
    'moonIntensity',
    'lightIntensity',
    'exposure',
    'bloom',
  ] as const;
  // Dense sampling also catches a branch change slightly before or after the horizon crossing.
  for (const center of [0, 6, 18, 24]) {
    for (let offset = -0.5; offset < 0.5; offset += 0.01) {
      const before = getLightingProfile(center + offset),
        after = getLightingProfile(center + offset + 0.01);
      for (const key of continuousValues) {
        const delta = Math.abs(after[key] - before[key]);
        assert.ok(delta < 0.08, `${key} jumps by ${delta} near hour ${center + offset}`);
      }
    }
  }
  const beforeMidnight = getLightingProfile(24 - 0.000001),
    afterMidnight = getLightingProfile(0.000001);
  assert.ok(beforeMidnight.sunDirection.distanceTo(afterMidnight.sunDirection) < 0.00001);
  for (const key of continuousValues)
    near(beforeMidnight[key], afterMidnight[key], `${key} loops smoothly at midnight`, 0.00001);
});

test('all lighting parameters and colors remain finite across a full day', () => {
  let colorCount = 0;
  for (let hour = 0; hour < 24; hour += 0.1) {
    const profile = getLightingProfile(hour);
    assert.ok(profile.hour >= 0 && profile.hour < 24);
    assert.ok(profile.daylight >= 0 && profile.daylight <= 1);
    assert.ok(profile.nightBlend >= 0 && profile.nightBlend <= 1);
    assert.ok(
      profile.sunIntensity >= 0 && profile.moonIntensity >= 0 && profile.lightIntensity >= 0,
    );
    assert.ok(profile.exposure > 0 && profile.bloom >= 0);
    for (const [key, value] of Object.entries(profile)) {
      if (typeof value === 'number')
        assert.ok(Number.isFinite(value), `${key} is not finite at ${hour}`);
      if (value instanceof THREE.Color) {
        colorCount++;
        for (const channel of [value.r, value.g, value.b])
          assert.ok(
            Number.isFinite(channel) && channel >= 0,
            `${key} has an invalid color at ${hour}`,
          );
      }
    }
  }
  assert.ok(colorCount > 0, 'Profiles must expose Three.js colors for the renderer');
});

test('day and night bloom stays subtle throughout the entire lighting cycle', () => {
  for (let hour = 0; hour < 24; hour += 0.05) {
    const bloom = getLightingProfile(hour).bloom;
    assert.ok(
      bloom >= 0 && bloom <= 0.08,
      `Bloom must remain within its subtle range at ${hour}; received ${bloom}`,
    );
  }
  assert.ok(getLightingProfile(12).bloom <= 0.04, 'Daylight should avoid a bright bloom haze');
  assert.ok(
    getLightingProfile(0).bloom > getLightingProfile(12).bloom,
    'Night lights may have a slightly stronger glow',
  );
});

test('shadow anchors stay fixed within half a texel and move in whole texel steps across a boundary', () => {
  const direction = new THREE.Vector3(0, 0, 1);
  const snap = (x: number, y: number) =>
    stabilizeShadowAnchor(direction, new THREE.Vector3(x, y, 7.25), 32, 128, 16, 32);
  // These rectangular dimensions represent a half-unit horizontal texel and a one-unit vertical texel.
  const origin = snap(0, 0);
  assert.ok(
    snap(0.249, 0.499).distanceTo(origin) < 1e-8,
    'Small positive pans must not move the shadow grid',
  );
  assert.ok(
    snap(-0.249, -0.499).distanceTo(origin) < 1e-8,
    'Small negative pans must not move the shadow grid',
  );
  assert.ok(
    snap(0.251, 0.501).distanceTo(new THREE.Vector3(0.5, 1, 7.25)) < 1e-8,
    'Crossing both half-texel boundaries should advance each axis by exactly one texel',
  );
  assert.ok(
    snap(-0.251, -0.501).distanceTo(new THREE.Vector3(-0.5, -1, 7.25)) < 1e-8,
    'Negative boundary crossings must also advance by whole texels',
  );
  near(snap(0.249, 1.51).x, origin.x, 'Vertical pans must not change the horizontal grid');
  near(snap(1.01, 0.499).y, origin.y, 'Horizontal pans must not change the vertical grid');
});

test('oblique shadow snapping preserves light depth and places both image-plane axes on the texel grid', () => {
  const direction = new THREE.Vector3(3, 4, 5).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const horizontalTexel = 48 / 512,
    verticalTexel = 32 / 128;
  for (const target of [
    new THREE.Vector3(17.32, 5.83, -27.19),
    new THREE.Vector3(-8.61, 2.37, 31.12),
  ]) {
    const before = target.clone();
    const snapped = stabilizeShadowAnchor(direction, target, 24, 512, 16, 128);
    near(
      snapped.dot(direction),
      target.dot(direction),
      'Snapping must preserve depth along the light direction',
    );
    near(
      snapped.dot(right) / horizontalTexel,
      Math.round(snapped.dot(right) / horizontalTexel),
      'Horizontal coordinates land on whole texels',
    );
    near(
      snapped.dot(up) / verticalTexel,
      Math.round(snapped.dot(up) / verticalTexel),
      'Vertical coordinates land on whole texels',
    );
    assert.ok(
      snapped.distanceTo(target) <= Math.hypot(horizontalTexel, verticalTexel) / 2 + 1e-8,
      'Snapping must not displace a target by more than half a texel per image-plane axis',
    );
    assert.ok(
      stabilizeShadowAnchor(direction, snapped, 24, 512, 16, 128).distanceTo(snapped) < 1e-8,
      'Snapping an already stable anchor must be idempotent',
    );
    assert.deepEqual(target, before, 'The camera target must not be mutated');
  }
});

test('vertical and nearly vertical light directions produce finite stable shadow anchors', () => {
  const target = new THREE.Vector3(0.49, 3.25, 0.49);
  for (const direction of [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1e-12, 1, -1e-12).normalize(),
  ]) {
    const snapped = stabilizeShadowAnchor(direction, target, 32, 64);
    assert.ok(
      [snapped.x, snapped.y, snapped.z].every(Number.isFinite),
      'Vertical sun must not create a degenerate light basis',
    );
    near(snapped.dot(direction), target.dot(direction), 'Vertical snapping preserves light depth');
    assert.ok(snapped.distanceTo(target) <= Math.SQRT1_2 + 1e-8);
    assert.ok(stabilizeShadowAnchor(direction, snapped, 32, 64).distanceTo(snapped) < 1e-8);
  }
});

test('city lighting moves the actual sun with its snapped shadow anchor without changing solar direction', (t) => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xaaaaaa, 100, 500);
  const sunlight = new THREE.DirectionalLight(),
    ambient = new THREE.HemisphereLight();
  const fill = new THREE.DirectionalLight();
  sunlight.shadow.camera.left = -24;
  sunlight.shadow.camera.right = 24;
  sunlight.shadow.camera.bottom = -16;
  sunlight.shadow.camera.top = 16;
  sunlight.shadow.mapSize.set(256, 128);
  scene.add(sunlight, sunlight.target, ambient, fill);
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  const lighting = createCityLighting({ scene, renderer, sunlight, ambient, fill, worldSize: 128 });
  t.after(() => lighting.dispose());
  const lightDirection = () => sunlight.position.clone().sub(sunlight.target.position).normalize();

  lighting.setTime(9);
  const firstAnchor = new THREE.Vector3(-23, 4, 31);
  const firstSnapped = stabilizeShadowAnchor(
    getLightingProfile(9).lightDirection,
    firstAnchor,
    24,
    256,
    16,
    128,
  );
  lighting.updateAnchor(firstAnchor);
  assert.ok(
    sunlight.target.position.distanceTo(firstSnapped) < 1e-8,
    'The light target must use the actual rectangular shadow dimensions',
  );
  assert.ok(lightDirection().distanceTo(getLightingProfile(9).lightDirection) < 1e-8);
  near(
    renderer.toneMappingExposure,
    getLightingProfile(9).exposure,
    'Renderer receives the selected exposure',
  );
  near(
    sunlight.intensity,
    getLightingProfile(9).lightIntensity,
    'Sunlight receives the selected intensity',
  );
  const morningDirection = lightDirection();
  const firstLightPosition = sunlight.position.clone();

  const secondAnchor = new THREE.Vector3(18, 8, -12);
  const secondSnapped = stabilizeShadowAnchor(
    getLightingProfile(9).lightDirection,
    secondAnchor,
    24,
    256,
    16,
    128,
  );
  lighting.updateAnchor(secondAnchor);
  assert.ok(sunlight.target.position.distanceTo(secondSnapped) < 1e-8);
  assert.ok(
    lightDirection().distanceTo(morningDirection) < 1e-8,
    'Panning must not alter the sunlight direction',
  );
  assert.ok(
    sunlight.position
      .clone()
      .sub(firstLightPosition)
      .distanceTo(secondSnapped.clone().sub(firstSnapped)) < 1e-8,
    'Light and target must translate together by the same snapped displacement',
  );

  lighting.setTime(15);
  const afternoonSnapped = stabilizeShadowAnchor(
    getLightingProfile(15).lightDirection,
    secondAnchor,
    24,
    256,
    16,
    128,
  );
  assert.ok(
    sunlight.target.position.distanceTo(afternoonSnapped) < 1e-8,
    'Changing time must snap the current camera anchor onto the new light plane',
  );
  assert.ok(lightDirection().distanceTo(getLightingProfile(15).lightDirection) < 1e-8);
  assert.ok(
    lightDirection().x * morningDirection.x < 0,
    'The actual light must cross the city between morning and afternoon',
  );
});

test('city lighting preserves fog, changes driving visibility, and disposes only its owned scene objects without rendering', () => {
  // Both target ownership cases matter: callers may already have attached a fill-light target.
  for (const existingFillTarget of [false, true]) {
    const scene = new THREE.Scene(),
      fog = new THREE.Fog(0x999999, 100, 500);
    scene.fog = fog;
    const originalEnvironment = new THREE.Texture();
    scene.environment = originalEnvironment;
    scene.environmentIntensity = 0.67;
    const sunlight = new THREE.DirectionalLight(),
      ambient = new THREE.HemisphereLight();
    const fill = new THREE.DirectionalLight(),
      existingObject = new THREE.Group();
    scene.add(sunlight, sunlight.target, ambient, fill, existingObject);
    if (existingFillTarget) scene.add(fill.target);
    const originalChildren = [...scene.children];
    let renderCalls = 0;
    const renderer = {
      toneMappingExposure: 1,
      render() {
        renderCalls++;
      },
    } as unknown as THREE.WebGLRenderer;
    const lighting = createCityLighting({
      scene,
      renderer,
      sunlight,
      ambient,
      fill,
      worldSize: 128,
    });
    try {
      assert.equal(
        scene.children.length,
        originalChildren.length + (existingFillTarget ? 1 : 2),
        'Lighting should add only the atmosphere and any missing fill target',
      );
      assert.equal(fill.target.parent, scene);
      assert.equal(scene.fog, fog, 'Construction must preserve the caller-owned fog object');
      const normalRange = [fog.near, fog.far];
      lighting.setDriving(true);
      assert.equal(scene.fog, fog);
      assert.ok(
        fog.near < normalRange[0] && fog.far < normalRange[1],
        'Driving mode should have a closer visibility range',
      );
      assert.ok(
        fog.near > 0 && fog.far > fog.near,
        'Driving fog must retain a valid near/far range',
      );
      lighting.setTime(21);
      assert.equal(scene.fog, fog, 'Time changes must also preserve the same fog object');
      assert.ok(fog.color.equals(getLightingProfile(21).background));
      lighting.setDriving(false);
      assert.deepEqual(
        [fog.near, fog.far],
        normalRange,
        'Leaving driving mode restores normal visibility',
      );
      lighting.setQuality('performance');
      lighting.invalidateReflections();
      lighting.updateAnchor(new THREE.Vector3(5, 1, -2));
      assert.equal(
        renderCalls,
        0,
        'Changing quality or scene lighting must not trigger a GPU reflection capture',
      );
    } finally {
      lighting.dispose();
    }
    assert.deepEqual(
      scene.children,
      originalChildren,
      'Disposal must leave no scene additions and preserve caller-owned objects',
    );
    assert.equal(fill.target.parent, existingFillTarget ? scene : null);
    assert.equal(scene.environment, originalEnvironment);
    near(scene.environmentIntensity, 0.67, 'Disposal restores the previous environment intensity');
    assert.equal(renderCalls, 0);
    lighting.dispose();
    assert.deepEqual(scene.children, originalChildren, 'Repeated disposal must be harmless');
    originalEnvironment.dispose();
  }
});

test('moving through the city and changing quality never recaptures the city or refilters an unchanged sky', (t) => {
  const filtering = t.mock.method(
    THREE.PMREMGenerator.prototype,
    'fromEquirectangular',
    (_texture: THREE.Texture, target?: THREE.WebGLRenderTarget | null) =>
      target ?? new THREE.WebGLRenderTarget(16, 16),
  );
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x999999, 100, 500);
  const sunlight = new THREE.DirectionalLight(),
    ambient = new THREE.HemisphereLight(),
    fill = new THREE.DirectionalLight();
  const cityObject = new THREE.Group();
  scene.add(sunlight, sunlight.target, ambient, fill, cityObject);
  let renderCalls = 0;
  const renderer = {
    toneMappingExposure: 1,
    shadowMap: { enabled: false },
    getContext: () => ({ isContextLost: () => false }),
    render() {
      renderCalls++;
    },
  } as unknown as THREE.WebGLRenderer;
  const lighting = createCityLighting({ scene, renderer, sunlight, ambient, fill, worldSize: 128 });
  t.after(() => lighting.dispose());
  const cameraTarget = new THREE.Vector3();
  lighting.refreshReflections(cameraTarget);
  assert.equal(
    filtering.mock.callCount(),
    1,
    'The initial procedural sky needs one filtered environment',
  );
  assert.equal(renderCalls, 0, 'Creating the sky environment must not render the city');

  const qualities = ['performance', 'balanced', 'ultra'] as const;
  for (let step = 0; step < 100; step++) {
    cameraTarget.set(Math.sin(step * 0.2) * 40, 2 + step * 0.05, Math.cos(step * 0.17) * 40);
    cityObject.position.set(step * 0.1, 0, step * 0.2);
    lighting.updateAnchor(cameraTarget);
    lighting.invalidateReflections();
    lighting.setQuality(qualities[step % qualities.length]);
    lighting.setTime(12);
    lighting.refreshReflections(cameraTarget, step % 10 === 0);
  }
  assert.equal(
    filtering.mock.callCount(),
    1,
    'Camera movement, city edits, quality changes, and forced refreshes must reuse the unchanged sky',
  );
  assert.equal(renderCalls, 0, 'No city cube-face captures may occur during normal interaction');

  lighting.setTime(21);
  lighting.refreshReflections(cameraTarget);
  assert.equal(
    filtering.mock.callCount(),
    2,
    'An explicit evening switch should promptly filter the new sky once',
  );
  lighting.refreshReflections(cameraTarget, true);
  assert.equal(filtering.mock.callCount(), 2, 'The new evening sky must also be reused');
  assert.equal(renderCalls, 0, 'Changing time must not reintroduce GPU city captures');
});
