import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { agentClientName } from '../../../api/agent-clients.ts';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import {
  compactTokens,
  exactTokens,
  getUsage,
  readerZone,
  shareOf,
  USAGE_RANGES,
  type Usage,
  type UsageRange,
} from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { UsageCard } from '../profile/UsageCard.tsx';
import { BarRows } from './BarRows.tsx';
import { Columns, dayPoints } from './Columns.tsx';
import {
  axisDays,
  dayLabel,
  defaultScope,
  scopeOptions,
  type ScopeProject,
} from './usage-derive.ts';
import '../profile/profile.css';
import './usage.css';

export interface UsageScreenProps {
  readonly me: MeProfile | undefined;
  /** Follow a link without reloading the page. */
  readonly onNavigate: (to: string) => void;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly usage: Usage }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * Usage — how many tokens the team's agents spent (§11.4.2, D-084, LAI-769).
 *
 * One page across the organisation, in the sidebar, with a space selector: an
 * owner or admin opens on *All spaces* and may pick any space; a member picks
 * among the spaces they are in, and is never offered the organisation.
 *
 * ## What is shown, and to whom
 *
 * The headline is input + output + cache writes, **at least** — the agents'
 * own session files miss their background calls — with cache reads beside it,
 * never in it (D-084 items 8 and 9). A trend by day; then by developer, by
 * agent, by model and the tasks that cost most, and the share no task holds.
 * **By developer is drawn only when the server sent it** — owners and admins
 * on a web session — and in name order: tokens are not a ranking of people
 * (D-084 item 7). Agents people connect that keep no token count say *no
 * token data* rather than zero.
 */
export function UsageScreen({ me, onNavigate }: UsageScreenProps) {
  const [projects, setProjects] = useState<readonly ScopeProject[] | null | undefined>(undefined);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<UsageRange>(30);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        if (controller.signal.aborted) return;
        setProjects(items.filter(isProject).map((p) => ({ id: p.id, slug: p.slug, name: p.name })));
      })
      .catch(() => {
        if (!controller.signal.aborted) setProjects(null);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const options = useMemo(
    () => (me === undefined || projects === undefined ? [] : scopeOptions(me, projects ?? [])),
    [me, projects],
  );

  // Where the page opens, once who is reading and which spaces exist are known.
  useEffect(() => {
    if (scope !== undefined || me === undefined || projects === undefined) return;
    const first = defaultScope(me, projects ?? []);
    if (first !== undefined) setScope(first);
  }, [me, projects, scope]);

  useEffect(() => {
    if (scope === undefined) return;
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getUsage(
      { days: range, tz: readerZone(), ...(scope === '' ? {} : { project: scope }) },
      controller.signal,
    )
      .then((usage) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', usage });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [scope, range]);

  const scopeName = options.find((o) => o.value === scope)?.label;
  const context = `${scopeName ?? 'Tokens'} · last ${String(range)} days · at least`;
  const noSpace = me !== undefined && projects !== undefined && options.length === 0;

  return (
    <div className="usage-page">
      <ScreenHeader title="Usage" context={context} />
      <div className="usage">
        <div className="usage-toolbar">
          {options.length > 0 && (
            <span className="usage-select">
              <span className="usage-select-label" aria-hidden="true">
                Space
              </span>
              <Dropdown
                className="usage-dropdown"
                aria-label="Space"
                value={scope ?? ''}
                options={options}
                onChange={(value) => {
                  setScope(value);
                }}
              />
            </span>
          )}
          <div className="usage-chips" role="group" aria-label="Range">
            {USAGE_RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                className="usage-chip"
                aria-pressed={range === r.days}
                onClick={() => {
                  setRange(r.days);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <p className="usage-floor">
          <strong>At least.</strong> Counted on developers’ machines from the agents’ own session
          files — Claude Code, Codex, Gemini CLI — which miss an agent’s background calls. Cache
          reads, most of the raw count, are shown apart and are not in the tokens.
        </p>

        {noSpace ? (
          <EmptyState
            headline="No space to show"
            body="Token totals are per space for members, and you are not in one yet."
          />
        ) : load.kind === 'error' ? (
          <ApiErrorState error={load.error} resource="token usage" scope="organisation" />
        ) : load.kind === 'loading' ? (
          <UsageSkeleton />
        ) : (
          <UsageBody usage={load.usage} onNavigate={onNavigate} />
        )}

        {me !== undefined && (
          <UsageCard
            userId={me.id}
            name={me.name}
            self
            section="mine"
            className="prof-card usage-card"
          />
        )}
      </div>
    </div>
  );
}

function UsageBody({
  usage,
  onNavigate,
}: {
  readonly usage: Usage;
  readonly onNavigate: (to: string) => void;
}) {
  const { totals } = usage;
  const nothing = totals.tokens + totals.cache_read === 0;
  const days = usage.trend.map((d) => d.day);
  const link = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  return (
    <>
      <dl className="usage-tiles">
        <div
          className="usage-stat"
          data-stat="tokens"
          title={`${exactTokens(totals.tokens)} tokens`}
        >
          <dt className="usage-stat-label">Tokens</dt>
          <dd className="usage-stat-value">{compactTokens(totals.tokens)}</dd>
          <dd className="usage-stat-sub">at least · input, output and cache writes</dd>
        </div>
        <div
          className="usage-stat"
          data-stat="cache-reads"
          title={`${exactTokens(totals.cache_read)} cache reads`}
        >
          <dt className="usage-stat-label">Cache reads</dt>
          <dd className="usage-stat-value">{compactTokens(totals.cache_read)}</dd>
          <dd className="usage-stat-sub">shown apart, not in tokens</dd>
        </div>
        <div className="usage-stat" data-stat="unattributed">
          <dt className="usage-stat-label">Unattributed</dt>
          <dd className="usage-stat-value">
            {shareOf(totals.tokens - totals.attributed_tokens, totals.tokens)}
          </dd>
          <dd className="usage-stat-sub">
            {shareOf(totals.attributed_tokens, totals.tokens)} tied to a task
          </dd>
        </div>
        <div className="usage-stat" data-stat="per-day">
          <dt className="usage-stat-label">Per day</dt>
          <dd className="usage-stat-value">
            {compactTokens(usage.days > 0 ? totals.tokens / usage.days : 0)}
          </dd>
          <dd className="usage-stat-sub">tokens, on average</dd>
        </div>
      </dl>

      {nothing && (
        <EmptyState
          headline="No token usage in this range"
          body="Tokens arrive from developers who share local activity (Connect → Share local activity, then laika activity on), at their next sync."
        />
      )}

      <section
        className="prof-card usage-card"
        data-section="trend"
        aria-labelledby="usage-trend-title"
      >
        <header className="prof-card-head">
          <h3 className="prof-card-title" id="usage-trend-title">
            Tokens per day
          </h3>
          <span className="prof-card-caption">
            {dayLabel(usage.from)} – {dayLabel(usage.to)} · without cache reads
          </span>
        </header>
        <Columns
          className="usage-trend"
          barClass="usage-bar"
          label="Tokens per day, without cache reads"
          points={dayPoints(usage.trend)}
          axis={axisDays(days).map(dayLabel)}
        />
      </section>

      <div className="usage-grid">
        <section
          className="prof-card usage-card"
          data-section="developers"
          aria-labelledby="usage-developers-title"
        >
          <header className="prof-card-head">
            <h3 className="prof-card-title" id="usage-developers-title">
              By developer
            </h3>
            <span className="prof-card-caption">by name</span>
            <InfoTip label="About by developer">
              <p className="usage-info">
                Each person’s tokens from their own machines, in name order. Owners and admins see
                it; members see totals only. Context, never a ranking or a rating (D-084).
              </p>
            </InfoTip>
          </header>
          {usage.by_developer === null ? (
            <p className="prof-empty">
              Per-person figures are for owners and admins; you see the space’s totals.
            </p>
          ) : usage.by_developer.length === 0 ? (
            <p className="prof-empty">Nobody’s tokens arrived in this range.</p>
          ) : (
            <BarRows
              label="Tokens by developer"
              rows={usage.by_developer.map((p) => ({
                key: p.user_id,
                name: <PersonLink userId={p.user_id}>{p.name}</PersonLink>,
                tokens: p.tokens,
                cacheRead: p.cache_read,
                note: `${shareOf(p.attributed_tokens, p.tokens)} on a task`,
              }))}
            />
          )}
        </section>

        <section
          className="prof-card usage-card"
          data-section="agents"
          aria-labelledby="usage-agents-title"
        >
          <header className="prof-card-head">
            <h3 className="prof-card-title" id="usage-agents-title">
              By agent
            </h3>
          </header>
          {usage.by_agent.length === 0 && usage.no_token_data.length === 0 ? (
            <p className="prof-empty">No agent reported tokens in this range.</p>
          ) : (
            <>
              <BarRows
                label="Tokens by agent"
                rows={usage.by_agent.map((a) => ({
                  key: a.agent,
                  name: (
                    <>
                      <AgentMark client={a.agent} size="sm" /> {agentClientName(a.agent)}
                    </>
                  ),
                  tokens: a.tokens,
                  cacheRead: a.cache_read,
                }))}
              />
              {usage.no_token_data.length > 0 && (
                <ul className="usage-rows usage-no-data" aria-label="Agents with no token data">
                  {usage.no_token_data.map((agent) => (
                    <li className="usage-row" key={agent} data-no-data="true">
                      <span className="usage-row-name">
                        <AgentMark client={agent} size="sm" /> {agentClientName(agent)}
                      </span>
                      <span className="usage-row-quiet">no token data</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section
          className="prof-card usage-card"
          data-section="models"
          aria-labelledby="usage-models-title"
        >
          <header className="prof-card-head">
            <h3 className="prof-card-title" id="usage-models-title">
              By model
            </h3>
          </header>
          {usage.by_model.length === 0 ? (
            <p className="prof-empty">No model reported tokens in this range.</p>
          ) : (
            <BarRows
              label="Tokens by model"
              rows={usage.by_model.map((m) => ({
                key: m.model,
                name: <code className="usage-model">{m.model}</code>,
                tokens: m.tokens,
                cacheRead: m.cache_read,
              }))}
            />
          )}
        </section>

        <section
          className="prof-card usage-card"
          data-section="tasks"
          aria-labelledby="usage-tasks-title"
        >
          <header className="prof-card-head">
            <h3 className="prof-card-title" id="usage-tasks-title">
              Top tasks
            </h3>
            <span className="prof-card-caption">
              {shareOf(totals.attributed_tokens, totals.tokens)} of tokens tied to a task
            </span>
          </header>
          {usage.top_tasks.length === 0 ? (
            <p className="prof-empty">
              No tokens are tied to a task yet: they count as unattributed until an agent marks the
              task it works on.
            </p>
          ) : (
            <BarRows
              label="Tokens by task"
              rows={usage.top_tasks.map((t) => {
                const to = `/board?project=${encodeURIComponent(t.project_slug)}&task=${encodeURIComponent(t.task_id)}`;
                return {
                  key: t.task_id,
                  name: (
                    <a className="usage-task" href={to} onClick={link(to)}>
                      <span className="usage-task-key">{t.key}</span> {t.title}
                    </a>
                  ),
                  tokens: t.tokens,
                  cacheRead: t.cache_read,
                };
              })}
            />
          )}
        </section>
      </div>
    </>
  );
}

function UsageSkeleton() {
  return (
    <div className="usage-skeleton" aria-busy="true" aria-label="Loading token usage">
      <div className="usage-tiles">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="usage-stat usage-stat-skeleton" />
        ))}
      </div>
      <div className="prof-card usage-card usage-card-skeleton" />
    </div>
  );
}
