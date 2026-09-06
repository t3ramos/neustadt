import type { CityState } from '../domain/types';
import { recalculate, takeLoan, repayLoan } from '../simulation/city-simulation';
import { formatNumber as fmt } from '../i18n/index';
import { $ } from './dom';

export function bindBudgetControls(
  state: CityState,
  changed: () => void,
  refreshPage: () => void,
  toast: (message: string, type: 'good' | 'warning') => void,
) {
  $('#tax-slider').oninput = (e) => {
    state.tax = Number((e.target as HTMLInputElement).value);
    $('#tax-value').textContent = `${fmt(state.tax)} %`;
    recalculate(state);
    changed();
  };
  $('#tax-slider').onchange = () => rerenderKeepingFocus(refreshPage, 'tax-slider');
  document.querySelectorAll<HTMLInputElement>('[data-funding]').forEach((el) => {
    el.oninput = () => {
      const key = el.dataset.funding as keyof CityState['funding'];
      state.funding[key] = Number(el.value);
      $(`#funding-${key}-value`).textContent = `${fmt(Number(el.value))} %`;
      recalculate(state);
      changed();
    };
    el.onchange = () => rerenderKeepingFocus(refreshPage, el.id);
  });
  $('#take-loan').onclick = () => {
    const r = takeLoan(state);
    if (r.ok) changed();
    toast(r.message, r.ok ? 'good' : 'warning');
    refreshPage();
  };
  $('#repay-loan').onclick = () => {
    const r = repayLoan(state);
    if (r.ok) changed();
    toast(r.message, r.ok ? 'good' : 'warning');
    refreshPage();
  };
}

function rerenderKeepingFocus(refreshPage: () => void, id: string) {
  const value = $<HTMLInputElement>('#' + id)?.value;
  refreshPage();
  const el = $<HTMLInputElement>('#' + id);
  if (el) {
    if (value !== undefined) el.value = value;
    el.focus({ preventScroll: true });
  }
}
