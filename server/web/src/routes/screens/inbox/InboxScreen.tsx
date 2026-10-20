import { useState, type ReactNode } from 'react';
import { EmbeddedScreen, ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import type { PageTab } from '../../page-tabs.ts';

export interface InboxScreenProps {
  /** The tabs this reader is offered — Unlisted work is admin-up. */
  readonly tabs: readonly PageTab[];
  readonly current: string;
  /** What waits on each tab, from the shell's own counts. */
  readonly counts: Readonly<Record<string, number | undefined>>;
  readonly onNavigate: (to: string) => void;
  /** The open tab's screen — Review or Unlisted work, exactly as they were. */
  readonly children: ReactNode;
}

/**
 * Inbox (LAI-796): the two queues a person works through, as tabs — work an
 * agent handed back for review (D-082), and work nobody filed (§4.14). Each
 * tab is the screen it was; the sidebar's Inbox count is their two counts
 * added.
 */
export function InboxScreen({ tabs, current, counts, onNavigate, children }: InboxScreenProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="page">
      <ScreenHeader
        variant="page"
        title="Inbox"
        onActionsSlot={setSlot}
        below={
          <PageTabs
            label="Inbox sections"
            path="/inbox"
            tabs={tabs}
            current={current}
            counts={counts}
            onNavigate={onNavigate}
          />
        }
      />
      <EmbeddedScreen slot={slot}>{children}</EmbeddedScreen>
    </div>
  );
}
