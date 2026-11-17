import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useGates, usePermissions } from '../../api/permissions.ts';
import { SPACE_TAB_PATHS } from '../../routes/route-table.ts';
import { taskHref } from '../../routes/task-href.ts';
import { useShell } from '../shell/shell-context.ts';
import { useToast } from '../toast/ToastProvider.tsx';
import { typingIn } from '../typing-in.ts';
import type { CreateOutcome } from './CreateTaskDialog.tsx';
import {
  CreateTaskContext,
  type CreateTask,
  type CreateTaskOpenOptions,
} from './use-create-task.ts';

export interface CreateTaskProviderProps {
  readonly children: ReactNode;
}

/**
 * The dialog, and the editors and reads it brings, load on first open: the
 * provider is the shell's on every screen, and the first page's budget
 * (`bundle-budget.test.ts`, LAI-1219) is not the place for a form nobody has
 * asked for yet. Its stylesheet is in the entry already (`screen-styles.ts`).
 */
const CreateTaskDialog = lazy(async () => {
  const module = await import('./CreateTaskDialog.tsx');
  return { default: module.CreateTaskDialog };
});

/** How long a *created* toast stays when all went well; a *but…* stays until closed. */
const TOAST_MS = 6_000;

/** Whether the reader may create a task in some space, as the server's grants say. */
function createsTasksSomewhere(
  me:
    | {
        readonly implicit_project_role: string | null;
        readonly projects: readonly { readonly actions: readonly string[] }[];
      }
    | undefined,
): boolean {
  if (me === undefined) return false;
  if (me.implicit_project_role === 'lead') return true;
  return me.projects.some((p) => p.actions.includes('task.create'));
}

interface Opening {
  readonly slug: string | undefined;
  readonly statusId: string | undefined;
}

/**
 * **The app's one way to create a task** (LAI-1167, D-145; app-wide since
 * LAI-1227): the state of the Create task dialog, its ways in, and the toast
 * that outlives it — the app's one toast (`useToast()`, LAI-1129).
 *
 * Mounted by the shell for a signed-in reader, so the header's *+ Create*
 * opens the dialog on every screen — not a menu of spaces, the dialog itself,
 * with the space a field in it. A space's own ways in (a lane's +, the List's
 * *Create task* row, the `c` key) pass their space, and their column.
 *
 * **Not in the URL.** The task drawer is content and lives in `?task=`; the
 * dialog is an action. A half-typed form cannot survive a refresh, and Back
 * closing a form someone has filled in is a trap. `?new=task` — what the old
 * *+ Create* navigated to — is still honoured as a way in on any screen,
 * starting in its `?project=` when there is one, then taken out of the
 * address with a replace, so Back does not open it again.
 *
 * **One gate.** `open` does nothing for a reader the server lets create a
 * task nowhere; the dialog's Space field lists only spaces whose
 * `task.create` they hold. The `c` key belongs to a space's screens and opens
 * the dialog in that space: never while typing (`typingIn`), never over
 * another modal.
 */
export function CreateTaskProvider({ children }: CreateTaskProviderProps) {
  const {
    route: { path, params, setParams, navigate },
    me,
    spaceId,
  } = useShell();
  const signedIn = me !== undefined;
  const { permissions, settled } = usePermissions(signedIn);
  const gates = useGates(signedIn);
  const [opening, setOpening] = useState<Opening | null>(null);
  /** What had focus when the dialog opened, to give it back on close. */
  const restore = useRef<HTMLElement | null>(null);
  const toast = useToast();
  /** Read when *Open* is pressed, not when the toast was made. */
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const onSpace = SPACE_TAB_PATHS.includes(path);
  const slugHere = onSpace ? (params.get('project') ?? undefined) : undefined;
  const mayCreate = createsTasksSomewhere(permissions?.me);
  const mayCreateHere =
    slugHere !== undefined && spaceId !== undefined && gates.project(spaceId, 'task.create');

  const open = useCallback(
    (options: CreateTaskOpenOptions = {}): void => {
      if (!mayCreate) return;
      const active = document.activeElement;
      restore.current = active instanceof HTMLElement ? active : null;
      setOpening({
        // The space on screen only when the reader may create in it; the
        // dialog otherwise starts from the last one used, or the first.
        slug: options.slug ?? (mayCreateHere ? slugHere : undefined),
        statusId: options.statusId,
      });
    },
    [mayCreate, mayCreateHere, slugHere],
  );
  const close = useCallback((): void => {
    setOpening(null);
  }, []);

  // A page that moves to another space under the open dialog — Back, a link
  // in a notification — closes it (review round 1 of LAI-1167): the column
  // it was opened with belonged to the page it was opened on.
  const firstSlug = useRef(slugHere);
  useEffect(() => {
    if (firstSlug.current === slugHere) return;
    firstSlug.current = slugHere;
    setOpening(null);
  }, [slugHere]);

  // `?new=task`, as the old Create navigated to: honoured once the
  // permissions can say whether this reader may, then taken out of the
  // address whether or not it opened.
  useEffect(() => {
    if (params.get('new') !== 'task') return;
    if (!settled) return;
    if (onSpace && slugHere !== undefined && spaceId === undefined) return;
    if (mayCreate) open({ slug: params.get('project') ?? undefined });
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next);
  }, [params, settled, onSpace, slugHere, spaceId, mayCreate, open, setParams]);

  // The `c` key on a space's screens, from anywhere that is not a field or a modal.
  useEffect(() => {
    if (!mayCreateHere || slugHere === undefined) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (typingIn(event.target instanceof Element ? event.target : null)) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      event.preventDefault();
      open({ slug: slugHere });
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [mayCreateHere, slugHere, open]);

  // A *created* toast goes by itself; a *created, but…* is an alert, and
  // waits to be read (the shared toast keeps an error until it is closed).
  const onCreated = useCallback(
    (outcome: CreateOutcome): void => {
      const { task, failed, slug } = outcome;
      const ok = failed.length === 0;
      toast.show({
        text: ok
          ? `${task.key} created`
          : `${task.key} created, but ${failed.map((f) => f.what).join(' and ')}`,
        tone: ok ? 'success' : 'error',
        ...(ok ? { duration: TOAST_MS } : { detail: failed.map((f) => f.said).join(' ') }),
        mark: 'created-toast',
        action: {
          label: 'Open',
          run: () => {
            const here = paramsRef.current;
            // Over the space already on screen, as the board's own open is
            // (LAI-252): a history entry, so Back closes it. Anywhere else,
            // the task in its own space.
            if (
              SPACE_TAB_PATHS.includes(window.location.pathname) &&
              here.get('project') === slug
            ) {
              const next = new URLSearchParams(here);
              next.set('task', task.id);
              setParams(next, { push: true });
              return;
            }
            navigate(taskHref({ id: task.id, key: task.key }, slug));
          },
        },
      });
    },
    [toast, setParams, navigate],
  );

  const whyNot = !settled
    ? 'Checking where you can create…'
    : mayCreate
      ? undefined
      : 'No space lets you create a task';

  const value = useMemo<CreateTask>(
    () => ({ open, close, mayCreate, mayCreateHere, whyNot }),
    [open, close, mayCreate, mayCreateHere, whyNot],
  );

  return (
    <CreateTaskContext.Provider value={value}>
      {children}
      {opening !== null && (
        <Suspense fallback={null}>
          <CreateTaskDialog
            initialSlug={opening.slug}
            currentSlug={slugHere}
            initialStatusId={opening.statusId}
            me={me}
            onClose={close}
            onCreated={onCreated}
            // Asked at close: the control that opened it may have gone with a
            // reload, and then the header's Create is the nearest thing to it.
            restore={() =>
              restore.current?.isConnected === true
                ? restore.current
                : document.querySelector<HTMLElement>('[data-header-create]')
            }
          />
        </Suspense>
      )}
    </CreateTaskContext.Provider>
  );
}
