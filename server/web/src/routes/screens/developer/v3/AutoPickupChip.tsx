import type { Launcher } from '../../../../api/capacity.ts';
import { autoPickupWords } from '../../../../components/agent/capacity-derive.ts';
import { DesignChip } from './DesignChip.tsx';
import { HintChip } from './StatusLegend.tsx';

/**
 * *Auto-pickup: on · 40 s*, *off*, or *not heard since …* (D-126 item 4,
 * LAI-1102) — a tool's launcher, or a device's, **from `launcher.state`
 * alone**: the board says `on` only for an enabled report under three minutes
 * old, and this never re-decides it.
 *
 * On a row it is a {@link HintChip}, its reason the chip's description and
 * tooltip, like every status there; in a panel the reason is written out
 * beside it, the way the panel's own status is. The word carries the meaning
 * and the tone repeats it.
 */
export function AutoPickupChip({
  launcher,
  now,
  device,
  layout = 'row',
}: {
  readonly launcher: Launcher;
  readonly now: number;
  /** Where the launcher runs, by the device's name. */
  readonly device: string;
  readonly layout?: 'row' | 'panel';
}) {
  const words = autoPickupWords(launcher, now, device);
  if (layout === 'panel') {
    return (
      <span className="dv3-panel-status" data-auto-pickup={words.state}>
        <DesignChip tone={words.tone}>{words.word}</DesignChip>
        {/* Read at the size of the panel's other notes, not its values. */}
        <span className="dv3-panel-reason dv3-note">{words.reason}</span>
      </span>
    );
  }
  return (
    <span data-auto-pickup={words.state}>
      <HintChip word={words.word} tone={words.tone} description={words.reason} />
    </span>
  );
}
