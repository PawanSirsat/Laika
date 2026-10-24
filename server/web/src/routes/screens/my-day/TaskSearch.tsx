import { useEffect, useState } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import { listAllTasks, type TaskSummary } from '../../../api/tasks.ts';
import { matchTasks } from './task-match.ts';

/** The tasks the person may read, fetched once per page load and shared by every editor. */
let cache: Promise<readonly TaskSummary[]> | undefined;

const PAGE = 100;

/** Every readable task, through the shared pager (LAI-703): its cap is the bound. */
async function loadAll(): Promise<readonly TaskSummary[]> {
  const all = await everyPage((cursor) =>
    listAllTasks({ limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }),
  );
  return all.items;
}

export function readableTasks(): Promise<readonly TaskSummary[]> {
  cache ??= loadAll().catch((cause: unknown) => {
    cache = undefined;
    throw cause;
  });
  return cache;
}

/** For a test: forget what was fetched. */
export function forgetTasks(): void {
  cache = undefined;
}

export interface TaskSearchProps {
  readonly busy: boolean;
  readonly onPick: (key: string) => void;
}

/**
 * Search tasks (the owner's design, D-110 item 7, LAI-504): type a key or a
 * title; the server has no text search, so the page filters the tasks the
 * person may read, as the board does. Picking one puts the block on it. No
 * task is made here.
 */
export function TaskSearch({ busy, onPick }: TaskSearchProps) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState<readonly TaskSummary[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (q.trim() === '' || all !== undefined) return;
    let live = true;
    readableTasks()
      .then((tasks) => {
        if (live) setAll(tasks);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [q, all]);

  const results = all === undefined ? [] : matchTasks(all, q);

  return (
    <div className="myday-task-search">
      <input
        type="search"
        className="input myday-task-search-field"
        placeholder="Search tasks"
        aria-label="Search tasks"
        value={q}
        disabled={busy}
        data-task-search
        onChange={(event) => {
          setQ(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0] !== undefined) {
            event.preventDefault();
            onPick(results[0].key);
            setQ('');
          }
        }}
      />
      {q.trim() !== '' && (
        <ul className="myday-task-results" aria-label="Matching tasks">
          {all === undefined && !failed && <li className="myday-quiet">Reading your tasks…</li>}
          {failed && <li className="myday-quiet">Your tasks could not be read.</li>}
          {all !== undefined && results.length === 0 && (
            <li className="myday-quiet">No task matches.</li>
          )}
          {results.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="myday-task-result"
                data-task-result={t.key}
                disabled={busy}
                onClick={() => {
                  onPick(t.key);
                  setQ('');
                }}
              >
                <span className="myday-ov-key">{t.key}</span>
                <span className="myday-task-result-title">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
