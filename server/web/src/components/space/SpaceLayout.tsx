import { everyPage } from '../../api/every-page.ts';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useShell } from '../shell/shell-context.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { listMembers, type Member } from '../../api/tasks.ts';
import { listMeetingReviews } from '../../api/meeting-reviews.ts';
import { listProjectTags, type ProjectTag } from '../../api/tags.ts';
import { TaskDrawerHost } from '../drawer/TaskDrawerHost.tsx';
import { TaskSourceProvider, type TaskSource } from '../drawer/TaskSourceProvider.tsx';
import { CreateTaskProvider } from '../create-task/CreateTaskProvider.tsx';
import { useCreateTask } from '../create-task/use-create-task.ts';
import { SpaceLive } from './SpaceLive.tsx';
import { SpaceTopBar } from './SpaceTopBar.tsx';
import { SpaceFilterClaim } from './SpaceSlot.tsx';
import { BAND_SLOT_ID, SLOT_ID } from './SpaceSlot.tsx';
import { ViewTabs } from './ViewTabs.tsx';
import type { TaskPriority } from '../../api/tasks.ts';
import { isPriority, isTagName } from '../../api/task-filter.ts';
import './space.css';
import { useGates, usePermissions } from '../../api/permissions.ts';

/**
 * The bar shows only values the board applies (LAI-724): a refused
 * `?priority=` or `?tag=` is named by the board and ignored, so the bar's
 * controls must not present it as set.
 */
function validPriority(raw: string | null): TaskPriority | undefined {
  return raw !== null && isPriority(raw) ? raw : undefined;
}

function validTag(raw: string | null): string | undefined {
  return raw !== null && isTagName(raw) ? raw : undefined;
}

export interface SpaceLayoutProps {
  readonly children: ReactNode;
}

/**
 * The frame every view of a space mounts into (LAI-251).
 *
 * Top to bottom: identity and controls with the view tabs, then the view. The
 * WORKING NOW row that sat between them on the board was removed on the
 * owner's word (LAI-727). One bar for the whole space — a screen
 * that drew its own header would be the second one, which is why
 * `SpaceSlot` exists for the per-view context line.
 */
export function SpaceLayout({ children }: SpaceLayoutProps) {
  const {
    route: { path, params, setParams, navigate },
    me,
  } = useShell();

  const slug = params.get('project') ?? undefined;

  return (
    <SpaceLive slug={slug} enabled={me !== undefined}>
      <SpaceFrame
        path={path}
        slug={slug}
        params={params}
        setParams={setParams}
        navigate={navigate}
        signedIn={me !== undefined}
      >
        {children}
      </SpaceFrame>
    </SpaceLive>
  );
}

interface SpaceFrameProps {
  readonly path: string;
  readonly slug: string | undefined;
  readonly params: URLSearchParams;
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  readonly navigate: (to: string) => void;
  readonly signedIn: boolean;
  readonly children: ReactNode;
}

function SpaceFrame({
  path,
  slug,
  params,
  setParams,
  navigate,
  signedIn,
  // `view`, not `children`, in this component: the band-order guard
  // (`board-bands.test.ts`) reads the first rendering of children after
  // `function SpaceFrame` as where the view is drawn, and that is
  // `SpaceFrameBody`'s below — this one only hands it on.
  children: view,
}: SpaceFrameProps) {
  const { permissions } = usePermissions(signedIn);
  // Whether Create is drawn: this space's `task.create`, as the server says (LAI-178).
  const gates = useGates(signedIn);
  const { spaceId } = useShell();
  /**
   * The space's display name.
   *
   * **A name, not a `Space`** (LAI-259). `toSpace()` reads `task_counts` and
   * `member_count`, which the *list* endpoint derives and the by-slug response
   * does not carry — so building one here threw, the `catch` below swallowed
   * it, and the bar read "No space" over a project that plainly existed.
   */
  const [members, setMembers] = useState<readonly Member[]>([]);
  /**
   * The Meeting review tab's badge — **the design puts it there**, not on
   * Sprints (LAI-270). A review that is still `pending` is one somebody has to
   * look at; anything applied or discarded is done with.
   */
  const [pendingReviews, setPendingReviews] = useState<number | undefined>(undefined);
  const [tags, setTags] = useState<readonly ProjectTag[]>([]);
  /** The view's live task set, when it offers one — Board and List (LAI-1190). */
  const [taskSource, setTaskSource] = useState<TaskSource | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) {
      setMembers([]);
      return;
    }

    const controller = new AbortController();

    /*
     * **`getProject` is gone from here** (LAI-293). It existed to name the
     * space in the bar; the name is now the rail's, fetched there by the same
     * call. Leaving it would have been a second request for an answer nothing
     * on this screen reads.
     *
     * The LAI-259 lesson it carried moves with it: a `catch` must not sit
     * around code that can throw a `TypeError`, or a genuine bug is absorbed
     * as an offline endpoint. `ShellSidebar` swallows only the request.
     */
    listMembers(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setMembers(list.members);
      })
      .catch(() => {
        // No cluster beats a wrong one.
      });

    everyPage((cursor) =>
      listMeetingReviews(
        slug,
        controller.signal,
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
        if (controller.signal.aborted) return;
        setPendingReviews(page.data.filter((r) => r.status === 'pending').length);
      })
      .catch(() => {
        // No badge beats a wrong badge — the same rule the sprint count follows.
      });

    listProjectTags(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setTags(list);
      })
      .catch(() => {
        // The tag filter simply does not offer itself.
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  /** One writer for the URL, so every control agrees about what clearing means. */
  const setParam = (
    key: string,
    value: string | undefined,
    options?: { readonly push?: boolean },
  ): void => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, options);
  };

  /*
   * A key rewritten as its id, in place: the link was the history entry, so
   * this must not be a second one Back would have to step over. Read through
   * `location` rather than `params`, so the callback is stable and the host's
   * effect does not re-run on every render.
   */
  const resolveTask = useCallback(
    (taskId: string) => {
      const next = new URLSearchParams(window.location.search);
      next.set('task', taskId);
      setParams(next);
    },
    [setParams],
  );

  const mayCreate = spaceId !== undefined && gates.project(spaceId, 'task.create');

  return (
    <TaskSourceProvider onSource={setTaskSource}>
      <CreateTaskProvider
        slug={slug}
        spaceId={spaceId}
        mayCreate={mayCreate}
        settled={gates.settled}
        members={members}
        tags={tags}
      >
        <SpaceFrameBody
          path={path}
          slug={slug}
          params={params}
          navigate={navigate}
          setParam={setParam}
          members={members}
          tags={tags}
          pendingReviews={pendingReviews}
          mayCreate={mayCreate}
          holds={permissionHolder(permissions?.me.actions)}
          taskSource={taskSource}
          onResolveTask={resolveTask}
        >
          {view}
        </SpaceFrameBody>
      </CreateTaskProvider>
    </TaskSourceProvider>
  );
}

interface SpaceFrameBodyProps {
  readonly path: string;
  readonly slug: string | undefined;
  readonly params: URLSearchParams;
  readonly navigate: (to: string) => void;
  readonly setParam: (
    key: string,
    value: string | undefined,
    options?: { readonly push?: boolean },
  ) => void;
  readonly members: readonly Member[];
  readonly tags: readonly ProjectTag[];
  readonly pendingReviews: number | undefined;
  readonly mayCreate: boolean;
  readonly holds: ReturnType<typeof permissionHolder>;
  readonly taskSource: TaskSource | undefined;
  readonly onResolveTask: (taskId: string) => void;
  readonly children: ReactNode;
}

/**
 * The frame's markup, under the Create task provider so the bar's *+ Create*
 * can open the dialog (LAI-1167) — the same dialog the List's row and the
 * `c` key open, rather than a navigation to the board with a form the board
 * never had.
 */
function SpaceFrameBody({
  path,
  slug,
  params,
  navigate,
  setParam,
  members,
  tags,
  pendingReviews,
  mayCreate,
  holds,
  taskSource,
  onResolveTask,
  children,
}: SpaceFrameBodyProps) {
  const createTask = useCreateTask();

  return (
    <SpaceFilterClaim>
      <div className="space">
        <div className="space-bar">
          {/*
            **Identity and tabs on one line** (LAI-292). The owner asked for the
            project name to move up so the row it had can be used for something
            else — and with the board's own controls moving below the bar,
            what is left of the bar is narrow enough to sit beside the tabs.
          */}
          <div className="space-bar-top">
            <SpaceTopBar
              members={members}
              query={params.get('q') ?? ''}
              priority={validPriority(params.get('priority'))}
              agentOnly={params.get('agent') === 'true'}
              tags={tags}
              tag={validTag(params.get('tag'))}
              assignee={params.get('assignee') ?? undefined}
              ready={params.get('ready') === 'true'}
              onQuery={(value) => {
                setParam('q', value);
              }}
              onPriority={(value) => {
                setParam('priority', value);
              }}
              onAgentOnly={(value) => {
                setParam('agent', value ? 'true' : undefined);
              }}
              onTag={(value) => {
                setParam('tag', value);
              }}
              onAssignee={(value) => {
                setParam('assignee', value);
              }}
              onReady={(value) => {
                setParam('ready', value ? 'true' : undefined);
              }}
              {...(mayCreate
                ? {
                    onCreate: () => {
                      createTask.open();
                    },
                  }
                : {})}
            />

            <ViewTabs
              currentPath={path}
              projectSlug={slug}
              params={params}
              onNavigate={navigate}
              holds={holds}
              counts={{ '/meeting-review': pendingReviews }}
            />
          </div>

          {/* Where each view puts its own context line and controls. */}
          <div id={SLOT_ID} className="space-slot" />
        </div>

        {/*
        A full-width band under the bar, for a view that has one — the
        Timeline's sprint chips (LAI-272). The board's sprint strip used it
        until LAI-727 removed the strip.
      */}
        <div id={BAND_SLOT_ID} />

        {/*
        **No WORKING NOW row** (LAI-727). It sat here on the board only, from
        the design's `boardLive` band (prototype line 2273); the owner asked for
        it to go. The header's `Agents` count still reads presence through
        `SpaceLive`, which is why that read stays; Activity reads its own.
      */}

        {children}

        {/*
        The task drawer, over the view and inside it (LAI-252). Mounted here so
        the screen underneath keeps its scroll and its data — a drawer that
        replaced the view would have to rebuild the board on every close.
      */}
        {/*
          **The host renders the content too** (LAI-1190, B1): every view of
          the space gets the full panel, not only the board.
        */}
        <TaskDrawerHost
          slug={slug}
          taskRef={params.get('task') ?? undefined}
          // The board and the list offer their store; until it arrives the
          // host waits rather than reading the same set a second time.
          source={taskSource}
          awaitSource={path === '/board' || path === '/list'}
          members={members}
          onOpen={(taskId) => {
            setParam('task', taskId, { push: true });
          }}
          onResolved={onResolveTask}
          onClose={() => {
            // `push`ed open, so Back closes it; closing is a replace, or Back
            // from here would step through the open state again.
            setParam('task', undefined);
          }}
        />
      </div>
    </SpaceFilterClaim>
  );
}
