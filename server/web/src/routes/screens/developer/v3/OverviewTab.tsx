import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
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
import { DxIcon } from './DxIcon.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import {
  ADVANCED_ADDRESS,
  OVERVIEW_ADDRESSES,
  attentionItems,
  heroOf,
  journeyComplete,
  journeyRows,
  overviewState,
  overviewSummary,
  statusLines,
  wizardAddress,
  type AttentionItem,
  type HeroKind,
} from './overview-state.ts';
import { RepoRows } from './RepoRows.tsx';
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
 * The Connection status card's tools chip when tools need the reader
 * (LAI-1096): a button that opens the list of them — each tool, why, and the
 * link to its row. It was a note between the hero and the journey; the
 * owner's design has nothing there, so the facts went behind the count.
 *
 * A disclosure, not a menu: the list holds words as well as links. Focus stays
 * on the chip as it opens, and `Tab` walks into the list, which follows it.
 * `Escape` closes it and puts focus back on the chip. A click outside, or
 * focus leaving for anywhere else, closes it in place.
 */
function AttentionChip({
  word,
  items,
  onNavigate,
}: {
  readonly word: string;
  readonly items: readonly AttentionItem[];
  readonly onNavigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    setOpen(false);
    button.current?.focus();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const to = event.relatedTarget as Node | null;
    if (!open || to === null || wrap.current?.contains(to) === true) return;
    setOpen(false);
  };

  return (
    <div className="dx-attention" ref={wrap} onKeyDown={onKey} onBlur={onBlur} data-attention="">
      <button
        type="button"
        className="dx-chip dx-chip-button"
        data-tone="warn"
        aria-expanded={open}
        {...(open ? { 'aria-controls': listId } : {})}
        ref={button}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {word}
        <span className="dx-chip-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="dx-attention-pop"
          id={listId}
          role="group"
          aria-label="Needs your attention"
        >
          <p className="dx-attention-title">Needs your attention</p>
          <ul className="dx-attention-list">
            {items.map((item) => (
              <li key={item.agentId} className="dx-attention-item" data-agent={item.agentId}>
                <span className="dx-attention-text">
                  <strong className="dx-attention-name">{item.label}</strong>
                  <span className="dx-attention-why">{item.why}</span>
                </span>
                <AppLink
                  href={item.href}
                  className="dx-attention-link"
                  onNavigate={(to) => {
                    setOpen(false);
                    onNavigate(to);
                  }}
                >
                  {item.action}
                  <span className="visually-hidden">{`: ${item.label}`}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
 * needs updated is among the tools the Connection status card says need the
 * reader (LAI-1096). How to update is in that tool's Details, and its
 * device's: the Overview carries no notice of its own.
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
   * said here, behind the tools chip; a failed read says nothing rather than
   * something wrong.
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
            <section className="dx-card" aria-labelledby="dx-overview-journey" data-journey="">
              <div className="dx-card-pad dx-overview-journey-head">
                <div className="dx-card-head">
                  <h2 className="dx-card-title" id="dx-overview-journey">
                    Your setup journey
                  </h2>
                  <DesignChip tone="accent">{journeyComplete(rows)}</DesignChip>
                </div>
                <p className="dx-card-sub">
                  One clear path, with finished steps skipped next time.
                </p>
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
                  {statusLines(state, attention).map((line) => (
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
                      {line.key === 'tools' && attention.length > 0 ? (
                        <AttentionChip
                          word={line.chip.word}
                          items={attention}
                          onNavigate={onNavigate}
                        />
                      ) : (
                        <DesignChip tone={line.chip.tone}>{line.chip.word}</DesignChip>
                      )}
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
        {/* The design's title; the region keeps the name of what it lists (LAI-1096). */}
        <section className="dx-overview-setups" aria-label="Your repository setups" data-setups="">
          <SectionTitle title="Project setup is the main outcome" titleId="dx-overview-setups" />
          <div className="dx-card">
            <ul className="dx-records">
              <li className="dx-record" data-setup="new">
                <span className="dx-icon">
                  <DxIcon name="repo" />
                </span>
                <div className="dx-record-main">
                  <strong className="dx-record-title">Set up a new repository</strong>
                  <span className="dx-record-sub">
                    Choose an existing Laika project, your connected tool, then copy a safe prompt
                    into your agent.
                  </span>
                </div>
                <div className="dx-record-end">
                  {/* The wizard, not the tab: it opens on these rows once there are any. */}
                  <AppLink
                    href={wizardAddress(projectsHref)}
                    className="dx-btn dx-btn-primary"
                    onNavigate={onNavigate}
                  >
                    Set up repository →
                  </AppLink>
                </div>
              </li>
              <RepoRows
                groups={state.setups}
                projectName={(group) => names.get(group.projectId) ?? group.projectSlug}
              />
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
