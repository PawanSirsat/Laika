import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { EmbeddedScreen, ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { PageTabs } from '../../../components/PageTabs.tsx';
import type { MeProfile } from '../../../api/me.ts';
import { useGates } from '../../../api/permissions.ts';
import type { DeveloperAccessMode } from '../../../api/developer-compat.ts';
import { ADVANCED_ACTIVITY_SECTION, isV3OnlyTab, type PageTab } from '../../page-tabs.ts';
import { ConnectScreen } from '../connect/ConnectScreen.tsx';
import { ShareActivity } from '../connect/ShareActivity.tsx';
import { TokensScreen } from '../tokens/TokensScreen.tsx';
import { AgentsTab } from './AgentsTab.tsx';
import { ProjectsTab } from './ProjectsTab.tsx';
import { AdvancedTab } from './v3/AdvancedTab.tsx';
import { DevicesTab } from './v3/DevicesTab.tsx';
import { OverviewTab } from './v3/OverviewTab.tsx';
import { ProjectSetupTab } from './v3/ProjectSetupTab.tsx';
import './developer.css';
import './v3/v3.css';
import './v3/design.css';

/**
 * In `preview`, Project setup's new flow is one query away from the classic
 * Projects tab, which stays the tab's default (LAI-1052).
 */
const PREVIEW_SETUP = 'v3';
const PREVIEW_SETUP_HREF = `/developer?tab=projects&setup=${PREVIEW_SETUP}`;

/** The page's sentence in the owner's design (LAI-1078). */
const V3_DESCRIPTION =
  'Pair your computer once, connect your coding tools, then set up each project repository. Project setup is where work becomes connected.';

export interface DeveloperScreenProps {
  /** How this deployment shows the page (LAI-1048); `classic` is today's. */
  readonly mode: DeveloperAccessMode;
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
 * page — four tabs since LAI-507, five since LAI-537, in the order a new
 * developer meets them.
 *
 * - **Connect** is the wizard itself (LAI-740), embedded: its header gives up
 *   its band and hands the board's address to this page's header, as every
 *   embedded screen does. Everything in it is **once per machine**.
 * - **Agents** is the reader's registered agents (LAI-537, D-114): each its
 *   own identity and credential, registered by a five-step wizard.
 * - **Projects** is what is **once per project**: the block for the agent's
 *   instructions file and the short prompt that writes it.
 * - **Activity** is what the organisation collects from the machine, once.
 * - **Tokens** is the Tokens screen, its *New token* in this page's header.
 *
 * The compact *Connect an agent* card (LAI-796) and the wizard's *Optional*
 * rail went with it: the card previewed the wizard that is now one click away,
 * and each optional entry is a tab — except *Invite a teammate*, which is
 * Organisation → People's.
 *
 * ## V3, behind `LAIKA_DEVELOPER_ACCESS` (LAI-1048, plan §I)
 *
 * - **`classic`** is everything above, unchanged.
 * - **`preview`** keeps it, Connect still the default, and adds Overview,
 *   Devices and Advanced after the classic tabs, each marked *Preview*, with
 *   a banner on Connect pointing at them and one on each saying it is one.
 * - **`v3`** is Overview · Project setup · Devices · Advanced, Overview
 *   first, in the owner's design (LAI-1078). The old tab ids are aliases
 *   (`developerAlias`), applied before this renders; *Activity* is the second
 *   card on Advanced, and `?section=activity` scrolls to it.
 *
 * `projects` and `activity` are one id in every mode, so they render the same
 * content everywhere: Project setup re-hosts Projects, Activity moves as is.
 * Devices re-hosts Agents — its redesign is slices D3 and D4. Advanced is
 * the reader's personal credentials only (LAI-1058, `v3/AdvancedTab.tsx`);
 * in `v3` Activity says *Once per device* and points at Project setup, its
 * rules, scope and history unchanged.
 */
export function DeveloperScreen({
  mode,
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
  const v3Here = mode === 'v3' || (mode === 'preview' && isV3OnlyTab(current));
  const preview = mode === 'preview';
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };
  return (
    <div className={`page dev-page dev-page-${current}`} data-developer-access={mode}>
      <ScreenHeader
        variant="page"
        title="Developer access"
        description={
          v3Here
            ? V3_DESCRIPTION
            : 'A token lets a tool act as you — point your coding agent at this board, or call the API. It carries your permissions, so treat it like your password.'
        }
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
      {preview && current === 'connect' && (
        <aside className="dev-v3-banner" aria-label="Preview">
          <p>
            <strong>Try the new Developer access.</strong> It is a preview: these tabs keep working
            exactly as they do now.
          </p>
          <a href="/developer?tab=overview" onClick={go('/developer?tab=overview')}>
            Open the preview
          </a>
        </aside>
      )}
      {preview && current === 'projects' && params.get('setup') !== PREVIEW_SETUP && (
        <aside className="dev-v3-banner" aria-label="Preview">
          <p>
            <strong>Try the new Project setup.</strong> It sets up one repository for one of your
            connected tools. This tab keeps working exactly as it does now.
          </p>
          <a href={PREVIEW_SETUP_HREF} onClick={go(PREVIEW_SETUP_HREF)}>
            Open the preview
          </a>
        </aside>
      )}
      {preview && current === 'projects' && params.get('setup') === PREVIEW_SETUP && (
        <aside className="dev-v3-banner" aria-label="Preview">
          <p>
            <strong>Preview.</strong> This is the new Project setup, still being built. The classic
            Projects tab is unchanged.
          </p>
          <a href="/developer?tab=projects" onClick={go('/developer?tab=projects')}>
            Back to Projects
          </a>
        </aside>
      )}
      {preview && isV3OnlyTab(current) && (
        <aside className="dev-v3-banner" aria-label="Preview">
          <p>
            <strong>Preview.</strong> This is the new Developer access, still being built. The
            classic tabs are unchanged.
          </p>
          <a href="/developer?tab=connect" onClick={go('/developer?tab=connect')}>
            Back to Connect
          </a>
        </aside>
      )}
      {current === 'overview' && (
        <OverviewTab
          onNavigate={onNavigate}
          {...(preview ? { projectsHref: PREVIEW_SETUP_HREF } : {})}
        />
      )}
      {current === 'devices' && (
        <DevicesTab
          me={me}
          origin={origin}
          params={params}
          setParams={setParams}
          preview={preview}
        />
      )}
      {current === 'advanced' && (
        <div className="dx dev-advanced-page">
          <div className="dev-card dev-tokens dev-advanced">
            <AdvancedTab me={me} onNavigate={onNavigate} />
          </div>
          {mode === 'v3' && (
            <ActivityCard
              v3
              canSetInsights={gates.org('org.developer_insights.set')}
              origin={origin}
              focus={params.get('section') === ADVANCED_ACTIVITY_SECTION}
            />
          )}
        </div>
      )}
      {current === 'connect' && (
        <EmbeddedScreen slot={slot}>
          <ConnectScreen me={me} origin={origin} params={params} setParams={setParams} />
        </EmbeddedScreen>
      )}
      {current === 'agents' && (
        <div className="dev-body">
          <AgentsTab me={me} origin={origin} />
        </div>
      )}
      {current === 'projects' &&
        (mode === 'v3' || (preview && params.get('setup') === PREVIEW_SETUP) ? (
          <ProjectSetupTab
            origin={origin}
            params={params}
            setParams={setParams}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="dev-body">
            <ProjectsTab origin={origin} />
          </div>
        ))}
      {current === 'activity' && (
        <div className="dev-body">
          <ActivityCard
            v3={mode === 'v3'}
            canSetInsights={gates.org('org.developer_insights.set')}
            origin={origin}
            focus={false}
          />
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

/**
 * *Share local activity* (D-079, D-102 amended): its own tab in classic and
 * preview, and Advanced's second card in `v3` (LAI-1078), where an address
 * naming it (`?section=activity`, which the old `?tab=activity` becomes)
 * scrolls it into view and puts focus on its title.
 */
function ActivityCard({
  v3,
  canSetInsights,
  origin,
  focus,
}: {
  readonly v3: boolean;
  readonly canSetInsights: boolean;
  readonly origin: string;
  readonly focus: boolean;
}) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!focus) return;
    titleRef.current?.scrollIntoView({ block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <section
      className="dev-card dev-sharing"
      aria-labelledby="dev-sharing-title"
      id={v3 ? ADVANCED_ACTIVITY_SECTION : undefined}
    >
      <div className="dev-card-head">
        <h2
          className="dev-card-title"
          id="dev-sharing-title"
          ref={titleRef}
          tabIndex={v3 ? -1 : undefined}
        >
          Share local activity
        </h2>
        <span className="conn-chip conn-chip-scope">
          {v3 ? 'Once per device' : 'Once per machine'}
        </span>
      </div>
      <ShareActivity
        canSetInsights={canSetInsights}
        origin={origin}
        {...(v3 ? { setupTabName: 'Project setup' } : {})}
      />
    </section>
  );
}
