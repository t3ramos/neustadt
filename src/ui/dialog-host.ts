import { $, icon, refreshIcons } from './dom';
import { captureFocus, restoreFocus, modalFocusables, type FocusReference } from './focus';
import { destroySelectMenus } from './select-menu';
import { languageControl } from './views/language';
import { tr } from '../i18n/index';
interface DialogOptions {
  awaitingStart: () => boolean;
  beforeOpen: () => void;
  renderPage: () => void;
  wireLanguageControls: () => void;
}
/** Modal focus, inertness, drawer navigation and scroll restoration share one lifecycle. */

export function createDialogHost(options: DialogOptions) {
  let modal = '';
  let drawerOpen = false;
  let drawerHasEntered = false;
  let modalInvoker: FocusReference | null = null;
  let renderedModal = '';
  function setModalInert(enabled: boolean) {
    for (const child of $('#game').children)
      if (child instanceof HTMLElement && child.id !== 'modal-root') child.inert = enabled;
  }
  function openModal(type: string) {
    const navigationFocus =
      drawerOpen && document.activeElement?.closest('[data-drawer-page]') ? captureFocus() : null;
    if (!modal) modalInvoker = captureFocus();
    if (type === 'menu') drawerOpen = true;
    options.beforeOpen();
    modal = type;
    options.renderPage();
    if (navigationFocus) restoreFocus(navigationFocus, $('#modal-root'));
  }
  function closeModal(force = false) {
    if (!force && options.awaitingStart() && modal === 'welcome') return;
    if (!force && options.awaitingStart() && modal === 'newcity') {
      openModal('welcome');
      return;
    }
    destroySelectMenus($('#modal-root'));
    document.body.classList.remove('welcoming');
    modal = '';
    renderedModal = '';
    drawerOpen = false;
    drawerHasEntered = false;
    $('#modal-root').innerHTML = '';
    setModalInert(false);
    $('#menu-btn')?.setAttribute('aria-expanded', 'false');
    if (!restoreFocus(modalInvoker)) $('#world').focus({ preventScroll: true });
    modalInvoker = null;
  }
  function modalScroller() {
    return $('.drawer-body') ?? $('.modal');
  }
  function drawerNavigation() {
    const pages = [
      ['menu', 'building-2', tr('Meine Stadt', 'My city')],
      ['budget', 'landmark', tr('Haushalt', 'Budget')],
      ['reports', 'chart-no-axes-combined', tr('Berichte', 'Reports')],
      ['citizen-life', 'users', tr('Stadtleben', 'City life')],
      ['graphics', 'cloud-sun', tr('Wetter & Licht', 'Weather & light')],
      ['audio', 'music-2', tr('Klang & Musik', 'Sound & music')],
      ['disaster', 'flame', tr('Katastrophen', 'Disasters')],
      ['progression', 'flag', tr('Stadtziele', 'City goals')],
      ['news', 'newspaper', tr('Journal', 'Journal')],
      ['camera', 'hand', tr('Steuerung', 'Controls')],
      ['help', 'circle-help', tr('Spielhilfe', 'Game help')],
    ];
    return `<nav class="drawer-nav" aria-label="${tr('Stadtverwaltung', 'City management')}">${pages
      .map(
        ([
          id,
          glyph,
          label,
        ]) => `<button data-drawer-page="${id}" ${modal === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>
    </button>`,
      )
      .join('')}</nav>`;
  }
  function modalShell(title: string, kicker: string, body: string, wide = false) {
    const previous = modalScroller(),
      sameModal = renderedModal === modal;
    const priorFocus = sameModal ? captureFocus() : null,
      priorIndex = sameModal
        ? modalFocusables().indexOf(document.activeElement as HTMLElement)
        : -1;
    const scroll = sameModal ? (previous?.scrollTop ?? 0) : 0;
    destroySelectMenus($('#modal-root'));
    const enteringDrawer = drawerOpen && !drawerHasEntered;
    drawerHasEntered = drawerOpen;
    $('#modal-root').innerHTML =
      `<div class="modal-backdrop ${drawerOpen ? 'drawer-backdrop' : ''}">
    <section class="modal ${wide ? 'wide' : ''} ${drawerOpen ? 'city-drawer' : ''} ${enteringDrawer ? 'drawer-enter' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
    <header class="modal-header">
    <div>
    <span class="eyebrow">${kicker}</span>
    <h2>${title}</h2>
    </div>
    <div class="modal-header-actions">${languageControl('modal-language-select')}<button class="icon-btn close-modal" title="${tr('Schließen', 'Close')}">${icon('x')}</button>
    </div>
    </header>${drawerOpen ? `${drawerNavigation()}<div class="drawer-body">${body}</div>` : body}</section>
    </div>`;
    document.body.classList.toggle('welcoming', options.awaitingStart());
    renderedModal = modal;
    $('.modal-backdrop').classList.toggle('welcome-backdrop', modal === 'welcome');
    $('.modal').classList.toggle('welcome-panel', modal === 'welcome');
    setModalInert(true);
    $('.close-modal').onclick = () => closeModal();
    $('.modal-backdrop').onclick = (e) => {
      if (e.target === $('.modal-backdrop')) closeModal();
    };
    refreshIcons($('#modal-root'));
    options.wireLanguageControls();
    $('#menu-btn')?.setAttribute('aria-expanded', String(drawerOpen));
    document
      .querySelectorAll<HTMLButtonElement>('[data-drawer-page]')
      .forEach((button) => (button.onclick = () => openModal(button.dataset.drawerPage!)));
    if (!restoreFocus(priorFocus, $('#modal-root')))
      (priorIndex >= 0
        ? modalFocusables()[Math.min(priorIndex, modalFocusables().length - 1)]
        : null
      )?.focus({ preventScroll: true });
    if (!$('#modal-root').contains(document.activeElement))
      $('.close-modal').focus({ preventScroll: true });
    modalScroller().scrollTop = scroll;
  }
  return {
    open: openModal,
    close: closeModal,
    render: modalShell,
    scroller: modalScroller,
    get page() {
      return modal;
    },
    get drawerOpen() {
      return drawerOpen;
    },
  };
}
