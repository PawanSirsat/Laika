import { Command } from 'cmdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGates, usePermissions } from '../../api/permissions.ts';
import { listAllTasks, type TaskSummary } from '../../api/tasks.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { useShell } from '../shell/shell-context.ts';
import { useDialogFocus } from '../use-dialog-focus.ts';
import { LiveRegion } from '../wizard/LiveRegion.tsx';
import { useLiveRegion } from '../wizard/live-region.ts';
import {
  allSpacesItem,
  emptySuggestion,
  filterItems,
  goToItems,
  isPaletteShortcut,
  matchTasks,
  resultCountMessage,
  spaceItems,
  TASK_DEBOUNCE_MS,
  TASK_QUERY_MIN,
  taskHref,
  type PaletteItem,
} from './palette-model.ts';
import { closePalette, paletteOpener } from './palette-store.ts';

/** The page `GET /tasks` is read in: the server's ceiling. */
const TASK_PAGE = 200;

/** How quickly the result count is spoken after the rows settle. */
const ANNOUNCE_GAP_MS = 600;

type TaskLoad =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | {
      readonly state: 'ready';
      readonly tasks: readonly TaskSummary[];
      /** More than one page exists, so matches are from the loaded page only. */
      readonly partial: boolean;
    }
  | { readonly state: 'error' };

/**
 * The tasks the palette searches (LAI-1192): one slim page of `GET /tasks`,
 * every project the reader may read, the server's own scope. The API has no
 * text search yet (proposal §1.2, BE-5), so the page is read once per opening,
 * when the first query long enough arrives, and filtered here as the query
 * settles; a page that is not the whole list says so under the results.
 */
function useTaskSearch(query: string): {
  readonly load: TaskLoad;
  readonly settled: string;
  readonly retry: () => void;
} {
  const [settled, setSettled] = useState(query);
  const [load, setLoad] = useState<TaskLoad>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(query);
    }, TASK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const wanted = settled.trim().length >= TASK_QUERY_MIN;
  // Which attempt has been sent, so a query that keeps changing reads the
  // page once; and whether the palette is still mounted to receive it. Not
  // aborted when the query shortens: the answer is wanted again a keystroke
  // later, and an aborted read would leave the group saying "Searching".
  const sent = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!wanted || sent.current === attempt) return;
    sent.current = attempt;
    setLoad({ state: 'loading' });
    listAllTasks({ limit: TASK_PAGE })
      .then((page) => {
        if (alive.current) {
          setLoad({ state: 'ready', tasks: page.data, partial: page.next_cursor !== null });
        }
      })
      .catch(() => {
        if (alive.current) setLoad({ state: 'error' });
      });
  }, [wanted, attempt]);

  return {
    load,
    settled,
    retry: () => {
      setLoad({ state: 'idle' });
      setAttempt((n) => n + 1);
    },
  };
}

/** A task's status as a small chip, coloured by its category. */
function StatusChip({ task }: { readonly task: TaskSummary }) {
  return <span className={`cmdk-status cmdk-status-${task.status}`}>{task.status_name}</span>;
}

/**
 * The command palette (LAI-1192): cmdk's `Command` **inline inside our own
 * modal**, never `Command.Dialog`, whose Radix scroll lock writes a `<style>`
 * element the CSP refuses (proposal, library verdict). Loaded lazily by
 * `CommandPaletteHost`.
 *
 * Four groups — Go to, Spaces, Tasks, Actions — each from data the app already
 * reads and gated the way the sidebar, the tab bar and the space bar gate
 * them. Filtering is ours (`shouldFilter={false}`), so the empty state and the
 * spoken count describe exactly the rows drawn.
 */
export function CommandPalette() {
  const {
    route: { path, params, navigate },
    signOut,
    signingOut,
    spaceName,
    spaceId,
  } = useShell();
  const projectSlug = params.get('project') ?? undefined;
  const { permissions } = usePermissions(true);
  const gates = useGates(true);
  const { all: spaces } = useSpaces(true, projectSlug);
  const { theme, setPreference } = useTheme();

  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  /**
   * The highlighted row, held here rather than left to cmdk: uncontrolled, it
   * highlights the first row on open without re-rendering the input, so
   * `aria-activedescendant` stays empty and a screen reader hears no option
   * until the first arrow press.
   */
  const [selected, setSelected] = useState('');
  const { load, settled, retry } = useTaskSearch(query);
  const [message, announce] = useLiveRegion(ANNOUNCE_GAP_MS);

  useDialogFocus(box, {
    initial: () => input.current,
    restore: () => paletteOpener() ?? document.getElementById('main'),
  });

  // The server's answer (`me.actions`); before it lands every gated entry
  // stays hidden, as the sidebar's do.
  const granted = permissions?.me.actions;
  const goTo = useMemo(() => {
    const holds = granted === undefined ? undefined : permissionHolder(granted);
    return filterItems(goToItems(holds, projectSlug, spaceName), query);
  }, [granted, projectSlug, spaceName, query]);

  const spaceRows = useMemo(
    () => filterItems([...spaceItems(spaces, projectSlug, path), allSpacesItem()], query),
    [spaces, projectSlug, path, query],
  );

  const actions = useMemo((): readonly (PaletteItem & { readonly run: () => void })[] => {
    const rows: (PaletteItem & { readonly run: () => void })[] = [];
    // Only where the space bar would draw Create: this space's `task.create`.
    if (
      projectSlug !== undefined &&
      spaceId !== undefined &&
      gates.project(spaceId, 'task.create')
    ) {
      rows.push({
        id: 'action:create-task',
        label: 'Create task',
        hint: spaceName,
        keywords: ['new', 'add', 'task'],
        run: () => {
          navigate(`/board?project=${encodeURIComponent(projectSlug)}&new=task`);
        },
      });
    }
    const next = theme === 'dark' ? 'light' : 'dark';
    rows.push({
      id: 'action:theme',
      label: `Switch to ${next} theme`,
      keywords: ['theme', 'dark', 'light', 'appearance', 'mode'],
      run: () => {
        setPreference(next);
      },
    });
    if (!signingOut) {
      rows.push({
        id: 'action:sign-out',
        label: 'Sign out',
        keywords: ['log out', 'logout', 'leave'],
        run: signOut,
      });
    }
    return filterItems(rows, query) as typeof rows;
  }, [
    projectSlug,
    spaceId,
    spaceName,
    gates,
    theme,
    setPreference,
    signOut,
    signingOut,
    navigate,
    query,
  ]);

  const tasks = load.state === 'ready' ? matchTasks(load.tasks, settled) : [];
  const typedEnough = query.trim().length >= TASK_QUERY_MIN;
  // Typing has outrun the debounce, or the page is on its way.
  const searching =
    typedEnough && (query !== settled || load.state === 'loading' || load.state === 'idle');
  const failed = typedEnough && load.state === 'error';
  const count = goTo.length + spaceRows.length + tasks.length + actions.length;
  const empty = count === 0 && !searching && !failed;

  useEffect(() => {
    if (searching) return;
    announce(resultCountMessage(count, query));
  }, [announce, count, query, searching]);

  /*
   * cmdk reads the highlighted row's id from the DOM before that row has
   * `aria-selected`, so on open (and after a query re-filters) the combobox
   * names no active option until an arrow is pressed. Point it at the row
   * that is highlighted when cmdk has left it empty or stale; cmdk's own value
   * replaces this the next time it has one.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const field = input.current;
      const row = box.current?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
      if (field === null || row === null || row === undefined || row.id === '') return;
      if (field.getAttribute('aria-activedescendant') !== row.id) {
        field.setAttribute('aria-activedescendant', row.id);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  const go = (href: string): void => {
    closePalette();
    navigate(href);
  };

  return createPortal(
    <div className="cmdk-layer" data-palette>
      <div className="cmdk-scrim" aria-hidden="true" onClick={closePalette} />
      <div
        ref={box}
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          // The palette's keys are its own: never also the page's shortcuts.
          event.stopPropagation();
          if (event.key === 'Escape' || isPaletteShortcut(event)) {
            event.preventDefault();
            closePalette();
          }
        }}
      >
        <Command
          label="Command palette"
          shouldFilter={false}
          loop
          value={selected}
          onValueChange={setSelected}
          className="cmdk-root"
        >
          <div className="cmdk-input-row">
            <svg
              className="cmdk-input-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <Command.Input
              ref={input}
              className="cmdk-input"
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, spaces, tasks and commands…"
            />
            <button type="button" className="cmdk-close" onClick={closePalette}>
              <span className="cmdk-close-label">Esc</span>
              <span className="visually-hidden">Close the command palette</span>
            </button>
          </div>

          <Command.List className="cmdk-list" label="Results">
            {goTo.length > 0 && (
              <Command.Group heading="Go to" className="cmdk-group">
                {goTo.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.href !== undefined) go(item.href);
                    }}
                  >
                    <span className="cmdk-item-label">{item.label}</span>
                    {item.hint !== undefined && <span className="cmdk-item-hint">{item.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {spaceRows.length > 0 && (
              <Command.Group heading="Spaces" className="cmdk-group">
                {spaceRows.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.href !== undefined) go(item.href);
                    }}
                  >
                    <span className="cmdk-space-key" aria-hidden="true">
                      {item.hint}
                    </span>
                    <span className="cmdk-item-label">{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {typedEnough && (searching || failed || tasks.length > 0) && (
              <Command.Group heading="Tasks" className="cmdk-group">
                {searching && (
                  <Command.Loading className="cmdk-note" label="Searching tasks">
                    Searching tasks…
                  </Command.Loading>
                )}
                {!searching && failed && (
                  <>
                    <p className="cmdk-note cmdk-note-error" role="alert">
                      Tasks could not be loaded.
                    </p>
                    <Command.Item value="action:retry-tasks" className="cmdk-item" onSelect={retry}>
                      <span className="cmdk-item-label">Retry task search</span>
                    </Command.Item>
                  </>
                )}
                {!searching &&
                  tasks.map((task) => (
                    <Command.Item
                      key={task.id}
                      value={`task:${task.id}`}
                      className="cmdk-item"
                      onSelect={() => {
                        go(taskHref(task, spaces));
                      }}
                    >
                      <span className="cmdk-task-key">{task.key}</span>
                      <span className="cmdk-item-label">{task.title}</span>
                      <StatusChip task={task} />
                    </Command.Item>
                  ))}
                {!searching && load.state === 'ready' && load.partial && tasks.length > 0 && (
                  <p className="cmdk-note">In loaded results — the newest {TASK_PAGE} tasks.</p>
                )}
              </Command.Group>
            )}

            {actions.length > 0 && (
              <Command.Group heading="Actions" className="cmdk-group">
                {actions.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      closePalette();
                      item.run();
                    }}
                  >
                    <span className="cmdk-item-label">{item.label}</span>
                    {item.hint !== undefined && <span className="cmdk-item-hint">{item.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {empty && (
              <div className="cmdk-empty" data-palette-empty>
                <p className="cmdk-empty-title">No results for “{query.trim()}”</p>
                <p className="cmdk-empty-hint">{emptySuggestion(query)}</p>
              </div>
            )}
          </Command.List>

          <footer className="cmdk-foot" aria-hidden="true">
            <span>
              <kbd className="cmdk-kbd">↑</kbd>
              <kbd className="cmdk-kbd">↓</kbd> to move
            </span>
            <span>
              <kbd className="cmdk-kbd">↵</kbd> to open
            </span>
            <span>
              <kbd className="cmdk-kbd">Esc</kbd> to close
            </span>
          </footer>
        </Command>
        <LiveRegion message={message} />
      </div>
    </div>,
    document.body,
  );
}
