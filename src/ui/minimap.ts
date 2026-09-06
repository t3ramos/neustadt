import type { CityState, Overlay } from '../domain/types';
import { $ } from './dom';

export function drawMinimap(state: CityState, overlay: Overlay) {
  const c = $<HTMLCanvasElement>('#minimap'),
    ctx = c.getContext('2d')!;
  const colors: Record<string, string> = {
    tree: '#507452',
    water: '#70abbc',
    road: '#ede7d6',
    rail: '#56626b',
    residential: '#85ad71',
    commercial: '#497f93',
    industrial: '#b99556',
    park: '#528c68',
    power: '#cf9b47',
    waterpump: '#548fa9',
    rubble: '#8e6552',
    university: '#a198b3',
    solar: '#476a8b',
    wind: '#d5dcc9',
  };
  const sx = c.width / state.size,
    sy = c.height / state.size;
  for (const t of state.tiles) {
    ctx.fillStyle =
      t.fire > 0
        ? '#eb6651'
        : (colors[t.kind] ??
          (t.kind === 'empty'
            ? `hsl(${94 + t.elevation * 1.5} 22% ${66 - t.elevation * 2}%)`
            : '#d4d4c4'));
    ctx.fillRect(t.x * sx, t.z * sy, Math.ceil(sx), Math.ceil(sy));
    if (overlay === 'water' && t.hasPipe) {
      ctx.fillStyle = '#7cdbe7';
      ctx.fillRect(t.x * sx, t.z * sy, Math.ceil(sx), Math.ceil(sy));
    }
    if (overlay === 'power' && t.hasPowerLine) {
      ctx.fillStyle = t.powered ? '#f5d47a' : '#d97359';
      ctx.fillRect(t.x * sx, t.z * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
}
