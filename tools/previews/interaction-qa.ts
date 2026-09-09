import { createCity } from '../../src/simulation/city-simulation';
import { createCityScene } from '../../src/rendering/scene';
import { sampleGroundHeight } from '../../src/rendering/world/terrain';
import type { Point } from '../../src/domain/types';

const state = createCity(42, true, 40);
for (const tile of state.tiles)
  Object.assign(tile, { kind: 'empty', level: 0, elevation: 1, fire: 0, anchor: -1 });
for (let x = 14; x <= 24; x++) state.tiles[20 * state.size + x].kind = 'road';
for (const x of [15, 17, 22, 24])
  Object.assign(state.tiles[19 * state.size + x], {
    kind: 'residential',
    level: 1,
    variation: x % 5,
  });
Object.assign(state.tiles[19 * state.size + 20], { kind: 'commercial', level: 2 });
state.tiles[21 * state.size + 20].kind = 'park';
state.stats.population = 500;
state.settings.timeOfDay = 17;
state.settings.dayNightCycle = false;
state.settings.weather = 'clear';
state.speed = 0;
state.revision++;
let hover: Point | null = null,
  selected: Point | null = null;
const scene = createCityScene(document.querySelector<HTMLElement>('#world')!, state, {
  onHover: (p) => {
    hover = p;
  },
  onSelect: (p) => {
    selected = p;
  },
  onPaint() {},
});
scene.setGraphicsQuality('balanced');
scene.focusBuilding(20, 21);
scene.zoom(-1);
document.querySelector<HTMLButtonElement>('#inspect')!.onclick = () => scene.setTool('inspect', 1);
document.querySelector<HTMLButtonElement>('#grab')!.onclick = () => scene.setTool('citizen', 1);
document.querySelector<HTMLButtonElement>('#play')!.onclick = () => {
  state.speed = state.speed ? 0 : 1;
  scene.update(state);
};
for (const [id, kind] of [
  ['gather', 'gathering'],
  ['festival', 'festival'],
] as const)
  document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () => {
    state.speed = 1;
    scene.update(state);
    scene.triggerCitizenEvent(kind);
    scene.focusCitizenEvent();
  };
document.querySelector<HTMLButtonElement>('#rotate')!.onclick = () => scene.rotate(1);
Object.defineProperty(window, 'interactionQA', {
  get: () => ({
    hover,
    selected,
    life: scene.getCitizenLife(),
    diagnostics: scene.getDiagnostics!(),
    targets: scene.getInteractionTargets!(),
    ground:
      scene.getDiagnostics!().citizens &&
      (
        scene.getDiagnostics!().citizens as { positions: { id: number; x: number; z: number }[] }
      ).positions.map((p) => ({ id: p.id, y: sampleGroundHeight(state, p.x, p.z) })),
  }),
});
setInterval(() => {
  const life = scene.getCitizenLife();
  document.querySelector('#status')!.textContent =
    `${state.speed ? 'Läuft' : 'Pausiert'} · ${life.total} Bewohner · ${JSON.stringify(life.counts)} · ${life.event ? `${life.event.arrived}/${life.event.invited} angekommen · ${Math.ceil(life.event.remaining)} s` : 'Keine Veranstaltung'} · Auswahl ${selected ? `${selected.x}/${selected.z}` : '–'}`;
}, 500);
window.addEventListener('pagehide', () => scene.dispose(), { once: true });
