import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createEasterEggBuilding } from '../rendering/buildings/easter-egg';
import { tr } from '../i18n/index';
import { icon, refreshIcons } from './dom';

let dismissCurrent: (() => void) | undefined;

/** Isolated view of the same cached GLB; never creates or changes a city parcel. */
export function showEasterEggPreview(onReturn: () => void): boolean {
  dismissCurrent?.();
  const building = createEasterEggBuilding();
  if (!building) return false;
  const panel = document.createElement('section');
  panel.className = 'easter-egg-preview';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Easter Egg');
  panel.innerHTML = `<header><div><span>${tr('GEBÄUDEANSICHT', 'BUILDING VIEW')}</span>
    <h2>Easter Egg</h2></div><button class="button secondary" data-preview-return>
    ${icon('map-pin')} ${tr('In der Stadt ansehen', 'View in the city')}</button></header>
    <div class="easter-egg-preview-canvas" tabindex="0" aria-label="${tr('Drehbare Ansicht des Bürogebäudes', 'Rotatable view of the office building')}"></div>
    <footer>${tr('Ziehen: Gebäude drehen · Mausrad: Zoom · Esc: zurück zur Stadt', 'Drag to orbit · Mouse wheel to zoom · Esc to return to the city')}</footer>`;
  const surface = panel.querySelector<HTMLElement>('.easter-egg-preview-canvas')!;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(0xe8ecdf);
  surface.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(building);
  scene.add(new THREE.HemisphereLight(0xf8fbff, 0x80936d, 2));
  const sunlight = new THREE.DirectionalLight(0xfff1d8, 3);
  sunlight.position.set(-4, 8, 7);
  scene.add(sunlight);
  const bounds = new THREE.Box3().setFromObject(building);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  const floorGeometry = new THREE.PlaneGeometry(span * 15, span * 15);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xdde3d2, roughness: 1 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, bounds.min.y - 0.025, center.z);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, span * 40);
  // The asset's entrance and original facade sign face +Z.
  camera.position.copy(center).add(new THREE.Vector3(-0.52, 0.6, 1.5).multiplyScalar(span));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = span * 0.75;
  controls.maxDistance = span * 4;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();
  const game = document.getElementById('game');
  const wasInert = game?.inert ?? false;
  if (game) game.inert = true;
  document.body.appendChild(panel);
  refreshIcons(panel);
  function resize() {
    const rect = surface.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  resize();
  let handle = 0;
  let disposed = false;
  function frame() {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    handle = requestAnimationFrame(frame);
  }
  function close() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(handle);
    observer.disconnect();
    controls.dispose();
    floorGeometry.dispose();
    floorMaterial.dispose();
    // GLB geometry/materials are shared with the live city's batches.
    renderer.dispose();
    renderer.forceContextLoss();
    panel.remove();
    if (game) game.inert = wasInert;
    dismissCurrent = undefined;
    onReturn();
  }
  dismissCurrent = close;
  const closeButton = panel.querySelector<HTMLButtonElement>('[data-preview-return]')!;
  closeButton.onclick = close;
  panel.addEventListener('keydown', (event) => {
    // Keep city shortcuts from acting beneath this separate preview surface.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === closeButton ? surface : closeButton).focus();
    }
  });
  closeButton.focus();
  frame();
  return true;
}
