import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { listUnlisted, type UnlistedWork } from '../../../api/unlisted.ts';
import { UnlistedList } from './UnlistedList.tsx';
import type { Member } from '../../../api/tasks.ts';
import './unlisted.css';

export interface UnlistedScreenProps {
  /** Open a task — a promotion that cannot be reached is a dead end (AC2). */
  readonly onOpenTask: (taskKey: string) => void;
  readonly members: ReadonlyMap<string, Member>;
}

/**
 * Unlisted work triage (SPEC §4.14, LAI-413).
 *
 * `log_unlisted_work` is the one MCP tool with no REST twin, and without this
 * screen it was write-only: an agent recorded what it noticed outside any
 * project and the rows accumulated where nobody looked.
 *
 * Admin-up only — these are audit rows and §4.14 borrows `audit_log.export`
 * rather than inventing a permission. The nav entry is **absent** for everyone
 * else (LAI-082), so this screen is not reached by anyone it would refuse.
 */
export function UnlistedScreen({ onOpenTask, members }: UnlistedScreenProps) {
  const [rows, setRows] = useState<readonly UnlistedWork[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);

  const load = (signal?: AbortSignal): void => {
    listUnlisted({ includeDismissed }, signal)
      .then((page) => {
        setRows(page.data);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [includeDismissed]);

  return (
    <div className="unl">
      <ScreenHeader
        title="Unlisted work"
        context={rows === undefined ? undefined : `${String(rows.length)} in the queue`}
      >
        <label className="unl-toggle">
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(event) => {
              setIncludeDismissed(event.target.checked);
            }}
          />
          {/* AC3's other half: dismissing is not deleting, so there has to be a
              way back to what was dismissed. */}
          <span>Show dismissed</span>
        </label>
      </ScreenHeader>

      <p className="unl-sub">
        Work an agent noticed outside any project — a stale dependency, a broken script, something
        nobody had filed. Promote what matters into a task; dismiss the rest.
      </p>

      {error !== null ? (
        <ApiErrorState error={error} resource="the unlisted queue" scope="organisation" />
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
        <UnlistedList
          rows={rows}
          names={new Map([...members].map(([id, member]) => [id, member.name]))}
          onOpenTask={onOpenTask}
          onChanged={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
