import type { PanelAgent } from './ExecutionPanel.tsx';
import type { HandoffFilter, HandoffKind } from './agent-states.ts';

/*
 * Inbox → Hand-offs, as data (LAI-536): which filter an offer belongs to and
 * what the badge counts. Kept out of the component so `node --test` can read
 * it.
 */

/** One offer in the inbox — the shape `handoff_offers` will be read into. */
export interface HandoffItem {
  readonly id: string;
  readonly kind: HandoffKind;
  /** Received means it is addressed to one of your agents. */
  readonly direction: 'received' | 'sent';
  readonly taskKey: string;
  readonly taskTitle: string;
  /** Null for a work request or a recovery — they come from no session. */
  readonly from: PanelAgent | null;
  /** Null means any eligible agent. */
  readonly to: PanelAgent | null;
  /** Its state, in words: "Open", "Waiting for approval", "Expired". */
  readonly state: string;
  /** Whether it needs **your** action now. Only these are counted. */
  readonly yourMove: boolean;
  readonly needsApproval: boolean;
  readonly age: string;
}

export function matches(item: HandoffItem, filter: HandoffFilter): boolean {
  switch (filter) {
    case 'received':
      return item.direction === 'received';
    case 'sent':
      return item.direction === 'sent';
    case 'needs_approval':
      return item.needsApproval;
    case 'recovery':
      return item.kind === 'recovery';
  }
}

/** Open items that need the reader's action. Expired or resolved ones never count. */
export function actionCount(items: readonly HandoffItem[], filter: HandoffFilter): number {
  return items.filter((item) => item.yourMove && matches(item, filter)).length;
}
