import { tr } from '../../i18n/index';
import { $, icon } from '../dom';
import { languageControl } from './language';
const CATEGORIES = () => [
  ['favorites', 'sparkles', tr('Schnellzugriff', 'Quick access')],
  ['zones', 'grid-2x2', tr('Zonen', 'Zones')],
  ['transport', 'route', tr('Verkehr', 'Transport')],
  ['utilities', 'zap', tr('Versorgung', 'Utilities')],
  ['services', 'landmark', tr('Stadtdienste', 'City services')],
  ['nature', 'trees', tr('Natur', 'Nature')],
  ['terrain', 'mountain', tr('Gelände', 'Terrain')],
  ['special', 'building', tr('Großprojekte', 'Landmarks')],
];

export function mountAppShell(category: string, drawerOpen: boolean, started: boolean) {
  const world = document.getElementById('world');
  $('#app').innerHTML = `
  <main id="game" aria-label="${tr('Neustadt 3D Städtebauspiel', 'Neustadt 3D city-building game')}">
    <div id="world" tabindex="0" aria-label="${tr('Interaktive dreidimensionale Stadt', 'Interactive three-dimensional city')}">
    </div>
    <header class="topbar">
      <a class="brand" href="#" id="brand-help" aria-label="${tr('Über Neustadt', 'About Neustadt')}">
    <span class="brand-symbol">${icon('building-2')}</span>
    <span>NEUSTADT<small>${tr('DEINE STADT. DEINE GESCHICHTE.', 'YOUR CITY. YOUR STORY.')}</small>
    </span>
    </a>
      <div class="city-heading">
    <span class="eyebrow">${tr('BÜRGERMEISTERBÜRO', 'MAYOR’S OFFICE')}</span>
    <button id="city-name" title="${tr('Stadt verwalten', 'Manage city')}">
    </button>
    </div>
      <div class="top-stats">
        <button class="stat" id="population-stat" title="${tr('Bevölkerungsstatistik', 'Population statistics')}">${icon('users')}<span>
    <small>${tr('Einwohner', 'Residents')}</small>
    <strong id="population">0</strong>
    </span>
    <span class="stat-trend" id="population-trend">↗</span>
    </button>
        <button class="stat money-stat" id="budget-stat" title="${tr('Stadthaushalt öffnen', 'Open city budget')}">${icon('wallet')}<span>
    <small>${tr('Stadtkasse', 'City treasury')}</small>
    <strong id="money">0 €</strong>
    </span>
    <span id="balance" class="stat-trend">
    </span>
    </button>
        <button class="stat happiness-stat" id="happiness-stat" title="${tr('Stadtbericht öffnen', 'Open city report')}">${icon('smile')}<span>
    <small>${tr('Zufriedenheit', 'Happiness')}</small>
    <strong id="happiness">0 %</strong>
    </span>
    </button>
      </div>
      <div class="top-actions">${languageControl('language-select')}<button class="icon-btn" id="goals-btn" title="${tr('Ausbaustufen, Aufträge und Challenges', 'City tiers, quests and challenges')}">${icon('flag')}</button>
    <button class="icon-btn" id="sound-toggle" aria-pressed="false" aria-label="${tr('Ton umschalten', 'Toggle sound')}">${icon('volume-x')}</button>
    <button class="icon-btn" id="graphics-btn" title="${tr('Grafik und Beleuchtung', 'Graphics and lighting')}">${icon('monitor-cog')}</button>
    <button class="icon-btn" id="save-btn" title="${tr('Stadt speichern (Strg+S)', 'Save city (Ctrl+S)')}">${icon('save')}</button>
    <button class="icon-btn" id="menu-btn" aria-haspopup="dialog" aria-expanded="${drawerOpen}" title="${tr('Stadtmenü', 'City menu')}">${icon('menu')}</button>
    </div>
    </header>
    <div class="viewbar">
    <div class="view-switch">
    <label for="overlay-select">${icon('layers')}</label>
    <select id="overlay-select" aria-label="${tr('Datenansicht', 'Data view')}">
    <option value="none">${tr('Stadtansicht', 'City view')}</option>
    <option value="power">${tr('Stromversorgung', 'Power supply')}</option>
    <option value="water">${tr('Wasserversorgung', 'Water supply')}</option>
    <option value="landvalue">${tr('Grundstückswert', 'Land value')}</option>
    <option value="pollution">${tr('Umweltbelastung', 'Pollution')}</option>
    <option value="traffic">${tr('Verkehrsdichte', 'Traffic density')}</option>
    <option value="terrain">${tr('Geländehöhen', 'Terrain height')}</option>
    </select>
    <span id="day-clock">14:00</span>
    <span class="view-divider">
    </span>
    <button id="building-lights-btn" title="${tr('Stadtbeleuchtung ein-/ausschalten (L)', 'Toggle city lighting (L)')}" aria-label="${tr('Stadtbeleuchtung', 'City lighting')}" aria-pressed="true">${icon('lightbulb')}</button>
    <button id="grid-btn" title="${tr('Raster einblenden (G)', 'Toggle grid (G)')}" aria-pressed="false">${icon('grid-2x2')}</button>
    <button id="night-btn" title="${tr('Tag / Nacht (N)', 'Day / night (N)')}" aria-pressed="false">${icon('sun')}</button>
    <button id="citizen-life-btn" title="${tr('Stadtleben: Bewohner, Treffen und Feste', 'City life: residents, gatherings and festivals')}" aria-label="${tr('Stadtleben', 'City life')}">${icon('users')}</button>
    </div>
    </div>
    <aside class="left-column">
      <section class="advisor panel" id="advisor">
    <div class="panel-kicker">
    <span>${icon('sprout')} ${tr('DEIN NÄCHSTES KAPITEL', 'YOUR NEXT CHAPTER')}</span>
    <button class="small-icon" id="advisor-close" title="${tr('Hinweise einklappen', 'Collapse advice')}">${icon('minus')}</button>
    </div>
    <h1>${tr('Platz für morgen.', 'Room for tomorrow.')}</h1>
    <p>${tr('Aus einer guten Nachbarschaft wird eine großartige Stadt.', 'A great city grows from a good neighborhood.')}</p>
    <div class="goal-label">
    <span id="goal-title">${tr('Eine Stadt wächst', 'A growing city')}</span>
    <strong id="goal-progress">0 / 5.000</strong>
    </div>
    <div class="progress-track">
    <div id="goal-bar">
    </div>
    </div>
    <div class="goal-reward">${icon('gift')} <span id="goal-reward">${tr('Nächster Meilenstein: 5.000 Einwohner', 'Next milestone: 5,000 residents')}</span>
    </div>
    <div class="advisor-divider">
    </div>
    <div class="checklist">
    <div id="check-roads">${icon('circle')}<span>${tr('Straßen als Verbindung bauen', 'Connect places with roads')}</span>
    </div>
    <div id="check-zones">${icon('circle')}<span>${tr('Raum zum Wohnen schaffen', 'Make room for homes')}</span>
    </div>
    <div id="check-services">${icon('circle')}<span>${tr('Strom und Wasser bereitstellen', 'Supply power and water')}</span>
    </div>
    </div>
    <button class="text-link" id="help-btn">${tr('So funktioniert deine Stadt', 'How your city works')} ${icon('arrow-up-right')}</button>
    </section>
      <section class="demand panel">
    <div class="section-label">${icon('chart-no-axes-combined')} ${tr('NACHFRAGE', 'DEMAND')} <span class="info-dot" title="${tr('Hohe Nachfrage fördert das Wachstum versorgter Zonen.', 'High demand encourages growth in zones with utility access.')}">i</span>
    </div>
    <div class="demand-item">
    <span>
    <b class="dot residential">
    </b>${tr('Wohnen', 'Residential')}</span>
    <div class="demand-track">
    <i id="demand-r">
    </i>
    </div>
    <b id="demand-r-val">
    </b>
    </div>
    <div class="demand-item">
    <span>
    <b class="dot commercial">
    </b>${tr('Gewerbe', 'Commercial')}</span>
    <div class="demand-track">
    <i id="demand-c">
    </i>
    </div>
    <b id="demand-c-val">
    </b>
    </div>
    <div class="demand-item">
    <span>
    <b class="dot industrial">
    </b>${tr('Industrie', 'Industrial')}</span>
    <div class="demand-track">
    <i id="demand-i">
    </i>
    </div>
    <b id="demand-i-val">
    </b>
    </div>
    </section>
      <button class="news-button" id="news-btn">${icon('newspaper')}<span>
    <small>${tr('NEUES AUS LINDENBUCHT', 'NEWS FROM LINDENBUCHT')}</small>
    <strong id="latest-news">${tr('Deine Stadt wartet auf dich.', 'Your city is waiting for you.')}</strong>
    </span>${icon('chevron-right')}</button>
    </aside>
    <div id="overlay-legend" class="panel hidden">
    </div>
    <aside id="inspector" class="panel hidden">
    </aside>
    <div class="camera-controls">
    <button id="pan-btn" title="${tr('Kamera verschieben (M)', 'Move camera (M)')}">${icon('hand')}</button>
    <button id="overview-btn" title="${tr('Ganze Region ansehen', 'View entire region')}">${icon('globe')}</button>
    <button id="zoom-in" title="${tr('Vergrößern', 'Zoom in')}">${icon('plus')}</button>
    <button id="zoom-out" title="${tr('Verkleinern', 'Zoom out')}">${icon('minus')}</button>
    <span>
    </span>
    <button id="rotate-left" title="${tr('Kamera drehen (Q)', 'Rotate camera (Q)')}">${icon('rotate-ccw')}</button>
    <button id="rotate-right" title="${tr('Kamera drehen (E)', 'Rotate camera (E)')}">${icon('rotate-cw')}</button>
    <button id="camera-home" title="${tr('Zur Innenstadt · Kamera zurücksetzen', 'Go downtown · Reset camera')}" aria-label="${tr('Zur Innenstadt · Kamera zurücksetzen', 'Go downtown · Reset camera')}">${icon('scan')}</button>
    <button id="camera-help" title="${tr('Kamera und Maus bedienen', 'Camera and mouse controls')}">${icon('circle-help')}</button>
    </div>
    <div class="map-widget panel">
    <div class="map-heading">
    <span>${icon('map')} REGION</span>
    <span class="north">N ↑</span>
    </div>
    <canvas id="minimap" width="160" height="136" aria-label="${tr('Übersichtskarte; zum Navigieren klicken', 'Overview map; click to navigate')}">
    </canvas>
    <div class="map-caption">Lindenbucht <span>40 × 40</span>
    </div>
    </div>
    <button id="vehicle-hotspot" class="hidden" title="${tr('Dieses Auto selbst fahren', 'Drive this vehicle')}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="2"/>
    <path d="M3.6 8.8 10 12m4 0 6.4-3.2M12 14v7"/>
    </svg>
    <span>${tr('Selbst fahren', 'Drive vehicle')}</span>
    </button>
    <div id="drive-hud" class="drive-hud hidden">
    <strong id="drive-speed">0 <small>km/h</small>
    </strong>
    <div>
    <p>${tr('W / ↑ Beschleunigen · S / ↓ Bremsen', 'W / ↑ Accelerate · S / ↓ Brake')}</p>
    <p>${tr('A / D Lenken · Leertaste + Lenken: Driften', 'A / D Steer · Space + steer: Drift')}</p>
    <p id="drive-status">
    </p>
    </div>
    <button id="exit-drive">${icon('log-out')} ${tr('ESC · Aussteigen', 'ESC · Exit vehicle')}</button>
    </div>
    <div id="build-preview" class="build-preview hidden" aria-live="polite">
    </div>
    <div id="tile-tooltip" class="hidden">
    </div>
    <div id="toast" role="status" class="toast hidden">
    </div>
    <footer class="build-dock">
    <section id="density-picker" class="density-picker" role="region" aria-labelledby="density-title" hidden></section>
    <div class="dock-top">
    <nav class="category-tabs" aria-label="${tr('Baukategorien', 'Build categories')}">${CATEGORIES()
      .map(
        ([
          id,
          ic,
          label,
        ]) => `<button data-category="${id}" class="${id === category ? 'active' : ''}">${icon(ic)}<span>${label}</span>
    </button>`,
      )
      .join('')}</nav>
    <div class="history-buttons">
    <button id="undo-btn" title="${tr('Letzten Bau rückgängig machen (Strg+Z)', 'Undo last construction (Ctrl+Z)')}">${icon('undo-2')}</button>
    <button id="help-shortcut" title="${tr('Spielhilfe (H)', 'Game help (H)')}">${icon('circle-help')}</button>
    </div>
    </div>
    <div class="dock-main">
    <div id="tool-list">
    </div>
    <div class="time-controls">
    <div class="date-display">${icon('calendar-days')}<strong id="game-date">${tr('Januar 2000', 'January 2000')}</strong>
    <span id="season">${tr('SPIELZEIT', 'PLAY TIME')}</span>
    </div>
    <div id="month-progress" class="month-progress" role="progressbar" aria-label="${tr('Fortschritt im Monat', 'Month progress')}" aria-valuemin="0" aria-valuemax="100">
    <i>
    </i>
    </div>
    <div class="speed-buttons">
    <button data-speed="0" title="${tr('Pause (Leertaste)', 'Pause (Space)')}" aria-label="Pause">${icon('pause')}</button>
    <button data-speed="1" title="${tr('Normale Geschwindigkeit', 'Normal speed')}" aria-label="${tr('Normale Geschwindigkeit', 'Normal speed')}">${icon('play')}<span>1×</span>
    </button>
    <button data-speed="2" title="${tr('Doppelte Geschwindigkeit', 'Double speed')}" aria-label="${tr('Doppelte Geschwindigkeit', 'Double speed')}">${icon('fast-forward')}<span>2×</span>
    </button>
    <button data-speed="3" title="${tr('Dreifache Geschwindigkeit', 'Triple speed')}" aria-label="${tr('Dreifache Geschwindigkeit', 'Triple speed')}">${icon('fast-forward')}<span>3×</span>
    </button>
    </div>
    </div>
    </div>
    <div class="dock-bottom">
    <div class="tool-hint" id="tool-hint">
    </div>
    <div class="brush-control" id="brush-control">
    <span>${tr('Pinsel', 'Brush')}</span>
    <button data-brush="1" class="active">1</button>
    <button data-brush="3">3</button>
    <button data-brush="5">5</button>
    <button data-brush="8">8</button>
    </div>
    <button class="rotate-building hidden" id="rotate-building" title="${tr('Gebäude drehen (R)', 'Rotate building (R)')}">${icon('rotate-cw')} <span>${tr('R · Drehen', 'R · Rotate')}</span>
    </button>
    <span class="navigation-hint">${icon('mouse')} ${tr('M / Hand: Bewegen · Rechts: Drehen · Rad: Zoom', 'M / Hand: Move · Right-drag: Rotate · Wheel: Zoom')} <span class="separator">/</span> <span id="autosave-status">${tr('Speicher wird vorbereitet', 'Preparing local storage')}</span>
    </span>
    </div>
    </footer>
    <div id="modal-root">
    </div>
    <input id="import-file" type="file" accept=".json,application/json" hidden/>
    <div id="loading-screen">
    <div class="loading-brand">${icon('building-2')} NEUSTADT</div>
    <span>${tr('Deine Stadt wird lebendig …', 'Your city is coming to life …')}</span>
    <div class="loading-line">
    </div>
    </div>
  </main>`;
  if (world) {
    $('#world').replaceWith(world);
    world.setAttribute(
      'aria-label',
      tr('Interaktive dreidimensionale Stadt', 'Interactive three-dimensional city'),
    );
  }
  if (started) $('#loading-screen').remove();
}
