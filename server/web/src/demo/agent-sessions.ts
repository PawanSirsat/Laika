/**
 * Running agent sessions.
 *
 * **No API.** There is no session entity anywhere — not a table, not a route.
 * The nearest real things are `activity.actor_kind = 'agent'` (which says an
 * agent *did* something, not that one is running now) and the `heartbeats`
 * table, which has no reader or writer.
 *
 * Replace with: an agent-sessions endpoint, when one exists.
 *
 * Anchored to real tasks so the rows name work that actually exists.
 */
import type { Task } from '../api/tasks.ts';
import { DEMO_ENABLED } from './enabled.ts';

export interface DemoSession {
  readonly id: string;
  readonly who: string;
  readonly task: string;
  readonly state: 'running' | 'queued';
  readonly pct: number;
  readonly meta: string;
}

export function demoAgentSessions(tasks: readonly Task[]): readonly DemoSession[] {
  // D-032: off unless deliberately enabled — see `demo/enabled.ts`.
  if (!DEMO_ENABLED) return [];

  const candidates = tasks.filter((t) => t.status === 'in_progress').slice(0, 2);
  const shapes = [
    { state: 'running' as const, pct: 62, meta: '4m elapsed · 18 tool calls' },
    { state: 'queued' as const, pct: 0, meta: 'waiting for a slot' },
  ];

  return candidates.map((task, i) => {
    const shape = shapes[i % shapes.length] ?? shapes[0];
    return {
      id: task.id,
      who: "Someone's agent",
      task: `${task.key} · ${task.title}`,
      state: shape?.state ?? 'queued',
      pct: shape?.pct ?? 0,
      meta: shape?.meta ?? '',
    };
  });
}
