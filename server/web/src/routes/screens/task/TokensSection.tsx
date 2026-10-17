import { useEffect, useState } from 'react';
import {
  agentsNote,
  countedNote,
  compactTokens,
  exactTokens,
  getTaskUsage,
  readerZone,
  roundLabel,
  shareOf,
  type TaskUsage,
} from '../../../api/usage.ts';
import { BarRows } from '../usage/BarRows.tsx';
import '../usage/usage.css';
import './tokens.css';

export interface TokensSectionProps {
  readonly taskId: string;
  readonly taskKey: string;
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
export function TokensSection({ taskId, taskKey, started, refreshKey }: TokensSectionProps) {
  const [view, setView] = useState<TaskUsage | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getTaskUsage(taskId, readerZone(), controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setView(answer);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey]);

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
        <TokensBody view={view} />
      )}
    </section>
  );
}

function TokensBody({ view }: { readonly view: TaskUsage }) {
  const { totals } = view;
  const people = view.by_person ?? [];
  return (
    <>
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
