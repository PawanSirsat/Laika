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
 * `copied` is set from the *resolved* promise, never beside the call.
 *
 * ## And absence still copies (LAI-760)
 *
 * Selecting the text and saying *Press ⌘C* was honest, and it still meant
 * every Copy on the live board copied nothing — the owner clicked Copy and
 * pasted nothing. A page that is not a secure context still has one clipboard
 * write: a selection and `document.execCommand('copy')`, inside the click. So
 * when the API is missing or refuses, the text goes through a temporary
 * textarea and that command. Only when that fails too does the button select
 * the text and say which keys to press.
 *
 * It stores a boolean and never the text: this button sits next to one-time
 * secrets, and a component holding its own copy of one would survive the
 * scrub that `TokensScreen.forget()` performs.
 */

export type CopyOutcome = 'copied' | 'select';

/** Where a modal keeps focus; the temporary textarea must go inside it. */
const MODAL = '[aria-modal="true"], [role="dialog"], dialog[open]';

/**
 * Copy through a selection: an off-screen read-only textarea, `select()` and
 * `execCommand('copy')` (LAI-760). The only clipboard write a page that is not
 * a secure context has, and it needs the click's user gesture, so it runs
 * synchronously inside the handler.
 *
 * The textarea goes inside the nearest open dialog when `from` is in one: a
 * focus trap would take focus back from anything outside it, and the copy
 * would fail without a word. The previous focus and selection are put back.
 */
function copyThroughSelection(text: string, from: Element | null): boolean {
  const host = from?.closest<HTMLElement>(MODAL) ?? document.body;
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges: Range[] = [];
  for (let i = 0; i < (selection?.rangeCount ?? 0); i += 1) {
    const range = selection?.getRangeAt(i);
    if (range !== undefined) ranges.push(range);
  }

  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.readOnly = true;
  scratch.tabIndex = -1;
  scratch.className = 'copy-scratch';
  scratch.setAttribute('aria-hidden', 'true');
  host.append(scratch);
  try {
    scratch.focus({ preventScroll: true });
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    scratch.remove();
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

/**
 * Put `text` on the clipboard: the API when the browser has it, a selection
 * and `execCommand('copy')` when it does not or refuses. `from` is the control
 * that was clicked, so the fallback can stay inside its dialog.
 *
 * **Call it inside the click handler, before any `await`.** When the API is
 * absent — the live board — nothing here awaits before the fallback, so it
 * runs within the user gesture that `execCommand('copy')` needs.
 *
 * Exported because the task drawer's overflow menu needs the same behaviour
 * without the button: those are menu items that close the menu, and forcing a
 * button with a "Copied" state into them would change how the menu behaves to
 * suit a component. One mechanism, two presentations.
 */
export async function copyText(text: string, from: Element | null = null): Promise<CopyOutcome> {
  if (navigator.clipboard?.writeText === undefined) {
    return copyThroughSelection(text, from) ? 'copied' : 'select';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // Refused — a permissions policy, or a document that is not focused.
    return copyThroughSelection(text, from) ? 'copied' : 'select';
  }
}

/**
 * The element near `from` that shows exactly `text`, for a button given no
 * `selects` — the BOARD chip's address, the token beside its button.
 */
function showing(from: Element, text: string): HTMLElement | null {
  let at = from.parentElement;
  for (let depth = 0; at !== null && depth < 3; depth += 1, at = at.parentElement) {
    for (const node of at.querySelectorAll<HTMLElement>('code, pre')) {
      if (node.textContent === text) return node;
    }
  }
  return null;
}

/** Select an element's text, so ⌘C works when nothing else will. */
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
   * The element to select when nothing could copy. Optional: without it the
   * nearest `code` or `pre` showing exactly `text` is selected, and when there
   * is none the button still reports honestly.
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

  const press = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    ? 'Press ⌘C to copy'
    : 'Press Ctrl+C to copy';
  const shown = outcome === 'copied' ? 'Copied' : outcome === 'select' ? press : label;
  // "Press ⌘C to copy" keeps its own longer instruction below rather than a name.
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
      onClick={(event) => {
        const from = event.currentTarget;
        void copyText(text, from).then((result) => {
          if (result === 'select') selectText(selects?.current ?? showing(from, text));
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
