import { createElement, icons } from 'lucide';

export function refreshIcons(root?: HTMLElement) {
  (root ?? document).querySelectorAll<HTMLElement>('i[data-lucide]').forEach((el) => {
    const name = el.dataset
      .lucide!.split('-')
      .map((v) => v[0].toUpperCase() + v.slice(1))
      .join('');
    const node = icons[name as keyof typeof icons];
    if (node) {
      const svg = createElement(node);
      svg.setAttribute('stroke-width', '1.65');
      if (el.className) svg.setAttribute('class', el.className);
      el.replaceWith(svg);
    }
  });
}
export const $ = <T extends HTMLElement = HTMLElement>(q: string) => document.querySelector<T>(q)!;
export const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}">
    </i>`;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
