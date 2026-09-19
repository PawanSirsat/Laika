import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import {
  getCapacity,
  getPresence,
  hasLocation,
  type CapacityView,
  type PresenceView,
} from '../../../api/presence.ts';
import { getTask, type Task } from '../../../api/tasks.ts';
import { listProjects } from '../../../api/projects.ts';
import { listUnlisted, type UnlistedWork } from '../../../api/unlisted.ts';
import { UnlistedList } from '../unlisted/UnlistedList.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { byAvailability, oldestAge, taskIdsToResolve } from './capacity-derive.ts';
import '../../../components/markers.css';
import './capacity.css';

export interface CapacityScreenProps {
  readonly onOpenTask: (taskKey: string) => void;
}

/** How often to re-read. §11.4.2's screen is worthless if it silently ages. */
const POLL_MS = 20_000;

/**
 * Capacity — who is working now, and what is stuck with nobody (§11.4.2).
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
 * `unlisted` is **absent**, not empty, for a reader without `audit_log.export` —
 * so the section renders on the key being present and never on `?? []`.
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
export function CapacityScreen({ onOpenTask }: CapacityScreenProps) {
  const { theme } = useTheme();
  const [capacity, setCapacity] = useState<CapacityView | undefined>(undefined);
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);
  const [unlisted, setUnlisted] = useState<readonly UnlistedWork[]>([]);
  const [tasks, setTasks] = useState<ReadonlyMap<string, Task>>(new Map());
  /**
   * How many spaces this screen reads across.
   *
   * A real count from `GET /projects`, and `undefined` until it lands — the bar
   * then says how often it refreshes rather than "across 0 spaces", which would
   * be a claim rather than a gap.
   */
  const [spaceCount, setSpaceCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  const load = (signal?: AbortSignal): void => {
    Promise.all([getCapacity(signal), getPresence(signal)])
      .then(([cap, pres]) => {
        setCapacity(cap);
        setPresence(pres);
        return taskIdsToResolve(cap.people);
      })
      .then(async (ids) => {
        // Deduped, and only the ids this render actually needs. No cache: a
        // second copy of the truth is what this repo spent the day removing.
        const resolved = await Promise.all(
          ids.map((id) =>
            getTask(id, signal)
              .then((task) => [id, task] as const)
              .catch(() => undefined),
          ),
        );
        setTasks(new Map(resolved.filter((r): r is readonly [string, Task] => r !== undefined)));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });

    listUnlisted({}, signal)
      .then((page) => {
        setUnlisted(page.data);
      })
      .catch(() => {
        // A reader without `audit_log.export` gets 403 here, and that is not an
        // error on this screen — it is the same permission that makes
        // `unlisted` absent from capacity. Leave the section out.
        setUnlisted([]);
      });
  };

  // Once, not on the poll: the number of spaces does not change every 20s, and
  // re-reading it with the presence poll would be a request per tick for a
  // figure nobody watches.
  useEffect(() => {
    const controller = new AbortController();
    listProjects({}, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setSpaceCount(page.data.length);
      })
      .catch(() => {
        // The bar falls back to saying how often it refreshes.
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => {
      load();
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (error !== null) {
    return <ApiErrorState error={error} resource="capacity" scope="organisation" />;
  }
  if (capacity === undefined || presence === undefined) {
    return <LoadingState shape="row" count={4} label="Loading capacity" />;
  }

  const people = byAvailability(capacity.people);
  const working = presence.present;

  return (
    <div className="cap">
      <SpaceSlot
        context={`${String(people.length)} ${people.length === 1 ? 'person' : 'people'} · updated every ${String(POLL_MS / 1000)}s`}
      />

      {!capacity.enabled ? (
        /* **Disabled is not empty.** `{ enabled: false }` says this org does not
           record who is working; an empty list would say nobody is. No control
           here: turning it on is Admin+ on the Organisation screen (LAI-149),
           and offering a switch that most readers cannot use is worse than
           saying where it lives. */
        <EmptyState
          headline="Presence is off for this organisation"
          body="Nobody's sessions are being recorded, so there is nothing to show — this is not the same as nobody working. An organisation admin can turn presence on from the Organisation screen."
        />
      ) : (
        <>
          {/*
            The design's summary bar (prototype line 651). Three counts and a
            sentence — every one of them counted from what the API sent, never
            estimated.
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
            <span className="cap-fig cap-fig-unlisted">
              <span className="cap-fig-label">UNLISTED WORK</span>
              <span className="cap-fig-value">{unlisted.length}</span>
            </span>
            {/*
              **The scope, in words** (LAI-279, prototype line 656).

              This screen reads across the whole organisation while living
              inside a space. That used to be said by stripping `?project=` from
              its link, which left the space bar reading "No space" over a screen
              still showing the space's tabs — not a scope statement, just a
              screen that looks broken. A sentence is what the design uses and
              what a reader can actually act on.
            */}
            <span className="cap-summary-note">
              {spaceCount === undefined
                ? `updated every ${String(POLL_MS / 1000)}s · live`
                : `across ${String(spaceCount)} ${spaceCount === 1 ? 'space' : 'spaces'} · live`}
            </span>
          </div>

          {/*
            One card per person, in four panels (prototype lines 657–693):
            who they are · what they are working on · their agent session ·
            what is in progress. It was two flat lists, which answered "who is
            here" and "who is free" but never joined them up for one person.
          */}
          {/*
            **Enabled and quiet is not disabled** (LAI-150). An org that records
            presence and has nobody beating must say so in its own words — an
            empty list beside a summary bar of zeroes reads as a broken screen,
            and reads identically to presence being off, which is a different
            claim entirely. `capacity.test.ts` is the fixture that separates them.
          */}
          {people.length === 0 && (
            <p className="cap-quiet">No sessions in the last five minutes.</p>
          )}

          <ul className="cap-people">
            {people.map((person) => {
              const age = oldestAge(person.oldest_in_progress_ms);
              const ink = avatarColor(person.user_id, theme);
              const here = working.find((e) => e.user_id === person.user_id);
              const now =
                here?.matched_task_id === undefined || here.matched_task_id === null
                  ? undefined
                  : tasks.get(here.matched_task_id);
              const mine = unlisted.filter((u) => u.user_id === person.user_id);

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
                        <span className="cap-name">{person.name}</span>
                        <span className="cap-who-meta">
                          {/*
                            **`is_agent`, not `active_sessions > 0`.** A person
                            can have a session count without that session being
                            an agent's — `is_agent` is `tokenId !== null`, which
                            is the fact this badge claims. The first cut badged a
                            human as an agent, and `capacity.test.ts` said so.
                          */}
                          {here?.is_agent === true && (
                            <span className="marker marker-agent">agent</span>
                          )}
                          <span className="cap-seen-dot">
                            <span
                              className={here === undefined ? 'cap-dot' : 'cap-dot cap-dot-live'}
                              aria-hidden="true"
                            />
                            {/*
                              `last_seen` is nullable — a person who has never
                              beaten has no time to show, and printing the epoch
                              would read as 1970.
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
                          {here?.repo !== undefined && (
                            <span className="cap-now-repo">
                              {here.repo}
                              {here.branch === undefined ? '' : ` · ${here.branch}`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="cap-idle">
                          {/*
                            **Three states, not two** (LAI-438). A person whose
                            location is withheld is not the same as one who is
                            in a session on no particular task, and neither is
                            the same as being away — `hasLocation` is the one
                            rule that tells the first apart, and it tests
                            `repo` because `matched_task_id` and `project_ids`
                            arrive `null`/`[]` either way.
                          */}
                          {here === undefined
                            ? 'Not in a session right now.'
                            : hasLocation(here)
                              ? 'In a session, on no particular task.'
                              : 'working elsewhere'}
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
                          person.in_progress_tasks.map((id) => {
                            const task = tasks.get(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                className="cap-chip"
                                disabled={task === undefined}
                                onClick={() => {
                                  if (task !== undefined) onOpenTask(task.key);
                                }}
                              >
                                <span
                                  className={`cap-chip-dot cap-chip-${task?.priority ?? 'p3'}`}
                                  aria-hidden="true"
                                />
                                {/* An id is not a key — until it resolves this
                                    says so rather than printing a ULID. */}
                                <span className="cap-chip-key">{task?.key ?? '…'}</span>
                                <span className="cap-chip-title">{task?.title ?? ''}</span>
                              </button>
                            );
                          })
                        )}
                      </span>
                    </div>
                  </div>

                  {/*
                    **Absent, not empty** — `?? []` here would turn "you may not
                    be told" into "they have logged nothing" (the field is
                    withheld without `audit_log.export`).
                  */}
                  {person.unlisted !== undefined && mine.length > 0 && (
                    <div className="cap-unlisted-strip">
                      <span className="cap-unlisted-label">UNLISTED WORK</span>
                      <span className="cap-unlisted-note">{mine[0]?.note ?? ''}</span>
                      <span className="cap-unlisted-meta">
                        {mine.length > 1 ? `+${String(mine.length - 1)} more · ` : ''}
                        {mine[0]?.repo ?? ''}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {unlisted.length > 0 && (
            <section className="cap-section">
              <h2 className="cap-h">Unlisted work</h2>
              <p className="cap-quiet">
                Work an agent noticed outside any project. Promote what matters without leaving this
                screen.
              </p>
              <UnlistedList
                rows={unlisted}
                // Real names, from `GET /capacity` — the screen already has
                // them, so a note does not have to say "Someone".
                names={new Map(capacity.people.map((person) => [person.user_id, person.name]))}
                onOpenTask={onOpenTask}
                onChanged={() => {
                  load();
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
