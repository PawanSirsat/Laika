import { useState, type MouseEvent, type ReactNode } from 'react';
import { agentClientName } from '../../../api/agent-clients.ts';
import {
  COST_LABEL,
  costText,
  FEW_PEOPLE_LABEL,
  isFewPeople,
  modelCostText,
  outsideAnySpace,
  shareOf,
  type Usage,
} from '../../../api/usage.ts';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { BarRows } from './BarRows.tsx';
import { BySpaceRows } from './BySpaceRows.tsx';
import { breakdownTab, breakdownTabs, type BreakdownTab } from './usage-derive.ts';
import { Tabs, tabId } from '../../../components/tabs/Tabs.tsx';

const TAB_LABELS: Record<BreakdownTab, string> = {
  space: 'Space',
  developer: 'Developer',
  agent: 'Agent',
  model: 'Model',
};

/** Each panel's `data-section`, as the cards it replaces carried it. */
const SECTIONS: Record<BreakdownTab, string> = {
  space: 'spaces',
  developer: 'developers',
  agent: 'agents',
  model: 'models',
};

const NOTES: Record<BreakdownTab, string> = {
  space: `Most first · cost is ${COST_LABEL}`,
  developer: 'By name · share of tokens tied to a task',
  agent: 'All agents in range',
  model: `Cost is ${COST_LABEL}`,
};

/**
 * *Breakdown* (LAI-1127, the owner's design): by space, by developer, by agent
 * and by model — the four cards the page had — as one card with tabs. Every
 * panel stays in the page, the hidden ones `hidden`, so a tab is a view and
 * never another request.
 *
 * *Space* is offered only when the server sent `by_project` (the organisation,
 * LAI-814). **By developer is drawn only when the server sent it** — owners
 * and admins on a web session — and in name order: tokens are not a ranking
 * of people (D-084 item 7). Agents that keep no token count say *no token
 * data* rather than zero.
 */
export function BreakdownCard({
  usage,
  link,
  offered,
}: {
  readonly usage: Usage;
  readonly link: (to: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly offered: ReadonlySet<string> | null;
}) {
  const [picked, setPicked] = useState<BreakdownTab | undefined>(undefined);
  const hasSpaces = usage.by_project !== null && outsideAnySpace(usage) !== null;
  const tabs = breakdownTabs(hasSpaces);
  const current = breakdownTab(picked, tabs, usage.by_developer !== null);

  const panels: Record<BreakdownTab, ReactNode> = {
    space: hasSpaces ? <BySpaceRows usage={usage} link={link} offered={offered} /> : null,
    developer: <Developers usage={usage} />,
    agent: <Agents usage={usage} />,
    model: <Models usage={usage} />,
  };

  return (
    <section
      className="prof-card usage-card usage-breakdown"
      data-section="breakdown"
      aria-labelledby="usage-breakdown-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-breakdown-title">
          Breakdown
        </h3>
        <InfoTip label="About the breakdown">
          <p className="usage-info">
            The range’s tokens by space, by developer, by agent and by model. Tokens no task holds
            cannot be placed in a space and are counted once, last, so the space rows add up to the
            total. Each person’s tokens are from their own machines, in name order — owners and
            admins see them; members see totals only. Context, never a ranking or a rating (D-084).
          </p>
        </InfoTip>
        <Tabs
          label="Break down by"
          className="usage-segmented prof-card-actions"
          tabClassName="usage-segment"
          idBase="usage-breakdown-tab"
          panelId={(tab) => `usage-breakdown-panel-${tab}`}
          selected={current}
          onSelect={setPicked}
          items={tabs.map((tab) => ({ id: tab, label: TAB_LABELS[tab] }))}
        />
      </header>
      {tabs.map((tab) => (
        <div
          key={tab}
          className="usage-panel"
          role="tabpanel"
          id={`usage-breakdown-panel-${tab}`}
          aria-labelledby={tabId('usage-breakdown-tab', tab)}
          data-section={SECTIONS[tab]}
          hidden={current !== tab}
        >
          {panels[tab]}
          <p className="usage-panel-note">{NOTES[tab]}</p>
        </div>
      ))}
    </section>
  );
}

function Developers({ usage }: { readonly usage: Usage }) {
  if (usage.by_developer === null) {
    return (
      <p className="prof-empty">
        Per-person figures are for owners and admins; you see the space’s totals.
      </p>
    );
  }
  if (usage.by_developer.length === 0) {
    return <p className="prof-empty">Nobody’s tokens arrived in this range.</p>;
  }
  return (
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
  );
}

function Agents({ usage }: { readonly usage: Usage }) {
  if (usage.by_agent.length === 0 && usage.no_token_data.length === 0) {
    return <p className="prof-empty">No agent reported tokens in this range.</p>;
  }
  return (
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
  );
}

function Models({ usage }: { readonly usage: Usage }) {
  if (usage.by_model.length === 0) {
    return <p className="prof-empty">No model reported tokens in this range.</p>;
  }
  return (
    <BarRows
      label="Tokens by model"
      rows={usage.by_model.map((m) => ({
        key: isFewPeople(m) ? 'few-people' : m.model,
        name: isFewPeople(m) ? FEW_PEOPLE_LABEL : <code className="usage-model">{m.model}</code>,
        tokens: m.tokens,
        cacheRead: m.cache_read,
        note: modelCostText(m.cost),
      }))}
    />
  );
}
