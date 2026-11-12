import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProjectTag } from '../../api/tags.ts';
import type { Member } from '../../api/tasks.ts';
import { useShell } from '../shell/shell-context.ts';
import { useToast } from '../toast/ToastProvider.tsx';
import { typingIn } from '../typing-in.ts';
import { CreateTaskDialog, type CreateOutcome } from './CreateTaskDialog.tsx';
import {
  CreateTaskContext,
  type CreateTask,
  type CreateTaskOpenOptions,
} from './use-create-task.ts';

export interface CreateTaskProviderProps {
  readonly slug: string | undefined;
  readonly spaceId: string | undefined;
  /** The space's `task.create`, as the server says it (LAI-178). */
  readonly mayCreate: boolean;
  /** Whether the permissions have been read: `?new=task` waits for them. */
  readonly settled: boolean;
  readonly members: readonly Member[];
  readonly tags: readonly ProjectTag[];
  readonly children: ReactNode;
}

/** How long a *created* toast stays when all went well; a *but…* stays until closed. */
const TOAST_MS = 6_000;

/**
 * The space's one way to create a task (LAI-1167, D-145): the state of the
 * Create task dialog, the three ways in, and the toast that outlives it —
 * the app's one toast (`useToast()`, LAI-1129), so it stacks with every other
 * and is not a second toast system beside it.
 *
 * **Not in the URL.** The task drawer is content and lives in `?task=`; the
 * dialog is an action. A half-typed form cannot survive a refresh, and Back
 * closing a form someone has filled in is a trap. `?new=task` — what the old
 * *+ Create* navigated to — is still honoured as a way in, and then taken out
 * of the address with a replace, so Back does not open it again.
 *
 * **Three ways in, one gate.** The bar's *+ Create*, the List's *Create task*
 * row and the `c` key all come through `open`, which does nothing for a
 * reader the space does not let create. The key fires only when nothing is
 * being typed in (`typingIn`) and no other modal is open — a `c` inside a
 * task drawer's Tiptap editor is a letter, and one while a column dialog is
 * up would open a second modal over it.
 */
export function CreateTaskProvider({
  slug,
  spaceId,
  mayCreate,
  settled,
  members,
  tags,
  children,
}: CreateTaskProviderProps) {
  const {
    route: { params, setParams },
    me,
  } = useShell();
  const [opening, setOpening] = useState<CreateTaskOpenOptions | null>(null);
  /** What had focus when the dialog opened, to give it back on close. */
  const restore = useRef<HTMLElement | null>(null);
  const toast = useToast();
  /** Read when *Open* is pressed, not when the toast was made. */
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const canOpen = mayCreate && slug !== undefined;

  const open = useCallback(
    (options: CreateTaskOpenOptions = {}): void => {
      if (!canOpen) return;
      const active = document.activeElement;
      restore.current = active instanceof HTMLElement ? active : null;
      setOpening(options);
    },
    [canOpen],
  );
  const close = useCallback((): void => {
    setOpening(null);
  }, []);

  // A dialog opened for one space is not a dialog for the next (review round
  // 1): its status, sprint and parent belong to the space it opened in.
  useEffect(() => {
    setOpening(null);
  }, [slug]);

  // `?new=task`, as the bar's Create navigated to before the dialog existed:
  // honoured once the permissions can say whether this reader may, then
  // taken out of the address whether or not it opened.
  useEffect(() => {
    if (params.get('new') !== 'task') return;
    if (slug !== undefined && (!settled || spaceId === undefined)) return;
    if (canOpen) open();
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next);
  }, [params, slug, spaceId, settled, canOpen, open, setParams]);

  // The `c` key, from anywhere on the page that is not a field or a modal.
  useEffect(() => {
    if (!canOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (typingIn(event.target instanceof Element ? event.target : null)) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [canOpen, open]);

  // A *created* toast goes by itself; a *created, but…* is an alert, and
  // waits to be read (the shared toast keeps an error until it is closed).
  const onCreated = useCallback(
    (outcome: CreateOutcome): void => {
      const { task, failed } = outcome;
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
            // A history entry, as the board's own open is (LAI-252): Back closes it.
            const next = new URLSearchParams(paramsRef.current);
            next.set('task', task.id);
            setParams(next, { push: true });
          },
        },
      });
    },
    [toast, setParams],
  );

  const value = useMemo<CreateTask>(
    () => ({ open, close, mayCreate: canOpen }),
    [open, close, canOpen],
  );

  return (
    <CreateTaskContext.Provider value={value}>
      {children}
      {opening !== null && slug !== undefined && (
        <CreateTaskDialog
          slug={slug}
          spaceId={spaceId}
          members={members}
          tags={tags}
          me={me}
          initialStatusId={opening.statusId}
          onClose={close}
          onCreated={onCreated}
          // Asked at close: the List row that opened it may have gone with a
          // reload, and then the bar's Create is the nearest thing to it.
          restore={() =>
            restore.current?.isConnected === true
              ? restore.current
              : document.querySelector<HTMLElement>('.space-create')
          }
        />
      )}
    </CreateTaskContext.Provider>
  );
}
