import { useState } from 'react';
import { EmbeddedScreen, ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import type { MeProfile } from '../../../api/me.ts';
import { useGates } from '../../../api/permissions.ts';
import type { PageTab } from '../../page-tabs.ts';
import { ConnectScreen } from '../connect/ConnectScreen.tsx';
import { ShareActivity } from '../connect/ShareActivity.tsx';
import { TokensScreen } from '../tokens/TokensScreen.tsx';
import { ProjectsTab } from './ProjectsTab.tsx';
import './developer.css';

export interface DeveloperScreenProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly tabs: readonly PageTab[];
  readonly current: string;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  readonly onNavigate: (to: string) => void;
}

/**
 * Developer access (LAI-796): connecting an agent and your own tokens, on one
 * page — four tabs since LAI-507, in the order a new developer meets them.
 *
 * - **Connect** is the wizard itself (LAI-740), embedded: its header gives up
 *   its band and hands the board's address to this page's header, as every
 *   embedded screen does. Everything in it is **once per machine**.
 * - **Projects** is what is **once per project**: the block for the agent's
 *   instructions file and the short prompt that writes it.
 * - **Activity** is what the organisation collects from the machine, once.
 * - **Tokens** is the Tokens screen, its *New token* in this page's header.
 *
 * The compact *Connect an agent* card (LAI-796) and the wizard's *Optional*
 * rail went with it: the card previewed the wizard that is now one click away,
 * and each optional entry is a tab — except *Invite a teammate*, which is
 * Organisation → People's.
 */
export function DeveloperScreen({
  me,
  origin,
  tabs,
  current,
  params,
  setParams,
  onNavigate,
}: DeveloperScreenProps) {
  const gates = useGates(me !== undefined);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className={`page dev-page dev-page-${current}`}>
      <ScreenHeader
        variant="page"
        title="Developer access"
        description="A token lets a tool act as you — point your coding agent at this board, or call the API. It carries your permissions, so treat it like your password."
        onActionsSlot={setSlot}
        below={
          <PageTabs
            label="Developer access sections"
            path="/developer"
            tabs={tabs}
            current={current}
            onNavigate={onNavigate}
          />
        }
      />
      {current === 'connect' && (
        <EmbeddedScreen slot={slot}>
          <ConnectScreen me={me} origin={origin} params={params} setParams={setParams} />
        </EmbeddedScreen>
      )}
      {current === 'projects' && (
        <div className="dev-body">
          <ProjectsTab origin={origin} />
        </div>
      )}
      {current === 'activity' && (
        <div className="dev-body">
          <section className="dev-card dev-sharing" aria-labelledby="dev-sharing-title">
            <div className="dev-card-head">
              <h2 className="dev-card-title" id="dev-sharing-title">
                Share local activity
              </h2>
              <span className="conn-chip conn-chip-scope">Once per machine</span>
            </div>
            <ShareActivity
              canSetInsights={gates.org('org.developer_insights.set')}
              origin={origin}
            />
          </section>
        </div>
      )}
      {current === 'tokens' && (
        <div className="dev-body">
          <div className="dev-card dev-tokens">
            <EmbeddedScreen slot={slot} titled>
              <TokensScreen me={me} />
            </EmbeddedScreen>
          </div>
        </div>
      )}
    </div>
  );
}
