import { useEffect, useState } from 'react';
import { getTaskTime, timeLoggedLine, type TaskTime } from '../../../api/task-time.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { ForecastSection } from './ForecastSection.tsx';
import { TokensSection } from './TokensSection.tsx';
import './forecast.css';

export interface EstimateCardProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** May change the effort and, by the server's word, the budget. */
  readonly mayEdit: boolean;
  /** Re-read when this changes — the task's `updated_at`, kept current by the stream. */
  readonly refreshKey: number;
  /** Who set an effort, by name. */
  readonly nameOf: (userId: string) => string;
  /** Open another task: the similar ones are links. */
  readonly onOpen: (taskId: string) => void;
  /** After an effort is set or cleared. */
  readonly onChanged: () => void;
}

/**
 * The rail's **Estimate** card (§11.4.2.1, LAI-1122): what the task was
 * expected to take and what it took, in one place. *Effort* with its
 * override and *Why …?*, *Similar* finished tasks with their times and why
 * each was sent back, *Actual* with its verdict — `ForecastSection` — then
 * *Tokens* against the estimate's high end with the cost, the budget and
 * *Details* — `TokensSection` — and *Time logged*, the confirmed time people
 * put on it, totals only.
 *
 * Each part reads its own data and draws nothing without it; a card with
 * no part drawn is not shown (`forecast.css`).
 */
export function EstimateCard({
  slug,
  task,
  mayEdit,
  refreshKey,
  nameOf,
  onOpen,
  onChanged,
}: EstimateCardProps) {
  return (
    <section className="meta-card est-card" aria-label="Estimate">
      <h3 className="meta-card-title">Estimate</h3>
      <ForecastSection
        compact
        slug={slug}
        task={task}
        mayEdit={mayEdit}
        refreshKey={refreshKey}
        nameOf={nameOf}
        onOpen={onOpen}
        onChanged={onChanged}
      />
      <TokensSection
        compact
        taskId={task.id}
        taskKey={task.key}
        projectSlug={slug}
        started={task.started_at !== null}
        refreshKey={refreshKey}
      />
      <TimeLogged taskId={task.id} refreshKey={refreshKey} />
    </section>
  );
}

/**
 * *Time logged · 2 h 10 min by 2 people* (LAI-812's intent): the confirmed
 * time on the task, totals only. Nothing at all for none, or when the read
 * fails — never `0 min`.
 */
function TimeLogged({
  taskId,
  refreshKey,
}: {
  readonly taskId: string;
  readonly refreshKey: number;
}) {
  // Keyed on the task, so one task's figure never sits under the next one's.
  const [loaded, setLoaded] = useState<{ taskId: string; view: TaskTime } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getTaskTime(taskId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setLoaded({ taskId, view: answer });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey]);

  const line = loaded?.taskId === taskId ? timeLoggedLine(loaded.view) : null;
  if (line === null) return null;
  return (
    <div className="est-row est-time" data-section="time">
      <p className="est-label">Time logged</p>
      <p className="est-value est-time-value">{line}</p>
    </div>
  );
}
