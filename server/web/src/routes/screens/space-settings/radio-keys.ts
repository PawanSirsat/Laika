import type { KeyboardEvent } from 'react';

/**
 * The keys of a radio group (LAI-1211), as the WAI-ARIA Authoring Practices
 * *Radio Group* pattern gives them: the group is **one** Tab stop, the checked
 * radio holds it, and the arrows move between the options and choose the one
 * they land on, wrapping at the ends. Space settings draws four groups as
 * buttons with `role="radio"` — colour swatches, visibility cards, *Who can
 * create tasks*, and the role for people being added — and before this each
 * option was its own Tab stop with no arrow keys.
 *
 * Pure, so the rule is tested without a browser. `undefined` means *"not a
 * radio key — leave the event alone"*, which keeps Tab, Enter and Space as
 * they are.
 */
export function radioKeyTarget(key: string, at: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  const from = at < 0 || at > last ? 0 : at;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return from === last ? 0 : from + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return from === 0 ? last : from - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}

/**
 * The group's `onKeyDown`: moves focus to the radio the key names and clicks
 * it, so choosing by keyboard runs exactly what choosing by pointer runs —
 * including the visibility card's *Make public?* confirmation, which a click on
 * Public opens rather than saving.
 */
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'),
  );
  const at = radios.findIndex((radio) => radio === document.activeElement);
  const target = radioKeyTarget(event.key, at, radios.length);
  if (target === undefined) return;
  event.preventDefault();
  const radio = radios[target];
  if (radio === undefined) return;
  radio.focus();
  if (radio.getAttribute('aria-checked') !== 'true') radio.click();
}

/** The roving `tabIndex` for one option: the checked radio, or the first when none is. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  if (checked) return 0;
  return !anyChecked && index === 0 ? 0 : -1;
}
