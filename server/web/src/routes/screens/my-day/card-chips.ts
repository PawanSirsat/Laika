import type { TaskRef } from '../../../api/time.ts';

/**
 * The cards a block can be put on in one click (LAI-831, the owner's design):
 * the block's own card first, then the reader's own work in progress — what
 * *On your plate* already read — then the other cards on their day. Each once,
 * and a handful: any other card is typed by its key. Every one comes from an
 * API response; nothing here invents a card.
 */

export const CHIP_CAP = 6;

export function cardChips(
  own: TaskRef | null,
  inProgress: readonly TaskRef[],
  onTheDay: readonly TaskRef[],
  cap: number = CHIP_CAP,
): TaskRef[] {
  const seen = new Set<string>();
  const out: TaskRef[] = [];
  for (const card of [...(own === null ? [] : [own]), ...inProgress, ...onTheDay]) {
    if (seen.has(card.key)) continue;
    seen.add(card.key);
    out.push(card);
    if (out.length === cap) break;
  }
  return out;
}
