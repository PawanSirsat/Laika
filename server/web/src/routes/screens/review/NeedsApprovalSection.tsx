import { useState, type MouseEvent } from 'react';
import type { PersonInboxCounts } from '../../../api/handoffs.ts';
import { HandoffsTab } from '../inbox/HandoffsTab.tsx';
import { plainClick } from '../my-day/task-link.ts';
import { Icon } from '../../../components/icon/Icon.tsx';

/** Review's *All hand-offs* view — the whole Hand-offs tab, one link away. */
export const ALL_HANDOFFS_HREF = '/inbox?tab=review&view=handoffs';

export interface NeedsApprovalSectionProps {
  readonly meId: string | undefined;
  /** The shell's live counts (LAI-1009); the heading's N is `needs_approval`. */
  readonly counts: PersonInboxCounts | undefined;
  readonly onChanged: () => void;
  readonly onNavigate: (to: string) => void;
}

/**
 * *Needs your approval (N)* at the top of the Review tab (D-146 item 4,
 * LAI-1169): the hand-offs between agents that wait on this person's say-so,
 * folded in where the rest of their decisions are. It is the Hand-offs tab
 * fixed on its *Needs approval* view — the same rows, the same Approve, the
 * same hold while a write is out — under a heading that counts them.
 *
 * Drawn only once the shell's count is known and above zero. **Once drawn it
 * stays for the page's life**: approving the last offer makes the count 0
 * while the reader's focus is still on that row, and a section that unmounted
 * under them would drop the focus to the page. The tab's own empty state
 * says there is nothing left.
 */
export function NeedsApprovalSection({
  meId,
  counts,
  onChanged,
  onNavigate,
}: NeedsApprovalSectionProps) {
  const waiting = counts?.needs_approval;
  const [shown, setShown] = useState(false);
  if (waiting !== undefined && waiting > 0 && !shown) setShown(true);
  if (!shown && !(waiting !== undefined && waiting > 0)) return null;
  const count = waiting ?? 0;
  return (
    <section className="rev-approvals" aria-labelledby="rev-approvals-title" data-needs-approval>
      <header className="rev-approvals-head">
        <h3 className="rev-group-title" id="rev-approvals-title">
          Needs your approval
          <span className="rev-group-count"> ({count})</span>
        </h3>
        <a
          className="rev-approvals-all"
          href={ALL_HANDOFFS_HREF}
          onClick={(event: MouseEvent) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            onNavigate(ALL_HANDOFFS_HREF);
          }}
        >
          All hand-offs
          <Icon name="arrow-right" size="tiny" />
        </a>
      </header>
      <HandoffsTab
        meId={meId}
        counts={counts}
        onChanged={onChanged}
        onNavigate={onNavigate}
        only="needs_approval"
      />
    </section>
  );
}
