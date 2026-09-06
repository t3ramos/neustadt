import { tr } from '../../i18n/index';
import { icon } from '../dom';

export function renderHelpView() {
  return `<div class="help-cover">
    <img src="${import.meta.env.BASE_URL}assets/neustadt-cover.png" alt="${tr('Originales 3D-Stadtmotiv von Neustadt', 'Original 3D city artwork from Neustadt')}"/>
    <div>
    <span>${tr('DEIN KLEINES STÜCK ZUKUNFT', 'YOUR LITTLE PIECE OF THE FUTURE')}</span>
    <h3>${tr('Baue. Verbinde.<br>Lass es wachsen.', 'Build. Connect.<br>Watch it grow.')}</h3>
    </div>
    </div>
    <div class="help-steps">${[
      [
        '01',
        'route',
        tr('Verbinde deine Stadt', 'Connect your city'),
        tr(
          'Ziehe Straßen über das Land. Große Gebäude benötigen ihre gesamte Baufläche; mit R kannst du sie drehen. Zonen brauchen einen Straßenanschluss, damit Menschen einziehen und Unternehmen entstehen.',
          'Draw roads across the land. Large buildings need their entire footprint; press R to rotate them. Zones need road access so residents can move in and businesses can open.',
        ),
      ],
      [
        '02',
        'house',
        tr('Gib Ideen einen Platz', 'Make room for ideas'),
        tr(
          'Ziehe Wohn-, Gewerbe- und Industriezonen als Rechteck auf und lasse zum Bauen los. Rechtsklick oder Esc verwirft den Entwurf; das Werkzeug bleibt aktiv. Achte auf die Nachfrage: Gebäude entstehen von selbst.',
          'Drag residential, commercial, and industrial zones as rectangles and release to build. Right-click or Esc cancels the draft and keeps your tool active. Watch demand: buildings appear on their own.',
        ),
      ],
      [
        '03',
        'zap',
        tr('Sorge für das Wesentliche', 'Provide the essentials'),
        tr(
          'Verbinde Kraftwerke über Stromleitungen mit deinen Baublöcken und Wasserwerke über unterirdische Rohre. Eine angrenzende Stromleitung versorgt den ganzen zusammenhängenden Block; Straßen trennen die Blöcke. Nur große Gebäude haben sichtbare Anschlusskabel, die nie über Straßen führen. Schulen, Kliniken, Polizei und Parks machen die Stadt lebenswert.',
          'Connect power plants to your building blocks with power lines, and waterworks with underground pipes. A power line beside a connected block powers the entire block; roads separate blocks. Only large buildings have visible service cables, and those never cross roads. Schools, clinics, police, and parks improve quality of life.',
        ),
      ],
      [
        '04',
        'chart-no-axes-combined',
        tr('Denke einen Schritt weiter', 'Plan one step ahead'),
        tr(
          'Erfülle Aufträge, hole Belohnungen ab und entwickle deine Kleinstadt über die Großstadt zur Metropole. Im Stadtziel wartet eine lebenswerte Stadt für 25.000 Menschen.',
          'Complete quests, collect rewards, and grow your small town into a city and then a metropolis. Your city goal is a great place to live for 25,000 people.',
        ),
      ],
    ]
      .map(
        ([num, ic, title, desc]) => `<article>
    <span>${num}</span>
    <div>
    <h3>${icon(ic)} ${title}</h3>
    <p>${desc}</p>
    </div>
    </article>`,
      )
      .join('')}</div>
    <div class="keyboard-help">
    <span>
    <kbd>${tr('Leertaste', 'Space')}</kbd> ${tr('Pause', 'Pause')}</span>
    <span>
    <kbd>Esc</kbd> ${tr('Bau abbrechen · Werkzeug behalten', 'Cancel construction · keep tool')}</span>
    <span>
    <kbd>V</kbd> ${tr('Auswählen', 'Select')}</span>
    <span>
    <kbd>1–5</kbd> ${tr('Bauen', 'Build')}</span>
    <span>
    <kbd>B</kbd> ${tr('Abreißen', 'Bulldoze')}</span>
    <span>
    <kbd>Q / E</kbd> ${tr('Drehen', 'Rotate')}</span>
    <span>
    <kbd>G</kbd> ${tr('Raster', 'Grid')}</span>
    <span>
    <kbd>${tr('Strg Z', 'Ctrl Z')}</kbd> ${tr('Rückgängig', 'Undo')}</span>
    </div>
    <button class="button primary full" id="start-playing">${tr('Meine Stadt gestalten', 'Create my city')} ${icon('arrow-right')}</button>`;
}
