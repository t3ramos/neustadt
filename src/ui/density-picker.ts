import type { Tool, ZoneDensity } from '../domain/types';
import { tr, getLocale } from '../i18n/index';
import { $, icon, refreshIcons } from './dom';
import { toolMetadata } from './tool-metadata';
import './styles/density.css';

export type ZoneTool = Extract<Tool, 'residential' | 'commercial' | 'industrial'>;
export const isZoneTool = (tool: Tool): tool is ZoneTool =>
  tool === 'residential' || tool === 'commercial' || tool === 'industrial';
export function densityLabel(density: ZoneDensity): string {
  return { low: tr('Niedrig', 'Low'), medium: tr('Mittel', 'Medium'), high: tr('Hoch', 'High') }[
    density
  ];
}
const densities: ZoneDensity[] = ['low', 'medium', 'high'];
function caption(tool: ZoneTool, density: ZoneDensity) {
  const captions = {
    residential: [
      tr('Einfamilienhäuser', 'Single-family homes'),
      tr('Wohnblöcke', 'Apartment blocks'),
      tr('Wohntürme', 'Residential towers'),
    ],
    commercial: [
      tr('Kleine Geschäfte', 'Local shops'),
      tr('Geschäftshäuser', 'Office blocks'),
      tr('Bürotürme', 'Office towers'),
    ],
    industrial: [
      tr('Werkstätten', 'Workshops'),
      tr('Fabriken', 'Factories'),
      tr('Industriekomplexe', 'Industrial complexes'),
    ],
  };
  return captions[tool][densities.indexOf(density)];
}

/** Session-only choices: creating or loading a city never rewrites its saved zoning. */
export function createDensityPicker(onChoose: () => void) {
  const choices: Record<ZoneTool, ZoneDensity> = {
    residential: 'low',
    commercial: 'low',
    industrial: 'low',
  };
  let openTool: ZoneTool | null = null;
  let bound = false;
  const close = (focusWorld = false) => {
    openTool = null;
    const panel = document.querySelector<HTMLElement>('#density-picker');
    if (panel) {
      panel.hidden = true;
      delete panel.dataset.contentKey;
    }
    document
      .querySelectorAll('[data-tool][aria-expanded]')
      .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (focusWorld) $('#world').focus({ preventScroll: true });
  };
  const reposition = () => {
    if (!openTool) return;
    const panel = $('#density-picker');
    const anchor = document.querySelector<HTMLElement>(`[data-tool="${openTool}"]`);
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const offsetTop = viewport?.offsetTop ?? 0;
    const panelWidth = Math.min(194, width - 24);
    const left = Math.max(
      offsetLeft + 12,
      Math.min(rect.left + rect.width / 2 - panelWidth / 2, offsetLeft + width - panelWidth - 12),
    );
    panel.style.width = `${panelWidth}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(offsetTop + 12, rect.top - panel.offsetHeight - 10)}px`;
    panel.style.setProperty('--density-origin-x', `${rect.left + rect.width / 2 - left}px`);
  };
  const render = () => {
    const panel = $('#density-picker');
    if (!openTool || !panel) return;
    const zone = openTool;
    const focused = panel.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.density
      : null;
    const contentKey = `${zone}:${choices[zone]}:${getLocale()}`;
    panel.hidden = false;
    panel.dataset.zone = zone;
    if (panel.dataset.contentKey !== contentKey) {
      panel.dataset.contentKey = contentKey;
      panel.innerHTML = `<span id="density-title" class="density-accessible-title">${toolMetadata()[zone].label} · ${tr('Bebauungsdichte', 'Zoning density')}</span><div class="density-options" role="group" aria-labelledby="density-title">${densities.map((density, index) => `<button class="density-option ${density === choices[zone] ? 'selected' : ''}" data-density="${density}" style="--density-step:${index}" aria-pressed="${density === choices[zone]}"><span class="density-building density-building-${density}" aria-hidden="true">${icon(['house', 'building', 'building-2'][index])}</span><span class="density-option-copy"><strong>${densityLabel(density)}</strong><span>${caption(zone, density)}</span></span><span class="density-check" aria-hidden="true">${icon('check')}</span></button>`).join('')}</div>`;
      panel.querySelectorAll<HTMLButtonElement>('[data-density]').forEach((button) => {
        button.onclick = () => {
          choices[zone] = button.dataset.density as ZoneDensity;
          close(true);
          onChoose();
        };
        button.onkeydown = (event) => {
          if (
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
          )
            return;
          event.preventDefault();
          const index = densities.indexOf(button.dataset.density as ZoneDensity);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 2
                : (index + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 2)) % 3;
          panel.querySelector<HTMLButtonElement>(`[data-density="${densities[next]}"]`)!.focus();
        };
      });
      refreshIcons(panel);
      if (focused)
        panel
          .querySelector<HTMLButtonElement>(`[data-density="${focused}"]`)
          ?.focus({ preventScroll: true });
    }
    reposition();
    document.querySelector(`[data-tool="${zone}"]`)?.setAttribute('aria-expanded', 'true');
  };
  const bind = () => {
    if (bound) return;
    bound = true;
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener(
      'keydown',
      (event) => {
        if (!openTool || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (
          !openTool ||
          !(event.target instanceof Element) ||
          event.target.closest('#density-picker')
        )
          return;
        // Dismiss the floating choices before the scene receives this first click; never paint accidentally.
        if (event.target.closest('#world')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          close(true);
        } else close();
      },
      true,
    );
  };
  return {
    selected: (tool: Tool): ZoneDensity | undefined =>
      isZoneTool(tool) ? choices[tool] : undefined,
    close,
    render,
    open(tool: ZoneTool) {
      bind();
      openTool = tool;
      render();
      $('#density-picker')
        .querySelector<HTMLButtonElement>(`[data-density="${choices[tool]}"]`)
        ?.focus({ preventScroll: true });
    },
  };
}
