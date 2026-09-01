import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import {
  getCapacity,
  getPresence,
  type CapacityView,
  type PresenceEntry,
  type PresenceView,
} from '../../../api/presence.ts';
import { getTask, type Task } from '../../../api/tasks.ts';
import { listUnlisted, type UnlistedWork } from '../../../api/unlisted.ts';
import { UnlistedList } from '../unlisted/UnlistedList.tsx';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { useTheme } from '../../../theme/use-theme.ts';
import { byAvailability, hasLocation, oldestAge, taskIdsToResolve } from './capacity-derive.ts';
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
      <ScreenHeader
        title="Capacity"
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
          <section className="cap-section">
            <h2 className="cap-h">Working now</h2>
            {working.length === 0 ? (
              <p className="cap-quiet">No sessions in the last five minutes.</p>
            ) : (
              <ul className="cap-present">
                {working.map((entry) => (
                  <PresenceRow key={entry.user_id} entry={entry} theme={theme} />
                ))}
              </ul>
            )}
          </section>

          <section className="cap-section">
            <h2 className="cap-h">Who takes the next task</h2>
            <ul className="cap-people">
              {people.map((person) => {
                const age = oldestAge(person.oldest_in_progress_ms);
                const ink = avatarColor(person.user_id, theme);

                return (
                  <li key={person.user_id} className="cap-person">
                    <span
                      className="cap-avatar"
                      style={{ background: ink.background, color: ink.foreground }}
                    >
                      {initials(person.name)}
                    </span>
                    <div className="cap-person-body">
                      <div className="cap-person-head">
                        <span className="cap-name">{person.name}</span>
                        {person.active_sessions > 0 && (
                          <span className="cap-sessions">
                            {person.active_sessions}{' '}
                            {person.active_sessions === 1 ? 'session' : 'sessions'}
                          </span>
                        )}
                        {age !== undefined && (
                          <span className="cap-age" title="Age of their oldest in-progress task">
                            oldest {age}
                          </span>
                        )}
                      </div>

                      <TaskLine
                        label="In progress"
                        ids={person.in_progress_tasks}
                        tasks={tasks}
                        onOpenTask={onOpenTask}
                      />
                      <TaskLine
                        label="Awaiting their review"
                        ids={person.tasks_in_review}
                        tasks={tasks}
                        onOpenTask={onOpenTask}
                      />

                      {/* **Absent, not empty.** `?? []` here would turn "you may
                          not be told" into "they have logged nothing". */}
                      {person.unlisted !== undefined && person.unlisted.length > 0 && (
                        <p className="cap-unlisted-count">
                          {person.unlisted.length} unlisted{' '}
                          {person.unlisted.length === 1 ? 'note' : 'notes'}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

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

/** One present person. **The no-location case is the one that must look normal.** */
function PresenceRow({ entry, theme }: { readonly entry: PresenceEntry; readonly theme: string }) {
  const ink = avatarColor(entry.user_id, theme as Parameters<typeof avatarColor>[1]);
  const located = hasLocation(entry);

  return (
    <li className="cap-present-row">
      <span className="cap-avatar" style={{ background: ink.background, color: ink.foreground }}>
        {initials(entry.name)}
      </span>
      <span className="cap-name">{entry.name}</span>
      {/* LAI-411's treatment, not a second one — `.marker-agent` is shared now. */}
      {entry.is_agent && <span className="marker marker-agent">agent</span>}

      {located ? (
        <span className="cap-where">
          <code className="cap-repo">{entry.repo}</code>
          <span className="cap-branch">{entry.branch}</span>
        </span>
      ) : (
        /* **A normal state, not a loading one** (LAI-438). The person, the time
           and whether it is an agent are all still known; only the place is
           withheld, because the hook fires in every repository someone opens and
           publishing each one would make consent to be seen working here into
           consent to broadcast everything else. No dash, no "unknown", no
           skeleton — a sentence. */
        <span className="cap-elsewhere">working elsewhere</span>
      )}

      <span className="cap-seen">{new Date(entry.last_seen).toLocaleTimeString()}</span>
    </li>
  );
}

function TaskLine({
  label,
  ids,
  tasks,
  onOpenTask,
}: {
  readonly label: string;
  readonly ids: readonly string[];
  readonly tasks: ReadonlyMap<string, Task>;
  readonly onOpenTask: (taskKey: string) => void;
}) {
  if (ids.length === 0) return null;

  return (
    <p className="cap-tasks">
      <span className="cap-tasks-label">{label}</span>
      {ids.map((id) => {
        const task = tasks.get(id);
        return (
          <button
            key={id}
            type="button"
            className="cap-task"
            disabled={task === undefined}
            onClick={() => {
              if (task !== undefined) onOpenTask(task.key);
            }}
          >
            {/* Until it resolves, the key is unknown — and an id is not a key,
                so this says so rather than printing a ULID at somebody. */}
            {task === undefined ? '…' : `${task.key} ${task.title}`}
          </button>
        );
      })}
    </p>
  );
}
