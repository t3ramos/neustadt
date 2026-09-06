import type { PreviewInfo } from '../domain/types';
import { tr, formatNumber as fmt, formatCurrency as euro } from '../i18n/index';
import { $, icon, escape, refreshIcons } from './dom';
import { toolMetadata } from './tool-metadata';
import { placeFloatingPanel } from './layout';

export function createBuildPreview(getMoney: () => number) {
  let lastPreview: PreviewInfo | null = null;
  function renderBuildPreview(info: PreviewInfo | null) {
    lastPreview = info;
    const el = $('#build-preview');
    if (!info || ['inspect', 'pan', 'citizen'].includes(info.tool)) {
      el.classList.add('hidden');
      return;
    }
    const valid = info.count > 0 && info.cost <= getMoney();
    const dims = info.area ?? info.footprint;
    // Successful previews already show price and size in the summary row. Keep only
    // the partial-placement explanation; failed previews retain their actual reason.
    const feedback = valid
      ? info.invalid.length
        ? info.message.split(' · ').slice(2).join(' · ') || info.message
        : ''
      : info.message;
    const terrain = ['raise', 'lower', 'level'].includes(info.tool);
    const action =
      terrain || info.tool === 'bulldoze'
        ? tr('Loslassen: Anwenden', 'Release: apply')
        : tr('Loslassen: Bauen', 'Release: build');
    el.innerHTML = `<div class="preview-title">${icon(toolMetadata()[info.tool]?.icon ?? 'construction')}<strong>${toolMetadata()[info.tool]?.label ?? info.tool}</strong>${dims ? `<span>${dims[0]} × ${dims[1]}</span>` : ''}</div>
    <div class="preview-cost">
    <b>${euro(info.cost)}</b>
    <span>${fmt(info.valid.length)} ${tr('Felder', 'tiles')}${info.invalid.length ? ` · ${fmt(info.invalid.length)} ${info.message.includes(tr('bereits', 'already')) ? tr('unverändert', 'unchanged') : tr('nicht geändert', 'not changed')}` : ''}</span>
    </div>${feedback ? `<p>${escape(feedback)}</p>` : ''}<small>${terrain && info.elevation !== undefined ? `${tr('Höhe', 'Elevation')}: ${fmt(info.elevation * 10)} m · ` : ''}${info.footprint ? `${tr('R: Drehen', 'R: rotate')} · ` : ''}${action}<br/>${tr('Rechtsklick / Esc: Abbrechen', 'Right-click / Esc: cancel')}</small>`;
    el.className = `build-preview ${valid ? 'valid' : 'invalid'}`;
    refreshIcons(el);
    positionBuildPreview();
  }
  function positionBuildPreview() {
    const el = $('#build-preview'),
      info = lastPreview;
    if (!info || el.classList.contains('hidden')) return;
    const viewport = window.visualViewport,
      left = (viewport?.offsetLeft ?? 0) + 8,
      right = left + (viewport?.width ?? window.innerWidth) - 16;
    const top = Math.max(
      (viewport?.offsetTop ?? 0) + 8,
      $('.topbar').getBoundingClientRect().bottom + 8,
    );
    const bottom = Math.min(
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8,
      $('.build-dock').getBoundingClientRect().top - 8,
    );
    el.style.maxWidth = `${Math.max(1, right - left)}px`;
    const measured = el.getBoundingClientRect();
    const obstacles = [
      ...document.querySelectorAll<HTMLElement>(
        '.viewbar,.left-column,.camera-controls,.map-widget,#inspector,#overlay-legend',
      ),
    ]
      .filter(
        (control) => control.getClientRects().length > 0 && !control.classList.contains('hidden'),
      )
      .map((control) => control.getBoundingClientRect());
    const position = placeFloatingPanel(
      {
        left,
        top,
        right,
        bottom: Math.max(top + measured.height, bottom),
      },
      { width: measured.width, height: measured.height },
      { x: info.screenX, y: info.screenY },
      obstacles,
    );
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
  }
  return {
    render: renderBuildPreview,
    reposition: positionBuildPreview,
    get current() {
      return lastPreview;
    },
  };
}
