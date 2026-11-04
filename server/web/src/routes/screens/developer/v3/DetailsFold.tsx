import { useCallback, useState, type ReactNode } from 'react';
import './details-sections.css';

/**
 * One section of Tool details or Device details, folded to a single summary
 * row that opens in place (LAI-1100): *Automatic checkpoints · On*.
 *
 * A native disclosure, as every other disclosure in these panels already is
 * (*How to update*, *What's new*, *How to update your Laika CLI*): keyboard
 * and screen readers get it for free, the row's whole line is its name, and
 * it nests inside the panel's modal without a second one. What it holds is
 * drawn while it is folded, so a section that reads its own state — the
 * consent switch — can say that state on the row before anyone opens it.
 *
 * Whether it is open is the panel's (`useFolds`), so the panel can open a
 * section for its next action, or keep one open that needs attention.
 */
export function DetailsFold({
  name,
  id,
  title,
  summary,
  open,
  onToggle,
  hook,
  children,
}: {
  /** The `data-fold` hook naming the section. */
  readonly name: string;
  /** The disclosure's id, for a control elsewhere in the panel that opens it. */
  readonly id?: string;
  readonly title: string;
  /** The section's state, in a few words, after the title. */
  readonly summary?: ReactNode;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  /** A further `data-*` hook the section had before it folded, kept for its readers. */
  readonly hook?: string;
  readonly children: ReactNode;
}) {
  return (
    <details
      className="dv3-fold"
      id={id}
      data-fold={name}
      {...(hook === undefined ? {} : { [`data-${hook}`]: '' })}
      open={open}
      onToggle={(event) => {
        // A disclosure inside this one toggles too; only this one's own counts.
        if (event.target !== event.currentTarget) return;
        onToggle(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="dv3-fold-line">
          <span className="dv3-fold-title">{title}</span>
          {summary !== undefined && (
            <>
              {' · '}
              <span className="dv3-fold-value">{summary}</span>
            </>
          )}
        </span>
        <span className="dv3-fold-chevron" aria-hidden="true" />
      </summary>
      <div className="dv3-fold-body">{children}</div>
    </details>
  );
}

export interface Folds<Name extends string> {
  readonly isOpen: (name: Name) => boolean;
  readonly setOpen: (name: Name, open: boolean) => void;
  /** The props a {@link DetailsFold} takes for one name. */
  readonly fold: (name: Name) => {
    readonly name: Name;
    readonly open: boolean;
    readonly onToggle: (open: boolean) => void;
  };
}

/** Which of a panel's sections are open: none but `initial` until a reader opens one. */
export function useFolds<Name extends string>(initial: readonly Name[] = []): Folds<Name> {
  const [open, setOpenSet] = useState<ReadonlySet<Name>>(() => new Set(initial));
  const setOpen = useCallback((name: Name, next: boolean): void => {
    setOpenSet((was) => {
      if (was.has(name) === next) return was;
      const set = new Set(was);
      if (next) set.add(name);
      else set.delete(name);
      return set;
    });
  }, []);
  const isOpen = (name: Name): boolean => open.has(name);
  return {
    isOpen,
    setOpen,
    fold: (name) => ({
      name,
      open: open.has(name),
      onToggle: (next) => {
        setOpen(name, next);
      },
    }),
  };
}
