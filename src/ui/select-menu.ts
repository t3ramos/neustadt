/** Custom, select-only comboboxes retaining native select values and change events. */
const selector = 'select:not([multiple]):not([data-native-select])';
const menus = new Map<HTMLSelectElement, SelectMenu>();
let opened: SelectMenu | undefined;
let serial = 0;
let observer: MutationObserver | undefined;

class SelectMenu {
  readonly trigger = document.createElement('button');
  readonly popup = document.createElement('div');
  private active = -1;
  private search = '';
  private searchTime = 0;
  private frame = 0;
  private readonly abort = new AbortController();
  private readonly oldTabIndex: string | null;
  private readonly oldHidden: string | null;
  private readonly oldDisplay: string;
  private readonly labelLinks: HTMLLabelElement[] = [];

  constructor(readonly select: HTMLSelectElement) {
    this.oldTabIndex = select.getAttribute('tabindex');
    this.oldHidden = select.getAttribute('aria-hidden');
    this.oldDisplay = select.style.display;
    const id = select.id ? `${select.id}-options` : `select-menu-${++serial}`;
    const label =
      select.getAttribute('aria-label') ||
      [...(select.labels ?? [])]
        .map((label) =>
          [...label.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' ')
            .trim(),
        )
        .filter(Boolean)
        .join(' ') ||
      select.name ||
      'Selection';
    this.trigger.type = 'button';
    this.trigger.id = select.id ? `${select.id}-trigger` : `${id}-trigger`;
    this.trigger.className = 'select-menu-trigger';
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', id);
    this.trigger.setAttribute('aria-label', label);
    if (select.hasAttribute('aria-labelledby'))
      this.trigger.setAttribute('aria-labelledby', select.getAttribute('aria-labelledby')!);
    this.trigger.dataset.selectId = select.id;
    this.popup.id = id;
    this.popup.className = 'select-menu-popup';
    this.popup.setAttribute('role', 'listbox');
    this.popup.setAttribute('aria-label', label);
    this.popup.hidden = true;
    if (select.matches('[data-language-select],#language-select')) {
      this.trigger.classList.add('select-menu-language');
      this.popup.classList.add('select-menu-language-popup');
    }
    for (const label of select.labels ?? [])
      if (label.htmlFor === select.id && select.id) this.labelLinks.push(label);
    this.labelLinks.forEach((label) => (label.htmlFor = this.trigger.id));
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.style.display = 'none';
    select.after(this.trigger);
    const signal = this.abort.signal;
    this.trigger.addEventListener('click', () => (opened === this ? this.close() : this.open()), {
      signal,
    });
    this.trigger.addEventListener('keydown', (event) => this.keydown(event), { signal });
    this.trigger.addEventListener('blur', () => this.close(), { signal });
    select.addEventListener('change', () => this.sync(), { signal });
    this.popup.addEventListener('pointerdown', (event) => event.preventDefault(), { signal });
    this.popup.addEventListener(
      'click',
      (event) => {
        const option = (event.target as Element).closest<HTMLElement>('[data-option-index]');
        if (option) this.commit(Number(option.dataset.optionIndex));
      },
      { signal },
    );
    this.sync();
  }

  private optionLabel(option: HTMLOptionElement) {
    return this.trigger.classList.contains('select-menu-language')
      ? ({ de: 'Deutsch', en: 'English' }[option.value] ?? option.label)
      : option.label;
  }
  private enabled(index: number) {
    const option = this.select.options[index];
    return (
      !!option &&
      !option.disabled &&
      !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) &&
      !option.hidden
    );
  }
  sync() {
    const option = this.select.selectedOptions[0];
    this.trigger.textContent = option
      ? this.trigger.classList.contains('select-menu-language')
        ? option.value.toUpperCase()
        : option.label
      : '—';
    this.trigger.disabled = this.select.disabled;
    this.trigger.setAttribute('aria-required', String(this.select.required));
    this.trigger.setAttribute('aria-invalid', this.select.getAttribute('aria-invalid') ?? 'false');
    this.trigger.title = option ? this.optionLabel(option) : '';
    if (opened === this) {
      if (this.select.disabled) this.close();
      else {
        this.renderOptions();
        this.position();
      }
    }
  }
  private renderOptions() {
    this.popup.replaceChildren(
      ...[...this.select.options].map((option, index) => {
        const row = document.createElement('div');
        row.id = `${this.popup.id}-option-${index}`;
        row.className = 'select-menu-option';
        row.dataset.optionIndex = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(index === this.select.selectedIndex));
        row.setAttribute('aria-disabled', String(!this.enabled(index)));
        row.hidden = option.hidden;
        row.textContent = this.optionLabel(option);
        if (option.lang) row.lang = option.lang;
        return row;
      }),
    );
    this.highlight(this.active);
  }
  private highlight(index: number) {
    this.active = index;
    this.popup
      .querySelectorAll<HTMLElement>('[data-option-index]')
      .forEach((row) =>
        row.classList.toggle('is-active', Number(row.dataset.optionIndex) === index),
      );
    const row = this.popup.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
    if (row) {
      this.trigger.setAttribute('aria-activedescendant', row.id);
      if (row.offsetTop < this.popup.scrollTop) this.popup.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > this.popup.scrollTop + this.popup.clientHeight)
        this.popup.scrollTop = row.offsetTop + row.offsetHeight - this.popup.clientHeight;
    } else this.trigger.removeAttribute('aria-activedescendant');
  }
  private open() {
    if (this.select.disabled) return;
    opened?.close();
    opened = this;
    this.search = '';
    this.active = this.enabled(this.select.selectedIndex)
      ? this.select.selectedIndex
      : [...this.select.options].findIndex((_, index) => this.enabled(index));
    // A manual HTML popover lives in the top layer while remaining in the dialog's
    // accessibility subtree. This is our styled list, never an OS select menu.
    const topLayer = typeof this.popup.showPopover === 'function';
    if (topLayer) this.popup.setAttribute('popover', 'manual');
    (topLayer
      ? (this.select.closest('[role="dialog"],dialog') ?? document.body)
      : document.body
    ).append(this.popup);
    this.popup.hidden = false;
    if (topLayer) this.popup.showPopover();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.renderOptions();
    this.position();
    this.highlight(this.active);
    this.trigger.focus({ preventScroll: true });
    // Tracking also handles an animated drawer without transformed fixed-position ancestors.
    const track = () => {
      if (opened !== this) return;
      if (!this.select.isConnected || !this.trigger.getClientRects().length) {
        this.close();
        return;
      }
      this.position();
      this.frame = requestAnimationFrame(track);
    };
    this.frame = requestAnimationFrame(track);
  }
  close() {
    cancelAnimationFrame(this.frame);
    if (typeof this.popup.hidePopover === 'function' && this.popup.matches(':popover-open'))
      this.popup.hidePopover();
    this.popup.hidden = true;
    this.popup.remove();
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant');
    if (opened === this) opened = undefined;
  }
  private position() {
    const rect = this.trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth,
      height = viewport?.height ?? window.innerHeight;
    const gap = 7,
      margin = 10;
    this.popup.style.width = `${Math.max(0, Math.min(Math.max(rect.width, this.trigger.classList.contains('select-menu-language') ? 180 : 240), width - margin * 2))}px`;
    const below = top + height - rect.bottom - gap - margin,
      above = rect.top - top - gap - margin;
    const desired = Math.min(this.popup.scrollHeight || 300, 330);
    const upwards = below < desired && above > below;
    this.popup.style.maxHeight = `${Math.max(0, Math.min(330, upwards ? above : below))}px`;
    this.popup.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - this.popup.offsetWidth - margin))}px`;
    this.popup.style.top = `${Math.max(top + margin, upwards ? rect.top - gap - this.popup.offsetHeight : rect.bottom + gap)}px`;
    this.popup.dataset.side = upwards ? 'above' : 'below';
  }
  private commit(index: number) {
    if (!this.enabled(index)) return;
    const changed = this.select.selectedIndex !== index;
    this.select.selectedIndex = index;
    this.close();
    this.sync();
    this.trigger.focus({ preventScroll: true });
    if (changed) {
      this.select.dispatchEvent(new Event('input', { bubbles: true }));
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  private keydown(event: KeyboardEvent) {
    // Prevent the game's letter shortcuts and dialog Escape from consuming select navigation.
    if (event.key !== 'Escape' || opened === this) event.stopPropagation();
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (event.key === 'Escape') {
      if (opened === this) {
        event.preventDefault();
        this.close();
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (opened === this) this.commit(this.active);
      else this.open();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const wasOpen = opened === this;
      if (!wasOpen) this.open();
      const indices = [...this.select.options]
        .map((_, index) => index)
        .filter((index) => this.enabled(index));
      if (!indices.length) return;
      const current = indices.indexOf(this.active);
      const index =
        event.key === 'Home'
          ? indices[0]
          : event.key === 'End'
            ? indices.at(-1)!
            : !wasOpen
              ? this.active
              : indices[
                  Math.max(
                    0,
                    Math.min(indices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                  )
                ];
      this.highlight(index);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (opened !== this) this.open();
      const now = Date.now();
      this.search = now - this.searchTime > 700 ? event.key : this.search + event.key;
      this.searchTime = now;
      const query = [...this.search].every((char) => char === this.search[0])
        ? this.search[0]
        : this.search;
      for (let offset = 1; offset <= this.select.options.length; offset++) {
        const index = (this.active + offset) % this.select.options.length;
        if (
          this.enabled(index) &&
          this.optionLabel(this.select.options[index])
            .toLocaleLowerCase()
            .startsWith(query.toLocaleLowerCase())
        ) {
          this.highlight(index);
          break;
        }
      }
    }
  }
  destroy() {
    this.close();
    this.abort.abort();
    this.trigger.remove();
    this.labelLinks.forEach((label) => {
      if (label.htmlFor === this.trigger.id) label.htmlFor = this.select.id;
    });
    this.select.style.display = this.oldDisplay;
    if (this.oldTabIndex === null) this.select.removeAttribute('tabindex');
    else this.select.setAttribute('tabindex', this.oldTabIndex);
    if (this.oldHidden === null) this.select.removeAttribute('aria-hidden');
    else this.select.setAttribute('aria-hidden', this.oldHidden);
  }
}

function prune() {
  for (const [select, menu] of menus)
    if (!select.isConnected) {
      menu.destroy();
      menus.delete(select);
    }
}
function outside(event: PointerEvent) {
  if (
    opened &&
    event.target instanceof Node &&
    !opened.trigger.contains(event.target) &&
    !opened.popup.contains(event.target)
  )
    opened.close();
}
/** Call after inserting markup (before or after attaching select onchange handlers). */
export function enhanceSelectMenus(root: ParentNode = document) {
  prune();
  const selects = [...root.querySelectorAll<HTMLSelectElement>(selector)];
  if (root instanceof HTMLSelectElement && root.matches(selector)) selects.unshift(root);
  for (const select of selects) if (!menus.has(select)) menus.set(select, new SelectMenu(select));
  if (!observer && menus.size) {
    observer = new MutationObserver(prune);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', outside, true);
  }
  syncSelectMenus(root);
}
/** Call after programmatic select.value/selectedIndex changes. */
export function syncSelectMenus(root: ParentNode = document) {
  prune();
  for (const [select, menu] of menus) if (root === select || root.contains(select)) menu.sync();
}
/** Optional explicit teardown; detached controls are also automatically collected. */
export function destroySelectMenus(root: ParentNode = document) {
  for (const [select, menu] of menus)
    if (root === select || root.contains(select)) {
      menu.destroy();
      menus.delete(select);
    }
  if (!menus.size) {
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener('pointerdown', outside, true);
  }
}
