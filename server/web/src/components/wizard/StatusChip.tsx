import type { ReactNode } from 'react';
import './status-chip.css';

/**
 * How a status reads at a glance. Each tone has a colour from the existing
 * `--chip-*` / `--overdue` tokens (LAI-1044 adds none), and **every one is
 * also a word**: a chip without its word, or a word that only a colour
 * distinguishes, is a defect.
 */
export type StatusTone = 'ok' | 'waiting' | 'warn' | 'danger' | 'neutral';

export interface StatusChipProps {
  readonly tone: StatusTone;
  /** The status in one or two words: *Ready*, *Needs update*, *Revoked*. */
  readonly word: string;
  /** Why, when the word alone would leave the reader asking. */
  readonly reason?: ReactNode;
}

/** A compact inline status: a dot, the word, and the reason after it. */
export function StatusChip({ tone, word, reason }: StatusChipProps) {
  return (
    <span className="status-chip" data-tone={tone}>
      <span className="status-chip-dot" aria-hidden="true" />
      <span className="status-chip-word">{word}</span>
      {reason !== undefined && (
        <>
          <span className="status-chip-sep" aria-hidden="true">
            ·
          </span>
          <span className="status-chip-reason">{reason}</span>
        </>
      )}
    </span>
  );
}

export interface StatusLineProps {
  /** `ok`, `waiting` or `idle` — the three states the line has a dot colour for. */
  readonly tone: 'ok' | 'waiting' | 'idle';
  /** What the status is about: a token's name, a tool on a device. */
  readonly subject: string;
  readonly word: string;
  /** Shown at the end of the line, such as Connect's *Live* pill. */
  readonly badge?: string | undefined;
}

/**
 * A full-width status line (Connect's step 4, LAI-741): the dot, what it is
 * about, and where it has got to in words. Styled by
 * `routes/screens/connect/connect.css` — see the note at the top of
 * `CodeBlock.tsx`.
 */
export function StatusLine({ tone, subject, word, badge }: StatusLineProps) {
  return (
    <div className="conn-status" data-dot={tone}>
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-status-name">{subject}</span>
      <span className="conn-status-words">{word}</span>
      {badge !== undefined && <span className="conn-live-pill">{badge}</span>}
    </div>
  );
}
