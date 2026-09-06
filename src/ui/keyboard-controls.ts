import type { Tool } from '../domain/types';
import { modalFocusables } from './focus';
export type KeyboardIntent =
  | {
      type: 'save' | 'undo' | 'escape' | 'pause' | 'help';
    }
  | {
      type: 'tool';
      tool: Tool;
    }
  | {
      type: 'rotate';
      direction: number;
    }
  | {
      type: 'click';
      id: string;
    };
interface KeyboardContext {
  modal: boolean;
  driving: boolean;
  awaitingStart: boolean;
  rotatable: boolean;
}
/** Keyboard routing owns browser defaults and focus gates, not city mutations. */

export function bindKeyboardControls(
  context: () => KeyboardContext,
  dispatch: (intent: KeyboardIntent) => void,
): () => void {
  const onKey = (event: KeyboardEvent) => {
    const state = context();
    const target = event.target instanceof Element ? event.target : null;
    const editable = !!target?.closest('input,select,textarea,[contenteditable="true"]');
    const control = !!target?.closest(
      'button,a[href],input,select,textarea,[role="button"],[contenteditable="true"]',
    );
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (state.modal && event.key === 'Tab') {
      const focusable = modalFocusables();
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
      return;
    }
    if (command && !event.altKey && !event.shiftKey && key === 's') {
      event.preventDefault();
      if (!event.repeat) dispatch({ type: 'save' });
      return;
    }
    if (event.key === 'Escape') {
      if (event.repeat) return;
      event.preventDefault();
      dispatch({ type: 'escape' });
      return;
    }
    if (
      !state.awaitingStart &&
      command &&
      !event.altKey &&
      !event.shiftKey &&
      key === 'z' &&
      !editable &&
      !state.modal &&
      !state.driving
    ) {
      event.preventDefault();
      if (!event.repeat) dispatch({ type: 'undo' });
      return;
    }
    if (
      state.awaitingStart ||
      control ||
      state.modal ||
      state.driving ||
      command ||
      event.altKey ||
      event.shiftKey ||
      event.repeat
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      dispatch({ type: 'pause' });
      return;
    }
    if (key === 'r' && state.rotatable) {
      event.preventDefault();
      dispatch({ type: 'click', id: 'rotate-building' });
      return;
    }
    const tools: Record<string, Tool> = {
      m: 'pan',
      c: 'citizen',
      '1': 'road',
      '2': 'residential',
      '3': 'commercial',
      '4': 'industrial',
      '5': 'park',
      b: 'bulldoze',
      v: 'inspect',
    };
    if (tools[key]) {
      event.preventDefault();
      dispatch({ type: 'tool', tool: tools[key] });
      return;
    }
    if (key === 'q' || key === 'e') dispatch({ type: 'rotate', direction: key === 'q' ? -1 : 1 });
    const buttons: Record<string, string> = {
      g: 'grid-btn',
      n: 'night-btn',
      l: 'building-lights-btn',
    };
    if (buttons[key]) dispatch({ type: 'click', id: buttons[key] });
    if (key === 'h') dispatch({ type: 'help' });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
