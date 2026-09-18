import { useEffect, useState, type ReactNode } from 'react';
import { useShell } from '../shell/shell-context.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { listMembers, type Member } from '../../api/tasks.ts';
import { toSpace, type Space } from '../../routes/spaces.ts';
import { getProject } from '../../api/projects.ts';
import { TaskDrawer } from '../drawer/TaskDrawer.tsx';
import { PresenceStrip } from './PresenceStrip.tsx';
import { SpaceLive, useLive } from './SpaceLive.tsx';
import { SpaceTopBar } from './SpaceTopBar.tsx';
import { SLOT_ID } from './SpaceSlot.tsx';
import { ViewTabs } from './ViewTabs.tsx';
import type { TaskPriority } from '../../api/tasks.ts';
import './space.css';

export interface SpaceLayoutProps {
  readonly children: ReactNode;
}

/**
 * The frame every view of a space mounts into (LAI-251).
 *
 * Top to bottom, as the design has it: identity and controls, the view tabs,
 * who is working now, then the view. One bar for the whole space — a screen
 * that drew its own header would be the second one, which is why
 * `SpaceSlot` exists for the per-view context line.
 */
export function SpaceLayout({ children }: SpaceLayoutProps) {
  const {
    route: { path, params, setParams, navigate },
    me,
    sprintCount,
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
        sprintCount={sprintCount}
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
  readonly sprintCount: number | undefined;
  readonly children: ReactNode;
}

function SpaceFrame({
  path,
  slug,
  params,
  setParams,
  navigate,
  orgRole,
  sprintCount,
  children,
}: SpaceFrameProps) {
  const { presence } = useLive();
  const [space, setSpace] = useState<Space | undefined>(undefined);
  const [members, setMembers] = useState<readonly Member[]>([]);

  useEffect(() => {
    if (slug === undefined) {
      setSpace(undefined);
      setMembers([]);
      return;
    }

    const controller = new AbortController();

    getProject(slug, controller.signal)
      .then((project) => {
        if (!controller.signal.aborted) setSpace(toSpace(project));
      })
      .catch(() => {
        // The bar falls back to the slug rather than failing the whole view;
        // the screen below has its own error state for a project that is gone.
      });

    listMembers(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setMembers(list.members);
      })
      .catch(() => {
        // No cluster beats a wrong one.
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

  const assignee = params.get('assignee') ?? undefined;

  return (
    <div className="space">
      <div className="space-bar">
        <SpaceTopBar
          space={space}
          members={members}
          query={params.get('q') ?? ''}
          priority={(params.get('priority') ?? undefined) as TaskPriority | undefined}
          agentOnly={params.get('agent') === 'true'}
          onQuery={(value) => {
            setParam('q', value);
          }}
          onPriority={(value) => {
            setParam('priority', value);
          }}
          onAgentOnly={(value) => {
            setParam('agent', value ? 'true' : undefined);
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
          onNavigate={navigate}
          holds={permissionHolder(orgRole)}
          counts={{ '/sprints': sprintCount }}
        />

        {/* Where each view puts its own context line and controls. */}
        <div id={SLOT_ID} className="space-slot" />
      </div>

      <PresenceStrip
        presence={presence}
        assignee={assignee}
        onFilter={(userId) => {
          setParam('assignee', userId);
        }}
      />

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
  );
}
