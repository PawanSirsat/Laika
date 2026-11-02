import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'accent' | 'danger';

/**
 * The design's chip (LAI-1078): a word in a pill — *Paired*, *2 of 3
 * complete*, *Next step*. The word carries the meaning; the tone repeats it.
 * A status with a reason after it is `StatusChip`'s, not this.
 */
export function DesignChip({
  tone = 'neutral',
  children,
}: {
  readonly tone?: ChipTone;
  readonly children: ReactNode;
}) {
  return (
    <span className="dx-chip" data-tone={tone}>
      {children}
    </span>
  );
}
