import * as THREE from 'three';

export type LightingQuality = 'performance' | 'balanced' | 'ultra';

export interface LightingProfile {
  hour: number;
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  lightDirection: THREE.Vector3;
  daylight: number;
  nightBlend: number;
  night: boolean;
  sunIntensity: number;
  moonIntensity: number;
  lightIntensity: number;
  ambientIntensity: number;
  fillIntensity: number;
  exposure: number;
  bloom: number;
  background: THREE.Color;
  zenith: THREE.Color;
  ground: THREE.Color;
  lightColor: THREE.Color;
  ambientColor: THREE.Color;
  fillColor: THREE.Color;
  twilight: number;
}

const smooth = THREE.MathUtils.smoothstep;
const mixColor = (a: number, b: number, amount: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), amount);

/** A deterministic 24-hour solar arc, independent of frame rate or simulation speed. */
export function getLightingProfile(inputHour: number): LightingProfile {
  const hour = Number.isFinite(inputHour) ? ((inputHour % 24) + 24) % 24 : 12;
  const phase = ((hour - 6) * Math.PI) / 12;
  // The slight northern inclination produces attractive diagonal shadows at noon,
  // while dawn/dusk stay at the horizon and east/west movement remains genuine.
  const sunDirection = new THREE.Vector3(-Math.cos(phase), Math.sin(phase) * 0.94, 0.3).normalize();
  const moonDirection = sunDirection.clone().negate();
  const altitude = sunDirection.y;
  const daylight = smooth(altitude, -0.14, 0.24);
  const nightBlend = 1 - daylight;
  const twilight = Math.exp(-Math.pow(altitude / 0.23, 2)) * smooth(altitude, -0.3, -0.06);
  const sunIntensity = 3.15 * smooth(altitude, 0, 0.27);
  const moonIntensity = 0.46 * smooth(-altitude, 0, 0.25);
  const lightDirection = (altitude >= 0 ? sunDirection : moonDirection).clone();
  const dayLightColor = mixColor(0xffb66e, 0xffefd9, smooth(altitude, 0.015, 0.53));
  const lightColor = altitude >= 0 ? dayLightColor : new THREE.Color(0x9bbbea);
  const background = mixColor(0x172b43, 0xcddedb, daylight).lerp(
    new THREE.Color(0xeab58a),
    twilight * 0.57,
  );
  const zenith = mixColor(0x071122, 0x71acd0, daylight).lerp(
    new THREE.Color(0x6681a2),
    twilight * 0.35,
  );
  const ground = mixColor(0x1c292b, 0x82927b, daylight);
  return {
    hour,
    sunDirection,
    moonDirection,
    lightDirection,
    daylight,
    nightBlend,
    night: nightBlend > 0.58,
    sunIntensity,
    moonIntensity,
    lightIntensity: sunIntensity + moonIntensity,
    ambientIntensity: 0.5 + daylight * 0.6,
    fillIntensity: 0.12 + daylight * 0.3,
    exposure: 1.12 - daylight * 0.15,
    bloom: 0.08 - daylight * 0.045,
    background,
    zenith,
    ground,
    lightColor,
    ambientColor: mixColor(0x8daddb, 0xe1f1ff, daylight),
    fillColor: mixColor(0x688cbd, 0xc5e3ff, daylight),
    twilight,
  };
}

/** World-direction radiance used by all PBR materials; no camera or city dependency. */
export function sampleSkyRadiance(
  profile: LightingProfile,
  direction: THREE.Vector3,
  result = new THREE.Color(),
): THREE.Color {
  const height = direction.y;
  result.copy(profile.background).lerp(profile.zenith, Math.pow(Math.max(0, height), 0.48));
  result.lerp(profile.ground, smooth(-height, 0.02, 0.6));
  const sunDot = Math.max(0, direction.dot(profile.sunDirection));
  const moonDot = Math.max(0, direction.dot(profile.moonDirection));
  const sunUp = smooth(profile.sunDirection.y, -0.055, 0.015);
  const moonUp = smooth(profile.moonDirection.y, -0.055, 0.04);
  // A filtered disc lobe avoids single-texel HDR sparks at modest resolution.
  const sun = Math.pow(sunDot, 400) * sunUp * 3;
  const sunset = Math.pow(sunDot, 8) * profile.twilight * 0.16;
  const moon = Math.pow(moonDot, 350) * moonUp * 0.7;
  result.r += sun + sunset + moon * 0.64;
  result.g += sun * 0.76 + sunset * 0.36 + moon * 0.78;
  result.b += sun * 0.48 + sunset * 0.1 + moon;
  const cloud = skyCloudCoverage(direction) * profile.daylight * 0.13;
  result.r += cloud;
  result.g += cloud;
  result.b += cloud;
  return result;
}

function skyCloudCoverage(direction: THREE.Vector3): number {
  const band =
    Math.sin(direction.x * 19 + direction.z * 7) * 0.45 +
    Math.sin(direction.z * 31 - direction.x * 13) * 0.25 +
    Math.sin(direction.x * 53 + direction.z * 41) * 0.12;
  return (
    smooth(band, 0.12, 0.62) *
    smooth(direction.y, 0.03, 0.22) *
    (1 - smooth(direction.y, 0.65, 0.95))
  );
}

export interface CityLightingOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sunlight: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  worldSize: number;
}

export interface CityLighting {
  setTime(
    hour: number,
  ): Pick<LightingProfile, 'night' | 'nightBlend' | 'exposure' | 'bloom' | 'background'>;
  updateAnchor(target: THREE.Vector3): void;
  refreshReflections(target: THREE.Vector3, force?: boolean): void;
  setQuality(quality: LightingQuality): void;
  setDriving(active: boolean): void;
  invalidateReflections(): void;
  dispose(): void;
}

/**
 * Snap a directional shadow's view-plane center to whole shadow-map texels.
 * Keeping depth unchanged preserves the light distance and near/far coverage;
 * only motion that would slide the shadow texture across the city is quantized.
 */
export function stabilizeShadowAnchor(
  direction: THREE.Vector3,
  target: THREE.Vector3,
  span: number,
  mapSize: number,
  verticalSpan = span,
  verticalMapSize = mapSize,
): THREE.Vector3 {
  const horizontalStep = (2 * span) / mapSize;
  const verticalStep = (2 * verticalSpan) / verticalMapSize;
  if (![horizontalStep, verticalStep].every((value) => Number.isFinite(value) && value > 0))
    return target.clone();
  const forward = direction.clone();
  if (!Number.isFinite(forward.lengthSq()) || forward.lengthSq() < 1e-12) forward.set(0, 1, 0);
  else forward.normalize();
  // This is the same right/up basis as Three's directional-light shadow camera.
  // Avoid the singular cross product for a light directly above the target.
  const referenceUp = new THREE.Vector3(
    0,
    Math.abs(forward.y) > 0.9999 ? 0 : 1,
    Math.abs(forward.y) > 0.9999 ? 1 : 0,
  );
  const right = referenceUp.cross(forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const x = target.dot(right),
    y = target.dot(up);
  return target
    .clone()
    .addScaledVector(right, Math.round(x / horizontalStep) * horizontalStep - x)
    .addScaledVector(up, Math.round(y / verticalStep) * verticalStep - y);
}

/**
 * Wait for a normal scene render to initialize resized PCF shadow targets before
 * doing deferred environment work. Three's shadow-array fallback has no
 * comparison mode, which is invalid for sampler2DShadow.
 */
export function reflectionShadowsReady(
  renderer: Pick<THREE.WebGLRenderer, 'shadowMap'>,
  scene: THREE.Scene,
): boolean {
  if (!renderer.shadowMap.enabled) return true;
  const comparison =
    renderer.shadowMap.type === THREE.PCFShadowMap ||
    renderer.shadowMap.type === THREE.PCFSoftShadowMap;
  let ready = true;
  scene.traverseVisible((object) => {
    if (
      !(
        object instanceof THREE.DirectionalLight ||
        object instanceof THREE.SpotLight ||
        object instanceof THREE.PointLight
      ) ||
      !object.castShadow
    )
      return;
    const map = object.shadow.map;
    if (!map || (comparison && (!map.depthTexture || map.depthTexture.compareFunction === null)))
      ready = false;
  });
  return ready;
}

/** Replace only directional/spot PCF sampling; retain Three's depth and shadow guards. */
export function stableShadowChunk(source = THREE.ShaderChunk.shadowmap_pars_fragment): string {
  const start = source.indexOf('float getShadow( sampler2DShadow');
  const end = source.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )', start);
  if (start < 0 || end < 0) return source;
  const original = source.slice(start, end);
  const replacement = original.replace(
    /vec2\s+texelSize\s*=\s*vec2\(\s*1\.0\s*\)\s*\/\s*shadowMapSize;[\s\S]*?\)\s*\*\s*0\.2;/,
    `
        // Stable weighted PCF: no screen-space noise or rotating sample pattern.
        vec2 stepSize = shadowRadius / shadowMapSize;
        vec2 uv = shadowCoord.xy;
        float depth = shadowCoord.z;
        shadow = (
          texture( shadowMap, vec3( uv + stepSize * vec2( -1.0, -1.0 ), depth ) ) +
          texture( shadowMap, vec3( uv + stepSize * vec2(  0.0, -1.0 ), depth ) ) * 2.0 +
          texture( shadowMap, vec3( uv + stepSize * vec2(  1.0, -1.0 ), depth ) ) +
          texture( shadowMap, vec3( uv + stepSize * vec2( -1.0,  0.0 ), depth ) ) * 2.0 +
          texture( shadowMap, vec3( uv, depth ) ) * 4.0 +
          texture( shadowMap, vec3( uv + stepSize * vec2(  1.0,  0.0 ), depth ) ) * 2.0 +
          texture( shadowMap, vec3( uv + stepSize * vec2( -1.0,  1.0 ), depth ) ) +
          texture( shadowMap, vec3( uv + stepSize * vec2(  0.0,  1.0 ), depth ) ) * 2.0 +
          texture( shadowMap, vec3( uv + stepSize * vec2(  1.0,  1.0 ), depth ) )
        ) * ( 1.0 / 16.0 );`,
  );
  return source.slice(0, start) + replacement + source.slice(end);
}

const deterministicShadowChunk = stableShadowChunk();
const stabilizedMaterials = new WeakSet<THREE.Material>();
/** Patch shared and newly-created city materials once, without changing Three globally. */
export function applyStableShadowFiltering(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || stabilizedMaterials.has(material))
        continue;
      stabilizedMaterials.add(material);
      const previousCompile = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey;
      const usesDefaultKey = previousKey === THREE.Material.prototype.customProgramCacheKey;
      const originalDefaultKey = usesDefaultKey ? previousKey.call(material) : '';
      material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <shadowmap_pars_fragment>',
          deterministicShadowChunk,
        );
      };
      material.customProgramCacheKey = function () {
        return (
          (usesDefaultKey ? originalDefaultKey : previousKey.call(this)) + '|neustadt-pcf-tent-v1'
        );
      };
      material.needsUpdate = true;
    }
  });
}

/**
 * Direct sun/moon light, stable shadow framing and a modest procedural sky.
 * The PBR environment contains only sky radiance: it never captures city meshes
 * or runs extra city render passes when the camera moves or buildings change.
 */
export function createCityLighting({
  scene,
  renderer,
  sunlight,
  ambient,
  fill,
  worldSize,
}: CityLightingOptions): CityLighting {
  const previousEnvironment = scene.environment;
  const previousEnvironmentIntensity = scene.environmentIntensity;
  const worldRadius = Math.max(180, worldSize * 2.35);
  const lightDistance = Math.max(95, worldSize * 0.85);
  const anchor = new THREE.Vector3();
  let profile = getLightingProfile(12);
  let driving = false;
  let disposed = false;
  let environmentBucket = -1;
  let lastEnvironmentUpdate = -Infinity;
  let fallbackEnvironment: THREE.WebGLRenderTarget | null = null;
  const addedFillTarget = fill.target.parent === null;
  if (addedFillTarget) scene.add(fill.target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyWidth = 256,
    skyHeight = 128;
  const pixels = new Float32Array(skyWidth * skyHeight * 4);
  const skyTexture = new THREE.DataTexture(
    pixels,
    skyWidth,
    skyHeight,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.LinearSRGBColorSpace;
  skyTexture.minFilter = THREE.LinearFilter;
  skyTexture.magFilter = THREE.LinearFilter;
  skyTexture.name = 'Neustadt procedural sky radiance';

  // Everything here is procedural. Sky bodies sit in world directions so the
  // visible sun, shadows and reflected sun all follow the same solar arc.
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: profile.zenith.clone() },
      uHorizon: { value: profile.background.clone() },
      uGround: { value: profile.ground.clone() },
      uSun: { value: profile.sunDirection.clone() },
      uMoon: { value: profile.moonDirection.clone() },
      uNight: { value: profile.nightBlend },
      uTwilight: { value: profile.twilight },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main(){
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGround, uSun, uMoon;
      uniform float uNight, uTwilight;
      varying vec3 vSkyDirection;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){
        vec3 d=normalize(vSkyDirection);
        vec3 color=mix(uHorizon,uZenith,pow(max(d.y,0.0),.48));
        color=mix(color,uGround,smoothstep(.02,.6,-d.y));
        float band=sin(d.x*19.0+d.z*7.0)*.45+sin(d.z*31.0-d.x*13.0)*.25+sin(d.x*53.0+d.z*41.0)*.12;
        float cloud=smoothstep(.12,.62,band)*smoothstep(.03,.22,d.y)*(1.0-smoothstep(.65,.95,d.y));
        color+=vec3(cloud*(1.0-uNight)*.13);
        float sunDot=max(dot(d,uSun),0.0), moonDot=max(dot(d,uMoon),0.0);
        float sunUp=smoothstep(-.055,.015,uSun.y);
        float moonUp=smoothstep(-.055,.04,uMoon.y);
        color+=vec3(1.0,.36,.10)*pow(sunDot,8.0)*uTwilight*.16;
        color+=vec3(1.0,.65,.27)*pow(sunDot,110.0)*sunUp*.05;
        // The broad corona and crisp disc are smoothly antialiased in direction space.
        float sunDisc=smoothstep(.99969,.99985,sunDot)*sunUp;
        color=mix(color,vec3(8.0,6.1,3.8),sunDisc);
        float moonDisc=smoothstep(.99966,.99984,moonDot)*moonUp;
        vec3 moonDetail=floor(d*900.0);
        float crater=.77+.15*hash(moonDetail)+.08*sin(d.x*600.0)*sin(d.z*420.0);
        color=mix(color,vec3(1.05,1.18,1.4)*crater,moonDisc);
        color+=vec3(.12,.17,.28)*pow(moonDot,120.0)*uNight*.12;
        // Sparse stars use a stable direction grid, so they cannot swim with time.
        vec3 stars=floor(d*780.0);
        float star=step(.9988,hash(stars))*pow(max(d.y,0.0),.35);
        color+=vec3(.53,.66,.85)*star*uNight*uNight;
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(worldRadius, 40, 24), skyMaterial);
  sky.name = 'Procedural atmosphere with moving sun and moon';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.raytracingExclude = true;
  scene.add(sky);

  function updateFog(): void {
    // Keep THREE.Fog: the caller and weather renderer also update its color.
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(profile.background);
      scene.fog.near = driving ? Math.max(28, worldSize * 0.42) : Math.max(150, worldSize * 2.3);
      scene.fog.far = driving ? Math.max(145, worldSize * 1.55) : Math.max(320, worldSize * 4.5);
    }
  }

  function updateAnchor(target: THREE.Vector3): void {
    if (disposed) return;
    anchor.set(
      THREE.MathUtils.clamp(target.x, -worldSize / 2, worldSize / 2),
      Number.isFinite(target.y) ? target.y : 0,
      THREE.MathUtils.clamp(target.z, -worldSize / 2, worldSize / 2),
    );
    const shadowCamera = sunlight.shadow.camera;
    const shadowAnchor = stabilizeShadowAnchor(
      profile.lightDirection,
      anchor,
      (shadowCamera.right - shadowCamera.left) / 2,
      sunlight.shadow.mapSize.x,
      (shadowCamera.top - shadowCamera.bottom) / 2,
      sunlight.shadow.mapSize.y,
    );
    sunlight.target.position.copy(shadowAnchor);
    sunlight.position.copy(shadowAnchor).addScaledVector(profile.lightDirection, lightDistance);
    sunlight.target.updateMatrixWorld();
    fill.target.position.copy(anchor);
    fill.position.copy(anchor).addScaledVector(profile.lightDirection, -lightDistance * 0.7);
    fill.position.y = anchor.y + lightDistance * 0.45;
    fill.target.updateMatrixWorld();
    sky.position.copy(anchor);
  }

  function setTime(hour: number): ReturnType<CityLighting['setTime']> {
    const nextProfile = getLightingProfile(hour);
    const difference = Math.abs(nextProfile.hour - profile.hour);
    if (Math.min(difference, 24 - difference) > 0.8) {
      // A manual day/night switch must refresh the modest sky environment promptly.
      environmentBucket = -1;
      lastEnvironmentUpdate = -Infinity;
    }
    profile = nextProfile;
    if (disposed) return profile;
    if (scene.background instanceof THREE.Color) scene.background.copy(profile.background);
    else scene.background = profile.background.clone();
    sunlight.color.copy(profile.lightColor);
    sunlight.intensity = profile.lightIntensity;
    ambient.color.copy(profile.ambientColor);
    ambient.groundColor.copy(profile.ground);
    ambient.intensity = profile.ambientIntensity;
    fill.color.copy(profile.fillColor);
    fill.intensity = profile.fillIntensity;
    scene.environmentIntensity = 0.48 - profile.nightBlend * 0.24;
    renderer.toneMappingExposure = profile.exposure;
    skyMaterial.uniforms.uZenith.value.copy(profile.zenith);
    skyMaterial.uniforms.uHorizon.value.copy(profile.background);
    skyMaterial.uniforms.uGround.value.copy(profile.ground);
    skyMaterial.uniforms.uSun.value.copy(profile.sunDirection);
    skyMaterial.uniforms.uMoon.value.copy(profile.moonDirection);
    skyMaterial.uniforms.uNight.value = profile.nightBlend;
    skyMaterial.uniforms.uTwilight.value = profile.twilight;
    updateFog();
    updateAnchor(anchor);
    return profile;
  }

  function updateFallbackEnvironment(): void {
    const sample = new THREE.Color(),
      direction = new THREE.Vector3();
    for (let y = 0; y < skyHeight; y++) {
      // DataTexture row zero maps to the south pole in equirectangular UVs.
      const latitude = ((y + 0.5) / skyHeight - 0.5) * Math.PI;
      const height = Math.sin(latitude);
      for (let x = 0; x < skyWidth; x++) {
        const longitude = ((x + 0.5) / skyWidth - 0.5) * Math.PI * 2;
        direction.set(
          Math.cos(longitude) * Math.cos(latitude),
          height,
          Math.sin(longitude) * Math.cos(latitude),
        );
        sampleSkyRadiance(profile, direction, sample);
        const offset = (y * skyWidth + x) * 4;
        pixels[offset] = sample.r;
        pixels[offset + 1] = sample.g;
        pixels[offset + 2] = sample.b;
        pixels[offset + 3] = 1;
      }
    }
    skyTexture.needsUpdate = true;
    fallbackEnvironment = pmrem.fromEquirectangular(skyTexture, fallbackEnvironment);
    fallbackEnvironment.texture.name = 'Filtered sky radiance';
    scene.environment = fallbackEnvironment.texture;
    environmentBucket = Math.floor(profile.hour * 4);
    lastEnvironmentUpdate = performance.now();
  }

  function refreshReflections(_target: THREE.Vector3, force = false): void {
    if (disposed) return;
    const bucketChanged = environmentBucket !== Math.floor(profile.hour * 4);
    if (fallbackEnvironment && !bucketChanged) return;
    const now = performance.now();
    if (fallbackEnvironment && !force && now - lastEnvironmentUpdate < 4000) return;
    if (renderer.getContext().isContextLost()) return;
    // Defer initial environment filtering until the normal render has finished
    // rebuilding any invalidated shadow target. This preserves the quality-switch
    // lifecycle contract without ever rendering the city into a reflection probe.
    if (!reflectionShadowsReady(renderer, scene)) return;
    updateFallbackEnvironment();
  }

  function setQuality(_next: LightingQuality): void {
    // Shadow-map resolution and postprocessing quality are owned by scene.ts.
    // The inexpensive sky environment remains identical in every quality mode.
  }

  setTime(12);
  return {
    setTime,
    updateAnchor,
    refreshReflections,
    setQuality,
    setDriving(active) {
      if (disposed) return;
      driving = active;
      updateFog();
    },
    invalidateReflections() {
      /* City edits do not alter the sky environment. */
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scene.environment === fallbackEnvironment?.texture)
        scene.environment = previousEnvironment;
      scene.environmentIntensity = previousEnvironmentIntensity;
      fallbackEnvironment?.dispose();
      skyTexture.dispose();
      sky.removeFromParent();
      sky.geometry.dispose();
      skyMaterial.dispose();
      pmrem.dispose();
      if (addedFillTarget) fill.target.removeFromParent();
    },
  };
}
