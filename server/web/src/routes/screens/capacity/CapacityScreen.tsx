import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { agentClientName, asAgentClient } from '../../../api/agent-clients.ts';
import {
  getCapacity,
  getPresence,
  type CapacityView,
  type PresenceView,
} from '../../../api/presence.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import { taskStore } from '../../../api/store.ts';
import { getTask, type Task } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { useTheme } from '../../../theme/use-theme.ts';
import { InfoTip } from '../profile/InfoTip.tsx';
import { CapacityCard, LOAD_RULE } from './CapacityCard.tsx';
import {
  barSegments,
  FILTERS,
  matchesQuery,
  passesFilter,
  PRESENCE_FILTERS,
  runningAgents,
  sortPeople,
  SORTS,
  summarize,
  taskIdsToResolve,
  teamLoad,
  workloadIn,
  type CapacityFilter,
  type CapacitySort,
} from './capacity-derive.ts';
import '../../../components/markers.css';
import '../profile/profile.css';
import './capacity.css';

/**
 * A task to open, with its own space (LAI-755). `projectSlug` is `undefined`
 * only when the space list could not be read.
 */
export interface CapacityTaskLink {
  readonly id: string;
  readonly key: string;
  readonly projectSlug: string | undefined;
}

export interface CapacityScreenProps {
  /**
   * Open a task **in the task's own space** (LAI-755). Capacity spans every
   * space, so the space last opened is usually the wrong one.
   */
  readonly onOpenTask: (task: CapacityTaskLink) => void;
  /**
   * Unlisted notes still waiting, from the shell (LAI-754). **`undefined` draws
   * no tile** — a reader without `audit_log.export` is not told the queue
   * exists, the same rule that keeps it out of their sidebar.
   */
  readonly unlistedOpen?: number | undefined;
  /** Tasks waiting for a person on Review, from the shell (D-082); `undefined` until read. */
  readonly reviewWaiting?: number | undefined;
  /** Follow a tile's link without reloading the page. */
  readonly onNavigate: (to: string) => void;
}

/** How often to re-read. §11.4.2's screen is worthless if it silently ages. */
const POLL_MS = 20_000;

/** A focus and a visibility change arrive together; one read answers both. */
const REFOCUS_GAP_MS = 2_000;

/**
 * Capacity — who is here, who is loaded and who can take the next task, across
 * **every space you can see** (§11.4.2, LAI-754; redesigned by LAI-767).
 *
 * **M5's exit criterion**: *"the capacity screen answers 'who takes the next
 * task' without asking."* The owner found the first answer to it — a wide row
 * a person, task chips in every row — not informative: no search, no clear
 * online state, no last seen. So now: a search and filters, tiles that count,
 * one card a person with a status ring and a load badge, and a *Team load*
 * chart that shows an imbalance in one glance.
 *
 * ## What the server decided, and what is left to this screen
 *
 * Status, last seen, the workload counts and the load badge arrive decided
 * (SPEC §9.3): this screen filters, sorts and says them. **What a member may
 * not see is not sent** — the profile kind, the 14-day series and the agents
 * a person is not running are absent from a member's answer, not hidden here.
 *
 * `enabled: false` is a fact, not an empty list: with presence off the cards
 * still show the workload, and say *Presence is off* where a status would be.
 *
 * ## Polling, not SSE
 *
 * `GET /events` carries **activity** per space, not presence — nothing on that
 * stream fires when somebody comes online, so a screen driven by it would sit
 * still while going stale. This re-reads every 20 s while the tab is visible,
 * and at once when it comes back. Tasks are resolved from the shared task
 * store first (LAI-724), and only for what is drawn.
 */
export function CapacityScreen({
  onOpenTask,
  unlistedOpen,
  reviewWaiting,
  onNavigate,
}: CapacityScreenProps) {
  const { theme } = useTheme();
  const [capacity, setCapacity] = useState<CapacityView | undefined>(undefined);
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  /** The last refresh failed while older figures are still on screen. */
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CapacityFilter>('all');
  const [space, setSpace] = useState<string | null>(null);
  const [sort, setSort] = useState<CapacitySort>('online');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [showNever, setShowNever] = useState(false);

  /**
   * The tasks the screen draws, by id: each session's matched task, and the
   * in-progress tasks of a card whose *Show tasks* is open. A held task set
   * answers first (LAI-724); otherwise one `GET /tasks/:id`, asked again on the
   * next poll if it failed.
   */
  const [resolved, setResolved] = useState<ReadonlyMap<string, Task>>(new Map());

  /**
   * Every space this reader can see: for the selector, and so a task opens in
   * its own space (LAI-755). `undefined` until read, `null` if the read failed.
   */
  const [spaces, setSpaces] = useState<
    ReadonlyMap<string, { readonly slug: string; readonly name: string }> | null | undefined
  >(undefined);

  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) {
          setSpaces(
            new Map(
              items
                .filter(isProject)
                .map((project) => [project.id, { slug: project.slug, name: project.name }]),
            ),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSpaces(null);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const lastRead = useRef(0);
  const hasData = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = (): void => {
      lastRead.current = Date.now();
      Promise.all([getCapacity(controller.signal), getPresence(controller.signal)])
        .then(([cap, pres]) => {
          hasData.current = true;
          setCapacity(cap);
          setPresence(pres);
          setNow(Date.now());
          setStale(false);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          // A failed refresh keeps what is on screen and says so; only a
          // first read with nothing to show is an error page.
          if (hasData.current) setStale(true);
          else setError(cause);
        });
    };
    const poll = (): void => {
      if (document.visibilityState !== 'hidden') load();
    };
    const back = (): void => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRead.current < REFOCUS_GAP_MS) return;
      load();
    };
    load();
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, []);

  const wanted = useMemo(
    () =>
      capacity === undefined || presence === undefined
        ? []
        : taskIdsToResolve(
            capacity.people,
            expanded,
            presence.present.map((entry) => entry.matched_task_id),
          ),
    [capacity, presence, expanded],
  );

  useEffect(() => {
    const missing = wanted.filter((id) => !resolved.has(id));
    // Until the spaces are known a held set cannot be consulted, and reading
    // by id first would spend the requests LAI-724 saved.
    if (missing.length === 0 || spaces === undefined) return;

    const held = new Map<string, Task>();
    for (const { slug } of spaces?.values() ?? []) {
      const set = taskStore.peek(slug);
      if (set?.status !== 'ready') continue;
      for (const id of missing) {
        const task = set.byId.get(id);
        if (task !== undefined) held.set(id, task);
      }
    }

    const controller = new AbortController();
    Promise.all(
      missing
        .filter((id) => !held.has(id))
        .map((id) =>
          getTask(id, controller.signal)
            .then((task) => [id, task] as const)
            .catch(() => undefined),
        ),
    )
      .then((fetched) => {
        if (controller.signal.aborted) return;
        const found = [...held, ...fetched.filter((entry) => entry !== undefined)];
        if (found.length === 0) return;
        setResolved((prev) => new Map([...prev, ...found]));
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [wanted, spaces]);

  const slugs = useMemo(
    () =>
      spaces === undefined || spaces === null
        ? spaces
        : new Map([...spaces].map(([id, s]) => [id, s.slug])),
    [spaces],
  );

  const toggleTasks = useCallback((userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  if (error !== null) {
    return <ApiErrorState error={error} resource="capacity" scope="organisation" />;
  }
  if (capacity === undefined || presence === undefined) {
    return <CapacitySkeleton />;
  }

  const on = capacity.enabled;
  const everyone = capacity.people;
  // With presence off, nothing reads presence: those chips and sorts are not
  // offered, and one left chosen falls back rather than filtering on nulls.
  const effectiveFilter: CapacityFilter = !on && PRESENCE_FILTERS.has(filter) ? 'all' : filter;
  const effectiveSort: CapacitySort = !on && (sort === 'online' || sort === 'seen') ? 'load' : sort;
  const searching = query.trim() !== '';
  const shown = sortPeople(
    everyone.filter(
      (person) => matchesQuery(person, query) && passesFilter(person, effectiveFilter, space),
    ),
    effectiveSort,
    space,
  );
  /*
   * **Never seen folds into one line** — unless the reader is looking for them
   * (the Never seen chip) or for somebody by name, when hiding a match would
   * read as "no such person".
   */
  const fold = on && effectiveFilter !== 'never' && !searching && !showNever;
  const cards = fold ? shown.filter((p) => p.status !== 'never') : shown;
  const never = fold ? shown.filter((p) => p.status === 'never') : [];

  const sum = summarize(everyone, space);
  const load = teamLoad(everyone, space);
  const running = everyone
    .flatMap((person) =>
      runningAgents(person)
        .filter((agent) => asAgentClient(agent.client) !== null)
        .map((agent) => ({ person, agent })),
    )
    .sort((a, b) => (b.agent.last_at ?? 0) - (a.agent.last_at ?? 0));
  const presenceFor = (userId: string) => presence.present.find((e) => e.user_id === userId);

  const pick = (next: CapacityFilter): void => {
    setFilter(next);
  };
  const link = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const context = `${String(everyone.length)} ${everyone.length === 1 ? 'person' : 'people'}${
    on ? ` · ${String(sum.online)} online` : ''
  } · ${stale ? `refresh failed, showing ${timeLabel(now, Date.now()).text}` : `updated every ${String(POLL_MS / 1000)}s`}`;

  return (
    <div className="cap-page">
      <ScreenHeader title="Capacity" context={context} />

      <div className="cap">
        {!on && (
          /* **Disabled is not empty.** No control here: turning it on is
             Admin+ on the Organisation screen (LAI-149). */
          <p className="cap-off" role="note">
            <strong>Presence is off for this organisation.</strong> Nobody’s status or last seen is
            recorded — this is not the same as nobody working. Workload below is still current. An
            organisation admin can turn presence on from the Organisation screen.
          </p>
        )}

        <div className="cap-tiles">
          <Tile
            label="Online now"
            value={on ? sum.online : 'Off'}
            sub={on ? `of ${String(everyone.length)} people` : 'presence is off'}
            pressed={effectiveFilter === 'online'}
            {...(on
              ? {
                  onClick: () => {
                    pick(filter === 'online' ? 'all' : 'online');
                  },
                }
              : {})}
            tone="online"
          />
          <Tile
            label="Agents running"
            value={on ? sum.sessions : 'Off'}
            sub={on ? (sum.sessions === 1 ? 'session' : 'sessions') : 'presence is off'}
            pressed={effectiveFilter === 'agents'}
            {...(on
              ? {
                  onClick: () => {
                    pick(filter === 'agents' ? 'all' : 'agents');
                  },
                }
              : {})}
          />
          <Tile
            label="In progress"
            value={sum.inProgress}
            sub="tasks · heaviest first"
            pressed={effectiveSort === 'load'}
            onClick={() => {
              setSort(sort === 'load' ? 'online' : 'load');
            }}
          />
          <Tile
            label="Waiting for review"
            value={reviewWaiting ?? '—'}
            sub="open Review"
            href="/review"
            onLink={link('/review')}
          />
          <Tile
            label="Overdue"
            value={sum.overdue}
            sub="assigned tasks"
            pressed={effectiveFilter === 'overdue'}
            onClick={() => {
              pick(filter === 'overdue' ? 'all' : 'overdue');
            }}
            tone={sum.overdue > 0 ? 'overdue' : undefined}
          />
          {unlistedOpen !== undefined && (
            <Tile
              label="Unlisted work"
              value={unlistedOpen}
              sub="to triage"
              href="/unlisted"
              onLink={link('/unlisted')}
              tone="unlisted"
            />
          )}
        </div>

        <div className="cap-toolbar">
          <label className="cap-search">
            <span className="visually-hidden">Search people</span>
            <svg className="cap-search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              type="search"
              placeholder="Search people by name or email"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>
          <div className="cap-chips" role="group" aria-label="Show">
            {FILTERS.filter((f) => on || !PRESENCE_FILTERS.has(f.id)).map((f) => (
              <button
                key={f.id}
                type="button"
                className="cap-chip"
                aria-pressed={effectiveFilter === f.id}
                onClick={() => {
                  pick(f.id);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="cap-selects">
            <span className="cap-select">
              <span className="cap-select-label" aria-hidden="true">
                Space
              </span>
              <Dropdown
                className="cap-dropdown"
                aria-label="Space"
                value={space ?? ''}
                options={[
                  { value: '', label: 'All spaces' },
                  ...[...(spaces ?? new Map<string, { slug: string; name: string }>())]
                    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                    .map(([id, s]) => ({ value: id, label: s.name })),
                ]}
                onChange={(value) => {
                  setSpace(value === '' ? null : value);
                }}
              />
            </span>
            <span className="cap-select">
              <span className="cap-select-label" aria-hidden="true">
                Sort
              </span>
              <Dropdown<CapacitySort>
                className="cap-dropdown"
                aria-label="Sort"
                value={effectiveSort}
                options={SORTS.filter((s) => on || (s.id !== 'online' && s.id !== 'seen')).map(
                  (s) => ({ value: s.id, label: s.label }),
                )}
                onChange={setSort}
              />
            </span>
            <InfoTip label="About these figures">
              <dl className="prof-defs">
                <dt>Online, away, last seen</dt>
                <dd>
                  The newest of a sign-in, a board action, and an agent’s heartbeat, MCP call or
                  write. Online is the last 5 minutes, away the last hour. Reading the board does
                  not count.
                </dd>
                <dt>Load</dt>
                <dd>{LOAD_RULE}</dd>
                <dt>Workload</dt>
                <dd>
                  Open tasks assigned to them, in the spaces you can see. To do is assigned and not
                  started; overdue is past its due date.
                </dd>
              </dl>
            </InfoTip>
          </div>
        </div>

        <p className="visually-hidden" role="status">
          {`${String(cards.length + never.length)} ${cards.length + never.length === 1 ? 'person' : 'people'} shown`}
        </p>

        {shown.length === 0 ? (
          <EmptyState
            headline="Nobody matches"
            body={
              searching
                ? `No one matches “${query.trim()}” with these filters.`
                : 'No one matches these filters.'
            }
            action={{
              label: 'Clear search and filters',
              onClick: () => {
                setQuery('');
                setFilter('all');
                setSpace(null);
              },
            }}
          />
        ) : (
          <ul className="cap-grid">
            {cards.map((person) => (
              <CapacityCard
                key={person.user_id}
                person={person}
                now={now}
                theme={theme}
                space={space}
                presence={presenceFor(person.user_id)}
                resolved={resolved}
                slugs={slugs}
                expanded={expanded.has(person.user_id)}
                onToggleTasks={() => {
                  toggleTasks(person.user_id);
                }}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        )}

        {never.length > 0 && (
          <div className="cap-never">
            <span className="cap-dot cap-dot-never" aria-hidden="true" />
            <span className="cap-never-text">
              {never.length} {never.length === 1 ? 'person' : 'people'} never seen
              <span className="cap-never-names">: {never.map((p) => p.name).join(', ')}</span>
            </span>
            <button
              type="button"
              className="cap-never-show"
              aria-expanded={false}
              onClick={() => {
                setShowNever(true);
              }}
            >
              Show
            </button>
          </div>
        )}
        {showNever && on && effectiveFilter !== 'never' && !searching && (
          <button
            type="button"
            className="cap-never-show cap-never-hide"
            aria-expanded={true}
            onClick={() => {
              setShowNever(false);
            }}
          >
            Fold people never seen
          </button>
        )}

        <div className="cap-lower">
          <section className="prof-card cap-team" aria-labelledby="cap-team-title">
            <div className="prof-card-head">
              <h2 className="prof-card-title" id="cap-team-title">
                Team load
              </h2>
              <span className="prof-card-caption">
                open work{space === null ? '' : ` in ${spaces?.get(space)?.name ?? 'this space'}`},
                heaviest first
              </span>
            </div>
            {load.rows.length === 0 ? (
              <p className="cap-quiet">Nobody has open work here.</p>
            ) : (
              <ul className="cap-team-rows">
                {load.rows.map((person) => {
                  const work = workloadIn(person, space);
                  const parts = barSegments(work, load.scale);
                  return (
                    <li key={person.user_id} className="cap-team-row">
                      <span className="cap-team-name">
                        <PersonLink userId={person.user_id} className="cap-name-link">
                          {person.name}
                        </PersonLink>
                      </span>
                      <span
                        className="cap-bar cap-team-bar"
                        role="img"
                        aria-label={`${person.name}: ${parts.map((s) => `${String(s.n)} ${s.label.toLowerCase()}`).join(', ')}${work.overdue > 0 ? `, ${String(work.overdue)} overdue` : ''}`}
                      >
                        {parts.map((s) => (
                          <span
                            key={s.key}
                            className={`cap-bar-part cap-part-${s.key}`}
                            style={{ width: `${String(s.pct)}%` }}
                          />
                        ))}
                      </span>
                      <span className="cap-team-n" aria-hidden="true">
                        {work.open}
                        {work.overdue > 0 && (
                          <span className="cap-team-overdue">{work.overdue} overdue</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <ul className="cap-legend" aria-hidden="true">
              <li>
                <span className="cap-swatch cap-part-in_progress" />
                In progress
              </li>
              <li>
                <span className="cap-swatch cap-part-in_review" />
                In review
              </li>
              <li>
                <span className="cap-swatch cap-part-todo" />
                To do
              </li>
            </ul>
            {load.idle > 0 && (
              <p className="cap-quiet">
                {load.idle} {load.idle === 1 ? 'person has' : 'people have'} no open work
                {space === null ? '' : ' here'}.
              </p>
            )}
          </section>

          <section className="prof-card cap-running" aria-labelledby="cap-running-title">
            <div className="prof-card-head">
              <h2 className="prof-card-title" id="cap-running-title">
                Agents running now
              </h2>
              {on && <span className="prof-card-count">{running.length}</span>}
            </div>
            {!on ? (
              <p className="cap-quiet">Presence is off, so no session is recorded.</p>
            ) : running.length === 0 ? (
              <p className="cap-quiet">No agent is running right now.</p>
            ) : (
              <ul className="cap-running-rows">
                {running.map(({ person, agent }) => (
                  <li key={`${person.user_id}-${agent.client}`} className="cap-running-row">
                    <AgentMark client={agent.client} size="md" />
                    <span className="cap-running-who">
                      <span className="cap-running-agent">{agentClientName(agent.client)}</span>
                      <span className="cap-running-person">{person.name}</span>
                    </span>
                    {agent.last_at !== null && (
                      <span className="cap-running-when" title={timeLabel(agent.last_at, now).full}>
                        active {timeLabel(agent.last_at, now).text}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

interface TileProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly sub: string;
  readonly tone?: 'online' | 'overdue' | 'unlisted' | undefined;
  /** A tile that applies a filter: a toggle button. */
  readonly onClick?: () => void;
  readonly pressed?: boolean;
  /** A tile that goes somewhere: a real link. */
  readonly href?: string;
  readonly onLink?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** A summary tile: a figure that filters the page, or links to the page it counts. */
function Tile({ label, value, sub, tone, onClick, pressed, href, onLink }: TileProps) {
  const className = `cap-tile${tone === undefined ? '' : ` cap-tile-${tone}`}`;
  const body = (
    <>
      <span className="cap-tile-label">{label}</span>
      <span className="cap-tile-value">{value}</span>
      <span className="cap-tile-sub">{sub}</span>
    </>
  );
  if (href !== undefined) {
    return (
      <a className={`${className} cap-tile-link`} href={href} onClick={onLink}>
        {body}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

/** The final layout in grey — tiles, toolbar, three cards — so nothing jumps. */
function CapacitySkeleton() {
  return (
    <div className="cap-page">
      <ScreenHeader title="Capacity" context="Loading" />
      <div className="cap" role="status" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading capacity</span>
        <div className="cap-tiles" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            // The tile's own three lines, each holding a grey bar of its
            // line's height, so the row is as tall as the real one.
            <div key={i} className="cap-tile cap-tile-skeleton">
              <span className="cap-tile-label">
                <span className="skeleton cap-skeleton-text" style={{ width: '5rem' }}>
                  &nbsp;
                </span>
              </span>
              <span className="cap-tile-value">
                <span className="skeleton cap-skeleton-text" style={{ width: '1.75rem' }}>
                  &nbsp;
                </span>
              </span>
              <span className="cap-tile-sub">
                <span className="skeleton cap-skeleton-text" style={{ width: '4rem' }}>
                  &nbsp;
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="cap-toolbar" aria-hidden="true">
          <span className="skeleton cap-skeleton-search" />
          <span className="cap-chips">
            <span className="skeleton cap-skeleton-chips" />
          </span>
        </div>
        <ul className="cap-grid" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="cap-card cap-card-skeleton">
              <div className="cap-card-head">
                <span className="skeleton cap-skeleton-avatar" />
                <span className="cap-who">
                  <span className="skeleton skeleton-line" style={{ width: '55%' }} />
                  <span className="skeleton skeleton-line" style={{ width: '35%' }} />
                </span>
              </div>
              <span className="skeleton skeleton-line" style={{ width: '70%' }} />
              <span className="skeleton cap-skeleton-counts" />
              <span className="skeleton skeleton-line" style={{ width: '45%' }} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
