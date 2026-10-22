import { useLayoutEffect, useRef, useState } from 'react';

export interface FitLabelProps {
  /** Longest first: `+ 30 min`, then `+`. When none fits, nothing is shown. */
  readonly options: readonly string[];
  /**
   * The box cuts the label across with an ellipsis, so only its height is
   * tried — a card's title, which is long and still worth its first words.
   */
  readonly ellipsis?: boolean;
}

/**
 * The first of `options` that fits its box **as drawn** (LAI-831). A gap's
 * `+ 30 min` was chosen by a pixel count set for one machine's font, and CI's
 * Linux drew it wider and cut it. So each option is tried in the box, longest
 * first, before the page is painted. The trial starts again whenever the box
 * changes size or a font finishes loading.
 *
 * The box is the parent element. It must not wrap and must hide its overflow,
 * so that `scrollWidth` shows whether the label was cut across and
 * `scrollHeight` whether it was cut down — a box shorter than its line, as a
 * timeline row shared by many blocks is (LAI-860).
 */
export function FitLabel({ options, ellipsis = false }: FitLabelProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const words = options.join('\n');
  const [tried, setTried] = useState({ words, pick: 0 });
  const pick = tried.words === words ? tried.pick : 0;

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (box === null || box === undefined || pick >= options.length) return;
    const across = !ellipsis && box.scrollWidth > box.clientWidth;
    if (across || box.scrollHeight > box.clientHeight) {
      setTried({ words, pick: pick + 1 });
    }
  });

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (box === null || box === undefined) return;
    const size = (): string => `${String(box.clientWidth)}x${String(box.clientHeight)}`;
    let room = size();
    const again = (): void => {
      setTried((t) => ({ ...t, pick: 0 }));
    };
    const watcher = new ResizeObserver(() => {
      if (size() === room) return;
      room = size();
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
