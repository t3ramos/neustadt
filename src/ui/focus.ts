export type FocusReference = {
  element: HTMLElement;
  id: string;
  data: [string, string][];
};

export function captureFocus(
  element: HTMLElement | null = document.activeElement as HTMLElement | null,
): FocusReference | null {
  if (!element || element === document.body || element === document.documentElement) return null;
  return {
    element,
    id: element.id,
    data: Object.entries(element.dataset).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  };
}

export function restoreFocus(reference: FocusReference | null, root: ParentNode = document) {
  if (!reference) return false;
  const eligible = (element: HTMLElement | null): element is HTMLElement =>
    !!element &&
    element.isConnected &&
    !element.matches(':disabled,[inert]') &&
    element.getClientRects().length > 0;
  let element: HTMLElement | null = null;
  if (
    eligible(reference.element) &&
    (root === document || (root as HTMLElement).contains(reference.element))
  )
    element = reference.element;
  if (!element && reference.id)
    element = root.querySelector<HTMLElement>(`#${CSS.escape(reference.id)}`);
  if (!element && reference.data.length)
    element =
      [
        ...root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]'),
      ].find((candidate) =>
        reference.data.every(([key, value]) => candidate.dataset[key] === value),
      ) ?? null;
  if (!eligible(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

export function modalFocusables() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.modal button:not([disabled]),.modal input:not([disabled]),.modal select:not([disabled]),.modal textarea:not([disabled]),.modal a[href],.modal [tabindex="0"]',
    ),
  ].filter((element) => element.getClientRects().length > 0);
}
