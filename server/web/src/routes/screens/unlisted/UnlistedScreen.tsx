import { everyPage } from '../../../api/every-page.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolled } from '../../../api/use-polled.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { StaleNotice } from '../../../components/StaleNotice.tsx';
import { listUnlisted, newestFirst, openUnlistedCount } from '../../../api/unlisted.ts';
import { listAllUsers } from '../../../api/users.ts';
import { UnlistedList } from './UnlistedList.tsx';
import './unlisted.css';

export interface UnlistedScreenProps {
  /** Open a task — a promotion that cannot be reached is a dead end (AC2). */
  readonly onOpenTask: (taskKey: string) => void;
  /** A promote or a dismiss changed the queue — the sidebar's count re-reads. */
  readonly onChanged?: () => void;
}

/**
 * How many lines show before *Show more* (LAI-754). Enough to fill a laptop
 * screen at one line each; the rest are already loaded and one click away.
 */
const UNLISTED_PAGE = 25;

/**
 * How often the queue is read again while the page is open (LAI-1128). Agents
 * log here at any time; a queue that only changed on a reload was a queue
 * whose count disagreed with the sidebar's.
 */
const POLL_MS = 30_000;

/**
 * Unlisted work triage (SPEC §4.14, LAI-413; compact since LAI-754).
 *
 * `log_unlisted_work` is the one MCP tool with no REST twin, and without this
 * screen it was write-only: an agent recorded what it noticed outside any
 * project and the rows accumulated where nobody looked.
 *
 * **One line per note, newest first**, the first {@link UNLISTED_PAGE} and then
 * *Show more*. Every page is still read (LAI-703) — the count beside the
 * header and in the sidebar must be the queue's, not the screen's.
 *
 * Admin-up only — these are audit rows and §4.14 borrows `audit_log.export`
 * rather than inventing a permission. The nav entry is **absent** for everyone
 * else (LAI-082), so this screen is not reached by anyone it would refuse.
 */
export function UnlistedScreen({ onOpenTask, onChanged }: UnlistedScreenProps) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [shown, setShown] = useState(UNLISTED_PAGE);

  /*
   * Every page, newest first, re-read on a timer (`usePolled`, LAI-1128): a
   * good read clears any error, and a failed re-read keeps the rows on screen
   * with a stale notice rather than replacing them with an error page.
   * Showing dismissed rows is a different question, so it starts again.
   */
  const fetchQueue = useCallback(
    (signal: AbortSignal) =>
      everyPage((cursor) => listUnlisted({ includeDismissed, cursor, limit: 200 }, signal)).then(
        ({ items }) => newestFirst(items),
      ),
    [includeDismissed],
  );
  const queue = usePolled(fetchQueue, {
    ms: POLL_MS,
    keepOnError: true,
    pauseWhenHidden: true,
    key: includeDismissed ? 'with-dismissed' : 'open',
  });
  const rows = queue.data;

  /*
   * Who logged each note. **Inactive people included**: a note keeps its
   * author after they leave, and "Someone" for a real, named person is a
   * fixture-shaped gap. A failed read leaves the fallback rather than an error
   * — the queue is still triageable without names.
   */
  useEffect(() => {
    const controller = new AbortController();
    listAllUsers(controller.signal, { includeInactive: true })
      .then(({ users }) => {
        if (!controller.signal.aborted) setNames(new Map(users.map((u) => [u.id, u.name])));
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  const open = useMemo(() => (rows === undefined ? undefined : openUnlistedCount(rows)), [rows]);
  const visible = rows?.slice(0, shown) ?? [];
  const left = (rows?.length ?? 0) - visible.length;

  return (
    <div className="unl">
      <ScreenHeader
        title="Unlisted work"
        context={open === undefined ? undefined : `${String(open)} open · newest first`}
      >
        <label className="unl-toggle">
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(event) => {
              setIncludeDismissed(event.target.checked);
              setShown(UNLISTED_PAGE);
            }}
          />
          {/* AC3's other half: dismissing is not deleting, so there has to be a
              way back to what was dismissed. */}
          <span>Show dismissed</span>
        </label>
      </ScreenHeader>

      <p className="unl-sub">
        Work an agent noticed outside any project. Open a line to read it, then promote it into a
        task or dismiss it.
      </p>

      {queue.stale && <StaleNotice readAt={queue.readAt} onRetry={queue.retry} />}

      {queue.status === 'error' ? (
        <ApiErrorState
          error={queue.error}
          resource="the unlisted queue"
          scope="organisation"
          onRetry={queue.retry}
        />
      ) : rows === undefined ? (
        <LoadingState shape="row" count={3} label="Loading unlisted work" />
      ) : rows.length === 0 ? (
        <EmptyState
          headline="Nothing unlisted"
          body={
            includeDismissed
              ? 'No agent has logged work outside a project yet.'
              : 'Nothing is waiting to be triaged. Agents log work here when they notice something outside any project.'
          }
        />
      ) : (
        <>
          <UnlistedList
            rows={visible}
            names={names}
            onOpenTask={onOpenTask}
            onChanged={() => {
              queue.retry();
              onChanged?.();
            }}
          />
          {left > 0 && (
            <button
              type="button"
              className="unl-more"
              onClick={() => {
                setShown((n) => n + UNLISTED_PAGE);
              }}
            >
              Show more
              <span className="unl-more-count">{left} more</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
