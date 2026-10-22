import type { BreakKind } from '../routes/screens/break-kinds.ts';

/** Twelve-pixel line glyphs, one a kind: the fork is the Timeline design's own. */
const PATHS: Readonly<Record<BreakKind, string>> = {
  meal: 'M2.5 1v3a1.5 1.5 0 0 0 3 0V1M4 1v10M9.5 11V1c-1.3.6-2 2-2 3.8 0 .9.6 1.4 2 1.4',
  cup: 'M1.5 4h7v3.5a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3V4zM8.5 5h1.3a1.5 1.5 0 0 1 0 3H8.5M3.5 1.5v1.2M5.5 1.5v1.2',
  rest: 'M9.5 7.6A4.2 4.2 0 0 1 4.4 2.5a4.2 4.2 0 1 0 5.1 5.1z',
  walk: 'M6.6 2.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5.2 4.2l1.6-.5 1.6 2 1.6.9M5.2 4.2 4.4 7l-1.6 3.6M6.2 7.6l1.3 1.3.9 2.3M4.4 7l1.8.6',
  people:
    'M4.2 5.4a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM8.3 5.6a1.4 1.4 0 1 0 0-2.8M1.5 10.5c0-2.1 1.2-3.4 2.7-3.4s2.7 1.3 2.7 3.4M7.8 10.5c0-1.6.8-2.8 2.2-3',
  pause: 'M4 2v8M8 2v8',
};

export interface BreakGlyphProps {
  readonly kind: BreakKind;
  readonly className?: string;
}

/**
 * The glyph for a kind of break (LAI-894): a fork for a meal, a cup for tea or
 * coffee, a moon for a rest, a walker, two people for a stand-up, and a pause
 * for anything else. Decorative: the label beside it carries the meaning.
 */
export function BreakGlyph({ kind, className = 'break-glyph' }: BreakGlyphProps) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      data-break-kind={kind}
    >
      <path
        d={PATHS[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
