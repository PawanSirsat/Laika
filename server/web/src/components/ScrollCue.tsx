import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './scroll-cue.css';

export interface ScrollCueProps {
  /** Names the scrolling region for a screen reader: "Your spaces table". */
  readonly label: string;
  /** Extra class on the outer wrapper, for the screen's own border and card. */
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * A region that scrolls sideways and says so (LAI-1196): a shadow on each
 * edge that has columns past it, and a line of text under it while anything
 * is off-screen. Focusable only while it scrolls, so a keyboard reader can
 * reach the hidden columns with the arrow keys and is not given a tab stop
 * that does nothing at 1440.
 */
export function ScrollCue({ label, className, children }: ScrollCueProps) {
  const { ref, edge } = useScrollCue<HTMLDivElement>();
  const scrolls = edge !== 'none';
  return (
    <>
      <div
        className={className === undefined ? 'scroll-cue' : `scroll-cue ${className}`}
        data-scroll={edge}
      >
        <div
          ref={ref}
          className="scroll-cue-region"
          role="region"
          aria-label={label}
          tabIndex={scrolls ? 0 : undefined}
        >
          {children}
        </div>
      </div>
      <p className="scroll-cue-hint" aria-hidden="true">
        Scroll sideways to see every column.
      </p>
    </>
  );
}

/** Which edges have columns hidden past them. `none`: everything fits. */
type ScrollEdge = 'none' | 'start' | 'middle' | 'end';

/**
 * Where a sideways-scrolling region stands (LAI-1196), for a cue that shows
 * only when there is something off-screen: a table narrower than its columns
 * at 768 or 390 otherwise reads as complete, with the last columns silently
 * cut off. Re-measured on scroll and whenever the region or its content
 * resizes.
 *
 * `start` means more to the right (scrolled to the start); `end` more to the
 * left; `middle` both. The returned ref goes on the scrolling element, and the
 * edge on its `data-scroll` attribute, which `scroll-cue.css` draws.
 */
function useScrollCue<T extends HTMLElement>(): {
  readonly ref: (node: T | null) => void;
  readonly edge: ScrollEdge;
} {
  const [node, setNode] = useState<T | null>(null);
  const [edge, setEdge] = useState<ScrollEdge>('none');
  const frame = useRef(0);

  const measure = useCallback(() => {
    if (node === null) return;
    const max = node.scrollWidth - node.clientWidth;
    // Right-to-left scrolls negative; the distance from the start is what counts.
    const at = Math.abs(node.scrollLeft);
    setEdge(max <= 1 ? 'none' : at <= 1 ? 'start' : at >= max - 1 ? 'end' : 'middle');
  }, [node]);

  useEffect(() => {
    if (node === null) return;
    measure();
    const onScroll = (): void => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    if (node.firstElementChild !== null) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [node, measure]);

  return { ref: setNode, edge };
}
