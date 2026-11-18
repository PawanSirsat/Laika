import { createContext, useContext, useState, type ReactNode } from 'react';

/** Where a viewer's open sections are remembered — this browser only (LAI-2005). */
const STORE_PREFIX = 'laika.org.section.';

function readOpen(name: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(STORE_PREFIX + name);
    return stored === null ? fallback : stored === '1';
  } catch {
    // A private window or blocked storage: the section opens as designed.
    return fallback;
  }
}

function writeOpen(name: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORE_PREFIX + name, open ? '1' : '0');
  } catch {
    // Remembering is a convenience; the section still opens and closes.
  }
}

/**
 * `flat` draws every `OrgAccordion` under it as an open card with no fold —
 * a section on a page of its own (LAI-1318: each connection's page) needs no
 * row to open it. Same heading id, same hooks, same body.
 */
export const OrgFoldMode = createContext<'fold' | 'flat'>('fold');

export interface OrgAccordionProps {
  /** The `data-acc` hook, and the key a viewer's choice is remembered under. */
  readonly name: string;
  /** The heading's id — what `aria-labelledby` and the tests find the section by. */
  readonly id: string;
  readonly title: string;
  /** A few words after the title: a count, a date, a state. */
  readonly meta?: ReactNode;
  /** One line under the title, readable while the section is folded. */
  readonly description?: ReactNode;
  /** Open on a first visit, before the viewer has chosen. */
  readonly defaultOpen?: boolean;
  /** Further classes for the card, such as the section's own `org-prices`. */
  readonly className?: string;
  /** A `data-section` hook the section carried before it folded, kept for its readers. */
  readonly section?: string;
  /** A `data-card` hook, as above. */
  readonly card?: string;
  /** A `data-matrix` hook, as above. */
  readonly matrix?: string;
  /** Any further `data-*` hooks the section carried, kept for its readers. */
  readonly hooks?: Readonly<Record<`data-${string}`, string | boolean | undefined>>;
  /**
   * Held open regardless of the viewer's choice — while a find on the page is
   * narrowing what the section holds, so a match is never folded out of sight.
   */
  readonly forceOpen?: boolean;
  /** Controls drawn above the body once open — never inside the summary row. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * One section of the Organisation page folded to a single row that opens in
 * place (LAI-2005): *Model prices · 14 models · table of 2026-10-18*.
 *
 * A native disclosure, like `DetailsFold` on Developer access: the keyboard
 * and screen readers get it for free, the whole row is its name, and what it
 * holds stays in the document while folded, so a search on the page still
 * finds it. Whether it is open is remembered for this viewer in this browser,
 * and only there — nothing about it reaches the server.
 */
export function OrgAccordion({
  name,
  id,
  title,
  meta,
  description,
  defaultOpen = false,
  className,
  section,
  card,
  matrix,
  hooks,
  forceOpen = false,
  actions,
  children,
}: OrgAccordionProps) {
  const mode = useContext(OrgFoldMode);
  const [chosen, setOpen] = useState(() => readOpen(name, defaultOpen));
  const open = chosen || forceOpen;

  if (mode === 'flat') {
    return (
      <section
        className={`org-card org-acc-flat${className === undefined ? '' : ` ${className}`}`}
        aria-labelledby={id}
        data-acc={name}
        {...(section === undefined ? {} : { 'data-section': section })}
        {...(card === undefined ? {} : { 'data-card': card })}
        {...(matrix === undefined ? {} : { 'data-matrix': matrix })}
        {...hooks}
      >
        <header className="org-flat-head">
          <span className="org-acc-line">
            <h2 id={id} className="org-acc-title">
              {title}
            </h2>
            {meta !== undefined && <span className="org-acc-meta">{meta}</span>}
          </span>
          {description !== undefined && <span className="org-acc-desc">{description}</span>}
        </header>
        {actions !== undefined && <div className="org-acc-actions">{actions}</div>}
        {children}
      </section>
    );
  }

  return (
    <details
      className={`org-card org-acc${className === undefined ? '' : ` ${className}`}`}
      data-acc={name}
      {...(section === undefined ? {} : { 'data-section': section })}
      {...(card === undefined ? {} : { 'data-card': card })}
      {...(matrix === undefined ? {} : { 'data-matrix': matrix })}
      {...hooks}
      open={open}
      onToggle={(event) => {
        // A disclosure nested inside this one toggles too; only this one counts.
        if (event.target !== event.currentTarget) return;
        const next = event.currentTarget.open;
        // A forced open is not a choice: only a toggle the viewer made is kept.
        if (next === open) return;
        setOpen(next);
        writeOpen(name, next);
      }}
    >
      <summary className="org-acc-summary">
        <span className="org-acc-text">
          <span className="org-acc-line">
            <h2 id={id} className="org-acc-title">
              {title}
            </h2>
            {meta !== undefined && <span className="org-acc-meta">{meta}</span>}
          </span>
          {description !== undefined && <span className="org-acc-desc">{description}</span>}
        </span>
        <span className="org-acc-state" aria-hidden="true">
          {open ? 'Hide' : 'Show'}
        </span>
        <span className="org-acc-chevron" aria-hidden="true" />
      </summary>
      <div className="org-acc-body">
        {actions !== undefined && <div className="org-acc-actions">{actions}</div>}
        {children}
      </div>
    </details>
  );
}
