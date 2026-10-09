import { useRef, useState } from 'react';
import './copy-button.css';

/**
 * Copy, on a board that is not a secure context (LAI-622).
 *
 * ## The measurement this exists for
 *
 * Laika is deployed at `http://52.72.203.206`. Browsers expose
 * `navigator.clipboard` **only in a secure context**, and plain HTTP on an IP
 * is not one. Measured on the live board:
 *
 * ```
 * window.isSecureContext   ->  false
 * typeof navigator.clipboard -> "undefined"
 * ```
 *
 * The three call sites this replaces all did
 * `void navigator.clipboard?.writeText(x)` and then set `copied = true`
 * unconditionally — so on the deployment they say **"Copied" having copied
 * nothing**. The optional chain that was there to be careful is what made the
 * failure silent.
 *
 * ## So the promise decides, and absence is a different answer
 *
 * `copied` is set from the *resolved* promise, never beside the call. When the
 * API is missing or refuses, the button selects the text instead and says so,
 * which is a thing the reader can act on — a selection plus ⌘C is exactly as
 * good, and being told is better than being lied to.
 *
 * It stores a boolean and never the text: this button sits next to one-time
 * secrets, and a component holding its own copy of one would survive the
 * scrub that `TokensScreen.forget()` performs.
 */

export type CopyOutcome = 'copied' | 'select';

/**
 * Put `text` on the clipboard if the browser will allow it.
 *
 * Exported because the task drawer's overflow menu needs the same behaviour
 * without the button: those are menu items that close the menu, and forcing a
 * button with a "Copied" state into them would change how the menu behaves to
 * suit a component. One mechanism, two presentations.
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  try {
    if (navigator.clipboard?.writeText === undefined) return 'select';
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // Refused — a permissions policy, or a document that is not focused.
    return 'select';
  }
}

/** Select an element's text, so ⌘C works when the API will not. */
function selectText(node: HTMLElement | null): void {
  if (node === null) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export interface CopyButtonProps {
  /** What lands on the clipboard. */
  readonly text: string;
  /**
   * The element to select when the clipboard is unavailable. Optional: without
   * it the button still reports honestly, it just cannot help with the
   * selection.
   */
  readonly selects?: React.RefObject<HTMLElement | null> | undefined;
  readonly label?: string | undefined;
  /**
   * What lands on the clipboard, in words — `the setup prompt`. Gives the
   * button an accessible name that says which of several identical "Copy"
   * buttons this is (LAI-733). The visible label is kept inside the name, so
   * a voice user saying "click Copy" still reaches it.
   */
  readonly what?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Why it is disabled — rendered as the title, so the reason is reachable. */
  readonly disabledReason?: string | undefined;
  readonly className?: string | undefined;
}

export function CopyButton({
  text,
  selects,
  label = 'Copy',
  what,
  disabled = false,
  disabledReason,
  className,
}: CopyButtonProps) {
  const [outcome, setOutcome] = useState<CopyOutcome | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = (next: CopyOutcome): void => {
    setOutcome(next);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOutcome(undefined);
    }, 4_000);
  };

  const shown = outcome === 'copied' ? 'Copied' : outcome === 'select' ? 'Press ⌘C' : label;
  // "Press ⌘C" keeps its own longer instruction below rather than a name.
  const named =
    what === undefined || outcome === 'select'
      ? undefined
      : `${outcome === 'copied' ? 'Copied' : label} ${what}`;

  return (
    <button
      type="button"
      className={className === undefined ? 'copy-button' : `copy-button ${className}`}
      data-outcome={outcome ?? 'idle'}
      disabled={disabled}
      {...(named !== undefined ? { 'aria-label': named } : {})}
      {...(disabled && disabledReason !== undefined ? { title: disabledReason } : {})}
      onClick={() => {
        void copyText(text).then((result) => {
          if (result === 'select') selectText(selects?.current ?? null);
          announce(result);
        });
      }}
    >
      {shown}
      {outcome === 'copied' && <span aria-hidden="true"> ✓</span>}
      {outcome === 'select' && (
        <span className="visually-hidden"> — the text is selected, press Command or Control C</span>
      )}
    </button>
  );
}
