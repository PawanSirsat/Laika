import { useEffect, useRef, type RefObject } from 'react';

/**
 * Where Tab should go inside a modal, or `undefined` to let the browser move
 * on as usual (LAI-739 review round 1). `items` are the dialog's focusable
 * controls in order; `current` is what holds focus now.
 *
 * Only the ends are handled: Tab off the last wraps to the first, Shift+Tab
 * off the first wraps to the last, and focus that has somehow left the dialog
 * is brought back in. Everything in between is the browser's own order.
 */
export function trapTarget<T>(items: readonly T[], current: T, backwards: boolean): T | undefined {
  if (items.length === 0) return undefined;
  const first = items[0];
  const last = items[items.length - 1];
  const at = items.indexOf(current);
  if (at === -1) return backwards ? last : first;
  if (!backwards && at === items.length - 1) return first;
  if (backwards && at === 0) return last;
  return undefined;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogFocus {
  /** What takes focus when the dialog opens. The first control when absent. */
  readonly initial?: (() => HTMLElement | null | undefined) | undefined;
  /**
   * Where focus goes when the dialog closes — asked **then**, not at open, so
   * a control that went away meanwhile (a deleted column's menu) can name a
   * fallback.
   */
  readonly restore?: (() => HTMLElement | null | undefined) | undefined;
}

/**
 * A modal's focus (LAI-739 review round 1): in on open, held in while open,
 * back where it belongs on close. The column dialogs used none of the three,
 * so a keyboard reader opened *Delete* and was left on the board behind it.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>, focus: DialogFocus): void {
  const latest = useRef(focus);
  latest.current = focus;

  useEffect(() => {
    const box = dialog.current;
    if (box === null) return;
    const controls = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (latest.current.initial?.() ?? controls()[0])?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const target = trapTarget(controls(), document.activeElement as HTMLElement, event.shiftKey);
      if (target === undefined) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      // After the dialog has left the DOM, so the target is focusable again.
      const restore = latest.current.restore;
      queueMicrotask(() => {
        restore?.()?.focus();
      });
    };
  }, [dialog]);
}
