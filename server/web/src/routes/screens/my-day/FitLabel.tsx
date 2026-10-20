import { useLayoutEffect, useRef, useState } from 'react';

export interface FitLabelProps {
  /** Longest first: `+ 30 min`, then `+`. When none fits, nothing is shown. */
  readonly options: readonly string[];
}

/**
 * The first of `options` that fits its box **as drawn** (LAI-831). A gap's
 * `+ 30 min` was chosen by a pixel count set for one machine's font, and CI's
 * Linux drew it wider and cut it. So each option is tried in the box, longest
 * first, before the page is painted. The trial starts again whenever the box
 * changes width or a font finishes loading.
 *
 * The box is the parent element. It must not wrap and must hide its overflow,
 * so that `scrollWidth` shows whether the label was cut.
 */
export function FitLabel({ options }: FitLabelProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const words = options.join('\n');
  const [tried, setTried] = useState({ words, pick: 0 });
  const pick = tried.words === words ? tried.pick : 0;

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (box === null || box === undefined || pick >= options.length) return;
    if (box.scrollWidth > box.clientWidth) setTried({ words, pick: pick + 1 });
  });

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (box === null || box === undefined) return;
    let room = box.clientWidth;
    const again = (): void => {
      setTried((t) => ({ ...t, pick: 0 }));
    };
    const watcher = new ResizeObserver(() => {
      if (box.clientWidth === room) return;
      room = box.clientWidth;
      again();
    });
    watcher.observe(box);
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      watcher.disconnect();
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, []);

  return <span ref={ref}>{options[pick] ?? ''}</span>;
}
