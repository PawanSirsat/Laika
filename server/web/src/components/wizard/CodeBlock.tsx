import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { CopyButton } from '../CopyButton.tsx';
import { commandLines } from './command-lines.ts';

/*
 * The wizard parts (LAI-1044) were Connect's private markup until Developer
 * access V3 needed them on more than one screen. They keep Connect's class
 * names on purpose — `golden/connect.json` proves the classic page renders
 * byte for byte as it did — so their rules still live in
 * `routes/screens/connect/connect.css`, which a screen using them imports.
 * Moving those rules into a component stylesheet is for when the classic
 * page goes (plan §J, slice F5), not for a refactor that promised no change.
 */

export interface CodeBlockProps {
  /** The bar's label: a file path, *Terminal*, or a short description. */
  readonly label: ReactNode;
  /**
   * The label's id. Given, the block is a named, focusable region (`tabIndex`
   * 0, labelled by the bar) whose copy also selects its text; absent, it is a
   * plain command, as Connect's *Start* block is.
   */
  readonly labelId?: string | undefined;
  /** The exact text: what is shown, selected and copied. */
  readonly text: string;
  /** The one-time secret, when the text holds it — those lines are highlighted. */
  readonly secret?: string | undefined;
  /** A badge beside the label, such as *carries your token*. */
  readonly tag?: string | undefined;
  /** What the copy button announces it copied: *the command*, *the token*. */
  readonly what: string;
  readonly copyDisabled?: boolean | undefined;
  /** Said on a disabled copy button, so it is never disabled without a reason. */
  readonly copyDisabledReason?: string | undefined;
  /** The step's main block — drawn heavier than a block under *Other ways*. */
  readonly main?: boolean | undefined;
  /** Classes added to the `<pre>` after `conn-pre`. */
  readonly preClassName?: string | undefined;
  /** Called when a copy *succeeded* — not on a click, not on *Press ⌘C*. */
  readonly onCopied?: (() => void) | undefined;
}

/**
 * A copyable block of code or prompt text: a bar with its label and a copy
 * button, and the text below it. The line that holds the real secret is
 * highlighted; the text itself is untouched, so what the reader sees, selects
 * and copies are the same characters.
 */
export function CodeBlock({
  label,
  labelId,
  text,
  secret,
  tag,
  what,
  copyDisabled,
  copyDisabledReason,
  main = false,
  preClassName,
  onCopied,
}: CodeBlockProps) {
  const ref = useRef<HTMLPreElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const named = labelId !== undefined;

  /*
   * The copy's outcome is the button's own `data-outcome` (LAI-741). Counting
   * clicks marked a refused clipboard as copied; this hears only `copied`.
   */
  useEffect(() => {
    const button = barRef.current?.querySelector('.copy-button');
    if (onCopied === undefined || button === null || button === undefined) return;
    const watch = new MutationObserver(() => {
      if (button.getAttribute('data-outcome') === 'copied') onCopied();
    });
    watch.observe(button, { attributes: true, attributeFilter: ['data-outcome'] });
    return () => {
      watch.disconnect();
    };
  }, [onCopied]);

  return (
    <div className={main ? 'conn-block conn-block-main' : 'conn-block'}>
      <div className="conn-block-bar" ref={barRef}>
        <span className="conn-block-label" {...(named ? { id: labelId } : {})}>
          {label}
        </span>
        {tag !== undefined && <span className="conn-block-tag">{tag}</span>}
        <CopyButton
          text={text}
          {...(named ? { selects: ref } : {})}
          what={what}
          className="conn-copy-primary"
          {...(copyDisabled !== undefined ? { disabled: copyDisabled } : {})}
          {...(copyDisabledReason !== undefined ? { disabledReason: copyDisabledReason } : {})}
        />
      </div>
      <pre
        className={preClassName === undefined ? 'conn-pre' : `conn-pre ${preClassName}`}
        {...(named ? { ref, tabIndex: 0, 'aria-labelledby': labelId } : {})}
      >
        <CommandText text={text} secret={secret} />
      </pre>
    </div>
  );
}

/**
 * A block's text, one span per line so each wraps under its own text
 * (LAI-742). `--lead` is the line's leading spaces; `connect.css` hangs its
 * continuation two columns in from there. The newlines stay text nodes between
 * the spans, so the block's text — selected, or read as `innerText` — is the
 * input to the byte. An empty line is only its newline.
 */
export function CommandText({
  text,
  secret,
}: {
  readonly text: string;
  readonly secret?: string | undefined;
}) {
  return commandLines(text, secret).map((line, i) => (
    <Fragment key={i}>
      {i > 0 && '\n'}
      {line.text !== '' && (
        <span className="conn-line" style={{ '--lead': line.lead } as CSSProperties}>
          {line.token ? <mark className="conn-token-line">{line.text}</mark> : line.text}
        </span>
      )}
    </Fragment>
  ));
}

/**
 * A block's label with its file paths set as code: as typed, never
 * upper-cased, and the only part allowed to break anywhere — a long path
 * wraps mid-name; the words around it do not.
 */
export function PathLabel({ text }: { readonly text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) =>
        /^[~.]?[\w.-]*\/[\w./<>-]*|^\.[\w-]+\/?/.test(part) ? (
          <code key={i} className="conn-path">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
