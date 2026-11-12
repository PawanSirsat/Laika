import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Cue {
  /** The content is wider than the box, so part of it is out of sight. */
  readonly overflow: boolean;
  /** Scrolled all the way to the right — nothing more to see that way. */
  readonly atEnd: boolean;
}

/**
 * A table that is wider than the screen, and says so (LAI-1194, visual audit
 * V9: People at 390 cut the Role column to "Memb" with no sign the rest was
 * there).
 *
 * Three cues, because each one alone is missable: a fade on the edge that has
 * more behind it, a line of text under the table, and a focusable region so
 * the arrow keys scroll it. All three are present **only while something is
 * actually hidden** — measured, not assumed from the viewport width — so at
 * 1440 nothing changes.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** What the region holds, for a screen reader: `People table`. */
  readonly label: string;
  /** Classes for the element that scrolls. */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cue, setCue] = useState<Cue>({ overflow: false, atEnd: false });

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      const overflow = el.scrollWidth - el.clientWidth > 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setCue((now) =>
        now.overflow === overflow && now.atEnd === atEnd ? now : { overflow, atEnd },
      );
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild !== null) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className="org-scroll"
      data-scroll-region
      data-overflow={cue.overflow ? 'true' : 'false'}
      data-at-end={cue.atEnd ? 'true' : 'false'}
    >
      <div
        ref={ref}
        className={className === undefined ? 'org-scroll-inner' : `org-scroll-inner ${className}`}
        role="region"
        aria-label={cue.overflow ? `${label}, scrolls sideways` : label}
        // Focusable only while there is somewhere to scroll: a stop in the tab
        // order that does nothing is its own defect.
        tabIndex={cue.overflow ? 0 : undefined}
      >
        {children}
      </div>
      {cue.overflow && (
        <p className="org-scroll-hint" data-scroll-hint aria-hidden="true">
          {cue.atEnd ? '← Scroll back' : 'Scroll sideways for more →'}
        </p>
      )}
    </div>
  );
}
