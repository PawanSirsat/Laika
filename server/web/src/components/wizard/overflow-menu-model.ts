import { trapTarget } from '../use-dialog-focus.ts';

/**
 * The keyboard decisions `OverflowMenu` makes (LAI-1044), without a DOM, so
 * `node --test` can reach them. `enabled` is one flag per item, in order.
 *
 * What a key does, per the WAI-ARIA menu-button pattern:
 *
 * - `ArrowDown` / `ArrowUp`: the next / previous enabled item, wrapping at the
 *   ends. The wrap is `trapTarget` — the same "off the last, back to the
 *   first" rule `useDialogFocus` applies to `Tab` in a modal.
 * - `Home` / `End`: the first / last enabled item.
 * - `Escape`: close, and focus goes back to the button that opened it.
 * - `Tab`: close and let focus move on as the browser would; a menu is not a
 *   modal and must not hold focus.
 */
export type MenuMove =
  | { readonly kind: 'focus'; readonly index: number }
  | { readonly kind: 'close'; readonly restore: boolean }
  | { readonly kind: 'none' };

function enabledIndexes(enabled: readonly boolean[]): number[] {
  return enabled.flatMap((on, i) => (on ? [i] : []));
}

/** Where focus goes when the menu opens: the first enabled item, or the last for `ArrowUp`. */
export function openingIndex(enabled: readonly boolean[], fromEnd: boolean): number | undefined {
  const on = enabledIndexes(enabled);
  return fromEnd ? on[on.length - 1] : on[0];
}

/** What `key`, pressed on the item at `current`, does. */
export function menuKey(key: string, enabled: readonly boolean[], current: number): MenuMove {
  const on = enabledIndexes(enabled);
  if (key === 'Escape') return { kind: 'close', restore: true };
  if (key === 'Tab') return { kind: 'close', restore: false };
  if (on.length === 0) return { kind: 'none' };

  if (key === 'Home') return { kind: 'focus', index: on[0] ?? 0 };
  if (key === 'End') return { kind: 'focus', index: on[on.length - 1] ?? 0 };

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const backwards = key === 'ArrowUp';
    const wrapped = trapTarget(on, current, backwards);
    if (wrapped !== undefined) return { kind: 'focus', index: wrapped };
    const at = on.indexOf(current);
    const next = on[backwards ? at - 1 : at + 1];
    return next === undefined ? { kind: 'none' } : { kind: 'focus', index: next };
  }

  return { kind: 'none' };
}
