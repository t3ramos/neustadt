/** Menu-local discovery sequence; every fresh menu starts locked. */
const discoveryKeys = [66, 67, 73, 83];
export function advanceLandmarkDiscovery(progress: number, key: string): number {
  const code = key.length === 1 ? key.toUpperCase().charCodeAt(0) : -1;
  return code === discoveryKeys[progress] ? progress + 1 : code === discoveryKeys[0] ? 1 : 0;
}
export function bindLandmarkDiscovery() {
  const progress = new WeakMap<HTMLElement, number>();
  document.addEventListener(
    'keydown',
    (event) => {
      const slot = document.getElementById('menu-landmark-secret');
      if (!slot || !slot.hidden || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const next = advanceLandmarkDiscovery(progress.get(slot) ?? 0, event.key);
      progress.set(slot, next);
      if (next > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (next === discoveryKeys.length) {
        slot.hidden = false;
        slot.querySelector<HTMLButtonElement>('button')?.focus();
      }
    },
    true,
  );
}
