import { bindLandmarkDiscovery } from '../ui/landmark-unlock';
import { showEasterEggPreview } from '../ui/easter-egg-preview';
import { createAudioSession } from './audio-session';
import { renderAudioView } from '../ui/views/audio';
import { bindAudioControls } from '../ui/audio-controls';
import { renderCalendarClock } from '../ui/calendar-clock';
import { bindLightingControls } from '../ui/lighting-controls';
import { createBuildPreview } from '../ui/build-preview';
import { renderToolPalette } from '../ui/tool-palette';
import { createDensityPicker, isZoneTool } from '../ui/density-picker';
import { bindBudgetControls } from '../ui/budget-controls';
import { renderInspectorView } from '../ui/views/inspector';
import { drawMinimap } from '../ui/minimap';
import { bindKeyboardControls } from '../ui/keyboard-controls';
import { createDialogHost } from '../ui/dialog-host';
import { SimulationRuntime } from '../simulation/runtime/controller';
import { startFrameLoop, type Frame } from './frame-loop';
import { showWelcomePreview, dismissWelcomePreview } from '../ui/welcome-preview';
import { renderCameraView } from '../ui/views/camera';
import { renderBudgetView } from '../ui/views/budget';
import { renderReportsView } from '../ui/views/reports';
import { renderNewsView } from '../ui/views/news';
import { renderHelpView } from '../ui/views/help';
import { renderGraphicsView } from '../ui/views/graphics';
import { renderWelcomeView } from '../ui/views/welcome';
import { renderNewCityView } from '../ui/views/new-city';
import { renderDisasterView } from '../ui/views/disaster';
import { renderCityMenuView } from '../ui/views/city-menu';
import { mountAppShell } from '../ui/views/app-shell';
import { captureFocus, restoreFocus } from '../ui/focus';
import { advanceWeather } from '../simulation/weather-cycle';
import { ECONOMY_STEP_SECONDS, perMonth, calendarDate } from '../simulation/calendar';
import {
  generateNewYorkCity,
  generateSmallCity,
  starterPoint,
  nextCitySize,
} from '../world/scenarios';
import { preloadEasterEggBuilding, isEasterEggBuilding } from '../rendering/buildings/easter-egg';
import { loadCityForPlay } from '../persistence/migrations';
import { enhanceSelectMenus, syncSelectMenus } from '../ui/select-menu';
import { version as appVersion } from '../../package.json';
import { $, icon, clamp, escape, refreshIcons } from '../ui/dom';
import {
  build,
  serializeCity,
  deserializeCity,
  triggerDisaster,
  TOOL_DEFS,
  expandCity,
  previewBuild,
  isBuildingAnchor,
  applyCitizenIncident,
} from '../simulation/city-simulation';
import { createCityScene } from '../rendering/scene';
import {
  getRank,
  isToolUnlocked,
  claimQuest,
  startChallenge,
  RANKS,
  updateProgression,
} from '../simulation/progression';
import {
  renderProgressionSidebar,
  renderProgressionDialog,
  type ProgressionTab,
} from '../ui/progression';
import {
  loadSavedCity,
  saveCityRaw,
  backupLegacy,
  safePreferenceGet,
  safePreferenceSet,
} from '../persistence/storage';
import {
  tr,
  getLocale,
  setLocale,
  formatNumber,
  formatCurrency,
  localizedEventTitle,
  localizedEventMessage,
  type Locale,
} from '../i18n/index';
import {
  captureConstructionState,
  recordConstruction,
  undoConstruction,
  clearConstructionHistory,
  canUndoConstruction,
  type ConstructionHistory,
} from '../construction/history';
import type {
  CityState,
  Tool,
  Overlay,
  Point,
  CitySceneApi,
  BuildOptions,
  DisasterKind,
  VehicleHover,
  DrivingStatus,
} from '../domain/types';
const fmt = formatNumber;
const euro = formatCurrency;
const languagePreference = safePreferenceGet('neustadt-language');
setLocale(
  languagePreference === 'de' || languagePreference === 'en'
    ? languagePreference
    : navigator.language.toLowerCase().startsWith('de')
      ? 'de'
      : 'en',
);

function updateDocumentLanguage() {
  document.documentElement.lang = getLocale();
  document.title = tr(
    'Neustadt – Deine Stadt. Deine Geschichte.',
    'Neustadt – Your city. Your story.',
  );
}
updateDocumentLanguage();
let state = generateNewYorkCity();
let awaitingStart = true;
let landmarkPreviewOpen = false;
let saved = false;
let loadError = '';
let loadNotice = '';
let saveBlocked = false;
let recoveryRaw: string | null = null;
let savePending = false;
let saveQueued = false;
let saveFailed = false;
let nextAutosave = Date.now() + 30000;
let saveDebounce: ReturnType<typeof setTimeout>;
let sceneSize = 0;
let buildingRotation: 0 | 1 | 2 | 3 = 0;
let progressionTab: ProgressionTab = 'quests';
let driving = false;

let hoveredVehicle: number | null = null;
let vehicleHoverTimer: ReturnType<typeof setTimeout>;
let lastRank = 0;
let victoryAnnounced = false;
let tool: Tool = 'inspect',
  category = 'favorites',
  brush = 1,
  overlay: Overlay = 'none',
  night = false,
  grid = false;
let scene: CitySceneApi;
let selected: Point | null = null;
const constructionHistory: ConstructionHistory = [];
let disasterUndo: {
  raw: string;
  month: number;
  revision: number;
} | null = null;
let tickAccumulator = 0;
let lastEvent = state.events[0]?.id ?? 0;
let toastTimer: ReturnType<typeof setTimeout>;
let minimizeAdvisor = false;
let buildCount = 0;
let quality: 'performance' | 'balanced' | 'ultra' = 'balanced';
let frameCount = 0;
let fps = 60;
let started = false;
const simulationRuntime = new SimulationRuntime({
  onDiagnostic: () => {
    state.speed = 0;
    renderStats();
    toast(
      tr(
        'Simulation pausiert: Hintergrundberechnung nicht verfügbar. Mit Play erneut versuchen.',
        'Simulation paused: background processing unavailable. Press Play to retry.',
      ),
      'warning',
    );
  },
});
let simulationCommitPending = false;
const audioSession = createAudioSession();
const buildPreview = createBuildPreview(() => state.money);
const dialogs = createDialogHost({
  awaitingStart: () => awaitingStart,
  beforeOpen: () => {
    scene?.cancelInteraction();
    simulationRuntime.invalidate();
    dismissWelcomePreview();
  },
  renderPage: renderModal,
  wireLanguageControls,
});
mountAppShell(category, dialogs.drawerOpen, started);

function wireLanguageControls() {
  enhanceSelectMenus();
  document
    .querySelectorAll<HTMLSelectElement>('[data-language-select]')
    .forEach((select) => (select.onchange = () => changeLanguage(select.value as Locale)));
}

function renderSaveStatus() {
  $('#autosave-status').textContent = saveBlocked
    ? tr('Alter Spielstand geschützt · Export möglich', 'Old save protected · export available')
    : savePending
      ? tr('Wird gespeichert …', 'Saving …')
      : saveFailed
        ? tr('Speicherfehler · bitte exportieren', 'Save failed · please export')
        : tr('Lokal gesichert', 'Saved locally');
}

function changeLanguage(locale: Locale) {
  if (locale === getLocale()) return;
  simulationRuntime.invalidate();
  // Preserve the running scene, controls and any unfinished dialog edits.
  const focusId = (document.activeElement as HTMLElement | null)?.id;
  const dialogValues = [
    ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '#modal-root input,#modal-root select',
    ),
  ]
    .filter((el) => !el.hasAttribute('data-language-select'))
    .map((el) => ({
      id: el.id,
      value: el.value,
      checked: el instanceof HTMLInputElement ? el.checked : undefined,
    }));
  const modalScroll = dialogs.scroller()?.scrollTop ?? 0;
  setLocale(locale);
  safePreferenceSet('neustadt-language', locale);
  updateDocumentLanguage();
  clearTimeout(toastTimer);
  clearTimeout(vehicleHoverTimer);
  mountAppShell(category, dialogs.drawerOpen, started);
  wireEvents(false);
  renderTools();
  renderStats();
  renderInspector();
  $<HTMLSelectElement>('#overlay-select').value = overlay;
  setOverlay(overlay);
  $('#grid-btn').classList.toggle('active', grid);
  $('#grid-btn').setAttribute('aria-pressed', String(grid));
  $('#pan-btn').classList.toggle('active', tool === 'pan');
  document
    .querySelectorAll<HTMLElement>('[data-brush]')
    .forEach((button) => button.classList.toggle('active', Number(button.dataset.brush) === brush));
  buildPreview.render(null);
  scene.refreshLocale?.();
  updateDriveHud(scene.getDrivingStatus());

  renderSaveStatus();
  if (dialogs.page) {
    renderModal();
    for (const item of dialogValues) {
      const input = document.getElementById(item.id);
      if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
        input.value = item.value;
        if (input instanceof HTMLInputElement && item.checked !== undefined)
          input.checked = item.checked;
      }
    }
    dialogs.scroller().scrollTop = modalScroll;
  }
  syncSelectMenus();
  refreshIcons();
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function toast(message: string, type: 'good' | 'warning' | 'info' = 'info') {
  const el = $('#toast');
  el.innerHTML = `${icon(type === 'good' ? 'check-circle-2' : type === 'warning' ? 'triangle-alert' : 'info')}<span>${escape(message)}</span>`;
  el.className = `toast ${type}`;
  refreshIcons(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4600);
}

async function save(show = true) {
  if (awaitingStart) return;
  if (saveBlocked) {
    if (show)
      toast(
        tr(
          'Der bisherige Spielstand bleibt geschützt. Exportiere die aktuelle Stadt oder starte/importiere ausdrücklich eine neue.',
          'Your previous save remains protected. Export this city, or explicitly start or import a new one.',
        ),
        'warning',
      );
    return;
  }
  if (savePending) {
    saveQueued = true;
    if (show)
      toast(tr('Deine Stadt wird bereits gespeichert.', 'Your city is already being saved.'));
    return;
  }
  nextAutosave = Date.now() + 30000;
  savePending = true;
  try {
    const raw = serializeCity(state);
    await saveCityRaw(raw);
    saveFailed = false;
    $('#autosave-status').textContent = tr('Lokal gesichert', 'Saved locally');
    if (show) toast(tr(`${state.name} gespeichert.`, `${state.name} saved.`), 'good');
  } catch (error) {
    nextAutosave = Date.now() + 120000;
    $('#autosave-status').textContent = tr(
      'Speicherfehler · bitte exportieren',
      'Save failed · please export',
    );
    if (show || !saveFailed)
      toast(
        error instanceof Error
          ? error.message
          : tr(
              'Speichern fehlgeschlagen. Exportiere die Stadt im Menü.',
              'Saving failed. Export your city from the menu.',
            ),
        'warning',
      );
    saveFailed = true;
  } finally {
    savePending = false;
    if (saveQueued) {
      saveQueued = false;
      void save(false);
    }
  }
}

function scheduleSave() {
  simulationRuntime.invalidate();
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => void save(false), 1000);
}

function clearDisasterUndo() {
  simulationRuntime.invalidate();
  disasterUndo = null;
  $('#undo-btn')?.toggleAttribute('disabled', !canUndoConstruction(constructionHistory));
}

function clearUndo() {
  clearConstructionHistory(constructionHistory);
  clearDisasterUndo();
}

function cityChanged() {
  clearDisasterUndo();
  updateProgression(state);
  renderStats();
  renderTools();
  scheduleSave();
}

function undo() {
  scene.cancelInteraction();
  if (disasterUndo) {
    const previous = disasterUndo;
    clearDisasterUndo();
    if (previous.month !== state.month || previous.revision !== state.revision) {
      renderStats();
      toast(
        tr(
          'Diese Katastrophe kann nach weiteren Stadtänderungen nicht mehr rückgängig gemacht werden.',
          'This disaster can no longer be undone after further city changes.',
        ),
        'warning',
      );
      return;
    }
    const speed = state.speed,
      hour = scene.getTimeOfDay();
    state = deserializeCity(previous.raw);
    state.speed = speed;
    state.settings.timeOfDay = hour;
    state.tickProgress = Math.min(tickAccumulator, ECONOMY_STEP_SECONDS - 1e-6);
    lastEvent = state.events[0]?.id ?? 0;
    syncScene();
    renderStats();
    renderTools();
    renderInspector();
    scheduleSave();
    toast(tr('Letzte Katastrophe rückgängig gemacht.', 'Last disaster undone.'), 'good');
    return;
  }
  const result = undoConstruction(state, constructionHistory);
  if (result.ok) {
    syncScene();
    renderTools();
    renderInspector();
    scheduleSave();
  }
  renderStats();
  toast(result.message, result.ok ? 'good' : 'warning');
}

function focusWorldAfterPointer(event: MouseEvent) {
  if (event.detail > 0 && !dialogs.page) $('#world').focus({ preventScroll: true });
}

const densityPicker = createDensityPicker(() => {
  scene?.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
  renderTools();
});

function selectTool(value: Tool) {
  densityPicker.close();
  tool = value;
  scene?.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
  renderTools();
  $('#pan-btn')?.classList.toggle('active', tool === 'pan');
  if (tool !== 'inspect') {
    $('#inspector').classList.add('hidden');
    selected = null;
  }
  if (isZoneTool(tool)) densityPicker.open(tool);
  if (tool === 'pipe') {
    setOverlay('water');
    $<HTMLSelectElement>('#overlay-select').value = 'water';
    syncSelectMenus();
  }
  if (tool === 'powerline') {
    setOverlay('power');
    $<HTMLSelectElement>('#overlay-select').value = 'power';
    syncSelectMenus();
  }
  if (!isToolUnlocked(state, tool)) {
    const rank = RANKS.find((r) => r.unlocks.includes(tool));
    toast(
      tr(
        `Bau verfügbar ab ${rank?.name ?? 'einer höheren Ausbaustufe'} · ${fmt(rank?.population ?? 0)} Einwohner.`,
        `Available from ${rank?.name ?? 'a higher city tier'} · ${fmt(rank?.population ?? 0)} residents.`,
      ),
    );
  }
}

function progressionBindings(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-open-progress]').forEach(
    (b) =>
      (b.onclick = () => {
        progressionTab = b.dataset.openProgress as ProgressionTab;
        dialogs.open('progression');
      }),
  );
  container.querySelectorAll<HTMLElement>('[data-progress-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        progressionTab = b.dataset.progressTab as ProgressionTab;
        renderModal();
      }),
  );
  container.querySelectorAll<HTMLElement>('[data-claim-quest]').forEach(
    (b) =>
      (b.onclick = () => {
        const result = claimQuest(state, b.dataset.claimQuest!);
        if (result.ok) {
          clearUndo();
          cityChanged();
        }
        toast(result.message, result.ok ? 'good' : 'warning');
        if (dialogs.page === 'progression') renderModal();
      }),
  );
  container.querySelectorAll<HTMLElement>('[data-start-challenge]').forEach(
    (b) =>
      (b.onclick = () => {
        const result = startChallenge(state, b.dataset.startChallenge!);
        if (result.ok) cityChanged();
        toast(result.message, result.ok ? 'good' : 'warning');
        renderModal();
      }),
  );
}

function renderStats() {
  const advisorFocus = $('#advisor').contains(document.activeElement) ? captureFocus() : null;
  const s = state.stats;
  $('#city-name').innerHTML = `${escape(state.name)} ${icon('chevron-down')}`;
  $('#population').textContent = fmt(s.population);
  const previous = state.history.at(-2)?.population ?? s.population;
  const change = s.population - previous;
  $('#population-trend').textContent =
    change === 0 ? '–' : `${change > 0 ? '+' : ''}${fmt(change)}`;
  $('#population-trend').classList.toggle('negative', change < 0);
  $('#money').textContent = euro(state.money);
  $('#happiness').textContent = `${fmt(s.happiness)} %`;
  $('#balance').textContent =
    `${s.balance >= 0 ? '+' : ''}${euro(perMonth(s.balance))}/${tr('Mon.', 'mo')}`;
  $('#balance').classList.toggle('negative', s.balance < 0);
  $('#balance').title = tr(
    'Prognose je Spielmonat · 1 Monat = 60 Sekunden bei 1×',
    'Projection per calendar month · 1 month = 60 seconds at 1×',
  );
  $('#game-date').textContent = calendarDate(state.month, tickAccumulator, getLocale());
  $('#season').textContent =
    state.settings.weather === 'rain' ? tr('REGEN', 'RAIN') : tr('KLAR', 'CLEAR');
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.speed) === state.speed);
    b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
  });
  [
    ['r', s.residentialDemand],
    ['c', s.commercialDemand],
    ['i', s.industrialDemand],
  ].forEach(([key, val]) => {
    $(`#demand-${key}`).style.width = `${clamp(Number(val), 0, 100)}%`;
    $(`#demand-${key}-val`).textContent = `${Math.round(Number(val))}%`;
  });
  $('#advisor').innerHTML = renderProgressionSidebar(state);
  progressionBindings($('#advisor'));
  $('#advisor').classList.toggle('hidden', minimizeAdvisor);
  const latest = state.events[0];
  $('#latest-news').textContent = latest
    ? localizedEventTitle(latest)
    : tr('Deine Stadt wartet auf dich.', 'Your city is waiting for you.');
  $('.news-button small').textContent = tr(
    `NEUES AUS ${state.name.toUpperCase()}`,
    `NEWS FROM ${state.name.toUpperCase()}`,
  );
  $('.map-caption').innerHTML = `${escape(state.name)} <span>${state.size} × ${state.size}</span>`;
  $('#undo-btn').toggleAttribute(
    'disabled',
    !canUndoConstruction(constructionHistory) && !disasterUndo,
  );
  $('#undo-btn').title = disasterUndo
    ? tr('Letzte Katastrophe rückgängig machen (Strg+Z)', 'Undo last disaster (Ctrl+Z)')
    : tr('Letzten Bau rückgängig machen (Strg+Z)', 'Undo last construction (Ctrl+Z)');
  renderLightSwitch();
  renderDayClock();
  drawMinimap(state, overlay);
  refreshIcons($('.topbar'));
  refreshIcons($('#advisor'));
  restoreFocus(advisorFocus, $('#advisor'));
}

function renderInspector() {
  if (!selected) return;
  let t = state.tiles[selected.z * state.size + selected.x];
  if (!t) return;
  if (t.anchor >= 0) t = state.tiles[t.anchor] ?? t;
  const selectedAnchor = { x: t.x, z: t.z };
  $('#inspector').innerHTML = renderInspectorView(state, t);
  $('#inspector').classList.remove('hidden');
  $('#inspector-close').onclick = () => {
    $('#inspector').classList.add('hidden');
    selected = null;
  };
  const b = $('#demolish-selected');
  if (b)
    b.onclick = () => {
      paint([selectedAnchor], 'bulldoze');
      renderInspector();
    };
  refreshIcons($('#inspector'));
}

function paint(points: Point[], override?: Tool, options: BuildOptions = {}) {
  if (awaitingStart) return;
  const use = override ?? tool;
  if (isZoneTool(use)) options = { ...options, density: densityPicker.selected(use) };
  if (['inspect', 'pan', 'citizen'].includes(use)) return;
  const preview = previewBuild(state, points, use, options);
  if (!preview.count || preview.cost > state.money) return toast(preview.message, 'warning');
  const before = captureConstructionState(state);
  const result = build(state, points, use, options);
  if (result.ok) {
    clearDisasterUndo();
    recordConstruction(constructionHistory, before, state, use, result);
    buildCount += result.count;
    syncScene();
    renderStats();
    renderTools();
    scheduleSave();
    toast(result.message, 'good');
  } else toast(result.message, 'warning');
}

function createScene() {
  return createCityScene($('#world'), state, {
    onHover: (p) => {
      if (!p) $('#tile-tooltip').classList.add('hidden');
    },
    onPaint: (points, options) => paint(points, undefined, options),
    onSelect: (p) => {
      if (awaitingStart) return;
      selected = p;
      renderInspector();
    },
    onPreview: buildPreview.render,
    onVehicleHover: showVehicleHover,
    onDriveStatus: updateDriveHud,
    onCitizenIncident: (incident) => {
      if (awaitingStart) return;
      const result = applyCitizenIncident(state, incident);
      if (result.ok) {
        clearDisasterUndo();
        syncScene();
        renderStats();
        scheduleSave();
        toast(result.message, incident.witnessed ? 'warning' : 'info');
      }
    },
  });
}

function syncScene(reset = false, replaceCity = false) {
  simulationRuntime.invalidate();
  if (replaceCity || !scene || sceneSize !== state.size) {
    scene?.dispose();
    scene = createScene();
    sceneSize = state.size;
    scene.setGraphicsQuality(quality);
    scene.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
    const savedHour = state.settings.timeOfDay,
      savedCycle = state.settings.dayNightCycle;
    scene.setTimeOfDay(savedHour);
    scene.setDayNightCycle(savedCycle);
    scene.setBuildingLights(state.settings.buildingLights);
    scene.setOverlay(overlay);
    scene.setGrid(grid);
    scene.setWeather(state.settings.weather);
  } else scene.update(state);
  if (reset) scene.resetCamera();
}

function beginCity(next: CityState, empty: boolean) {
  awaitingStart = false;
  scene?.exitDrive();
  state = next;
  state.speed = 0;
  saved = true;
  saveBlocked = false;
  recoveryRaw = null;
  clearUndo();
  selected = null;
  lastRank = getRank(state).id;
  victoryAnnounced = state.progression.victory;
  tickAccumulator = state.tickProgress ?? 0;
  tool = 'inspect';
  category = 'favorites';
  overlay = 'none';
  grid = false;
  minimizeAdvisor = false;
  syncScene(true, true);
  scene.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
  scene.setOverlay(overlay);
  scene.setGrid(false);
  renderStats();
  renderTools();
  $('#inspector').classList.add('hidden');
  dialogs.close();
  if (empty) {
    const p = starterPoint(state.size);
    scene.focus(p.x, p.z);
    showStarterHint();
    if (state.size >= 128) {
      scene.zoom(-1);
      scene.zoom(-1);
    }
  } else {
    scene.resetCamera();
    scene.zoom(-1);
  }
  save(false);
  toast(
    tr(
      `Willkommen in ${state.name}. Deine Geschichte beginnt.`,
      `Welcome to ${state.name}. Your story begins.`,
    ),
    'good',
  );
}

function showStarterHint() {
  const p = starterPoint(state.size);
  const el = document.createElement('button');
  el.id = 'starter-hint';
  el.className = 'starter-hint';
  el.innerHTML = `${icon('map-pin')}<span>
    <strong>${tr('Dein Bauplatz', 'Your building site')}</strong>
    <small>${tr('Beginne hier mit einer Straße und deiner Versorgung.', 'Start here with a road and utilities.')}</small>
    </span>${icon('x')}`;
  el.title = tr('Hinweis schließen', 'Dismiss hint');
  el.onclick = () => el.remove();
  $('#game').appendChild(el);
  refreshIcons(el);
  scene.focus(p.x, p.z);
}

function showVehicleHover(info: VehicleHover | null) {
  const el = $('#vehicle-hotspot');
  clearTimeout(vehicleHoverTimer);
  if (!info) {
    vehicleHoverTimer = setTimeout(() => {
      if (!el.matches(':hover')) el.classList.add('hidden');
    }, 500);
    return;
  }
  if (driving || awaitingStart) return;
  hoveredVehicle = info.id;
  el.classList.remove('hidden');
  el.style.left = `${clamp(info.screenX, 80, innerWidth - 90)}px`;
  el.style.top = `${clamp(info.screenY - 24, 130, innerHeight - 205)}px`;
}

function updateDriveHud(info: DrivingStatus) {
  const entering = info.active && !driving;
  driving = info.active;
  if (entering) $('#world').focus({ preventScroll: true });
  document.body.classList.toggle('driving', driving);
  $('#drive-hud').classList.toggle('hidden', !driving);
  $('#drive-speed').innerHTML = `${fmt(Math.abs(info.speed))} <small>km/h</small>`;
  $('#drive-status').textContent =
    info.blocked ??
    [
      info.drifting ? 'Drift' : info.label,
      info.speedLimit ? tr(`Tempo ${fmt(info.speedLimit)}`, `Limit ${fmt(info.speedLimit)}`) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  $('#drive-status').classList.toggle('drive-warning', !!info.blocked);
  $('#drive-hud').classList.toggle('is-drifting', !!info.drifting);
  if (driving) {
    $('#vehicle-hotspot').classList.add('hidden');
    $('#build-preview').classList.add('hidden');
    $('#inspector').classList.add('hidden');
  }
}

function setBuildingLights(enabled: boolean) {
  clearDisasterUndo();
  state.settings.buildingLights = enabled;
  scene.setBuildingLights(enabled);
  renderLightSwitch();
  scheduleSave();
}

function renderLightSwitch() {
  const button = $('#building-lights-btn');
  button.classList.toggle('active', state.settings.buildingLights);
  button.setAttribute('aria-pressed', String(state.settings.buildingLights));
  button.title = state.settings.buildingLights
    ? tr('Stadtbeleuchtung ausschalten (L)', 'Turn city lights off (L)')
    : tr('Stadtbeleuchtung einschalten (L)', 'Turn city lights on (L)');
  button.innerHTML = icon(state.settings.buildingLights ? 'lightbulb' : 'lightbulb-off');
  refreshIcons(button);
}

function setOverlay(v: Overlay) {
  overlay = v;
  syncSelectMenus();
  scene.setOverlay(v);
  drawMinimap(state, overlay);
  const legend = $('#overlay-legend');
  if (v === 'none') {
    legend.classList.add('hidden');
    return;
  }
  const labels: Record<string, string[]> = {
    power: [
      tr('Stromversorgung', 'Power supply'),
      tr('Ohne Strom', 'No power'),
      tr('Versorgt', 'Supplied'),
    ],
    water: [
      tr('Wasserversorgung', 'Water supply'),
      tr('Ohne Wasser', 'No water'),
      tr('Versorgt', 'Supplied'),
    ],
    landvalue: [tr('Grundstückswert', 'Land value'), tr('Niedrig', 'Low'), tr('Hoch', 'High')],
    pollution: [
      tr('Umweltbelastung', 'Pollution'),
      tr('Sauber', 'Clean'),
      tr('Belastet', 'Polluted'),
    ],
    traffic: [
      tr('Verkehrsdichte', 'Traffic density'),
      tr('Freie Fahrt', 'Free-flowing'),
      tr('Stau', 'Congested'),
    ],
    terrain: [
      tr('Geländehöhen', 'Terrain height'),
      tr('Meereshöhe', 'Sea level'),
      tr('Hochland', 'High ground'),
    ],
  };
  const [title, a, b] = labels[v];
  legend.innerHTML = `<strong>${title}</strong>
    <div class="legend-gradient ${v}">
    </div>
    <div>
    <span>${a}</span>
    <span>${b}</span>
    </div>`;
  legend.classList.remove('hidden');
}

function renderModal() {
  if (dialogs.page === 'progression') {
    dialogs.render(
      tr('Deine Stadt hat große Pläne.', 'Your city has big plans.'),
      tr('AUFTRÄGE · AUSBAUSTUFEN · STADTZIEL', 'QUESTS · CITY LEVELS · CITY GOAL'),
      renderProgressionDialog(state, progressionTab),
      true,
    );
    progressionBindings($('#modal-root'));
  } else if (dialogs.page === 'camera') {
    dialogs.render(
      tr('Deine Stadt aus jedem Blickwinkel.', 'Your city from every angle.'),
      tr('KAMERA & BAUEN', 'CAMERA & BUILDING'),
      renderCameraView(),
      true,
    );
    $('#camera-use-pan').onclick = () => {
      dialogs.close();
      selectTool('pan');
      $('#world').focus({ preventScroll: true });
    };
  } else if (dialogs.page === 'budget') {
    dialogs.render(
      tr('Ein guter Plan für morgen.', 'A good plan for tomorrow.'),
      tr('STADTHAUSHALT', 'CITY BUDGET'),
      renderBudgetView(state),
      true,
    );
    bindBudgetControls(state, cityChanged, renderModal, toast);
  } else if (dialogs.page === 'reports') {
    dialogs.render(
      tr('So geht es deiner Stadt.', 'How your city is doing.'),
      tr('STADTBERICHT', 'CITY REPORT'),
      renderReportsView(state),
      true,
    );
  } else if (dialogs.page === 'news') {
    dialogs.render(
      tr('Geschichten aus deiner Stadt.', 'Stories from your city.'),
      tr('STADTJOURNAL', 'CITY JOURNAL'),
      renderNewsView(state),
    );
  } else if (dialogs.page === 'help') {
    dialogs.render(
      tr('Eine Stadt nach deinen Ideen.', 'A city shaped by your ideas.'),
      tr('WILLKOMMEN IN NEUSTADT', 'WELCOME TO NEUSTADT'),
      renderHelpView(),
      true,
    );
    $('#start-playing').onclick = () => dialogs.close();
  } else if (dialogs.page === 'graphics') {
    dialogs.render(
      tr('Deine Stadt im besten Licht.', 'Your city in its best light.'),
      tr('GRAFIK & BELEUCHTUNG', 'GRAPHICS & LIGHTING'),
      renderGraphicsView(state, quality) + renderAudioView(audioSession.preferences),
    );
    bindAudioControls((patch) => {
      audioSession.setPreferences(patch);
      renderSoundToggle();
    });
    bindLightingControls(state, scene, cityChanged, renderModal, (value) => {
      quality = value;
      safePreferenceSet('neustadt-quality', value);
    });
  } else if (dialogs.page === 'audio') {
    dialogs.render(
      tr('Deine Stadt klingt lebendig.', 'Your city sounds alive.'),
      tr('KLANG & MUSIK', 'SOUND & MUSIC'),
      renderAudioView(audioSession.preferences),
    );
    bindAudioControls((patch) => {
      audioSession.setPreferences(patch);
      renderSoundToggle();
    });
  } else if (dialogs.page === 'welcome') {
    dialogs.render(
      tr('Deine nächste Geschichte.', 'Your next story.'),
      tr('WILLKOMMEN IN NEUSTADT', 'WELCOME TO NEUSTADT'),
      renderWelcomeView(state),
    );
    $('.close-modal').hidden = true;
    $('#adopt-new-york').onclick = () => beginCity(state, false);
    $('#found-own-city').onclick = () => dialogs.open('newcity');
  } else if (dialogs.page === 'newcity') {
    dialogs.render(
      tr('Hier beginnt deine Stadt.', 'This is where your city begins.'),
      tr('NEUE STADT', 'NEW CITY'),
      renderNewCityView(awaitingStart),
    );
    $('#random-seed').onclick = () => {
      $<HTMLInputElement>('#new-seed').value = String(
        crypto.getRandomValues(new Uint32Array(1))[0],
      );
    };
    $('#new-empty').onclick = () =>
      beginCity(
        generateSmallCity(
          $<HTMLInputElement>('#new-seed').value,
          $<HTMLInputElement>('#new-name').value.trim().slice(0, 40) ||
            tr('Meine Stadt', 'My city'),
        ),
        true,
      );
    $('#new-starter').onclick = () => beginCity(generateNewYorkCity(), false);
  } else if (dialogs.page === 'disaster') {
    dialogs.render(
      tr('Wenn die Stadt dich braucht.', 'When your city needs you.'),
      tr('EXPERIMENTIERMODUS & KATASTROPHEN', 'SANDBOX & DISASTERS'),
      renderDisasterView(state),
    );
    $('#disaster-enabled').onchange = (e) => {
      state.settings.disastersEnabled = (e.target as HTMLInputElement).checked;
      cityChanged();
      renderModal();
    };
    document.querySelectorAll<HTMLButtonElement>('[data-disaster]').forEach(
      (b) =>
        (b.onclick = () => {
          const previous = serializeCity(state);
          const result = triggerDisaster(state, b.dataset.disaster as DisasterKind);
          if (!result.ok) return toast(result.message, 'warning');
          clearUndo();
          disasterUndo = {
            raw: previous,
            month: state.month,
            revision: state.revision,
          };
          state.speed = 0;
          syncScene();
          renderStats();
          scheduleSave();
          dialogs.close();
          toast(
            tr(
              'Katastrophe ausgelöst · Stadt pausiert · Strg+Z: rückgängig',
              'Disaster triggered · City paused · Ctrl+Z: undo',
            ),
            'warning',
          );
        }),
    );
  } else {
    dialogs.render(
      tr('Deine Stadt. Dein Spiel.', 'Your city. Your game.'),
      tr('STADTMENÜ', 'CITY MENU'),
      renderCityMenuView(state, recoveryRaw, tickAccumulator),
    );
    $('#download-recovery')?.addEventListener('click', () => {
      if (recoveryRaw)
        download(
          new Blob([recoveryRaw], { type: 'application/json' }),
          tr('neustadt-original-sicherung.json', 'neustadt-original-backup.json'),
        );
    });
    $('#rename-btn').onclick = () => {
      const name = $<HTMLInputElement>('#rename-input').value.trim();
      if (name) {
        state.name = name;
        cityChanged();
        save(false);
        toast(tr('Deine Stadt hat einen neuen Namen.', 'Your city has a new name.'), 'good');
        renderModal();
      }
    };
    $('#menu-save').onclick = () => save();
    $('#menu-export').onclick = () =>
      download(
        new Blob([serializeCity(state)], { type: 'application/json' }),
        `${state.name.toLowerCase().replace(/[^a-z0-9äöüß_-]/g, '-')}-${tr('spielstand', 'save')}.json`,
      );
    $('#menu-import').onclick = () => {
      $<HTMLInputElement>('#import-file').click();
    };
    $('#menu-new').onclick = () => dialogs.open('newcity');
    $('#menu-reset').onclick = () => {
      if (
        !window.confirm(
          tr(
            'Auf die ursprüngliche Startstadt Kassel zurücksetzen? Dein aktueller Spielstand wird ersetzt. Wenn du ihn behalten möchtest, wähle zuerst „Spielstand exportieren“.',
            'Reset to the original starter city Kassel? Your current save will be replaced. To keep it, choose “Export save” first.',
          ),
        )
      )
        return;
      beginCity(generateNewYorkCity(), false);
    };
    $('#menu-expand')?.addEventListener('click', () => {
      const nextSize = nextCitySize(state.size);
      if (nextSize === null) return;
      state = expandCity(state, nextSize);
      clearUndo();
      selected = null;
      syncScene(true);
      renderStats();
      renderTools();
      dialogs.close();
      scene.overview();
      save(false);
      toast(
        tr(
          'Deine Region ist gewachsen. Deine Bebauung bleibt erhalten.',
          'Your region has grown. Your existing buildings are preserved.',
        ),
        'good',
      );
    });
    $('#menu-photo').onclick = () => {
      const a = document.createElement('a');
      a.href = scene.screenshot();
      a.download = tr('neustadt-stadtansicht.png', 'neustadt-city-view.png');
      a.click();
      toast(
        tr(
          'Deine Stadtansicht wurde als PNG exportiert.',
          'Your city view has been exported as a PNG.',
        ),
        'good',
      );
    };
    $('#menu-help').onclick = () => dialogs.open('help');
    $('#menu-easter-egg').onclick = focusEasterEgg;
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(tr('Spielstand exportiert.', 'City save exported.'), 'good');
}

function renderSoundToggle() {
  const button = $('#sound-toggle');
  if (!button) return;
  const enabled = audioSession.preferences.enabled;
  button.innerHTML = icon(enabled ? 'volume-2' : 'volume-x');
  button.setAttribute('aria-pressed', String(enabled));
  button.title = enabled
    ? tr('Ton an · ausschalten', 'Sound on · turn off')
    : tr('Ton aus · einschalten', 'Sound off · turn on');
  button.setAttribute('aria-label', button.title);
  button.classList.toggle('active', enabled);
  refreshIcons(button);
}

function wireEvents(includeGlobal = true) {
  renderSoundToggle();
  $('#sound-toggle').onclick = () => {
    audioSession.setPreferences({ enabled: !audioSession.preferences.enabled });
    renderSoundToggle();
    const control = document.querySelector<HTMLInputElement>('#audio-enabled');
    if (control) control.checked = audioSession.preferences.enabled;
  };
  wireLanguageControls();
  document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(
    (b) =>
      (b.onclick = () => {
        densityPicker.close();
        category = b.dataset.category!;
        document
          .querySelectorAll('[data-category]')
          .forEach((x) => x.classList.toggle('active', x === b));
        renderTools();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(
    (b) =>
      (b.onclick = () => {
        setSpeed(Number(b.dataset.speed) as CityState['speed']);
      }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach(
    (b) =>
      (b.onclick = (event) => {
        brush = Number(b.dataset.brush);
        scene.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
        document
          .querySelectorAll('[data-brush]')
          .forEach((x) => x.classList.toggle('active', x === b));
        focusWorldAfterPointer(event);
      }),
  );
  $('#vehicle-hotspot').onmouseleave = () => {
    $('#vehicle-hotspot').classList.add('hidden');
  };
  $('#vehicle-hotspot').onclick = () => {
    if (hoveredVehicle !== null && scene.enterDrive(hoveredVehicle)) {
      $('#vehicle-hotspot').classList.add('hidden');
    }
  };
  $('#exit-drive').onclick = () => scene.exitDrive();
  $('#goals-btn').onclick = () => dialogs.open('progression');
  $('#overview-btn').onclick = () => scene.overview();
  $('#pan-btn').onclick = (event) => {
    selectTool('pan');
    focusWorldAfterPointer(event);
  };
  $('#camera-help').onclick = () => dialogs.open('camera');
  $('#rotate-building').onclick = (event) => {
    buildingRotation = ((buildingRotation + 1) % 4) as 0 | 1 | 2 | 3;
    scene.setTool(tool, brush, buildingRotation, densityPicker.selected(tool));
    focusWorldAfterPointer(event);
  };
  $('#graphics-btn').onclick = () => dialogs.open('graphics');
  $('#save-btn').onclick = () => save();
  $('#undo-btn').onclick = undo;
  $('#menu-btn').onclick = () => dialogs.open('menu');
  $('#city-name').onclick = () => dialogs.open('menu');
  $('#budget-stat').onclick = () => dialogs.open('budget');
  $('#population-stat').onclick = () => dialogs.open('reports');
  $('#happiness-stat').onclick = () => dialogs.open('reports');
  $('#help-btn')?.addEventListener('click', () => dialogs.open('help'));
  $('#help-shortcut').onclick = () => dialogs.open('help');
  $('#brand-help').onclick = (e) => {
    e.preventDefault();
    dialogs.open('help');
  };
  $('#news-btn').onclick = () => dialogs.open('news');
  $('#advisor-close')?.addEventListener('click', () => {
    minimizeAdvisor = true;
    $('#advisor').classList.add('hidden');
  });
  $('#building-lights-btn').onclick = () => setBuildingLights(!state.settings.buildingLights);
  $('#zoom-in').onclick = () => scene.zoom(1);
  $('#zoom-out').onclick = () => scene.zoom(-1);
  $('#rotate-left').onclick = () => scene.rotate(-1);
  $('#rotate-right').onclick = () => scene.rotate(1);
  $('#camera-home').onclick = () => scene.resetCamera();
  $('#overlay-select').onchange = (e) =>
    setOverlay((e.target as HTMLSelectElement).value as Overlay);
  $('#grid-btn').onclick = () => {
    grid = !grid;
    scene.setGrid(grid);
    $('#grid-btn').classList.toggle('active', grid);
    $('#grid-btn').setAttribute('aria-pressed', String(grid));
  };
  $('#night-btn').onclick = () => {
    clearDisasterUndo();
    night = scene.getTimeOfDay() >= 6 && scene.getTimeOfDay() < 19;
    state.settings.timeOfDay = night ? 21 : 14;
    state.settings.dayNightCycle = false;
    scene.setTimeOfDay(state.settings.timeOfDay);
    scene.setDayNightCycle(false);
    $('#night-btn').innerHTML = icon(night ? 'moon' : 'sun');
    $('#night-btn').classList.toggle('active', night);
    $('#night-btn').setAttribute('aria-pressed', String(night));
    refreshIcons($('#night-btn'));
    scheduleSave();
  };
  $('#minimap').onclick = (e) => {
    const rect = $('#minimap').getBoundingClientRect();
    scene.focus(
      Math.floor(((e.clientX - rect.left) / rect.width) * state.size),
      Math.floor(((e.clientY - rect.top) / rect.height) * state.size),
    );
  };
  $('#import-file').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 12000000) throw Error(tr('Datei ist zu groß.', 'The file is too large.'));
      const imported = loadCityForPlay(await file.text());

      state = imported;
      awaitingStart = false;
      state.speed = 0;
      saveBlocked = false;
      recoveryRaw = null;
      clearUndo();
      selected = null;
      lastRank = getRank(state).id;
      victoryAnnounced = state.progression.victory;
      tickAccumulator = state.tickProgress ?? 0;
      scene.exitDrive();
      syncScene(true, true);
      renderStats();
      renderTools();
      $('#inspector').classList.add('hidden');
      dialogs.close();
      save(false);
      toast(tr(`${state.name} erfolgreich geladen.`, `${state.name} loaded successfully.`), 'good');
    } catch (err) {
      toast(
        tr(
          `Spielstand konnte nicht geladen werden: ${err instanceof Error ? err.message : 'Ungültige Datei'}`,
          `Could not load the save: ${err instanceof Error ? err.message : 'Invalid file'}`,
        ),
        'warning',
      );
    }
    (e.target as HTMLInputElement).value = '';
  };
  if (!includeGlobal) return;
  bindLandmarkDiscovery();
  $('#world').addEventListener(
    'pointerdown',
    () => {
      if (!dialogs.page) $('#world').focus({ preventScroll: true });
    },
    true,
  );
  bindKeyboardControls(
    () => ({
      modal: !!dialogs.page,
      driving,
      awaitingStart,
      rotatable: !!TOOL_DEFS[tool]?.footprint,
    }),
    (intent) => {
      switch (intent.type) {
        case 'save':
          void save();
          break;
        case 'undo':
          undo();
          break;
        case 'escape':
          if (dialogs.page) {
            dialogs.close();
            break;
          }
          if (awaitingStart) {
            dialogs.open('welcome');
            break;
          }
          if (driving) {
            scene.exitDrive();
            break;
          }
          scene.cancelInteraction();
          $('#inspector').classList.add('hidden');
          selected = null;
          break;
        case 'pause':
          setSpeed(state.speed ? 0 : 1);
          break;
        case 'tool':
          category = 'favorites';
          document
            .querySelectorAll<HTMLElement>('[data-category]')
            .forEach((button) =>
              button.classList.toggle('active', button.dataset.category === category),
            );
          selectTool(intent.tool);
          break;
        case 'rotate':
          scene.rotate(intent.direction);
          break;
        case 'click':
          $('#' + intent.id).click();
          break;
        case 'help':
          dialogs.open('help');
          break;
      }
    },
  );
  window.addEventListener('resize', buildPreview.reposition);
  window.visualViewport?.addEventListener('resize', buildPreview.reposition);
  window.addEventListener('beforeunload', () => {
    void save(false);
    audioSession.dispose();
    simulationRuntime.dispose();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(false);
  });
}
/** Commit one background economy step only if its source city still owns the session. */

async function advanceEconomy() {
  if (simulationCommitPending || simulationRuntime.busy) return;
  clearDisasterUndo();
  simulationCommitPending = true;
  const source = state;
  try {
    const result = await simulationRuntime.step(source, getLocale());
    if (
      !result ||
      state !== source ||
      source.revision !== result.baseRevision ||
      result.epoch !== simulationRuntime.epoch
    )
      return;
    // Camera/daylight, user controls and fractional calendar remain main-thread owned.
    result.state.speed = state.speed;
    result.state.settings = { ...state.settings };
    tickAccumulator = Math.max(0, tickAccumulator - ECONOMY_STEP_SECONDS);
    state = result.state;
    state.tickProgress = Math.min(tickAccumulator, ECONOMY_STEP_SECONDS - 1e-6);
    syncScene();
    renderStats();
    renderInspector();
    const rank = getRank(state);
    if (rank.id > lastRank) {
      lastRank = rank.id;
      renderTools();
      toast(
        tr(
          `Ausbaustufe ${rank.id + 1}: ${rank.name}! Neue Gebäude sind freigeschaltet.`,
          `City tier ${rank.id + 1}: ${rank.name}! New buildings unlocked.`,
        ),
        'good',
      );
    }
    if (state.progression.victory && !victoryAnnounced) {
      victoryAnnounced = true;
      progressionTab = 'goal';
      dialogs.open('progression');
    }
    if (state.events[0]?.id !== lastEvent) {
      lastEvent = state.events[0]?.id ?? 0;
      const latest = state.events[0];
      if (latest?.type === 'warning') toast(localizedEventMessage(latest), 'warning');
    }
  } finally {
    simulationCommitPending = false;
  }
}

function loop(frame: Frame) {
  audioSession.update(
    frame.delta,
    () => scene.getAudioState(),
    awaitingStart || !!dialogs.page || landmarkPreviewOpen,
  );
  fps = frame.fps;
  frameCount = frame.count;
  if (
    !document.hidden &&
    !dialogs.page &&
    !landmarkPreviewOpen &&
    !awaitingStart &&
    state.speed > 0
  ) {
    if (tickAccumulator < ECONOMY_STEP_SECONDS) {
      const simulationDelta = Math.min(
        frame.delta * state.speed,
        ECONOMY_STEP_SECONDS - tickAccumulator,
      );
      tickAccumulator += simulationDelta;
      if (advanceWeather(state, simulationDelta)) {
        scene.setWeather(state.settings.weather);
        renderDayClock();
        scheduleSave();
      }
    }
    if (tickAccumulator >= ECONOMY_STEP_SECONDS) void advanceEconomy();
  }
  state.tickProgress = Math.min(tickAccumulator, ECONOMY_STEP_SECONDS - 1e-6);
  if (frameCount % 30 === 0 && scene) renderDayClock();
  if (!awaitingStart && !savePending && Date.now() > nextAutosave) void save(false);
}

function focusEasterEgg() {
  const building = state.tiles.find(
    (tile) => isEasterEggBuilding(tile) && isBuildingAnchor(state, tile),
  );
  if (!building) {
    toast(tr('In dieser Stadt gibt es kein Easter Egg.', 'This city has no Easter Egg.'), 'info');
    return;
  }
  dialogs.close(true);
  scene.focusBuilding(building.x, building.z);
  if (awaitingStart) {
    document.body.classList.add('welcoming');
    showWelcomePreview(() => dialogs.open('welcome'));
  } else {
    selected = { x: building.x, z: building.z };
    renderInspector();
  }
  simulationRuntime.invalidate();
  landmarkPreviewOpen = showEasterEggPreview(() => {
    landmarkPreviewOpen = false;
    scene.focusBuilding(building.x, building.z);
    if (awaitingStart)
      document.querySelector<HTMLButtonElement>('#welcome-preview button')?.focus();
    else document.getElementById('world')?.focus();
  });
}

export async function startApplication() {
  try {
    const load = await loadSavedCity();
    if (load.error) {
      loadError = load.error;
      saveBlocked = true;
    }
    if (load.raw) {
      try {
        const city = loadCityForPlay(load.raw);
        if (load.source === 'legacy') {
          try {
            await backupLegacy(load.raw);
          } catch {
            loadNotice = tr(
              'Die alte Sicherung bleibt erhalten. Die Stadt wird geladen.',
              'Your old backup is preserved. Loading the city.',
            );
          }
        }
        state = city;
        awaitingStart = false;
        state.speed = 0;
        tickAccumulator = state.tickProgress ?? 0;
        saved = true;
      } catch (error) {
        saveBlocked = true;
        recoveryRaw = load.raw;
        loadError = tr(
          `Der bisherige Spielstand bleibt geschützt: ${error instanceof Error ? error.message : 'Laden fehlgeschlagen'}`,
          `Your previous save remains protected: ${error instanceof Error ? error.message : 'Loading failed'}`,
        );
      }
    }
    await preloadEasterEggBuilding();
    awaitingStart = !saved && !saveBlocked;
    const preference = safePreferenceGet('neustadt-quality');
    if (['performance', 'balanced', 'ultra'].includes(preference ?? ''))
      quality = preference as typeof quality;
    lastRank = getRank(state).id;
    victoryAnnounced = state.progression.victory;
    syncScene();
    renderTools();
    renderStats();
    wireEvents();
    refreshIcons();
    started = true;
    $('#loading-screen').classList.add('loaded');
    setTimeout(() => $('#loading-screen')?.remove(), 650);
    if (saveBlocked)
      $('#autosave-status').textContent = tr(
        'Alter Spielstand geschützt · Export möglich',
        'Old save protected · export available',
      );
    if (loadError) toast(loadError, 'warning');
    else if (loadNotice) toast(loadNotice, 'good');
    else if (saved)
      toast(
        tr(
          'Willkommen zurück. Deine Stadt wurde geladen.',
          'Welcome back. Your city has been loaded.',
        ),
        'good',
      );
    if (awaitingStart) {
      scene.resetCamera();
      scene.zoom(-1);
      dialogs.open('welcome');
    } else if (!saveBlocked) scheduleSave();
    startFrameLoop(loop);
    Object.defineProperty(window, 'neustadtDebug', {
      get: () => ({
        version: appVersion,
        audio: audioSession.preferences,
        simulation: { busy: simulationRuntime.busy, epoch: simulationRuntime.epoch },
        awaitingStart,
        state: structuredClone(state),
        locale: getLocale(),
        tool,
        overlay,
        night,
        grid,
        quality,
        driving,
        rotation: buildingRotation,
        renderStatus: { mode: 'realtime', status: tr('Echtzeit', 'Realtime') },
        preview: buildPreview.current,
        interactionTargets: scene.getInteractionTargets?.(),
        diagnostics: scene.getDiagnostics?.(),
        drivingStatus: scene.getDrivingStatus(),
        fps: Math.round(fps),
        frames: frameCount,
        buildCount,
        undoCount: constructionHistory.length + (disasterUndo ? 1 : 0),
        saveBlocked,
        savePending,
        saveFailed,
      }),
    });
  } catch (error) {
    $('#loading-screen').innerHTML =
      `<h2>${tr('Die Stadt konnte nicht gestartet werden.', 'The city could not be started.')}</h2>
    <p>${escape(error instanceof Error ? error.message : tr('Unbekannter Fehler', 'Unknown error'))}</p>
    <p>${tr('Bitte verwende einen Browser mit aktivierter WebGL-Grafik.', 'Please use a browser with WebGL graphics enabled.')}</p>`;
    console.error(error);
  }
}

function renderTools() {
  renderToolPalette(
    state,
    category,
    tool,
    (next, event) => {
      selectTool(next);
      if (!isZoneTool(next)) focusWorldAfterPointer(event);
    },
    densityPicker.selected(tool),
  );
  densityPicker.render();
}

function renderDayClock() {
  night = renderCalendarClock(
    state,
    tickAccumulator,
    scene ? scene.getTimeOfDay() : state.settings.timeOfDay,
  );
}

function setSpeed(speed: CityState['speed']) {
  simulationRuntime.invalidate();
  state.speed = speed;
  if (speed > 0) clearDisasterUndo();
  renderStats();
}
