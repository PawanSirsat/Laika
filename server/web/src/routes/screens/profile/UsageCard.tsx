import { useEffect, useState } from 'react';
import { agentClientName } from '../../../api/agent-clients.ts';
import { ApiError } from '../../../api/errors.ts';
import {
  compactTokens,
  exactTokens,
  getPersonUsage,
  shareOf,
  type PersonUsage,
} from '../../../api/usage.ts';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { BarRows, Columns } from '../usage/UsageBars.tsx';
import { dayLabel } from '../usage/usage-derive.ts';
import { InfoTip } from './InfoTip.tsx';
import '../usage/usage.css';

/** How many agents and models the card lists before the rest go unsaid. */
const TOP = 3;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly usage: PersonUsage }
  | { readonly kind: 'error'; readonly forbidden: boolean };

/**
 * One person's tokens (D-084, LAI-769): twelve weeks, their agents and models,
 * and how much of it is tied to a task — on their profile for an owner or
 * admin, and as *Your tokens* on the Usage page for the person themselves.
 *
 * Reads `GET /users/:id/usage`, which answers an owner or admin about anyone
 * and a person about themselves, on a web session (§3.1); the card says so
 * rather than drawing a zero when it is refused.
 *
 * Every figure is **at least** (D-084 item 9) and leaves cache reads out of
 * the headline (item 8). Context only: nothing here feeds the rating (D-078).
 */
export function UsageCard({
  userId,
  name,
  self,
  section = 'tokens',
  className = 'prof-card',
}: {
  readonly userId: string;
  readonly name: string;
  /** The reader is the person: the empty states speak to them. */
  readonly self: boolean;
  readonly section?: string;
  readonly className?: string;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getPersonUsage(userId, controller.signal)
      .then((usage) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', usage });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          forbidden: cause instanceof ApiError && cause.code === 'forbidden',
        });
      });
    return () => {
      controller.abort();
    };
  }, [userId]);

  const title = self ? 'Your tokens' : 'Tokens';
  const id = `usage-${section}-title`;
  const usage = load.kind === 'ready' ? load.usage : undefined;
  const totals = usage?.totals;

  return (
    <section className={`${className} usage-person`} data-section={section} aria-labelledby={id}>
      <header className="prof-card-head">
        <h3 className="prof-card-title" id={id}>
          {title}
        </h3>
        <span className="prof-card-caption">12 weeks · at least</span>
        <InfoTip label="About these tokens">
          <p className="usage-info">
            Counted on {self ? 'your' : `${name}’s`} machines from the agents’ own session files —
            Claude Code, Codex, Gemini CLI — and sent as totals per day. <strong>At least</strong>:
            those files miss an agent’s background calls. <strong>Tokens</strong> are input, output
            and cache writes; cache reads, most of the raw count, are shown apart. Context only —
            never a rating or a ranking of people.
          </p>
        </InfoTip>
      </header>

      {load.kind === 'loading' && <p className="prof-empty">Reading tokens…</p>}
      {load.kind === 'error' && (
        <p className="prof-empty">
          {load.forbidden
            ? 'Token figures per person are for owners and admins, and for the person themselves.'
            : 'Could not load tokens.'}
        </p>
      )}

      {usage !== undefined && totals !== undefined && (
        <>
          {totals.tokens + totals.cache_read === 0 ? (
            <p className="prof-empty">{emptyLine(usage, name, self)}</p>
          ) : (
            <>
              <dl className="usage-person-stats">
                <div data-stat="tokens" title={`${exactTokens(totals.tokens)} tokens`}>
                  <dt>Tokens</dt>
                  <dd className="usage-person-value">
                    <span className="usage-floor-mark">at least</span>{' '}
                    {compactTokens(totals.tokens)}
                  </dd>
                </div>
                <div
                  data-stat="cache-reads"
                  title={`${exactTokens(totals.cache_read)} cache reads`}
                >
                  <dt>Cache reads</dt>
                  <dd className="usage-person-value">{compactTokens(totals.cache_read)}</dd>
                </div>
                <div data-stat="attributed">
                  <dt>Tied to a task</dt>
                  <dd className="usage-person-value">
                    {shareOf(totals.attributed_tokens, totals.tokens)}
                  </dd>
                </div>
              </dl>
              <Columns
                className="usage-weeks"
                barClass="usage-week"
                label="Tokens per week, without cache reads"
                points={usage.weeks.map((w) => ({
                  key: w.start,
                  label: `Week of ${dayLabel(w.start)}`,
                  tokens: w.tokens,
                  cacheRead: w.cache_read,
                }))}
                axis={[usage.weeks[0], usage.weeks.at(-1)]
                  .filter((w) => w !== undefined)
                  .map((w) => dayLabel(w.start))}
              />
              <div className="usage-person-lists">
                <div>
                  <h4 className="usage-person-h">Agents</h4>
                  <BarRows
                    label="Tokens by agent"
                    rows={usage.by_agent.slice(0, TOP).map((a) => ({
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
                </div>
                <div>
                  <h4 className="usage-person-h">Models</h4>
                  <BarRows
                    label="Tokens by model"
                    rows={usage.by_model.slice(0, TOP).map((m) => ({
                      key: m.model,
                      name: <code className="usage-model">{m.model}</code>,
                      tokens: m.tokens,
                      cacheRead: m.cache_read,
                    }))}
                  />
                </div>
              </div>
            </>
          )}
          {usage.no_token_data.length > 0 && (
            <p className="usage-no-data-line">
              {usage.no_token_data.map((a) => agentClientName(a)).join(', ')}: no token data —{' '}
              {usage.no_token_data.length === 1 ? 'it keeps' : 'they keep'} no token counts to read.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function emptyLine(usage: PersonUsage, name: string, self: boolean): string {
  if (!usage.sharing.org_enabled) {
    return 'Developer insights are off for this organisation, so no tokens are counted.';
  }
  if (!usage.sharing.enabled) {
    return self
      ? 'Turn on Share local activity on Connect, then run laika activity on — token counts come with it.'
      : `${name} has not turned on sharing, so no tokens arrive from their machines.`;
  }
  return self
    ? 'Nothing has arrived from your machines yet: tokens go with the next laika activity sync.'
    : `Nothing has arrived from ${name}’s machines yet.`;
}
