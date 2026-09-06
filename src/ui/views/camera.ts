import { tr } from '../../i18n/index';
import { icon } from '../dom';

export function renderCameraView() {
  return `<div class="camera-guide">${[
    [
      'hand',
      tr('M · Bewegen', 'M · Pan'),
      tr(
        'Wähle die Hand oder drücke M. Dann mit der linken Maustaste ziehen. Alternativ: mittlere Maustaste oder Alt + links.',
        'Select the hand or press M, then drag with the left mouse button. You can also use the middle mouse button or Alt + left drag.',
      ),
    ],
    [
      'move',
      tr('W A S D · Navigieren', 'W A S D · Navigate'),
      tr(
        'Bewege die Kamera über die Region. Die Pfeiltasten funktionieren ebenfalls.',
        'Move the camera across the region. The arrow keys work too.',
      ),
    ],
    [
      'grid-2x2',
      tr('Zonen · Rechteck aufziehen', 'Zones · Drag a rectangle'),
      tr(
        'Wohnen, Gewerbe und Industrie von einer Ecke zur anderen ziehen. Loslassen baut die markierte Fläche.',
        'Drag residential, commercial, or industrial zones from one corner to the other. Release to build the selected area.',
      ),
    ],
    [
      'undo-2',
      tr('Rechtsklick / Esc · Bau abbrechen', 'Right-click / Esc · Cancel construction'),
      tr(
        'Verwirf den aktuellen Entwurf und baue mit demselben Werkzeug weiter. Mit V oder Auswählen wechselst du zur Grundstücksauswahl.',
        'Discard the current draft and keep building with the same tool. Press V or choose Select to inspect plots.',
      ),
    ],
    [
      'rotate-cw',
      tr('Rechts ziehen · Drehen', 'Right drag · Rotate'),
      tr(
        'Ohne aktiven Bauentwurf die rechte Maustaste gedrückt halten und ziehen. Q und E drehen in festen Schritten.',
        'Without an active construction draft, hold the right mouse button and drag. Q and E rotate in fixed steps.',
      ),
    ],
    [
      'zoom-in',
      tr('Mausrad · Zoomen', 'Mouse wheel · Zoom'),
      tr(
        'Scrolle zum Vergrößern und Verkleinern. Die Minikarte bringt dich direkt an einen Ort.',
        'Scroll to zoom in and out. Click the minimap to jump to a location.',
      ),
    ],
    [
      'globe',
      tr('Region · Überblick', 'Region · Overview'),
      tr(
        'Die Weltkugel zeigt die ganze Region. Wirkt der Blickwinkel ungewohnt, setzt das Fadenkreuz die Kamera zurück und bringt dich zur Innenstadt.',
        'The globe shows the entire region. If the viewing angle feels unfamiliar, the crosshair resets the camera and takes you downtown.',
      ),
    ],
    [
      'rotate-cw',
      tr('R · Gebäude drehen', 'R · Rotate buildings'),
      tr(
        'Wähle ein großes Gebäude und drehe seine komplette Baufläche mit R.',
        'Select a large building and press R to rotate its entire footprint.',
      ),
    ],
    [
      'car',
      tr('Selbst fahren', 'Drive a vehicle'),
      tr(
        'Zeige auf ein Fahrzeug und klicke auf das Lenkrad. W/S beschleunigt und bremst, A/D lenkt; Esc steigt aus.',
        'Point at a vehicle and click the steering wheel. W/S accelerate and brake, A/D steer, and Esc exits.',
      ),
    ],
    [
      'rotate-ccw',
      tr('Handbremse · Driften', 'Handbrake · Drift'),
      tr(
        'Halte bei etwas Tempo die Leertaste und lenke. Beim Loslassen finden die Reifen wieder Halt.',
        'At speed, hold Space and steer. Release it to let the tires regain grip.',
      ),
    ],
    [
      'lightbulb',
      tr('L · Stadtbeleuchtung', 'L · City lighting'),
      tr(
        'Schalte Fenster und versorgte Straßenlaternen über die Glühbirne oder Taste L.',
        'Toggle windows and powered streetlights using the lightbulb or the L key.',
      ),
    ],
    [
      'person-standing',
      tr('C · Bewohner greifen', 'C · Pick up residents'),
      tr(
        'Greife eine Figur und hebe sie mit der Maus an. Sanft absetzen lässt sie weiterlaufen; ein kräftiger Wurf kann sie töten.',
        'Pick up a resident and lift them with the mouse. Put them down gently to let them keep walking; a hard throw can kill them.',
      ),
    ],
  ]
    .map(
      ([ic, title, desc]) => `<article>${icon(ic)}<div>
    <h3>${title}</h3>
    <p>${desc}</p>
    </div>
    </article>`,
    )
    .join('')}</div>
    <button id="camera-use-pan" class="button primary full">${icon('hand')} ${tr('Kamera jetzt bewegen', 'Move the camera now')}</button>`;
}
