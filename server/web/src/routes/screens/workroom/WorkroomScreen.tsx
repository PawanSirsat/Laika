import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { everyPage } from '../../../api/every-page.ts';
import { isTombstone, listProjects, type Project } from '../../../api/projects.ts';
import { listMembers, type Member } from '../../../api/tasks.ts';
import { reloadProjectTasks, useProjectTasks } from '../../../api/use-project-tasks.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { workroomReturn } from '../../workroom-return.ts';
import { Workroom } from './Workroom.tsx';
import { findByKey, prefixOf, spaceOfKey } from './workroom-resolve.ts';
import './workroom.css';

export interface WorkroomScreenProps {
  /** `:key` from `/task/:key`, as typed or pasted. */
  readonly taskKey: string;
  readonly navigate: (to: string) => void;
}

type SpaceRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly project: Project | undefined };

/**
 * The space a key's prefix names, among the spaces this reader can read.
 *
 * **The REST task read takes an id only** (`GET /tasks/:id`), so a key is
 * resolved here: its prefix to a space, then the space's task set to the
 * task — the same set every view of the space shares, so opening a task from
 * a view the reader just left costs nothing. A server-side key lookup would
 * retire this; it is reported as a gap, not built.
 */
function useSpaceOfKey(key: string): readonly [SpaceRead, () => void] {
  const [read, setRead] = useState<SpaceRead>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const prefix = prefixOf(key)?.toUpperCase();
  useEffect(() => {
    if (prefix === undefined) {
      setRead({ kind: 'ready', project: undefined });
      return;
    }
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        if (controller.signal.aborted) return;
        setRead({
          kind: 'ready',
          // A prefix the space carried before still names it (D-103 item 3).
          project: spaceOfKey(
            key,
            items.filter((p): p is Project => !isTombstone(p)),
          ),
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [prefix, attempt]);
  return [
    read,
    () => {
      setAttempt((n) => n + 1);
    },
  ];
}

/** The space's members by id, for names. An unreadable list is an empty one. */
function useMembers(slug: string | undefined): ReadonlyMap<string, Member> {
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());
  useEffect(() => {
    setMembers(new Map());
    if (slug === undefined) return;
    const controller = new AbortController();
    listMembers(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted)
          setMembers(new Map(list.members.map((m) => [m.user_id, m] as const)));
      })
      .catch(() => {
        // Names fall back to "a member you cannot see"; the server still decides.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);
  return members;
}

/**
 * **`/task/:key` — the Workroom** (LAI-1199). Finds the task, then hands it
 * to the three-panel page. Every state has its own words: reading, a read
 * that failed (with Retry), a key that names nothing this reader can see,
 * and a space they may not read.
 */
export function WorkroomScreen({ taskKey, navigate }: WorkroomScreenProps) {
  const [space, retrySpace] = useSpaceOfKey(taskKey);
  const slug = space.kind === 'ready' ? space.project?.slug : undefined;
  const set = useProjectTasks(slug);
  const members = useMembers(slug);
  const task = useMemo(
    () => (set === undefined ? undefined : findByKey(set.tasks, taskKey)),
    [set, taskKey],
  );

  useEffect(() => {
    if (task === undefined) return;
    // After the shell's own title effect, which names the route only.
    const timer = window.setTimeout(() => {
      document.title = `${task.key} · ${task.title} · Laika`;
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [task]);

  if (space.kind === 'error') {
    return (
      <WorkroomState title="Could not open this task" taskKey={taskKey} navigate={navigate}>
        <ApiErrorState error={space.error} resource="your spaces" onRetry={retrySpace} />
      </WorkroomState>
    );
  }

  if (space.kind === 'ready' && space.project === undefined) {
    return <NotFoundState taskKey={taskKey} navigate={navigate} />;
  }

  if (set?.status === 'error') {
    const status = set.error instanceof ApiError ? set.error.status : undefined;
    if (status === 404) return <NotFoundState taskKey={taskKey} navigate={navigate} />;
    if (status === 403) {
      return (
        <WorkroomState title="You cannot open this task" taskKey={taskKey} navigate={navigate}>
          <p className="wr-state-body" data-state="forbidden">
            {taskKey} belongs to a space you do not have access to. Ask one of its leads to add you.
          </p>
        </WorkroomState>
      );
    }
    return (
      <WorkroomState title="Could not open this task" taskKey={taskKey} navigate={navigate}>
        <ApiErrorState
          error={set.error}
          resource="this space's tasks"
          onRetry={() => {
            reloadProjectTasks(slug);
          }}
        />
      </WorkroomState>
    );
  }

  if (set?.status === 'ready' && task === undefined) {
    return <NotFoundState taskKey={taskKey} navigate={navigate} truncated={set.truncated} />;
  }

  if (task === undefined || slug === undefined || set === undefined) {
    return (
      <div className="wr-loading" data-state="loading">
        <LoadingState shape="drawer" count={6} label={`Loading ${taskKey}`} />
      </div>
    );
  }

  return (
    <Workroom
      key={task.id}
      task={task}
      slug={slug}
      set={set}
      members={members}
      navigate={navigate}
      back={workroomReturn(task.key, { slug, taskId: task.id })}
    />
  );
}

function WorkroomState({
  title,
  taskKey,
  navigate,
  children,
}: {
  readonly title: string;
  readonly taskKey: string;
  readonly navigate: (to: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="wr-state" aria-labelledby="wr-state-title">
      <p className="wr-state-key">{taskKey}</p>
      <h1 id="wr-state-title" className="wr-state-title">
        {title}
      </h1>
      {children}
      <Button
        variant="secondary"
        onClick={() => {
          navigate('/projects');
        }}
      >
        Go to your spaces
      </Button>
    </section>
  );
}

function NotFoundState({
  taskKey,
  navigate,
  truncated = false,
}: {
  readonly taskKey: string;
  readonly navigate: (to: string) => void;
  readonly truncated?: boolean;
}) {
  return (
    <WorkroomState title={`No task ${taskKey}`} taskKey={taskKey} navigate={navigate}>
      <p className="wr-state-body" data-state="not-found">
        {truncated
          ? `${taskKey} is not among the tasks this space returned. It may have been deleted, or the space has more tasks than one read returns.`
          : `${taskKey} may have been deleted, or it belongs to a space you cannot read.`}
      </p>
    </WorkroomState>
  );
}
