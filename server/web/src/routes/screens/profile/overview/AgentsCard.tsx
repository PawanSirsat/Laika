import { useEffect, useState } from 'react';
import { agentClientName, type AgentClient } from '../../../../api/agent-clients.ts';
import type { ProfileAgents } from '../../../../api/profiles.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { getPersonUsage, type UsageAgentSlice } from '../../../../api/usage.ts';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { countLabel, lastActive } from '../profile-derive.ts';
import { toolRows } from './overview-derive.ts';
import { CardLink, Dashed, OverviewCard } from './OverviewCard.tsx';

/** Categorical slots for the share bar, in rank order. */
const SHARE_SLOTS = 6;

/** An agent's name on the profile: `other` is *Other agent* (LAI-751). */
function agentName(client: AgentClient): string {
  return client === 'other' ? 'Other agent' : agentClientName(client);
}

/**
 * Agents (SPEC §11.4.2.1, frame A): the tools they use — one bar of each
 * tool's **share of their LLM tokens over twelve weeks**, from the usage
 * read's `by_agent` (`GET /users/:id/usage`, the same one the LLM tokens card
 * makes; the client shares the request in flight) — then a row per tool with
 * its mark, *online*, how many tokens it is on, when it was last active and
 * its share. Tokens and presence are the profile's `agents` block.
 *
 * With no tool at all, a dashed box says so (*You haven't…* on your own).
 */
export function AgentsCard({
  userId,
  agents,
  first,
  own,
  setup,
  now,
}: {
  readonly userId: string;
  /** Absent from a response that predates D-139 item 2: no tools. */
  readonly agents: ProfileAgents | undefined;
  readonly first: string;
  readonly own: boolean;
  /** The Developer setup (or access) tab, when the reader has it. */
  readonly setup?: { readonly href: string; readonly go: () => void } | undefined;
  readonly now: number;
}) {
  const [byAgent, setByAgent] = useState<readonly UsageAgentSlice[] | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setByAgent(undefined);
    getPersonUsage(userId, controller.signal)
      .then((usage) => {
        if (!controller.signal.aborted) setByAgent(usage.by_agent);
      })
      // No usage read: the rows stand without a share, never a share of zero.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [userId]);

  const online = agents?.online;
  const live = online?.enabled === true ? online.clients : [];
  const rows = toolRows(byAgent, agents?.tokens ?? [], live);
  const spent = rows.filter((row) => row.llmTokens > 0);
  const slot = (i: number) => Math.min(i, SHARE_SLOTS - 1);
  const spoken = spent.map((row) => `${agentName(row.client)} ${row.share}`).join(', ');

  const caption =
    rows.length === 0
      ? 'none set up'
      : `${countLabel(rows.length, 'tool', 'tools')} · ${
          online?.enabled === false
            ? 'presence off'
            : live.length === 0
              ? 'none online'
              : `${String(live.length)} online`
        }`;

  return (
    <OverviewCard
      name="agents"
      title="Agents"
      caption={caption}
      link={
        setup === undefined ? undefined : (
          <CardLink name="setup" href={setup.href} onGo={setup.go}>
            {own ? 'Developer access' : 'Developer setup'}
          </CardLink>
        )
      }
    >
      {rows.length === 0 ? (
        <Dashed
          title={own ? 'You haven’t set up an agent yet' : `${first} hasn’t set up an agent yet`}
        >
          {own
            ? 'Pair a device and add a tool from Developer access. Until then, no agent can pick up cards for you.'
            : 'No device is paired and no token has been used. Their own work and time are not affected.'}
        </Dashed>
      ) : (
        <>
          {spent.length > 0 && (
            <div className="ov-share">
              <span className="ov-share-label">Share of LLM tokens, 12 weeks</span>
              <div
                className="prof-share"
                role="img"
                aria-label={`Share of LLM tokens by tool, the last 12 weeks: ${spoken}`}
              >
                {spent.map((row, i) => (
                  <span
                    key={row.client}
                    className="prof-share-part"
                    data-slot={slot(i)}
                    data-client={row.client}
                    style={{ flexGrow: row.llmTokens }}
                  />
                ))}
              </div>
            </div>
          )}
          <ul className="prof-list ov-tools">
            {rows.map((row, i) => {
              const used = lastActive(row.tokens, row.client);
              const isOnline = live.includes(row.client);
              return (
                <li
                  key={row.client}
                  className="ov-tool"
                  data-client={row.client}
                  data-online={isOnline}
                >
                  <span
                    className="prof-swatch"
                    data-slot={row.llmTokens > 0 ? slot(i) : undefined}
                    data-none={row.llmTokens === 0}
                    aria-hidden="true"
                  />
                  <AgentMark client={row.client} />
                  <span className="prof-task-who">
                    <span className="prof-agent-name">
                      {agentName(row.client)}
                      {isOnline && (
                        <span className="prof-online">
                          <span className="prof-live-dot" aria-hidden="true" />
                          online
                        </span>
                      )}
                    </span>
                    <span className="prof-row-meta">
                      {row.tokens.length === 0
                        ? 'no usable token now'
                        : countLabel(row.tokens.length, 'token', 'tokens')}
                      {used !== null && ` · active ${timeLabel(used, now).text}`}
                    </span>
                  </span>
                  <b className="prof-share-pct" data-share>
                    {row.share}
                  </b>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </OverviewCard>
  );
}
