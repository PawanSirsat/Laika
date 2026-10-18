import { useEffect, useState } from 'react';
import { getProjectBudgets, runawayLine, setTaskBudget } from '../../../api/budgets.ts';
import { getTaskEstimate, tokenRange, type TaskEstimate } from '../../../api/estimates.ts';
import {
  agentsNote,
  countedNote,
  compactTokens,
  COST_LABEL,
  costCaveats,
  costText,
  exactTokens,
  getTaskUsage,
  readerZone,
  roundLabel,
  shareOf,
  type TaskUsage,
} from '../../../api/usage.ts';
import { BarRows } from '../usage/BarRows.tsx';
import { BudgetEditor, BudgetMeter } from '../usage/BudgetMeter.tsx';
import '../usage/usage.css';
import './tokens.css';

export interface TokensSectionProps {
  readonly taskId: string;
  readonly taskKey: string;
  /** Its project, to ask whether this reader may set its budget (LAI-773). */
  readonly projectSlug?: string | undefined;
  /** Whether work on it has started: a task never started shows no empty section. */
  readonly started: boolean;
  /** Re-read when this changes — the task's `updated_at`, kept current by the stream. */
  readonly refreshKey: number;
}

/**
 * The task panel's Tokens section (D-084, LAI-770), under the proof: what
 * every person's agents spent on this task — the headline without cache
 * reads, cache reads beside it — per review round, per person and agent for
 * the readers allowed to see people, and how much of those people's work
 * Laika could tie to a task at all, so the figure is never taken for the
 * whole story (item 6).
 *
 * **What a reader may not see is not sent.** An owner or admin gets everyone's
 * part, anyone else on a session their own, a token nobody's: the server
 * decides (`people`) and this draws what arrives. People are listed by name,
 * never ranked (item 7). Every figure is a floor and says *at least* (item 9).
 */
export function TokensSection({
  taskId,
  taskKey,
  projectSlug,
  started,
  refreshKey,
}: TokensSectionProps) {
  // What was read, and for which task: the panel stays mounted when it moves
  // to another task, and one task's figures must never sit under the next
  // one's key while its own load (review, item 7). A refresh of the same task
  // keeps its figures until the new ones arrive.
  const [loaded, setLoaded] = useState<{ taskId: string; view: TaskUsage } | undefined>(undefined);
  const [failedFor, setFailedFor] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setFailedFor(undefined);
    getTaskUsage(taskId, readerZone(), controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setLoaded({ taskId, view: answer });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedFor(taskId);
      });
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey]);

  // The forecast beside the actual (LAI-772): the estimate's token range, read
  // apart, so a failure here costs the section nothing but the figure.
  const [estimate, setEstimate] = useState<{ taskId: string; view: TaskEstimate } | undefined>(
    undefined,
  );
  useEffect(() => {
    const controller = new AbortController();
    getTaskEstimate(taskId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setEstimate({ taskId, view: answer });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey]);

  // Whether this reader may set the budget (LAI-773): the server's answer,
  // `can_set`, never a try that is refused. A lead, on a web session.
  const [canSet, setCanSet] = useState<{ slug: string; can: boolean } | undefined>(undefined);
  useEffect(() => {
    if (projectSlug === undefined) return;
    const controller = new AbortController();
    getProjectBudgets(projectSlug, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setCanSet({ slug: projectSlug, can: answer.can_set });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [projectSlug]);
  // A budget set here re-reads the figures in place.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (asked === 0) return;
    const controller = new AbortController();
    getTaskUsage(taskId, readerZone(), controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setLoaded({ taskId, view: answer });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [asked, taskId]);

  const view = loaded?.taskId === taskId ? loaded.view : undefined;
  const failed = failedFor === taskId;
  const forecast = estimate?.taskId === taskId ? estimate.view : undefined;
  const mayBudget = canSet !== undefined && canSet.slug === projectSlug && canSet.can;

  const empty = view !== undefined && view.totals.tokens + view.totals.cache_read === 0;
  if (view === undefined && !failed) return null;
  if (empty && !started) return null;

  return (
    <section className="panel-section tk" aria-label="Tokens" data-section="tokens">
      <h3 className="panel-section-title">Tokens</h3>
      {failed ? (
        <p className="panel-alert" role="alert">
          Could not load this task’s tokens.
        </p>
      ) : view === undefined ? null : empty ? (
        <p className="panel-muted tk-empty">
          None tied to this task yet. An agent ties its tokens here by marking the task —{' '}
          <code>start_working</code>, or <code>update_status</code> to in progress — or by working
          on a branch named <code>{taskKey}-…</code>.
        </p>
      ) : (
        <TokensBody
          view={view}
          forecast={forecast}
          mayBudget={mayBudget}
          onBudget={(tokens) =>
            setTaskBudget(view.task_id, tokens).then(() => {
              setAsked((n) => n + 1);
            })
          }
        />
      )}
    </section>
  );
}

function TokensBody({
  view,
  forecast,
  mayBudget,
  onBudget,
}: {
  readonly view: TaskUsage;
  readonly forecast: TaskEstimate | undefined;
  /** A lead on a web session, by the server's `can_set`. */
  readonly mayBudget: boolean;
  readonly onBudget: (tokens: number | null) => Promise<void>;
}) {
  const { totals } = view;
  const people = view.by_person ?? [];
  const range = forecast === undefined ? null : tokenRange(forecast.tokens);
  const build = forecast?.actual_tokens?.build;
  const caveats = costCaveats(totals.cost);
  const budget = view.budget;
  return (
    <>
      {/* LAI-773: the runaway alert, sent only to the person it is for — the
          server decides, this draws what arrives. About their quota, never a
          report on them. */}
      {view.runaway !== null && (
        <p className="tk-runaway" role="alert" data-runaway>
          {runawayLine(view.runaway)}
        </p>
      )}
      <dl className="tk-figures">
        <div className="tk-figure" title={`${exactTokens(totals.tokens)} tokens`}>
          <dt>Tokens</dt>
          <dd className="tk-total">{compactTokens(totals.tokens)}</dd>
          <dd className="tk-sub">at least · input, output and cache writes</dd>
        </div>
        <div className="tk-figure" title={`${exactTokens(totals.cache_read)} cache reads`}>
          <dt>Cache reads</dt>
          <dd className="tk-cache">{compactTokens(totals.cache_read)}</dd>
          <dd className="tk-sub">shown apart, not in tokens</dd>
        </div>
        <div className="tk-figure" data-figure="cost">
          <dt>Cost</dt>
          <dd className="tk-cost">{costText(totals.cost)}</dd>
          <dd className="tk-sub">{COST_LABEL}</dd>
          {caveats.length > 0 && <dd className="tk-sub">{caveats.join(' · ')}</dd>}
        </div>
        {forecast !== undefined && (
          <div className="tk-figure" data-figure="forecast">
            <dt>Forecast</dt>
            <dd className="tk-forecast">{range ?? 'Early'}</dd>
            <dd className="tk-sub">
              {range === null
                ? `the build, after ${String(forecast.tokens.forecasts_after)} tasks with attributed tokens`
                : `the build, likely to pessimistic${
                    build === undefined ? '' : ` · spent on it ${compactTokens(build)}`
                  }`}
            </dd>
          </div>
        )}
        {view.attributed !== null && (
          <div className="tk-figure" data-figure="attributed">
            <dt>Tied to a task</dt>
            <dd className="tk-share">{shareOf(view.attributed.tokens, view.attributed.of)}</dd>
            <dd className="tk-sub">
              {view.people === 'everyone'
                ? 'of its people’s work those days'
                : 'of yours those days'}
            </dd>
          </div>
        )}
      </dl>
      <p className="panel-muted tk-note">{countedNote(view)}</p>

      {(budget !== null || mayBudget) && (
        <div className="tk-block" data-block="budget">
          <h4 className="tk-h">
            Budget<span className="tk-h-note"> · soft, alerts at 80% and 100%</span>
          </h4>
          {budget !== null ? (
            <BudgetMeter budget={budget} name={budget.label}>
              {mayBudget && (
                <BudgetEditor
                  current={budget.source === 'set' ? budget.tokens : undefined}
                  removeLabel="Back to the forecast"
                  label={`Token budget for ${budget.label}`}
                  onSave={onBudget}
                />
              )}
            </BudgetMeter>
          ) : (
            <>
              <p className="panel-muted tk-note">
                No budget: none set, and no forecast was frozen when it was claimed.
              </p>
              <BudgetEditor
                current={undefined}
                label="Token budget for this task"
                onSave={onBudget}
              />
            </>
          )}
        </div>
      )}

      {view.by_round.length > 0 && (
        <div className="tk-block">
          <h4 className="tk-h">By round</h4>
          <BarRows
            label="Tokens by review round"
            rows={view.by_round.map((r) => ({
              key: String(r.number),
              name: roundLabel(r),
              tokens: r.tokens,
              cacheRead: r.cache_read,
            }))}
          />
        </div>
      )}

      {view.people !== 'none' && people.length > 0 && (
        <div className="tk-block">
          <h4 className="tk-h">
            {view.people === 'everyone' ? 'By person and agent' : 'Yours, by agent'}
            <span className="tk-h-note">{view.people === 'everyone' ? ' · by name' : ''}</span>
          </h4>
          <BarRows
            label={view.people === 'everyone' ? 'Tokens by person' : 'Your tokens'}
            rows={people.map((p) => ({
              key: p.user_id,
              name: p.name,
              tokens: p.tokens,
              cacheRead: p.cache_read,
              note: agentsNote(p),
            }))}
          />
        </div>
      )}
      {view.people === 'own' && people.length === 0 && (
        <p className="panel-muted tk-note">None of these are yours; who spent them is not shown.</p>
      )}
    </>
  );
}
