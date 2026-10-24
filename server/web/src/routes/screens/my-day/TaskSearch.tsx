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
  /**
   * The typed words name no task (the design's *type a new one*, LAI-515):
   * they become the entry's title, on General — no task is made (D-110
   * item 7). Absent, the row is not offered.
   */
  readonly onCustom?: ((title: string) => void) | undefined;
}

/**
 * Search tasks (the owner's design, D-110 item 7, LAI-504): type a key or a
 * title; the server has no text search, so the page filters the tasks the
 * person may read, as the board does. Picking one puts the block on it. No
 * task is made here.
 */
export function TaskSearch({ busy, onPick, onCustom }: TaskSearchProps) {
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

  const typed = q.trim();
  const results = all === undefined ? [] : matchTasks(all, q);
  const exact = results.some((t) => t.key.toLowerCase() === typed.toLowerCase());
  const custom = onCustom !== undefined && typed !== '' && all !== undefined && !exact;

  return (
    <div className="editor-search">
      <div className="editor-search-box">
        <svg
          className="editor-search-icon"
          width="13"
          height="13"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M9.2 9.2L12.5 12.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          className="input editor-input editor-search-field"
          placeholder={onCustom === undefined ? 'Search tasks' : 'Search tasks, or type a new one'}
          aria-label="Search tasks"
          value={q}
          disabled={busy}
          data-task-search
          onChange={(event) => {
            setQ(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (results[0] !== undefined) {
              onPick(results[0].key);
              setQ('');
            } else if (custom && onCustom !== undefined) {
              onCustom(typed);
              setQ('');
            }
          }}
        />
      </div>
      {typed !== '' && (
        <ul className="editor-results" aria-label="Matching tasks">
          {all === undefined && !failed && (
            <li className="editor-result-quiet">Reading your tasks…</li>
          )}
          {failed && <li className="editor-result-quiet">Your tasks could not be read.</li>}
          {all !== undefined && results.length === 0 && !custom && (
            <li className="editor-result-quiet">No task matches.</li>
          )}
          {results.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="editor-result"
                data-task-result={t.key}
                disabled={busy}
                onClick={() => {
                  onPick(t.key);
                  setQ('');
                }}
              >
                <span className="editor-result-key">{t.key}</span>
                <span className="editor-result-title">{t.title}</span>
              </button>
            </li>
          ))}
          {custom && (
            <li>
              <button
                type="button"
                className="editor-result"
                data-task-custom
                disabled={busy}
                onClick={() => {
                  onCustom?.(typed);
                  setQ('');
                }}
              >
                <span className="editor-result-key">+ New</span>
                <span className="editor-result-title">Use “{typed}” as the title, on no task</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
