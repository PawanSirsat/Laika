import { everyPage } from '../../../api/every-page.ts';
import { useEffect, useMemo, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { agentClientName } from '../../../api/agent-clients.ts';
import {
  getCapacity,
  getPresence,
  agentsOf,
  connectedVia,
  hasLocation,
  type CapacityView,
  type PresenceView,
} from '../../../api/presence.ts';
import { getTask, type Task } from '../../../api/tasks.ts';
import { taskStore } from '../../../api/store.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { byAvailability, chipsFor, oldestAge, taskIdsToResolve } from './capacity-derive.ts';
import '../../../components/markers.css';
import './capacity.css';

export interface CapacityScreenProps {
  readonly onOpenTask: (taskKey: string) => void;
  /**
   * Unlisted notes still waiting, from the shell (LAI-754). **`undefined` draws
   * no link** — a reader without `audit_log.export` is not told the queue
   * exists, the same rule that keeps it out of their sidebar.
   */
  readonly unlistedOpen?: number | undefined;
  /** Follow the summary strip's Unlisted link without reloading the page. */
  readonly onNavigate: (to: string) => void;
}

/** How often to re-read. §11.4.2's screen is worthless if it silently ages. */
const POLL_MS = 20_000;

/**
 * Capacity — who is working now, across **every space you can see** (§11.4.2).
 *
 * **One page for the organisation since LAI-754** (owner, 2026-10-15:
 * *"Capacity must not be at project level; it must go to the sidebar and be
 * global"*). It was a space tab from LAI-251; it is a sidebar entry now, with
 * no space frame, and its unlisted-work list moved to `/unlisted`.
 *
 * **M5's exit criterion**: *"the capacity screen answers 'who takes the next
 * task' without asking."*
 *
 * ## Four shapes the server decided, and one of them is subtle
 *
 * `enabled` is a **field**, not something to infer: `{ enabled: false }` and an
 * empty list are opposite claims, and since LAI-150 a disabled org stores
 * nothing, so an empty list is all that is left to infer from.
 *
 * Capacity **keeps the person and shortens their list** when a reader cannot see
 * a project. The person is not the secret.
 *
 * And presence says **where** only to a reader who may be told (LAI-438). `repo`
 * and `branch` go absent; **`matched_task_id` arrives `null` and `project_ids`
 * arrives `[]`** — measured against a running instance, because the task file
 * originally said all four went absent. That is why `hasLocation` tests `repo`:
 * the others cannot tell "withheld" from "resolved to nothing".
 *
 * ## Polling, not SSE
 *
 * `GET /events` carries **activity**, not heartbeats — nothing on that stream
 * fires when somebody's presence changes, so a screen driven by it would sit
 * still while going stale. AC8 says a stale capacity screen is worse than a slow
 * one, so this polls every 20s and says so.
 */
export function CapacityScreen({ onOpenTask, unlistedOpen, onNavigate }: CapacityScreenProps) {
  const { theme } = useTheme();
  const [capacity, setCapacity] = useState<CapacityView | undefined>(undefined);
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);
  /**
   * The tasks the screen draws, by id (LAI-754).
   *
   * Capacity serves task **ids**. Each one resolves from a project's task set
   * when one is already held (`task-store.ts`, LAI-724 — usually the space you
   * just left), and otherwise with one `GET /tasks/:id`, **only for what is
   * drawn**: three chips a person and the task their session is on.
   *
   * **A failed read is asked again on the next poll.** The owner's screenshot
   * had chips reading only a dot and `…`: an id that did not resolve once was
   * never asked again for the rest of the visit. The server change that
   * retires these reads is LAI-728.
   */
  const [resolved, setResolved] = useState<ReadonlyMap<string, Task>>(new Map());
  /**
   * The spaces this screen reads across, by slug.
   *
   * A real list from `GET /projects`: `undefined` until it lands and `null` if
   * it failed — the strip then says how often it refreshes rather than "across
   * 0 spaces", which would be a claim rather than a gap.
   */
  const [spaces, setSpaces] = useState<readonly string[] | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  // Once, not on the poll: the number of spaces does not change every 20s.
  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703).
        if (!controller.signal.aborted) {
          setSpaces(items.filter(isProject).map((project) => project.slug));
        }
      })
      .catch(() => {
        // The strip falls back to saying how often it refreshes, and no set
        // is consulted before a task is read by id.
        if (!controller.signal.aborted) setSpaces(null);
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = (): void => {
      Promise.all([getCapacity(controller.signal), getPresence(controller.signal)])
        .then(([cap, pres]) => {
          setCapacity(cap);
          setPresence(pres);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  /*
   * What is drawn, re-derived on every poll — which is also what retries an
   * id that failed: the new answer re-runs the effect below, and anything
   * still missing is asked for again.
   */
  const wanted = useMemo(
    () =>
      capacity === undefined || presence === undefined
        ? []
        : taskIdsToResolve(
            capacity.people,
            presence.present.map((entry) => entry.matched_task_id),
          ),
    [capacity, presence],
  );

  useEffect(() => {
    const missing = wanted.filter((id) => !resolved.has(id));
    // Until the spaces are known a held set cannot be consulted, and reading
    // by id first would spend the requests LAI-724 saved.
    if (missing.length === 0 || spaces === undefined) return;

    // A set some other screen already walked answers without a request.
    const held = new Map<string, Task>();
    for (const slug of spaces ?? []) {
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

  if (error !== null) {
    return <ApiErrorState error={error} resource="capacity" scope="organisation" />;
  }
  if (capacity === undefined || presence === undefined) {
    return <LoadingState shape="row" count={4} label="Loading capacity" />;
  }

  const people = byAvailability(capacity.people);
  const working = presence.present;
  const scope =
    spaces === undefined || spaces === null
      ? `updated every ${String(POLL_MS / 1000)}s · live`
      : `across ${String(spaces.length)} ${spaces.length === 1 ? 'space' : 'spaces'} · live`;

  return (
    <div className="cap-page">
      <ScreenHeader
        title="Capacity"
        context={`${String(people.length)} ${people.length === 1 ? 'person' : 'people'} · updated every ${String(POLL_MS / 1000)}s`}
      />

      <div className="cap">
        {!capacity.enabled ? (
          /* **Disabled is not empty.** `{ enabled: false }` says this org does
             not record who is working; an empty list would say nobody is. No
             control here: turning it on is Admin+ on the Organisation screen
             (LAI-149), and offering a switch that most readers cannot use is
             worse than saying where it lives. */
          <EmptyState
            headline="Presence is off for this organisation"
            body="Nobody's sessions are being recorded, so there is nothing to show — this is not the same as nobody working. An organisation admin can turn presence on from the Organisation screen."
          />
        ) : (
          <>
            {/*
              The design's summary bar (prototype line 651). Counts and a
              sentence — every one of them counted from what the API sent,
              never estimated. The scope is said in words: this page reads
              across every space the reader can see.
            */}
            <div className="cap-summary">
              <span className="cap-fig">
                <span className="cap-fig-label">ACTIVE NOW</span>
                <span className="cap-fig-value">{working.length}</span>
              </span>
              <span className="cap-fig cap-fig-agent">
                <span className="cap-fig-label">AGENT SESSIONS</span>
                <span className="cap-fig-value">
                  {people.reduce((n, person) => n + person.active_sessions, 0)}
                </span>
              </span>
              {/*
                **A link, not the list** (LAI-754). The notes have their own
                page now; this says how many wait there, for a reader allowed
                to open it.
              */}
              {unlistedOpen !== undefined && (
                <a
                  className="cap-fig cap-fig-unlisted cap-fig-link"
                  href="/unlisted"
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate('/unlisted');
                  }}
                >
                  <span className="cap-fig-label">UNLISTED</span>
                  <span className="cap-fig-value">{unlistedOpen}</span>
                </a>
              )}
              <span className="cap-summary-note">{scope}</span>
            </div>

            {/*
              **Enabled and quiet is not disabled** (LAI-150). An org that
              records presence and has nobody beating must say so in its own
              words — `capacity.test.ts` is the fixture that separates them.
            */}
            {people.length === 0 && (
              <p className="cap-quiet">No sessions in the last five minutes.</p>
            )}

            {/*
              One card per person, in four panels (prototype lines 657–693):
              who they are · what they are working on · their agent session ·
              what is in progress.
            */}
            <ul className="cap-people">
              {people.map((person) => {
                const age = oldestAge(person.oldest_in_progress_ms);
                const ink = avatarColor(person.user_id, theme);
                const here = working.find((e) => e.user_id === person.user_id);
                const now =
                  here?.matched_task_id === undefined || here.matched_task_id === null
                    ? undefined
                    : resolved.get(here.matched_task_id);
                const chips = chipsFor(person.in_progress_tasks);

                return (
                  <li key={person.user_id} className="cap-card">
                    <div className="cap-panels">
                      <div className="cap-who">
                        <span
                          className="cap-avatar"
                          style={{ background: ink.background, color: ink.foreground }}
                          aria-hidden="true"
                        >
                          {initials(person.name)}
                        </span>
                        <span className="cap-who-lines">
                          <span className="cap-name">
                            <PersonLink
                              userId={person.user_id}
                              className="cap-name-link"
                              label={`Open ${person.name}’s profile`}
                            >
                              {person.name}
                            </PersonLink>
                          </span>
                          <span className="cap-who-meta">
                            {/*
                              **`is_agent`, not `active_sessions > 0`.** A
                              person can have a session count without that
                              session being an agent's — `is_agent` is
                              `tokenId !== null`, which is the fact this badge
                              claims.
                            */}
                            {here?.is_agent === true && (
                              <span className="marker marker-agent">agent</span>
                            )}
                            {/* Which agents, in words beside their marks (LAI-737). */}
                            {here !== undefined &&
                              agentsOf(here).map((client) => (
                                <span key={client} className="cap-client">
                                  <AgentMark client={client} size="sm" />
                                  {agentClientName(client)}
                                </span>
                              ))}
                            <span className="cap-seen-dot">
                              <span
                                className={here === undefined ? 'cap-dot' : 'cap-dot cap-dot-live'}
                                aria-hidden="true"
                              />
                              {/*
                                `last_seen` is nullable — a person who has never
                                beaten has no time to show, and printing the
                                epoch would read as 1970.
                              */}
                              <span className="cap-seen">
                                {person.last_seen === null
                                  ? 'never seen'
                                  : new Date(person.last_seen).toLocaleTimeString()}
                              </span>
                            </span>
                          </span>
                        </span>
                      </div>

                      <div className="cap-panel cap-working">
                        <span className="cap-panel-label">WORKING ON</span>
                        {now !== undefined ? (
                          <>
                            <span className="cap-now">
                              <span className="cap-now-key">{now.key}</span>
                              <span className="cap-now-title" title={now.title}>
                                {now.title}
                              </span>
                            </span>
                            {here?.repo !== undefined ? (
                              <span className="cap-now-repo">
                                {here.repo}
                                {here.branch === undefined ? '' : ` · ${here.branch}`}
                              </span>
                            ) : (
                              /* An MCP-only session has no repo (LAI-736); it
                                 says which agent instead (LAI-737). */
                              here !== undefined &&
                              connectedVia(here) !== undefined && (
                                <span className="cap-now-repo">{connectedVia(here)}</span>
                              )
                            )}
                          </>
                        ) : (
                          <span className="cap-idle">
                            {/*
                              **Three states, not two** (LAI-438). A person whose
                              location is withheld is not the same as one who is
                              in a session on no particular task, and neither is
                              the same as being away — `hasLocation` is the one
                              rule that tells the first apart.
                            */}
                            {here === undefined
                              ? 'Not in a session right now.'
                              : hasLocation(here)
                                ? 'In a session, on no particular task.'
                                : (connectedVia(here) ?? 'working elsewhere')}
                          </span>
                        )}
                      </div>

                      <div className="cap-panel cap-agent">
                        <span className="cap-panel-label">AGENT SESSION</span>
                        {person.active_sessions > 0 ? (
                          <>
                            <span className="cap-agent-live">
                              <span className="cap-pulse" aria-hidden="true" />
                              running
                              <span className="cap-agent-count">
                                {person.active_sessions}{' '}
                                {person.active_sessions === 1 ? 'token' : 'tokens'}
                              </span>
                            </span>
                            {age !== undefined && (
                              <span className="cap-agent-meta">oldest task {age}</span>
                            )}
                          </>
                        ) : (
                          <span className="cap-idle">No agent session.</span>
                        )}
                      </div>

                      <div className="cap-panel cap-wip">
                        <span className="cap-panel-label">
                          IN PROGRESS
                          <span className="cap-wip-count">{person.in_progress_tasks.length}</span>
                        </span>
                        <span className="cap-chips">
                          {person.in_progress_tasks.length === 0 ? (
                            <span className="cap-idle">Nothing assigned in progress</span>
                          ) : (
                            <>
                              {chips.shown.map((id) => {
                                const task = resolved.get(id);
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    className="cap-chip"
                                    disabled={task === undefined}
                                    // The whole title, and which in-progress
                                    // column when a project has several (LAI-739).
                                    title={
                                      task === undefined
                                        ? 'Loading this task…'
                                        : `${task.key} · ${task.title} — ${task.status_name}`
                                    }
                                    aria-label={
                                      task === undefined
                                        ? 'Loading task'
                                        : `${task.key} ${task.title}`
                                    }
                                    onClick={() => {
                                      if (task !== undefined) onOpenTask(task.key);
                                    }}
                                  >
                                    <span
                                      className={`cap-chip-dot cap-chip-${task?.priority ?? 'p3'}`}
                                      aria-hidden="true"
                                    />
                                    {/* An id is not a key — until it resolves
                                        this says so rather than printing a ULID. */}
                                    <span className="cap-chip-key">{task?.key ?? '…'}</span>
                                    {task !== undefined && (
                                      <span className="cap-chip-title">{task.title}</span>
                                    )}
                                  </button>
                                );
                              })}
                              {chips.more > 0 && (
                                <span
                                  className="cap-chip-more"
                                  title={`${String(chips.more)} more in progress`}
                                >
                                  +{chips.more} more
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
