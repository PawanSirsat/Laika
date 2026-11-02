import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { getCompatibility } from '../../../../api/developer-updates.ts';
import { listDevices, type Device } from '../../../../api/devices.ts';
import { listProjectSetups, type ProjectSetup } from '../../../../api/project-setups.ts';
import { getAgentVerification } from '../../../../api/tool-setup.ts';
import { useProjects } from '../../../../api/use-projects.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import { DesignChip } from './DesignChip.tsx';
import { DxIcon, type DxIconName } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import {
  ADVANCED_ADDRESS,
  OVERVIEW_ADDRESSES,
  SETUP_CHIPS,
  attentionItems,
  heroOf,
  journeyComplete,
  journeyRows,
  overviewState,
  overviewSummary,
  setupLine,
  setupTitle,
  statusLines,
  type HeroKind,
  type SetupChipKey,
} from './overview-state.ts';
import { updateManifestOf, updateStatus, type UpdateStatus } from './update-status.ts';
import './overview.css';

export interface OverviewTabProps {
  readonly onNavigate: (to: string) => void;
  /** Where *Set up a project* goes; `preview` sends it to the new flow (LAI-1052). */
  readonly projectsHref?: string;
}

/** The Overview's two reads, together: neither is drawn without the other. */
interface Loaded {
  readonly devices: readonly Device[];
  readonly setups: readonly ProjectSetup[];
}

interface Failure {
  readonly resource: string;
  readonly cause: unknown;
}

const SETUP_ICON: Readonly<Record<SetupChipKey, DxIconName>> = {
  checked: 'check',
  recorded: 'repo',
  'update-available': 'alert',
  missing: 'alert',
};

/** An in-app link: a real `href`, and a plain click stays in the page. */
function AppLink({
  href,
  className,
  primary = false,
  onNavigate,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  /** The view's main action — where focus goes when the view changes under it. */
  readonly primary?: boolean;
  readonly onNavigate: (to: string) => void;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };
  return (
    <a
      href={href}
      className={className}
      onClick={onClick}
      {...(primary ? { 'data-primary': '' } : {})}
    >
      {children}
    </a>
  );
}

/**
 * Developer access V3 → Overview (LAI-1048, LAI-1079), in the owner's design:
 * one next step, the three-step journey, where things stand, and the
 * repository setups made so far.
 *
 * Everything on it is worked out from two reads every time
 * (`overview-state.ts`): `GET /devices` — the Devices tab's own read, so the
 * two pages count alike — and the reader's setup records across every project
 * (`GET /project-setups`, LAI-1077). Each tool that has reached the board is
 * also asked for its helper's version report, once, so a helper the board
 * needs updated is named under the hero.
 *
 * It reads again when the reader comes back to the tab — the step that sends
 * them away (running a command on their machine) finishes elsewhere — and a
 * change is announced through the throttled live region.
 */
export function OverviewTab({
  onNavigate,
  projectsHref = OVERVIEW_ADDRESSES.projects,
}: OverviewTabProps) {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [error, setError] = useState<Failure | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [updates, setUpdates] = useState<ReadonlyMap<string, UpdateStatus>>(new Map());
  const [message, announce] = useLiveRegion();
  const projects = useProjects();
  const spoken = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  const shownKind = useRef<HeroKind | undefined>(undefined);

  const load = useCallback((signal?: AbortSignal): void => {
    void Promise.allSettled([
      listDevices(signal),
      listProjectSetups(undefined, undefined, signal),
    ]).then(([devices, setups]) => {
      if (signal?.aborted === true) return;
      if (devices.status === 'rejected') {
        setError({ resource: 'your devices', cause: devices.reason });
        return;
      }
      if (setups.status === 'rejected') {
        setError({ resource: 'your repository setups', cause: setups.reason });
        return;
      }
      setLoaded({ devices: devices.value.data, setups: setups.value });
      setError(null);
      setNow(Date.now());
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const state = useMemo(
    () => (loaded === undefined ? undefined : overviewState(loaded.devices, loaded.setups, now)),
    [loaded, now],
  );

  /*
   * Each tool that has reached the board, asked once for its helper's report
   * (`GET /agents/:id/verification`) beside the board's own answer — the
   * Devices tab's update status, read the same way. Only *Update required* is
   * said here; a failed read says nothing rather than something wrong.
   */
  const seenKey =
    state === undefined
      ? ''
      : state.tools
          .filter((agent) => agent.last_seen_at !== null)
          .map((agent) => agent.id)
          .join(',');
  useEffect(() => {
    if (seenKey === '') return;
    const ids = seenKey.split(',');
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([
      getCompatibility(signal).then(
        (body) => updateManifestOf(body) ?? ('failed' as const),
        () => 'failed' as const,
      ),
      Promise.all(
        ids.map((id) =>
          getAgentVerification(id, signal).then(
            (v) => v.client_report,
            () => 'failed' as const,
          ),
        ),
      ),
    ]).then(([manifest, reports]) => {
      if (signal.aborted) return;
      setUpdates(new Map(ids.map((id, i) => [id, updateStatus(manifest, reports[i])])));
    });
    return () => {
      controller.abort();
    };
  }, [seenKey]);

  // The first answer is what the page shows; a later one that changes it is news.
  useEffect(() => {
    if (state === undefined) return;
    const said = overviewSummary(state);
    if (spoken.current !== undefined && spoken.current !== said) announce(said);
    spoken.current = said;
  }, [state, announce]);

  /*
   * A refetch can swap the next step under the reader — *Continue setup*
   * becomes *Set up a project* the moment their first tool connects — and the
   * link they were on goes with it, which leaves focus on `body`. Then focus
   * goes to the new main action. Focus anywhere else is left alone.
   */
  useEffect(() => {
    if (state === undefined) return;
    const before = shownKind.current;
    shownKind.current = state.hero;
    if (before === undefined || before === state.hero) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost) return;
    root.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
  }, [state]);

  const names = useMemo(
    () => new Map(projects.projects.map((project) => [project.id, project.name])),
    [projects.projects],
  );

  let body: ReactNode;
  if (error !== null) {
    body = (
      <ApiErrorState
        error={error.cause}
        resource={error.resource}
        scope="organisation"
        onRetry={() => {
          setError(null);
          load();
        }}
      />
    );
  } else if (state === undefined) {
    body = <LoadingState shape="card" count={2} label="Loading your developer access" />;
  } else {
    const toolsHref = OVERVIEW_ADDRESSES.tools;
    const hero = heroOf(state, now, projectsHref, toolsHref);
    const attention = attentionItems(state, updates, now);
    const rows = journeyRows(state, projectsHref, toolsHref);
    body = (
      <>
        <div className="dx-columns">
          <div className="dx-stack">
            <section
              className="dx-card dx-hero"
              aria-labelledby="dx-overview-hero-title"
              data-hero={hero.kind}
            >
              <div className="dx-card-pad dx-hero-inner">
                <p className="dx-eyebrow">{hero.eyebrow}</p>
                <h2 className="dx-hero-title" id="dx-overview-hero-title">
                  {hero.title}
                </h2>
                <p className="dx-hero-sub">{hero.sub}</p>
                <div className="dx-actions">
                  <AppLink
                    href={hero.primary.href}
                    className="dx-btn dx-btn-primary"
                    primary
                    onNavigate={onNavigate}
                  >
                    {hero.primary.label}
                  </AppLink>
                  {hero.secondary !== undefined && (
                    <AppLink href={hero.secondary.href} className="dx-btn" onNavigate={onNavigate}>
                      {hero.secondary.label}
                    </AppLink>
                  )}
                </div>
              </div>
            </section>
            {attention.length > 0 && (
              <NoteBlock tone="warn" title="Needs your attention" note="attention">
                <ul className="dx-overview-attention">
                  {attention.map((item) => (
                    <li key={item.agentId} data-agent={item.agentId}>
                      <AppLink href={item.href} onNavigate={onNavigate}>
                        {item.label}
                      </AppLink>
                      : {item.why}
                    </li>
                  ))}
                </ul>
              </NoteBlock>
            )}
            <section className="dx-card" aria-labelledby="dx-overview-journey" data-journey="">
              <div className="dx-card-pad dx-overview-journey-head">
                <div className="dx-card-head">
                  <h2 className="dx-card-title" id="dx-overview-journey">
                    Your setup journey
                  </h2>
                  <DesignChip tone="accent">{journeyComplete(rows)}</DesignChip>
                </div>
                <p className="dx-card-sub">One clear path; finished steps are skipped next time.</p>
              </div>
              <ol className="dx-flow">
                {rows.map((row, i) => (
                  <li
                    key={row.step}
                    className="dx-flow-row"
                    data-step={row.step}
                    data-state={row.state}
                  >
                    <span
                      className="dx-flow-n"
                      aria-hidden="true"
                      {...(row.state === 'pending' ? {} : { 'data-state': row.state })}
                    >
                      {row.state === 'done' ? <DxIcon name="check" size={16} /> : i + 1}
                    </span>
                    <div className="dx-flow-text">
                      <strong className="dx-flow-name">
                        <span className="visually-hidden">
                          {`Step ${String(i + 1)}, ${row.state === 'done' ? 'done' : row.state === 'active' ? 'next' : 'later'}: `}
                        </span>
                        {row.name}
                      </strong>
                      <span className="dx-flow-line">{row.line}</span>
                    </div>
                    {row.locked === undefined ? (
                      <AppLink
                        href={row.action.href}
                        className="dx-btn dx-btn-sm"
                        onNavigate={onNavigate}
                      >
                        {row.action.label}
                        <span className="visually-hidden">{`: ${row.name}`}</span>
                      </AppLink>
                    ) : (
                      <button
                        type="button"
                        className="dx-btn dx-btn-sm"
                        disabled
                        title={row.locked}
                      >
                        {row.action.label}
                        <span className="visually-hidden">{`: ${row.name}. ${row.locked}`}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <div className="dx-stack">
            <section className="dx-card" aria-labelledby="dx-overview-status" data-status="">
              <div className="dx-card-pad">
                <h2 className="dx-card-title" id="dx-overview-status">
                  Connection status
                </h2>
                <ul className="dx-stats">
                  {statusLines(state).map((line) => (
                    <li key={line.key} className="dx-stat" data-stat={line.key}>
                      <span className="dx-icon">
                        <DxIcon name={line.icon} />
                      </span>
                      <div className="dx-stat-text">
                        <strong className="dx-stat-count">{line.count}</strong>
                        <span className="dx-stat-names" title={line.names}>
                          {line.names}
                        </span>
                      </div>
                      <DesignChip tone={line.chip.tone}>{line.chip.word}</DesignChip>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <section
              className="dx-card"
              aria-labelledby="dx-overview-distinction"
              data-distinction=""
            >
              <div className="dx-card-pad">
                <p className="dx-label">Important distinction</p>
                <h2 className="dx-card-title" id="dx-overview-distinction">
                  Access ≠ repository setup
                </h2>
                <p className="dx-overview-distinction-body">
                  A tool reaches only the projects you give it, on Project setup. The project prompt
                  only adds the Laika block to a repository’s instructions file, and never carries a
                  credential.
                </p>
                <AppLink
                  href={projectsHref}
                  className="dx-btn dx-btn-soft dx-btn-full"
                  onNavigate={onNavigate}
                >
                  Explore project setup →
                </AppLink>
                <p className="dx-overview-aside">
                  Scripts and the API use your personal credentials, under{' '}
                  <AppLink href={ADVANCED_ADDRESS} onNavigate={onNavigate}>
                    Advanced
                  </AppLink>
                  .
                </p>
              </div>
            </section>
          </div>
        </div>
        <section className="dx-overview-setups" aria-labelledby="dx-overview-setups" data-setups="">
          <SectionTitle
            title="Your repository setups"
            titleId="dx-overview-setups"
            sub="Project setup is the main outcome: one block in each repository’s instructions file."
          />
          <div className="dx-card">
            <ul className="dx-records">
              <li className="dx-record" data-setup="new">
                <span className="dx-icon">
                  <DxIcon name="repo" />
                </span>
                <div className="dx-record-main">
                  <strong className="dx-record-title">Set up a new repository</strong>
                  <span className="dx-record-sub">
                    Choose a Laika project and one of your tools, then copy the prompt into it.
                  </span>
                </div>
                <div className="dx-record-end">
                  <AppLink
                    href={projectsHref}
                    className="dx-btn dx-btn-primary"
                    onNavigate={onNavigate}
                  >
                    Set up repository →
                  </AppLink>
                </div>
              </li>
              {state.setups.map((row) => {
                const chip = SETUP_CHIPS[row.chip];
                const title = setupTitle(row, names.get(row.projectId) ?? row.projectSlug);
                const line = setupLine(row);
                return (
                  <li key={row.key} className="dx-record" data-setup={row.chip}>
                    <span className="dx-icon">
                      <DxIcon name={SETUP_ICON[row.chip]} />
                    </span>
                    <div className="dx-record-main">
                      <strong className="dx-record-title" title={title}>
                        {title}
                      </strong>
                      <span className="dx-record-sub" title={line}>
                        {line}
                      </span>
                    </div>
                    <div className="dx-record-end">
                      <DesignChip tone={chip.tone}>{chip.word}</DesignChip>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="dx dx-overview" data-testid="dev-overview" ref={root}>
      <LiveRegion message={message} />
      {body}
    </div>
  );
}
