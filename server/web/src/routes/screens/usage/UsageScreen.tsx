import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { agentClientName } from '../../../api/agent-clients.ts';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import type { TokenAlert } from '../../../api/token-alerts.ts';
import {
  compactTokens,
  COST_LABEL,
  costCaveats,
  costText,
  exactTokens,
  FEW_PEOPLE_LABEL,
  getUsage,
  isFewPeople,
  modelCostText,
  percent,
  readerZone,
  shareOf,
  usd,
  USAGE_RANGES,
  type Usage,
  type UsageRange,
  reworkLine,
} from '../../../api/usage.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { UsageCard } from '../profile/UsageCard.tsx';
import { AlertsBanner } from './AlertsBanner.tsx';
import { BarRows } from './BarRows.tsx';
import { BudgetsCard } from './BudgetsCard.tsx';
import { AcceptedCostCard } from './AcceptedCostCard.tsx';
import { CacheCard } from './CacheCard.tsx';
import { RunawayCard } from './RunawayCard.tsx';
import { PlanLimitCard } from './PlanLimitCard.tsx';
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
  /** The reader's own open token alerts (LAI-773), from the shell; `undefined` until read. */
  readonly alerts?: readonly TokenAlert[] | undefined;
  /** An alert was put away: the shell reads them again, for the badge too. */
  readonly onAlertsChanged?: () => void;
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
export function UsageScreen({
  me,
  onNavigate,
  alerts,
  onAlertsChanged = () => undefined,
}: UsageScreenProps) {
  const [projects, setProjects] = useState<readonly ScopeProject[] | null | undefined>(undefined);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<UsageRange>(30);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // A budget a lead set moves the figures: read the page again, in place.
  const [asked, setAsked] = useState(0);

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
    if (asked === 0) setLoad({ kind: 'loading' });
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
  }, [scope, range, asked]);

  const scopeName = options.find((o) => o.value === scope)?.label;
  const context = `${scopeName ?? 'Tokens'} · last ${String(range)} days · at least`;
  const noSpace = me !== undefined && projects !== undefined && options.length === 0;

  return (
    <div className="usage-page">
      {/*
        The space and the range are this screen's header controls (LAI-796),
        so on Insights they sit in the page's header, where the period of a
        page is chosen.
      */}
      <ScreenHeader title="Usage" context={context}>
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
      </ScreenHeader>
      <div className="usage">
        <p className="usage-floor">
          <strong>At least.</strong> Counted on developers’ machines from the agents’ own session
          files — Claude Code, Codex, Gemini CLI — which miss an agent’s background calls, and from
          Claude Code’s own telemetry where a developer sends it. Cache reads, most of the raw
          count, are shown apart and are not in the tokens. Costs are <strong>{COST_LABEL}</strong>:
          list prices on the vendor’s API, for comparing work.
        </p>

        <AlertsBanner alerts={alerts} onNavigate={onNavigate} onChanged={onAlertsChanged} />

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
          <UsageBody
            usage={load.usage}
            onNavigate={onNavigate}
            onChanged={() => {
              setAsked((n) => n + 1);
            }}
            {...(options.some((o) => o.value === '')
              ? {
                  onAllSpaces: () => {
                    setScope('');
                  },
                }
              : {})}
          />
        )}

        {me !== undefined && (
          <div className="usage-grid usage-mine">
            <UsageCard
              userId={me.id}
              name={me.name}
              self
              section="mine"
              className="prof-card usage-card"
            />
            <PlanLimitCard />
          </div>
        )}
      </div>
    </div>
  );
}

function UsageBody({
  usage,
  onNavigate,
  onChanged,
  onAllSpaces,
}: {
  readonly usage: Usage;
  readonly onNavigate: (to: string) => void;
  /** A budget changed: read the page again. */
  readonly onChanged: () => void;
  /** Present for a reader who may read the whole organisation. */
  readonly onAllSpaces?: () => void;
}) {
  const { totals } = usage;
  /*
   * **A space holds only tokens tied to its tasks** (§4.33: a row has a project
   * only through its task), so in a space "unattributed" is always 0% — true
   * and misleading (D-084 item 6). A space says instead what it cannot hold,
   * with the organisation's unattributed share for a reader who may see it.
   */
  const space = usage.project;
  const org = usage.org_totals;
  const nothing = totals.tokens + totals.cache_read === 0;
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
          <dd className="usage-stat-sub">
            {space === null
              ? 'at least · input, output and cache writes'
              : 'at least · tied to this space’s tasks'}
          </dd>
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
        {space === null ? (
          <div className="usage-stat" data-stat="unattributed">
            <dt className="usage-stat-label">Unattributed</dt>
            <dd className="usage-stat-value">
              {shareOf(totals.tokens - totals.attributed_tokens, totals.tokens)}
            </dd>
            <dd className="usage-stat-sub">
              {shareOf(totals.attributed_tokens, totals.tokens)} tied to a task
            </dd>
          </div>
        ) : (
          <div className="usage-stat" data-stat="outside">
            <dt className="usage-stat-label">Outside any space</dt>
            <dd className="usage-stat-value">
              {org === null ? '—' : shareOf(org.tokens - org.attributed_tokens, org.tokens)}
            </dd>
            <dd className="usage-stat-sub">
              {org === null
                ? 'the organisation’s, for owners and admins'
                : 'of all tokens, tied to no task'}
            </dd>
          </div>
        )}
        <div className="usage-stat" data-stat="per-day">
          <dt className="usage-stat-label">Per day</dt>
          <dd className="usage-stat-value">
            {compactTokens(usage.days > 0 ? totals.tokens / usage.days : 0)}
          </dd>
          <dd className="usage-stat-sub">tokens, on average</dd>
        </div>
        {/* LAI-773: what the same tokens would cost on the API — never the bill. */}
        <div className="usage-stat" data-stat="cost" title={costCaveats(totals.cost).join(' · ')}>
          <dt className="usage-stat-label">Cost</dt>
          <dd className="usage-stat-value">{costText(totals.cost)}</dd>
          <dd className="usage-stat-sub">{COST_LABEL}</dd>
          {costCaveats(totals.cost).map((line) => (
            <dd key={line} className="usage-stat-sub usage-cost-caveat">
              {line}
            </dd>
          ))}
        </div>
        <div className="usage-stat" data-stat="cache">
          <dt className="usage-stat-label">From cache</dt>
          <dd className="usage-stat-value">{percent(usage.cache.share)}</dd>
          <dd className="usage-stat-sub">
            {usage.cache.saving_usd === null
              ? 'of input-side tokens'
              : `of input-side tokens · saved ${usd(usage.cache.saving_usd)}`}
          </dd>
        </div>
      </dl>

      {usage.telemetry !== null && usage.telemetry.tokens > 0 && (
        <p className="usage-telemetry" data-telemetry>
          <strong>{compactTokens(usage.telemetry.tokens)}</strong> of these tokens came from Claude
          Code’s own telemetry — side calls its session files never show — matched session by
          session, so nothing is counted twice.
          {usage.telemetry.cost_usd_reported !== null &&
            ` Claude Code’s own figure for those sessions: ${usd(usage.telemetry.cost_usd_reported)}.`}
        </p>
      )}

      {space !== null && (
        <p className="usage-space-note">
          <strong>Unattributed tokens cannot be placed in a space.</strong> A space shows only the
          tokens tied to its tasks; tokens no task holds count only across all spaces
          {org === null
            ? ', which owners and admins see.'
            : ` — ${shareOf(org.tokens - org.attributed_tokens, org.tokens)} of them in this range.`}{' '}
          {onAllSpaces !== undefined && (
            <button type="button" className="usage-chip" onClick={onAllSpaces}>
              Show all spaces
            </button>
          )}
        </p>
      )}

      {nothing && space !== null ? (
        <div data-state="space-empty">
          <EmptyState
            headline={`No tokens are tied to ${space.name}’s tasks yet`}
            body={`A space counts the tokens agents spend on its tasks. Until agents mark the task they work on, tokens are tied to no task and count only across all spaces${org === null ? ', which owners and admins see' : ''}.`}
          />
        </div>
      ) : (
        <UsageDetail usage={usage} link={link} onChanged={onChanged} />
      )}
    </>
  );
}

function UsageDetail({
  usage,
  link,
  onChanged,
}: {
  readonly usage: Usage;
  readonly link: (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onChanged: () => void;
}) {
  const { totals } = usage;
  const nothing = totals.tokens + totals.cache_read === 0;
  const days = usage.trend.map((d) => d.day);
  return (
    <>
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
                name: (
                  <PersonLink userId={p.user_id} className="usage-person-link">
                    {p.name}
                  </PersonLink>
                ),
                tokens: p.tokens,
                cacheRead: p.cache_read,
                note: `${shareOf(p.attributed_tokens, p.tokens)} on a task · ${costText(p.cost)}`,
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
                  // The fold's `agent` is `other`, as the `other` kind's is (D-087 item 7).
                  key: isFewPeople(a) ? 'few-people' : a.agent,
                  name: (
                    <>
                      <AgentMark client={a.agent} size="sm" />{' '}
                      {isFewPeople(a) ? FEW_PEOPLE_LABEL : agentClientName(a.agent)}
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
            <span className="prof-card-caption">cost is {COST_LABEL}</span>
          </header>
          {usage.by_model.length === 0 ? (
            <p className="prof-empty">No model reported tokens in this range.</p>
          ) : (
            <BarRows
              label="Tokens by model"
              rows={usage.by_model.map((m) => ({
                key: isFewPeople(m) ? 'few-people' : m.model,
                name: isFewPeople(m) ? (
                  FEW_PEOPLE_LABEL
                ) : (
                  <code className="usage-model">{m.model}</code>
                ),
                tokens: m.tokens,
                cacheRead: m.cache_read,
                note: modelCostText(m.cost),
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
              {usage.project === null
                ? `${shareOf(totals.attributed_tokens, totals.tokens)} of tokens tied to a task`
                : 'this space’s tasks'}
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

        {/* LAI-772: what send-backs cost, per project — the cost of a false
            done, in tokens and time. Nobody is named or counted. */}
        <section
          className="prof-card usage-card"
          data-section="rework"
          aria-labelledby="usage-rework-title"
        >
          <header className="prof-card-head">
            <h3 className="prof-card-title" id="usage-rework-title">
              Rework
            </h3>
            <span className="prof-card-caption">
              after a send-back · per space, never per person
            </span>
          </header>
          {usage.rework.length === 0 ? (
            <p className="prof-empty">Nothing was sent back in this range.</p>
          ) : (
            <ul className="usage-rework">
              {usage.rework.map((r) => (
                <li key={r.project.slug} className="usage-rework-row">
                  <span className="usage-rework-name">{r.project.name}</span>
                  <span className="usage-rework-line">{reworkLine(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AcceptedCostCard usage={usage} />
        <CacheCard usage={usage} />
        <BudgetsCard budgets={usage.budgets} space={usage.project} onChanged={onChanged} />
        <RunawayCard usage={usage} />
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
