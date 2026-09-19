import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import { getPresence, type PresenceView } from '../../../api/presence.ts';
import { useEvents } from '../../../api/use-events.ts';
import { listMembers, listTasks, type Member, type Task } from '../../../api/tasks.ts';
import { ActivityPanels, staleTasks, STALE_DAYS } from './ActivityPanels.tsx';
import './activity.css';

export interface ActivityScreenProps {
  readonly slug: string | undefined;
}

/**
 * Activity — the live stream, the agent sessions, and what has stopped moving.
 *
 * **A tab of its own, not a rail** (the owner's updated design, 2026-09-18).
 * These three panels used to sit in a 252px column beside the board, where the
 * stream was too narrow to read a sentence in and the board lost a fifth of its
 * width to them. The board is now plain; this is where they live, three across.
 *
 * Every panel is fed by something real: the stream is `GET /events` — the first
 * consumer that endpoint has ever had — sessions are heartbeats sent on a token
 * (`is_agent`), and stale is computed from `updated_at`, which every task
 * carries.
 */
export function ActivityScreen({ slug }: ActivityScreenProps) {
  const stream = useEvents(slug);
  const [tasks, setTasks] = useState<readonly Task[] | undefined>(undefined);
  const [members, setMembers] = useState<ReadonlyMap<string, Member>>(new Map());
  /** `undefined` while the first read is in flight (LAI-440). */
  const [presence, setPresence] = useState<PresenceView | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();

    listTasks(slug, { limit: 200 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted)
          setTasks(page.data.filter((t): t is Task => !('deleted' in t)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setTasks([]);
      });

    listMembers(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted)
          setMembers(new Map(list.members.map((m) => [m.user_id, m])));
      })
      .catch(() => {
        // Names fall back to ids rather than the panel failing.
      });

    getPresence(controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setPresence(view);
      })
      .catch(() => {
        // The sessions panel says it is loading rather than claiming zero.
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  if (slug === undefined) {
    return <EmptyState headline="No space chosen" body="Pick a space to see its activity." />;
  }

  if (tasks === undefined) {
    return (
      <div className="act">
        <LoadingState shape="card" count={3} label="Loading activity" />
      </div>
    );
  }

  const stale = staleTasks(tasks, Date.now());
  const agents = presence?.present.filter((entry) => entry.is_agent) ?? [];
  /*
   * The design's header line. Every figure is counted from what is on screen —
   * a summary that disagreed with the panels below it would be worse than none.
   */
  const running = agents.length;
  const minuteAgo = Date.now() - 60_000;
  const recent = stream.recent.filter((event) => event.created_at >= minuteAgo).length;

  return (
    <div className="act">
      <SpaceSlot
        /*
         * **The agent clause is dropped until presence answers** (LAI-295).
         * `presence?.present.filter(...) ?? []` gives 0 for "not asked yet"
         * and 0 for "asked, nobody there", so this line read "0 agent sessions
         * running" as a fact and then changed it. `ActivityPanels` two files
         * over already guards its own count this way.
         */
        context={[
          `${String(recent)} ${recent === 1 ? 'event' : 'events'} in the last minute`,
          presence === undefined
            ? undefined
            : `${String(running)} agent ${running === 1 ? 'session' : 'sessions'} running`,
          `${String(stale.length)} stale ${stale.length === 1 ? 'task' : 'tasks'}`,
        ]
          .filter((part) => part !== undefined)
          .join(' · ')}
      >
        {/* The design's pill names the transport, because "live" on this screen
            means one specific thing: the SSE stream is attached. */}
        <span className={`act-pill act-pill-${stream.status}`}>
          <span className="act-pill-dot" aria-hidden="true" />
          LIVE · SSE
        </span>
      </SpaceSlot>

      <ActivityPanels
        status={stream.status}
        events={stream.recent}
        gapped={stream.gapped}
        members={members}
        presence={presence}
        stale={stale}
        staleDays={STALE_DAYS}
      />
    </div>
  );
}
