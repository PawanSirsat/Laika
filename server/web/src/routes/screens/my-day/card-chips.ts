import type { TaskRef } from '../../../api/time.ts';

/**
 * The cards a block can be put on in one click (LAI-831, the owner's design):
 * the block's own card first, then the reader's own work in progress — what
 * *On your plate* already read — then the other cards on their day. Each once,
 * and a handful: any other card is typed by its key. Every one comes from an
 * API response; nothing here invents a card.
 */

export const CHIP_CAP = 6;

/** Why a card is offered (the design's chips, LAI-515): said beside its key. */
export type ChipWhy =
  'In progress' | 'Agent worked on it' | 'On your day' | 'Card before' | 'Card after';

export interface CardChip {
  readonly task: TaskRef;
  /** Absent on the block's own card. */
  readonly why: ChipWhy | undefined;
}

export function cardChipsWhy(
  own: TaskRef | null,
  inProgress: readonly TaskRef[],
  onTheDay: readonly TaskRef[],
  cap: number = CHIP_CAP,
  /** The cards an agent worked on that day (`agent.by_task`): no agent's name, only that one did. */
  byAgent: readonly TaskRef[] = [],
): CardChip[] {
  const seen = new Set<string>();
  const out: CardChip[] = [];
  const take = (card: TaskRef, why: ChipWhy | undefined): boolean => {
    if (seen.has(card.key)) return out.length < cap;
    seen.add(card.key);
    out.push({ task: card, why });
    return out.length < cap;
  };
  if (own !== null && !take(own, undefined)) return out;
  for (const card of inProgress) if (!take(card, 'In progress')) return out;
  for (const card of byAgent) if (!take(card, 'Agent worked on it')) return out;
  for (const card of onTheDay) if (!take(card, 'On your day')) return out;
  return out;
}

export function cardChips(
  own: TaskRef | null,
  inProgress: readonly TaskRef[],
  onTheDay: readonly TaskRef[],
  cap: number = CHIP_CAP,
): TaskRef[] {
  return cardChipsWhy(own, inProgress, onTheDay, cap).map((c) => c.task);
}
