import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { airport, facilityArchitecture } from '../../src/rendering/buildings/facilities';
import { facilityFrame } from '../../src/rendering/buildings/facility-frame';
import {
  createFacilityActors,
  updateFacilityActors,
} from '../../src/rendering/buildings/facility-actors';
import { createCity } from '../../src/simulation/city-simulation';
const state = createCity(81, true, 40),
  scene = new THREE.Scene();
scene.background = new THREE.Color('#aec9d7');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(37, innerWidth / innerHeight, 0.1, 100);
camera.position.set(12, 12, -13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.update();
scene.add(new THREE.HemisphereLight(0xe3f4ff, 0x869268, 2));
const light = new THREE.DirectionalLight(0xffedcf, 3);
light.position.set(-8, 15, -10);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
light.shadow.camera.left = -10;
light.shadow.camera.right = 10;
light.shadow.camera.top = 10;
light.shadow.camera.bottom = -10;
scene.add(light);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x759563, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
let root = new THREE.Group(),
  actors: THREE.Group,
  time = 0,
  paused = false;
const variant = document.querySelector('#variant') as HTMLSelectElement,
  rotation = document.querySelector('#rotation') as HTMLSelectElement,
  phase = document.querySelector('#phase') as HTMLInputElement;
function rebuild() {
  scene.remove(root);
  root = new THREE.Group();
  const v = +variant.value,
    r = +rotation.value,
    tile = {
      ...state.tiles[12 * state.size + 12],
      x: 12,
      z: 12,
      kind: 'airport' as const,
      level: 1,
      elevation: 0,
      anchor: -1,
      variation: v,
      rotation: r as 0 | 1 | 2 | 3,
    };
  const fixed = new THREE.Group(),
    frame = facilityFrame(fixed, tile);
  airport(frame);
  facilityArchitecture(frame, tile);
  actors = createFacilityActors(tile, state)!;
  root.add(fixed, actors);
  root.position.set(-((r % 2 ? 6 : 10) - 1) / 2, 0, -((r % 2 ? 10 : 6) - 1) / 2);
  scene.add(root);
}
variant.onchange = rotation.onchange = rebuild;
document.querySelector('#pause')!.addEventListener('click', (e) => {
  paused = !paused;
  (e.target as HTMLElement).textContent = paused ? 'Fortsetzen' : 'Pause';
});
phase.oninput = () => {
  time = +phase.value;
  paused = true;
  document.querySelector('#pause')!.textContent = 'Fortsetzen';
};
rebuild();
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (!paused) time = (time + (now - last) / 1000) % 52;
  last = now;
  phase.value = String(time);
  updateFacilityActors(actors, time - +variant.value, state);
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
