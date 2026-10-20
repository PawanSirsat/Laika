import { useState, type ReactNode } from 'react';
import { EmbeddedScreen, ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import type { PageTab } from '../../page-tabs.ts';

export interface InsightsScreenProps {
  readonly tabs: readonly PageTab[];
  readonly current: string;
  readonly onNavigate: (to: string) => void;
  /** The open tab's screen — Capacity or Usage & cost, exactly as they were. */
  readonly children: ReactNode;
}

/**
 * Insights (LAI-796): the two pages that read across every space, as tabs —
 * Capacity (LAI-754) and Usage & cost (D-084). Usage's range and space
 * selectors are its header controls, so they sit in this page's header;
 * Capacity is live and has no period to choose.
 */
export function InsightsScreen({ tabs, current, onNavigate, children }: InsightsScreenProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="page">
      <ScreenHeader
        variant="page"
        title="Insights"
        onActionsSlot={setSlot}
        below={
          <PageTabs
            label="Insights sections"
            path="/insights"
            tabs={tabs}
            current={current}
            onNavigate={onNavigate}
          />
        }
      />
      <EmbeddedScreen slot={slot}>{children}</EmbeddedScreen>
    </div>
  );
}
