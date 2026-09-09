import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTileModel, setModelNightBlend } from '../../src/rendering/buildings/models';
import {
  preloadEasterEggBuilding,
  createEasterEggBuilding,
} from '../../src/rendering/buildings/easter-egg';
import { createCity } from '../../src/simulation/city-simulation';
import { createCitizens } from '../../src/citizens/system';
import { createMountedHero } from '../../src/citizens/mounted-hero';
import { createFrameLimiter } from '../../src/rendering/frame-limit';
import type { Tile } from '../../src/domain/types';

await preloadEasterEggBuilding();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe1e5df);
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentTarget = pmrem.fromScene(environment, 0.04);
scene.environment = environmentTarget.texture;
scene.environmentIntensity = 0.45;
environment.dispose();
pmrem.dispose();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 150);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.7;
controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * 0.48;
const sun = new THREE.DirectionalLight(0xffebd1, 3);
sun.position.set(-5, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 30 });
sun.shadow.normalBias = 0.002;
sun.shadow.bias = -0.0001;
scene.add(sun);
const sky = new THREE.HemisphereLight(0xe7f1ff, 0x767d62, 1.1);
scene.add(sky);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0xc6d0c2, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = true;
scene.add(ground);

const state = createCity(81, true, 40);
const homes = new THREE.Group();
for (let i = 0; i < 5; i++) {
  const tile: Tile = {
    ...state.tiles[0],
    kind: 'residential',
    level: 1,
    variation: i,
    x: 0,
    z: 0,
    anchor: -1,
    rotation: 0,
    elevation: 0,
    lotWidth: 1,
    lotDepth: 1,
  };
  const house = createTileModel(tile, state);
  house.position.set((i - 2) * 1.15, 0, 0.7);
  homes.add(house);
  const apartment = createTileModel({ ...tile, level: i % 2 ? 3 : 2 }, state);
  apartment.position.set((i - 2) * 1.15, 0, -0.8);
  homes.add(apartment);
}
scene.add(homes);
const skyline = new THREE.Group();
for (let i = 0; i < 5; i++) {
  for (const level of [2, 3]) {
    const building = createTileModel(
      {
        ...state.tiles[0],
        kind: 'commercial',
        level,
        variation: i,
        anchor: -1,
        rotation: 0,
        elevation: 0,
        lotWidth: 1,
        lotDepth: 1,
      },
      state,
    );
    building.position.set((i - 2) * 1.25, 0, level === 2 ? 1 : -0.7);
    skyline.add(building);
  }
}
skyline.visible = false;
scene.add(skyline);
const office = createEasterEggBuilding()!;
office.position.set(0, 0, 0);
office.visible = false;
scene.add(office);

for (const tile of state.tiles) {
  tile.kind = 'empty';
  tile.level = 0;
  tile.anchor = -1;
  tile.elevation = 0;
}
for (let x = 4; x < 16; x++) {
  state.tiles[10 * state.size + x].kind = 'road';
  const home = state.tiles[11 * state.size + x];
  home.kind = 'residential';
  home.level = 2;
}
state.stats.population = 500;
state.revision++;
const crowd = createCitizens(state);
const hero = createMountedHero(state);
const heroDisplay = new THREE.Group();
heroDisplay.add(hero.group);
heroDisplay.scale.setScalar(9);
heroDisplay.visible = false;
scene.add(heroDisplay);
const portraits = new THREE.Group();
const sourceMeshes = crowd.group.children.filter(
  (object): object is THREE.InstancedMesh =>
    object instanceof THREE.InstancedMesh && object.name.startsWith('citizen-'),
);
const portraitParts: { source: THREE.InstancedMesh; mesh: THREE.Mesh; index: number }[] = [];
for (let index = 0; index < 6; index++) {
  for (const source of sourceMeshes) {
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    const tint = new THREE.Color();
    source.getColorAt(index, tint);
    material.color.multiply(tint);
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = true;
    portraits.add(mesh);
    portraitParts.push({ source, mesh, index });
  }
}
portraits.visible = false;
scene.add(portraits);
let view = 'homes';
let night = false;
const origin = new THREE.Matrix4(),
  inverseHeading = new THREE.Matrix4(),
  placement = new THREE.Matrix4(),
  scale = new THREE.Matrix4().makeScale(9, 9, 9);
const torso = sourceMeshes.find((mesh) => mesh.name === 'citizen-torso')!;
const torsoMatrix = new THREE.Matrix4(),
  orientation = new THREE.Quaternion(),
  positionScratch = new THREE.Vector3(),
  scaleScratch = new THREE.Vector3();
const portraitTransforms = Array.from({ length: 6 }, () => new THREE.Matrix4());
function updatePortraits(dt: number) {
  crowd.animate(dt, true);
  const citizens = crowd.getDebug().positions;
  for (let i = 0; i < 6 && i < citizens.length; i++) {
    const citizen = citizens[i];
    origin.makeTranslation(-citizen.x, -citizen.y, -citizen.z);
    torso.getMatrixAt(i, torsoMatrix);
    torsoMatrix.decompose(positionScratch, orientation, scaleScratch);
    inverseHeading.makeRotationFromQuaternion(orientation.invert());
    placement.makeTranslation((i - 2.5) * 0.62, 0, 0);
    portraitTransforms[i]
      .copy(origin)
      .premultiply(inverseHeading)
      .premultiply(scale)
      .premultiply(placement);
  }
  for (const part of portraitParts) {
    const citizen = citizens[part.index];
    if (!citizen) {
      part.mesh.visible = false;
      continue;
    }
    part.mesh.visible = true;
    part.source.getMatrixAt(part.index, part.mesh.matrix);
    part.mesh.matrix.premultiply(portraitTransforms[part.index]);
    part.mesh.matrixWorldNeedsUpdate = true;
  }
}
function select(next: string) {
  if (!['homes', 'skyline', 'office', 'citizens', 'hero'].includes(next)) next = 'homes';
  view = next;
  homes.visible = next === 'homes';
  skyline.visible = next === 'skyline';
  office.visible = next === 'office';
  portraits.visible = next === 'citizens';
  heroDisplay.visible = next === 'hero';
  const descriptions: Record<string, [string, string]> = {
    homes: [
      'Ein neues Stadtbild.',
      'Dachziegel, tiefe Fenster, Balkone und gestaltete Gärten. Zehn echte Wohngebäude aus der Simulation.',
    ],
    citizens: [
      'Menschen mit Charakter.',
      'Die echten Bewohner mit Kleidung, Gesichtern und artikulierter Bewegung. Für diese Ansicht neunfach vergrößert.',
    ],
    skyline: [
      'Eine neue Silhouette.',
      'Runde Glasfassaden, markante Giebel und bepflanzte Terrassen. Fünf Bürofamilien in zwei Dichten.',
    ],
    office: [
      'Ein besonderer Ort.',
      'Die originale weiße und anthrazitfarbene Firmenfassade mit ihren Fensterachsen. Die Dachterrasse erhält dezente Möbel und Begrünung.',
    ],
    hero: [
      'Skanderbeg zu Pferd.',
      'Eine stilisierte historische Hommage mit Ziegenhelm, Rüstung und rotem Umhang. Im Spiel reitet er auf vorhandenen Wegen durch die Stadt.',
    ],
  };
  document.querySelector('#title')!.textContent = descriptions[next][0];
  document.querySelector('#description')!.textContent = descriptions[next][1];
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
  controls.target.set(0, next === 'skyline' ? 1.8 : next === 'citizens' ? 0.8 : 0.35, 0);
  camera.position.set(
    next === 'citizens' ? 0.7 : next === 'skyline' ? -4.6 : -3.3,
    next === 'citizens' ? 1.65 : next === 'office' ? 2.4 : next === 'skyline' ? 6.5 : 5.6,
    next === 'office' ? 4.1 : next === 'citizens' ? 5.8 : next === 'skyline' ? 11 : 7.5,
  );
  controls.update();
  if (next === 'hero') {
    controls.target.set(0, 1.4, 0);
    camera.position.set(3.5, 2.2, 5.5);
    controls.update();
  }
}
document
  .querySelectorAll<HTMLButtonElement>('[data-view]')
  .forEach((button) => (button.onclick = () => select(button.dataset.view!)));
document.querySelector<HTMLButtonElement>('#light')!.onclick = () => {
  night = !night;
  sun.color.setHex(night ? 0xffc38e : 0xffebd1);
  sun.intensity = night ? 1 : 3;
  sun.position.y = night ? 3 : 9;
  sky.intensity = night ? 0.4 : 1.1;
  scene.environmentIntensity = night ? 0.25 : 0.45;
  setModelNightBlend(night ? 0.8 : 0);
  document.querySelector('#light')!.textContent = night ? 'Tageslicht' : 'Abendlicht';
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
select(new URLSearchParams(location.search).get('view') || 'homes');
const limiter = createFrameLimiter(60);
let previous = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!limiter(now)) return;
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (view === 'citizens') updatePortraits(dt);
  if (view === 'hero') {
    hero.animate(dt, true);
    const p = hero.getDebug().position;
    heroDisplay.position.set(-p[0] * 9, -p[1] * 9, -p[2] * 9);
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
Object.assign(window, {
  graphicsShowroom: { scene, camera, controls, renderer, select, crowd, updatePortraits },
});
