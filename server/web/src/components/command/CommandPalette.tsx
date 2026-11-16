import { Command } from 'cmdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGates, usePermissions } from '../../api/permissions.ts';
import { everyPage } from '../../api/every-page.ts';
import { listAllTasks, type TaskSummary } from '../../api/tasks.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { CREATE_SPACE_HREF } from '../../routes/nav-url.ts';
import { useCreateTask } from '../create-task/use-create-task.ts';
import { toggledTheme } from '../../theme/theme.ts';
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
  highlightParts,
  isPaletteShortcut,
  matchTasks,
  recentItems,
  resultCountMessage,
  spaceItems,
  TASK_DEBOUNCE_MS,
  TASK_QUERY_MIN,
  taskHref,
  type PaletteItem,
} from './palette-model.ts';
import { pushRecent, readRecent, writeRecent, type RecentEntry } from './palette-recent.ts';
import { openShortcuts } from '../shell/shortcuts-store.ts';
import { formatShortcut, onMac } from '../tooltip/shortcut.ts';
import { closePalette, paletteOpener } from './palette-store.ts';
import { useOrgPeople } from '../../api/use-org-people.ts';
import type { OrgUser } from '../../api/users.ts';
import { matchPeople, personTargets, SEE_EVERYONE } from '../shell/header-model.ts';

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
      /** `everyPage` hit its cap: matches are from the tasks loaded, not all. */
      readonly partial: boolean;
    }
  | { readonly state: 'error' };

/**
 * The tasks the palette searches (LAI-1192): `GET /tasks`, slim, every
 * project the reader may read (the server's own scope), read to the end
 * through `everyPage` (LAI-703). The API has no text search yet (proposal
 * §1.2, BE-5), so the list is read once per opening, when the first query
 * long enough settles, and filtered here as the query changes. If
 * `everyPage` stops at its cap, the results say they come from what was
 * loaded, never passing a floor off as the whole.
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
    // Every page (LAI-703), up to `everyPage`'s cap, which it reports.
    everyPage((cursor) =>
      listAllTasks(cursor === undefined ? { limit: TASK_PAGE } : { limit: TASK_PAGE, cursor }),
    )
      .then(({ items, truncated }) => {
        if (alive.current) setLoad({ state: 'ready', tasks: items, partial: truncated });
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

const MAC = onMac();

/** Storage, or nothing where the browser refuses it. */
function store(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * A label with the query's words marked (LAI-1221). `<mark>` says *matched*
 * to assistive technology that announces it, and the parts joined are the
 * label exactly, so the row reads the same.
 */
function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  const parts = highlightParts(text, query);
  if (parts.length === 1 && parts[0]?.match !== true) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="cmdk-mark">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
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
 * Groups — Go to, Spaces, People, Tasks, Actions — each from data the app
 * already reads and gated the way the sidebar, the tab bar and the space bar
 * gate them. **People** (LAI-1188) is only for a reader who holds *See
 * everyone's analytics*; picking a person lists the views of them that
 * reader may open (`personTargets`), and the header's search bar opens this
 * same palette. Filtering is ours (`shouldFilter={false}`), so the empty state and the
 * spoken count describe exactly the rows drawn.
 */
export function CommandPalette() {
  const {
    route: { path, params, navigate },
    me,
    signOut,
    signingOut,
    spaceName,
  } = useShell();
  const projectSlug = params.get('project') ?? undefined;
  const { permissions } = usePermissions(true);
  const gates = useGates(true);
  const createTask = useCreateTask();
  const { all: spaces } = useSpaces(true, projectSlug);
  const { theme, setPreference, darkVariant } = useTheme();

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
  /**
   * The person whose views are on offer (LAI-1188): picking someone in the
   * People group shows where they can be looked at, instead of leaving the
   * palette. `undefined` is the palette's own rows.
   */
  const [person, setPerson] = useState<OrgUser | undefined>(undefined);
  /**
   * *See everyone's analytics* (`people.analytics.read`), as the server
   * answers it: the permission that opens a member's profile link, My day's
   * *Viewing* switch and Work's *By person*. Without it there is no People
   * group, no person view, and the people list is never asked for.
   */
  const seesEveryone = gates.org(SEE_EVERYONE);
  const people = useOrgPeople(seesEveryone);
  /**
   * The last places opened from here (LAI-1221), ids only (`palette-recent.ts`),
   * per person and per browser; read as the palette opens.
   */
  const [recent, setRecent] = useState<readonly RecentEntry[]>(() =>
    me === undefined ? [] : readRecent(store(), me.id),
  );
  const remember = (entry: RecentEntry): void => {
    if (me === undefined) return;
    const next = pushRecent(recent, entry);
    setRecent(next);
    writeRecent(store(), me.id, next);
  };
  const { load, settled, retry } = useTaskSearch(person === undefined ? query : '');
  const [message, announce] = useLiveRegion(ANNOUNCE_GAP_MS);

  useDialogFocus(box, {
    initial: () => input.current,
    restore: () => paletteOpener() ?? document.getElementById('main'),
  });

  // The server's answer (`me.actions`); before it lands every gated entry
  // stays hidden, as the sidebar's do.
  const granted = permissions?.me.actions;
  const allPages = useMemo(() => {
    const holds = granted === undefined ? undefined : permissionHolder(granted);
    return goToItems(holds, projectSlug, spaceName);
  }, [granted, projectSlug, spaceName]);
  const goTo = useMemo(() => filterItems(allPages, query), [allPages, query]);
  const blank = query.trim() === '' && person === undefined;
  const recentRows = useMemo(
    () =>
      blank
        ? recentItems(recent, {
            pages: [...allPages, allSpacesItem()],
            spaces,
            people: seesEveryone && people !== null ? people : undefined,
            currentPath: path,
          })
        : [],
    [blank, recent, allPages, spaces, seesEveryone, people, path],
  );

  const spaceRows = useMemo(
    () => filterItems([...spaceItems(spaces, projectSlug, path), allSpacesItem()], query),
    [spaces, projectSlug, path, query],
  );

  const actions = useMemo((): readonly (PaletteItem & { readonly run: () => void })[] => {
    const rows: (PaletteItem & { readonly run: () => void })[] = [];
    // The app's one Create task dialog (LAI-1227), on any screen, exactly
    // when the header's + Create is available: the dialog's Space field
    // starts on this space when the reader may create here.
    if (createTask.mayCreate) {
      rows.push({
        id: 'action:create-task',
        label: 'Create task',
        hint: createTask.mayCreateHere ? spaceName : undefined,
        keywords: ['new', 'add', 'task'],
        run: () => {
          createTask.open();
        },
      });
    }
    // Creating a space is not a Create menu any more (LAI-1227): it is here
    // and on the Spaces page, for whoever the server lets.
    if (gates.org('project.create')) {
      rows.push({
        id: 'action:create-space',
        label: 'Create space',
        keywords: ['new', 'add', 'space', 'project'],
        run: () => {
          navigate(CREATE_SPACE_HREF);
        },
      });
    }
    rows.push({
      id: 'action:shortcuts',
      label: 'Keyboard shortcuts',
      hint: '?',
      keywords: ['keys', 'keyboard', 'help', 'hotkeys', 'shortcuts'],
      run: () => {
        openShortcuts(paletteOpener());
      },
    });
    const next = toggledTheme(theme, darkVariant);
    rows.push({
      id: 'action:theme',
      label: `Switch to ${next} theme`,
      keywords: ['theme', 'dark', 'light', 'black', 'mode'],
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
    createTask,
    spaceName,
    gates,
    theme,
    darkVariant,
    setPreference,
    signOut,
    signingOut,
    navigate,
    query,
  ]);

  /** Before typing, what is worth doing next — not signing out. */
  const suggested = actions.filter((item) => item.id !== 'action:sign-out');

  const personRows = useMemo(
    () => (seesEveryone && people ? matchPeople(people, query, me?.id) : []),
    [seesEveryone, people, query, me?.id],
  );
  const targets = useMemo(() => {
    if (person === undefined) return [];
    const holds = permissionHolder(granted);
    return filterItems(
      personTargets(person.id, holds, path, params).map((t) => ({
        id: `person:${t.id}`,
        label: t.label,
        href: t.href,
      })),
      query,
    );
  }, [person, granted, path, params, query]);

  const tasks = load.state === 'ready' ? matchTasks(load.tasks, settled) : [];
  const typedEnough = person === undefined && query.trim().length >= TASK_QUERY_MIN;
  // Typing has outrun the debounce, or the page is on its way.
  const searching =
    typedEnough && (query !== settled || load.state === 'loading' || load.state === 'idle');
  const failed = typedEnough && load.state === 'error';
  const count =
    person === undefined
      ? recentRows.length +
        (blank ? suggested.length - actions.length : 0) +
        goTo.length +
        spaceRows.length +
        personRows.length +
        tasks.length +
        actions.length
      : targets.length;
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

  const go = (href: string, entry?: RecentEntry): void => {
    if (entry !== undefined) remember(entry);
    closePalette();
    navigate(href);
  };

  /** Into one person's views, or back out of them; the field starts empty each way. */
  const choosePerson = (next: OrgUser | undefined): void => {
    if (next !== undefined) remember({ kind: 'person', id: next.id });
    setPerson(next);
    setQuery('');
    setSelected('');
    input.current?.focus();
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
          // Inside one person's views, Escape and Backspace in an empty field
          // go back to the palette's rows rather than closing it.
          if (
            person !== undefined &&
            (event.key === 'Escape' || (event.key === 'Backspace' && query === ''))
          ) {
            event.preventDefault();
            choosePerson(undefined);
            return;
          }
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
              placeholder={
                person !== undefined
                  ? `Choose a view of ${person.name}…`
                  : seesEveryone
                    ? 'Search tasks, spaces, people, pages and commands…'
                    : 'Search tasks, spaces, pages and commands…'
              }
            />
            <button type="button" className="cmdk-close" onClick={closePalette}>
              <span className="cmdk-close-label">Esc</span>
              <span className="visually-hidden">Close the command palette</span>
            </button>
          </div>

          <Command.List className="cmdk-list" label="Results">
            {person !== undefined && (
              <Command.Group heading={person.name} className="cmdk-group" data-palette-person>
                {targets.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.href !== undefined) go(item.href);
                    }}
                  >
                    <span className="cmdk-item-label">{item.label}</span>
                  </Command.Item>
                ))}
                <Command.Item
                  value="person:back"
                  className="cmdk-item"
                  onSelect={() => {
                    choosePerson(undefined);
                  }}
                >
                  <span className="cmdk-item-label">Back to all results</span>
                  <span className="cmdk-item-hint">Esc</span>
                </Command.Item>
              </Command.Group>
            )}

            {recentRows.length > 0 && (
              <Command.Group heading="Recent" className="cmdk-group" data-palette-recent>
                {recentRows.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.entry.kind === 'person') {
                        const row = people?.find((p) => p.id === item.entry.id);
                        if (row !== undefined) choosePerson(row);
                        return;
                      }
                      if (item.href !== undefined) go(item.href, item.entry);
                    }}
                  >
                    <span className="cmdk-item-label">{item.label}</span>
                    {item.hint !== undefined && <span className="cmdk-item-hint">{item.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {blank && suggested.length > 0 && (
              <Command.Group heading="Suggested" className="cmdk-group" data-palette-suggested>
                {suggested.map((item) => (
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

            {person === undefined && goTo.length > 0 && (
              <Command.Group heading="Go to" className="cmdk-group">
                {goTo.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.href !== undefined) {
                        go(item.href, { kind: 'page', id: item.id.slice('go:'.length) });
                      }
                    }}
                  >
                    <span className="cmdk-item-label">
                      <Highlighted text={item.label} query={query} />
                    </span>
                    {item.hint !== undefined && <span className="cmdk-item-hint">{item.hint}</span>}
                    {item.shortcut !== undefined && (
                      <kbd className="cmdk-kbd cmdk-item-kbd" data-palette-shortcut>
                        {formatShortcut(item.shortcut, MAC)}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {person === undefined && spaceRows.length > 0 && (
              <Command.Group heading="Spaces" className="cmdk-group">
                {spaceRows.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    className="cmdk-item"
                    onSelect={() => {
                      if (item.href !== undefined) {
                        go(
                          item.href,
                          item.id.startsWith('space:')
                            ? { kind: 'space', id: item.id.slice('space:'.length) }
                            : { kind: 'page', id: '/projects' },
                        );
                      }
                    }}
                  >
                    <span className="cmdk-space-key" aria-hidden="true">
                      {item.hint}
                    </span>
                    <span className="cmdk-item-label">
                      <Highlighted text={item.label} query={query} />
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {personRows.length > 0 && person === undefined && (
              <Command.Group heading="People" className="cmdk-group" data-palette-people>
                {personRows.map((row) => (
                  <Command.Item
                    key={row.id}
                    value={`people:${row.id}`}
                    className="cmdk-item"
                    onSelect={() => {
                      choosePerson(row);
                    }}
                  >
                    <span className="cmdk-item-label">
                      <Highlighted text={row.name} query={query} />
                    </span>
                    <span className="cmdk-item-hint">{row.email}</span>
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
                        const space = spaces.find((sp) => sp.id === task.project_id)?.slug;
                        go(
                          taskHref(task, spaces),
                          space === undefined
                            ? undefined
                            : { kind: 'task', id: task.id, key: task.key, space },
                        );
                      }}
                    >
                      <span className="cmdk-task-key">
                        <Highlighted text={task.key} query={settled} />
                      </span>
                      <span className="cmdk-item-label">
                        <Highlighted text={task.title} query={settled} />
                      </span>
                      <StatusChip task={task} />
                    </Command.Item>
                  ))}
                {!searching && load.state === 'ready' && load.partial && tasks.length > 0 && (
                  <p className="cmdk-note" data-palette-partial>
                    In loaded results — the first {load.tasks.length} tasks; more exist.
                  </p>
                )}
              </Command.Group>
            )}

            {person === undefined && !blank && actions.length > 0 && (
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
                    <span className="cmdk-item-label">
                      <Highlighted text={item.label} query={query} />
                    </span>
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
