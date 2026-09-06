import { tr } from '../i18n/index';
import { icon, refreshIcons } from './dom';
/** Previewing a landmark never adopts or saves the showcase city. */

export function showWelcomePreview(onReturn: () => void): void {
  dismissWelcomePreview();
  const panel = document.createElement('aside');
  panel.id = 'welcome-preview';
  panel.className = 'welcome-preview';
  panel.innerHTML = `<span>${tr('Easter Egg · Vorschau', 'Easter Egg · Preview')}</span>
    <button class="button primary">${icon('arrow-left')} ${tr('Zur Stadtauswahl', 'Back to city selection')}</button>`;
  panel.querySelector('button')!.onclick = onReturn;
  document.getElementById('game')!.appendChild(panel);
  refreshIcons(panel);
  panel.querySelector('button')!.focus();
}

export function dismissWelcomePreview(): void {
  document.getElementById('welcome-preview')?.remove();
}
