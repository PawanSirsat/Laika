import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { listWatchers, unwatchTask, watchTask, type Member } from '../../../api/tasks.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import './task-panel.css';

export interface WatchersSectionProps {
  readonly taskId: string;
  readonly members: ReadonlyMap<string, Member>;
  readonly theme: Theme;
  /** So the button can say Watch or Unwatch without a second request. */
  readonly meId: string | undefined;
}

/**
 * Who is watching this task (LAI-284, closing half of LAI-458).
 *
 * `GET /tasks/:id/watchers`, `PUT`/`DELETE /tasks/:id/watch` have all been
 * served and none had a caller.
 *
 * **The server returns user ids, not people**, and filters them to who can
 * still read the task. Names and roles come from the project's members, which
 * the panel already holds — a second lookup would be a second answer to "who is
 * this", and they would disagree the moment somebody's role changed.
 *
 * A watcher who is not in the members map is still counted and still drawn: the
 * list is the server's and dropping a row because this page cannot name it
 * would under-report who gets told.
 */
export function WatchersSection({ taskId, members, theme, meId }: WatchersSectionProps) {
  const [watchers, setWatchers] = useState<readonly string[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = (signal?: AbortSignal): void => {
    listWatchers(taskId, signal)
      .then((list) => {
        if (signal?.aborted !== true) setWatchers(list.watchers);
      })
      .catch(() => {
        // The section says it could not read rather than claiming nobody is
        // watching — those are different statements.
        if (signal?.aborted !== true) setWatchers(undefined);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [taskId]);

  const watching = meId !== undefined && watchers?.includes(meId) === true;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await (watching ? unwatchTask(taskId) : watchTask(taskId));
      /*
       * Re-read rather than patch the array locally. Watching is **implicit as
       * well as explicit** — commenting on a task makes you a watcher — so the
       * server's list is not always ours plus or minus one, and a local guess
       * would drift from it.
       */
      load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not change that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-section">
      <h3 className="panel-section-title">
        Watchers
        {watchers !== undefined && <span className="panel-count">{watchers.length}</span>}
      </h3>

      {watchers === undefined ? (
        <p className="panel-muted">Could not read who is watching.</p>
      ) : watchers.length === 0 ? (
        <p className="panel-muted">Nobody yet. Commenting makes you one.</p>
      ) : (
        <ul className="watch-list">
          {watchers.map((id) => {
            const who = members.get(id);
            const ink = avatarColor(id, theme);
            return (
              <li key={id} className="watch-row">
                <span
                  className="watch-avatar"
                  style={{ background: ink.background, color: ink.foreground }}
                  aria-hidden="true"
                >
                  {initials(who?.name ?? '?')}
                </span>
                <span className="watch-name">
                  {/* Named when we can; never an id in front of a person. */}
                  {who?.name ?? 'Someone on this space'}
                </span>
                {who !== undefined && <span className="watch-role">{who.role}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {meId !== undefined && (
        <button
          type="button"
          className="watch-toggle"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {watching ? 'Stop watching' : 'Watch this task'}
        </button>
      )}

      {error !== undefined && (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
