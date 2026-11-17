import { useEffect, useState, type MouseEvent } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import {
  getCapacity,
  getPresence,
  type CapacityView,
  type PresenceView,
} from '../../../api/presence.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { usePolled } from '../../../api/use-polled.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { FilterBar, Segmented } from '../../../components/kpi/FilterBar.tsx';
import { KpiRow, KpiTile } from '../../../components/kpi/KpiRow.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { StaleNotice } from '../../../components/StaleNotice.tsx';
import { useTheme } from '../../../theme/use-theme.ts';
import { InfoTip } from '../profile/InfoTip.tsx';
import { CapacityCard, LOAD_RULE } from './CapacityCard.tsx';
import { CapacityList } from './CapacityList.tsx';
import {
  filterCounts,
  matchesQuery,
  passesFilter,
  PRESENCE_FILTERS,
  sortPeople,
  SORTS,
  summarize,
  teamLoad,
  CAPACITY_DEFAULTS,
  type CapacityFilter,
  type CapacityParams,
  type CapacitySort,
} from './capacity-derive.ts';
import '../../../components/markers.css';
import '../profile/profile.css';
import './capacity.css';

export interface CapacityScreenProps {
  /**
   * Unlisted notes still waiting, from the shell (LAI-754). **`undefined` draws
   * no tile** — a reader without `audit_log.export` is not told the queue
   * exists, the same rule that keeps it out of their sidebar.
   */
  readonly unlistedOpen?: number | undefined;
  /** Tasks waiting for a person on Review, from the shell (D-082); `undefined` until read. */
  readonly reviewWaiting?: number | undefined;
  /**
   * The server returned its 200 and said more wait (LAI-818): the tile reads
   * "200+", because a cap shown as a total is a number that lies (D-092 item 5).
   */
  readonly reviewCapped?: boolean | undefined;
  /** Follow a tile's link without reloading the page. */
  readonly onNavigate: (to: string) => void;
  /**
   * The search, chip, space and sort the address names (LAI-1201), so a
   * reload or a pasted link opens the same view. Absent: the screen keeps its
   * own, starting from the defaults.
   */
  readonly params?: CapacityParams | undefined;
  /** A filter changed: the shell writes it into the address. */
  readonly onParams?: ((next: Partial<CapacityParams>) => void) | undefined;
}

/** How often to re-read. §11.4.2's screen is worthless if it silently ages. */
const POLL_MS = 20_000;

/** The two reads the page is drawn from, taken together so they agree. */
interface CapacityRead {
  readonly capacity: CapacityView;
  readonly presence: PresenceView;
}

function readCapacity(signal: AbortSignal): Promise<CapacityRead> {
  return Promise.all([getCapacity(signal), getPresence(signal)]).then(([capacity, presence]) => ({
    capacity,
    presence,
  }));
}

/** Cards or a table (LAI-991). Remembered per browser; cards until chosen. */
export type CapacityViewMode = 'cards' | 'list';
const VIEW_KEY = 'laika.capacity.view';

/** Local storage, or nothing — reading the property itself can throw. */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function rememberedView(): CapacityViewMode {
  try {
    return storage()?.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function rememberView(view: CapacityViewMode): void {
  try {
    storage()?.setItem(VIEW_KEY, view);
  } catch {
    // A browser that refuses storage still shows the view chosen.
  }
}

/**
 * Capacity — who is here, who is loaded and who can take the next task, across
 * **every space you can see** (§11.4.2, LAI-754; redesigned by LAI-767).
 *
 * **M5's exit criterion**: *"the capacity screen answers 'who takes the next
 * task' without asking."* The owner found the first answer to it — a wide row
 * a person, task chips in every row — not informative: no search, no clear
 * online state, no last seen. So now: a search and filters, tiles that count,
 * one card a person with a status ring and a load badge.
 *
 * **LAI-991 compacted it to the owner's design.** Every card draws every block
 * — workload, agents, spaces — with a `0` where there is nothing, so the
 * cards are one shape and one height. A **Cards /
 * List** toggle adds a table of the same people, whose bars share one scale:
 * that table is the team-load chart, and it replaced the *Team load* and
 * *Agents running now* panels that sat under the grid.
 *
 * ## What the server decided, and what is left to this screen
 *
 * Status, last seen, the workload counts and the load badge arrive decided
 * (SPEC §9.3): this screen filters, sorts and says them. **What a member may
 * not see is not sent** — the profile kind and the agents a person is not
 * running are absent from a member's answer, not hidden here. The 14-day
 * series still arrives for an owner or admin and is drawn on the profile,
 * not here (LAI-992).
 *
 * `enabled: false` is a fact, not an empty list: with presence off the cards
 * still show the workload, and say *Presence is off* where a status would be.
 *
 * ## Polling, not SSE
 *
 * `GET /events` carries **activity** per space, not presence — nothing on that
 * stream fires when somebody comes online, so a screen driven by it would sit
 * still while going stale. This re-reads every 20 s while the tab is visible,
 * and at once when it comes back. **No task is read** (LAI-992): the
 * `GET /tasks/:id` behind a matched task and *Show tasks* went with them.
 */
export function CapacityScreen({
  unlistedOpen,
  reviewWaiting,
  reviewCapped,
  onNavigate,
  params,
  onParams,
}: CapacityScreenProps) {
  const { theme } = useTheme();
  /*
   * Re-read every 20 s while the tab is visible, and at once when it comes
   * back (`usePolled`, LAI-1128). A good read clears any error; a failed
   * re-read keeps the figures on screen and says they are stale.
   */
  const polled = usePolled(readCapacity, { ms: POLL_MS, keepOnError: true, pauseWhenHidden: true });
  const capacity = polled.data?.capacity;
  const presence = polled.data?.presence;
  const now = polled.readAt ?? 0;

  const [own, setOwn] = useState<CapacityParams>(CAPACITY_DEFAULTS);
  const { query, filter, space, sort } = params ?? own;
  const update = (next: Partial<CapacityParams>): void => {
    if (onParams === undefined) setOwn((was) => ({ ...was, ...next }));
    else onParams(next);
  };
  const setQuery = (next: string): void => {
    update({ query: next });
  };
  const setFilter = (next: CapacityFilter): void => {
    update({ filter: next });
  };
  const setSpace = (next: string | null): void => {
    update({ space: next });
  };
  const setSort = (next: CapacitySort): void => {
    update({ sort: next });
  };
  const [showNever, setShowNever] = useState(false);
  const [view, setView] = useState<CapacityViewMode>(rememberedView);
  const chooseView = (next: CapacityViewMode): void => {
    setView(next);
    rememberView(next);
  };

  /**
   * Every space this reader can see, for the selector. `undefined` until
   * read, `null` if the read failed.
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

  if (polled.status === 'error') {
    return (
      <div className="cap-page">
        <ScreenHeader title="Capacity" />
        <div className="cap">
          <ApiErrorState
            error={polled.error}
            resource="capacity"
            scope="organisation"
            onRetry={polled.retry}
          />
        </div>
      </div>
    );
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
  // One scale for every list row's bar, so the rows compare (the team load).
  const { scale } = teamLoad(everyone, space);

  const pick = (next: CapacityFilter): void => {
    setFilter(next);
  };
  /** A figure pressed again goes back to everyone. */
  const toggle = (next: CapacityFilter): void => {
    setFilter(effectiveFilter === next ? 'all' : next);
  };
  const counts = filterCounts(everyone, space);
  const link = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const summary = `${String(everyone.length)} ${everyone.length === 1 ? 'person' : 'people'}${
    on ? ` · ${String(sum.online)} online` : ''
  } · ${String(sum.inProgress)} in progress · ${polled.stale ? `refresh failed, showing ${timeLabel(now, Date.now()).text}` : `updated every ${String(POLL_MS / 1000)}s`}`;
  /*
   * The one-line summary ends with the two queues this page counts but does
   * not list (LAI-1222): each a link to the page that does. They were tiles
   * among the filters; a figure that goes elsewhere is not a filter here.
   */
  const context = (
    <>
      {summary}
      <span className="cap-out-sep" aria-hidden="true">
        {' · '}
      </span>
      <a
        className="cap-out"
        data-out="review"
        href="/inbox?tab=review"
        onClick={link('/inbox?tab=review')}
      >
        {reviewWaiting === undefined
          ? 'Review'
          : `${String(reviewWaiting)}${reviewCapped === true ? '+' : ''} waiting for review`}
      </a>
      {unlistedOpen !== undefined && (
        <>
          <span className="cap-out-sep" aria-hidden="true">
            {' · '}
          </span>
          <a
            className="cap-out"
            data-out="unlisted"
            href="/inbox?tab=unlisted"
            onClick={link('/inbox?tab=unlisted')}
          >
            {`${String(unlistedOpen)} unlisted to triage`}
          </a>
        </>
      )}
    </>
  );

  return (
    <div className="cap-page">
      <ScreenHeader title="Capacity" context={context} />

      <div className="cap">
        {polled.stale && <StaleNotice readAt={polled.readAt} onRetry={polled.retry} />}

        {!on && (
          /* **Disabled is not empty.** No control here: turning it on is
             Admin+ on the Organisation screen (LAI-149). */
          <p className="cap-off" role="note">
            <strong>Presence is off for this organisation.</strong> Nobody’s status or last seen is
            recorded — this is not the same as nobody working. Workload below is still current. An
            organisation admin can turn presence on from the Organisation screen.
          </p>
        )}

        {/* The figures are the filters (LAI-1222): each tile shows how many
            people its filter leaves, and pressing it narrows the cards; the
            last two go to the page that breaks their figure down. */}
        <KpiRow label="Filter people" className="cap-kpis">
          <KpiTile
            id="all"
            label="People"
            value={everyone.length}
            sub={on ? `${String(sum.online)} online` : 'presence is off'}
            pressed={effectiveFilter === 'all'}
            onToggle={() => {
              pick('all');
            }}
          />
          {on && (
            <KpiTile
              id="online"
              label="Online now"
              value={counts.online}
              sub={`of ${String(everyone.length)} people`}
              tone={counts.online > 0 ? 'positive' : undefined}
              pressed={effectiveFilter === 'online'}
              onToggle={() => {
                toggle('online');
              }}
            />
          )}
          {on && (
            <KpiTile
              id="agents"
              label="Agents running"
              value={counts.agents}
              sub={`${String(sum.sessions)} ${sum.sessions === 1 ? 'session' : 'sessions'}`}
              pressed={effectiveFilter === 'agents'}
              onToggle={() => {
                toggle('agents');
              }}
            />
          )}
          {(counts.heavy > 0 || effectiveFilter === 'heavy') && (
            <KpiTile
              id="heavy"
              label="Heavy load"
              value={counts.heavy}
              sub={counts.heavy === 1 ? 'person' : 'people'}
              tone={counts.heavy > 0 ? 'warning' : undefined}
              pressed={effectiveFilter === 'heavy'}
              onToggle={() => {
                toggle('heavy');
              }}
            />
          )}
          <KpiTile
            id="overdue"
            label="Overdue"
            value={sum.overdue}
            sub={
              sum.overdue === 0
                ? 'nothing past due'
                : `tasks · ${String(counts.overdue)} ${counts.overdue === 1 ? 'person' : 'people'}`
            }
            tone={sum.overdue > 0 ? 'danger' : undefined}
            pressed={effectiveFilter === 'overdue'}
            onToggle={() => {
              toggle('overdue');
            }}
          />
          {(counts.none > 0 || effectiveFilter === 'none') && (
            <KpiTile
              id="none"
              label="No load"
              value={counts.none}
              sub="can take the next task"
              pressed={effectiveFilter === 'none'}
              onToggle={() => {
                toggle('none');
              }}
            />
          )}
          {on && (counts.never > 0 || effectiveFilter === 'never') && (
            <KpiTile
              id="never"
              label="Never seen"
              value={counts.never}
              sub={counts.never === 1 ? 'person' : 'people'}
              pressed={effectiveFilter === 'never'}
              onToggle={() => {
                toggle('never');
              }}
            />
          )}
        </KpiRow>

        {/* Nobody at all (LAI-1216): no search, filters or sort for a list that is not there. */}
        {everyone.length > 0 && (
          <FilterBar
            label="Find people"
            active={space === null ? 0 : 1}
            primary={
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
            }
            filters={
              <>
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
                <Dropdown<CapacitySort>
                  className="cap-dropdown"
                  aria-label="Sort"
                  value={effectiveSort}
                  options={SORTS.filter((s) => on || (s.id !== 'online' && s.id !== 'seen')).map(
                    (s) => ({ value: s.id, label: `Sort: ${s.label}` }),
                  )}
                  onChange={setSort}
                />
                {(effectiveFilter !== 'all' || space !== null || searching) && (
                  <button
                    type="button"
                    className="cap-clear"
                    onClick={() => {
                      update({ query: '', filter: 'all', space: null });
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </>
            }
            trailing={
              <>
                <Segmented<CapacityViewMode>
                  label="View"
                  value={view}
                  options={[
                    { value: 'cards', label: 'Cards' },
                    { value: 'list', label: 'List' },
                  ]}
                  onChange={chooseView}
                />
                <InfoTip label="About these figures">
                  <dl className="prof-defs">
                    <dt>Online, away, last seen</dt>
                    <dd>
                      The newest of a sign-in, a board action, and an agent’s heartbeat, MCP call or
                      write. Online is the last 5 minutes, away the last hour. Reading the board
                      does not count.
                    </dd>
                    <dt>Load</dt>
                    <dd>{LOAD_RULE}</dd>
                    <dt>Workload</dt>
                    <dd>
                      Open tasks assigned to them, in the spaces you can see. To do is committed and
                      not started; backlog is the pipeline, not yet committed. Waiting on reviewers
                      is their work in review: it waits on the reviewer, not on them. Overdue is
                      past its due date, and is its own badge.
                    </dd>
                    <dt>The figures</dt>
                    <dd>
                      Each figure at the top is a filter: press it to show only those people, and
                      press it again for everyone. A figure that would show nobody is left out.
                    </dd>
                    <dt>List</dt>
                    <dd>
                      The same people as the cards, one row each. Every row’s bar is drawn to the
                      same scale, so the longest bar is the heaviest person.
                    </dd>
                  </dl>
                </InfoTip>
              </>
            }
          />
        )}

        <p className="visually-hidden" role="status">
          {`${String(cards.length + never.length)} ${cards.length + never.length === 1 ? 'person' : 'people'} shown`}
        </p>

        {everyone.length === 0 ? (
          /* Nobody to show is not "nobody matches": no filter would help. */
          <EmptyState
            headline="No one to show yet"
            body="Capacity lists the people in the spaces you can see. Once someone is in one of your spaces, their workload and presence appear here."
          />
        ) : shown.length === 0 ? (
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
                update({ query: '', filter: 'all', space: null });
              },
            }}
          />
        ) : view === 'list' ? (
          <CapacityList people={cards} now={now} theme={theme} space={space} scale={scale} />
        ) : (
          <ul className="cap-grid">
            {cards.map((person) => (
              <CapacityCard
                key={person.user_id}
                person={person}
                now={now}
                theme={theme}
                space={space}
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

        {everyone.length > 0 && (
          <ul className="cap-legend" aria-hidden="true">
            <li>
              <span className="cap-swatch cap-part-in_progress" />
              In progress
            </li>
            <li>
              <span className="cap-swatch cap-part-todo" />
              To do
            </li>
            <li className="cap-legend-note">
              committed work; backlog and review are counted apart
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

/** The final layout in grey — tiles, toolbar, three cards — so nothing jumps. */
function CapacitySkeleton() {
  return (
    <div className="cap-page">
      <ScreenHeader title="Capacity" context="Loading" />
      <div className="cap" role="status" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading capacity</span>
        <div className="kpi-row" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            // The tile's own three lines, each holding a grey bar of its
            // line's height, so the row is as tall as the real one.
            <div key={i} className="kpi cap-tile-skeleton">
              <span className="kpi-label">
                <span className="skeleton cap-skeleton-text" style={{ width: '5rem' }}>
                  &nbsp;
                </span>
              </span>
              <span className="kpi-value">
                <span className="skeleton cap-skeleton-text" style={{ width: '1.75rem' }}>
                  &nbsp;
                </span>
              </span>
              <span className="kpi-sub">
                <span className="skeleton cap-skeleton-text" style={{ width: '4rem' }}>
                  &nbsp;
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="cap-toolbar" aria-hidden="true">
          <span className="skeleton cap-skeleton-search" />
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
