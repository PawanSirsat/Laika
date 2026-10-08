import { everyPage } from '../../api/every-page.ts';
import { useEffect, useState, type ReactNode } from 'react';
import { useShell } from '../shell/shell-context.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { listMembers, type Member } from '../../api/tasks.ts';
import { listMeetingReviews } from '../../api/meeting-reviews.ts';
import { listProjectTags, type ProjectTag } from '../../api/tags.ts';
import { TaskDrawer } from '../drawer/TaskDrawer.tsx';
import { SpaceLive } from './SpaceLive.tsx';
import { SpaceTopBar } from './SpaceTopBar.tsx';
import { SpaceFilterClaim } from './SpaceSlot.tsx';
import { BAND_SLOT_ID, SLOT_ID } from './SpaceSlot.tsx';
import { ViewTabs } from './ViewTabs.tsx';
import type { TaskPriority } from '../../api/tasks.ts';
import './space.css';

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
        orgRole={me?.org_role}
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
  readonly orgRole: string | undefined;
  readonly children: ReactNode;
}

function SpaceFrame({
  path,
  slug,
  params,
  setParams,
  navigate,
  orgRole,
  children,
}: SpaceFrameProps) {
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
  const setParam = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

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
              priority={(params.get('priority') ?? undefined) as TaskPriority | undefined}
              agentOnly={params.get('agent') === 'true'}
              tags={tags}
              tag={params.get('tag') ?? undefined}
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
              onCreate={() => {
                // The board owns task creation; Create from any view goes there
                // with the form open rather than duplicating it per screen.
                navigate(
                  slug === undefined
                    ? '/board?new=task'
                    : `/board?project=${encodeURIComponent(slug)}&new=task`,
                );
              }}
            />

            <ViewTabs
              currentPath={path}
              projectSlug={slug}
              params={params}
              onNavigate={navigate}
              holds={permissionHolder(orgRole)}
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
        `SpaceLive`, which is why that read stays; Activity and Capacity read
        their own.
      */}

        {children}

        {/*
        The task drawer, over the view and inside it (LAI-252). Mounted here so
        the screen underneath keeps its scroll and its data — a drawer that
        replaced the view would have to rebuild the board on every close.
      */}
        {params.get('task') !== null && (
          <TaskDrawer
            onClose={() => {
              // `push`ed open, so Back closes it; closing is a replace, or Back
              // from here would step through the open state again.
              setParam('task', undefined);
            }}
          />
        )}
      </div>
    </SpaceFilterClaim>
  );
}
