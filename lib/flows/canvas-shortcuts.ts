// Unknown declared values inherit per spec; fail safe by treating them as keyboard-owned.
const TEXT_ENTRY_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false' i]), [role='textbox']";

const MODAL_SURFACE_SLOTS = [
  "alert-dialog-content",
  "dialog-content",
  "drawer-content",
  "select-content",
  "sheet-content",
] as const;

const NON_MODAL_SURFACE_SLOTS = [
  "command",
  "context-menu-content",
  "context-menu-sub-content",
  "dropdown-menu-content",
  "dropdown-menu-sub-content",
  "menubar-content",
  "menubar-sub-content",
  "popover-content",
] as const;

function dataSlotSelector(slot: string) {
  return `[data-slot='${slot}']`;
}

const KEYBOARD_SURFACE_SELECTOR = [
  // Bespoke focused or event-owning portals can opt out of canvas shortcuts.
  "[data-canvas-shortcuts='ignore']",
  "[data-state='open'][aria-haspopup]",
  ...MODAL_SURFACE_SLOTS.map(dataSlotSelector),
  ...NON_MODAL_SURFACE_SLOTS.map(dataSlotSelector),
  "[role='alertdialog']",
  "[role='dialog']",
  "[role='listbox']",
  "[role='menu']",
].join(", ");

const OPEN_MODAL_SURFACE_SELECTOR = [
  ...MODAL_SURFACE_SLOTS.map(
    (slot) => `${dataSlotSelector(slot)}[data-state='open']`
  ),
  "[role='alertdialog'][aria-modal='true']:not([data-state='closed'])",
  "[role='dialog'][aria-modal='true']:not([data-state='closed'])",
].join(", ");

function isWithin(element: Element | null, selector: string) {
  return Boolean(element?.closest(selector));
}

export function shouldIgnoreCanvasShortcut(
  activeElement: Element | null,
  eventElement: Element | null,
  documentRoot: ParentNode | null
) {
  if (
    isWithin(activeElement, TEXT_ENTRY_SELECTOR) ||
    isWithin(eventElement, TEXT_ENTRY_SELECTOR)
  ) {
    return true;
  }

  if (
    isWithin(eventElement, KEYBOARD_SURFACE_SELECTOR) ||
    isWithin(activeElement, KEYBOARD_SURFACE_SELECTOR)
  ) {
    return true;
  }

  // Modal surfaces win during mount-to-focus transitions; unrelated non-modal overlays do not.
  return Boolean(documentRoot?.querySelector(OPEN_MODAL_SURFACE_SELECTOR));
}
