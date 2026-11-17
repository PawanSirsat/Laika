import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A table in a document (LAI-1131, T6). It scrolls sideways inside its own
 * wrapper, never the page; and only when it actually overflows does it say
 * so — a shadow on the edge that has more, and a "Scroll for more columns"
 * hint. A table that fits shows neither. Six or more columns pins the first,
 * so a row keeps its name while you scroll its cells.
 *
 * The wrapper is focusable and labelled by the caption, so a keyboard user
 * can scroll it with the arrow keys.
 */

type Edge = 'none' | 'start' | 'end' | 'both';

export const STICKY_FROM_COLUMNS = 6;

export function DocTable({
  columns,
  children,
}: {
  readonly columns: number;
  readonly children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [more, setMore] = useState<Edge>('none');

  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const measure = (): void => {
      const over = el.scrollWidth - el.clientWidth > 1;
      setOverflow(over);
      if (!over) {
        setMore('none');
        return;
      }
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setMore(atStart ? 'end' : atEnd ? 'start' : 'both');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  return (
    <div className="doc-table" data-overflow={overflow ? 'true' : 'false'} data-more={more}>
      {overflow ? (
        <p className="doc-table-hint" aria-hidden="true">
          Scroll for more columns →
        </p>
      ) : null}
      <div
        ref={wrap}
        className="doc-table-scroll"
        // Only a scroller needs a tab stop; a table that fits is not a control.
        tabIndex={overflow ? 0 : undefined}
        role={overflow ? 'region' : undefined}
        aria-label={overflow ? 'Wide table, scrolls sideways' : undefined}
      >
        <table data-sticky-first={columns >= STICKY_FROM_COLUMNS ? 'true' : undefined}>
          {children}
        </table>
      </div>
    </div>
  );
}
