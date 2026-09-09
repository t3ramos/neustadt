import { tr, formatNumber } from '../../i18n/index';
import { escape, icon } from '../dom';

import type { CitizenLifeSnapshot } from '../../domain/citizen-life';

const count = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const number = (value: number): string => escape(formatNumber(count(value)));
function duration(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function routineName(key: string): string {
  const names: Record<string, string> = {
    home: tr('Heimweg', 'Home routine'),
    work: tr('Arbeitsweg', 'Work routine'),
    leisure: tr('Freizeit', 'Leisure'),
    social: tr('Treffen', 'Socializing'),
    wandering: tr('Spazieren', 'Strolling'),
  };
  return Object.hasOwn(names, key) ? names[key] : key;
}
const decorativeIcon = (name: string) => `<span aria-hidden="true">${icon(name)}</span>`;

/** Pure drawer content. The host owns actions, live refresh and simulation state. */
export function renderCitizenLifeView(snapshot: CitizenLifeSnapshot, paused = false): string {
  const event = snapshot.event;
  const cooldown = Math.max(0, snapshot.cooldownSeconds || 0);
  const busy = !!event || cooldown > 0 || !!paused || count(snapshot.total) === 0;
  const reason = paused
    ? tr(
        'Setze die Simulation fort, damit sich die Bewohner bewegen.',
        'Resume the simulation so residents can move.',
      )
    : event
      ? tr('Eine Veranstaltung läuft bereits.', 'An event is already in progress.')
      : cooldown > 0
        ? tr(
            `Nächste Einladung in ${duration(cooldown)} Spielzeit.`,
            `Next invitation in ${duration(cooldown)} of simulation time.`,
          )
        : count(snapshot.total) === 0
          ? tr(
              'Sobald Bewohner unterwegs sind, kannst du sie einladen.',
              'Invite residents once they are out and about.',
            )
          : tr(
              'Lade Bewohner ein und beobachte ihren Weg zum Treffpunkt.',
              'Invite residents and watch them walk to the meeting point.',
            );
  const invited = count(event?.invited ?? 0),
    arrived = Math.min(invited, count(event?.arrived ?? 0));
  const eventTitle =
    event?.kind === 'festival'
      ? tr('Stadtfest', 'City festival')
      : tr('Nachbarschaftstreff', 'Neighborhood gathering');
  return `<section class="citizen-life" aria-labelledby="citizen-life-title">
    <header class="citizen-life-heading"><div><p class="citizen-life-eyebrow">${tr('DEINE STADT LEBT', 'YOUR CITY IS ALIVE')}</p><h3 id="citizen-life-title">${tr('Stadtleben', 'City life')}</h3></div><span class="citizen-life-badge">${tr('Freies Spiel', 'Sandbox')}</span></header>
    <p class="citizen-life-intro">${tr('Die sichtbaren Bewohner planen Wege zur Arbeit, nach Hause und in Parks. Veranstaltungen nutzen vorhandene Wege.', 'Visible residents plan routes to work, home and parks. Events use existing paths.')}</p>
    <section class="citizen-life-routines" aria-labelledby="citizen-routine-title"><h4 id="citizen-routine-title">${tr('Gerade in der Stadt', 'Around town now')}<span>${number(snapshot.total)} ${tr('Sichtbare Bewohner', 'Visible residents')}</span></h4><dl>${Object.entries(
      snapshot.counts,
    )
      .map(
        ([key, value]) =>
          `<div><dt>${escape(routineName(key))}</dt><dd>${number(value)}</dd></div>`,
      )
      .join('')}</dl></section>
    ${
      event
        ? `<section class="citizen-life-event" aria-labelledby="citizen-event-title"><div class="citizen-life-event-heading">${decorativeIcon('calendar-heart')}<div><p class="citizen-life-eyebrow">${tr('AKTUELLE VERANSTALTUNG', 'CURRENT EVENT')}</p><h4 id="citizen-event-title">${eventTitle}</h4></div></div>
      <dl class="citizen-life-event-counts"><div><dt>${tr('Eingeladen', 'Invited')}</dt><dd>${number(invited)}</dd></div><div><dt>${tr('Angekommen', 'Arrived')}</dt><dd>${number(arrived)}</dd></div><div><dt>${tr('Restzeit', 'Time left')}</dt><dd>${duration(event.remaining)}</dd></div></dl>
      <label class="citizen-life-progress-label" for="citizen-event-arrivals">${tr('Ankunft am Treffpunkt', 'Arrival at the meeting point')}</label><progress id="citizen-event-arrivals" max="${Math.max(1, invited)}" value="${arrived}"></progress>
      <div class="citizen-life-event-actions"><button type="button" data-citizen-event-focus>${decorativeIcon('map-pin')}${tr('Treffpunkt zeigen', 'Show meeting point')}</button><button type="button" data-citizen-event-stop>${tr('Beenden', 'End event')}</button></div></section>`
        : ''
    }
    <section class="citizen-life-invitations" aria-labelledby="citizen-invite-title"><h4 id="citizen-invite-title">${tr('Etwas gemeinsam erleben', 'Bring people together')}</h4><p id="citizen-event-availability" class="citizen-life-status" role="status" aria-live="polite">${escape(reason)}</p>
      ${paused ? `<button type="button" class="citizen-life-resume" data-citizen-resume>${decorativeIcon('play')}${tr('Simulation fortsetzen', 'Resume simulation')}</button>` : ''}<div class="citizen-life-action-grid"><button type="button" data-citizen-event="gathering" aria-describedby="citizen-event-availability" ${busy ? 'disabled' : ''}>${decorativeIcon('users')}<strong>${tr('Nachbarschaftstreff', 'Neighborhood gathering')}</strong><span>${tr('Ein kleiner Treff im Viertel.', 'A small get-together in the neighborhood.')}</span></button><button type="button" data-citizen-event="festival" aria-describedby="citizen-event-availability" ${busy ? 'disabled' : ''}>${decorativeIcon('party-popper')}<strong>${tr('Stadtfest', 'City festival')}</strong><span>${tr('Ein größerer Anlass für deine Stadt.', 'A bigger occasion for your city.')}</span></button></div>
    </section>
    <p class="citizen-life-note">${tr('Kostenlose Sandbox-Aktionen ohne Geldkosten oder Belohnungen. Vorhandene Bewohner laufen zum Ziel. Wege, Veranstaltungen und Wartezeit schreiten bei laufender Simulation voran.', 'Free sandbox actions with no money cost or rewards. Existing residents walk to the destination. Journeys, events and cooldown advance while the simulation runs.')}</p>
    <button type="button" class="citizen-life-grab" data-citizen-grab>${decorativeIcon('hand')}<span><strong>${tr('Bewohner greifen', 'Pick up a resident')}</strong><small>${tr('Greifwerkzeug öffnen und einen Bewohner auswählen.', 'Open the grab tool and select a resident.')}</small></span>${decorativeIcon('arrow-up-right')}</button>
  </section>`;
}
