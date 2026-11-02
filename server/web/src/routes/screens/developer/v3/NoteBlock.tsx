import type { ReactNode } from 'react';

export type NoteTone = 'neutral' | 'warn' | 'accent' | 'danger';

export interface NoteBlockProps {
  readonly tone?: NoteTone;
  /** A few words in bold above the body. */
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  /** A `data-note` hook, for tests and for the reader's own find. */
  readonly note?: string;
  /** `alert` only for something that has just gone wrong. */
  readonly role?: 'alert' | 'status';
}

/**
 * A sentence that needs its own ground (LAI-1078): the design's note block —
 * a quiet card, a warm one for a warning, the accent for what is the point of
 * the step. The tone is never the only signal; the title says it in words.
 */
export function NoteBlock({ tone = 'neutral', title, children, note, role }: NoteBlockProps) {
  return (
    <div className="dx-note" data-tone={tone} data-note={note} role={role}>
      {title !== undefined && <strong className="dx-note-title">{title}</strong>}
      {children !== undefined && <div className="dx-note-body">{children}</div>}
    </div>
  );
}
