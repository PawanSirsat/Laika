import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './scroll-cue.css';

/**
 * A wide table that scrolls sideways inside its card, and says so (LAI-1201).
 *
 * On a phone a table of many columns cannot fit; the page must not scroll
 * sideways, so the table does — and a scroll nobody can see is a column
 * nobody finds. Each edge that has more beyond it fades, and a line under the
 * table says to scroll. The scroller is a labelled region in the tab order
 * while it scrolls, so a keyboard reader can move it with the arrow keys.
 */
export function ScrollCue({
  className,
  label,
  children,
}: {
  /** The scroller's own class — its border, background, radius. */
  readonly className: string;
  /** What the region holds, for a screen reader. */
  readonly label: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = (): void => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = max > 1 && el.scrollLeft < max - 1;
      setEdges((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(read);
    observer?.observe(el);
    if (el.firstElementChild !== null) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  }, []);

  const scrolls = edges.start || edges.end;
  return (
    <div
      className="scroll-cue"
      data-more-start={edges.start ? 'true' : undefined}
      data-more-end={edges.end ? 'true' : undefined}
    >
      <div className="scroll-cue-frame">
        <div
          ref={ref}
          className={className}
          role="region"
          aria-label={label}
          tabIndex={scrolls ? 0 : undefined}
        >
          {children}
        </div>
        <span className="scroll-cue-edge scroll-cue-edge-start" aria-hidden="true" />
        <span className="scroll-cue-edge scroll-cue-edge-end" aria-hidden="true" />
      </div>
      {scrolls && (
        <p className="scroll-cue-hint" aria-hidden="true">
          {edges.end ? 'Scroll sideways for more columns →' : '← Scroll back for the first columns'}
        </p>
      )}
    </div>
  );
}
