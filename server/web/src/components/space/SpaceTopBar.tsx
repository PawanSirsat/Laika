import { useLive } from './SpaceLive.tsx';
import { agentCount, agentsLive } from './top-bar-derive.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { agentClientName, type AgentClient } from '../../api/agent-clients.ts';
import { AgentMark } from '../agent-mark/AgentMark.tsx';
import { useShell } from '../shell/shell-context.ts';
import { SpaceMenu } from './SpaceMenu.tsx';

export interface SpaceTopBarProps {
  /** Whether only agent-authored work is shown — the Agents chip's state. */
  readonly agentOnly: boolean;
  readonly onAgentOnly: (value: boolean) => void;
}

/**
 * Row one of a space: **who and what, and nothing else** (LAI-1198).
 *
 * Until LAI-1198 this row also carried Search, Priority, Tag, Assignee and
 * Ready-only on every view that did not claim them, which pushed Agents and
 * Create onto a second line on the Calendar, Sprints, Activity and Meeting
 * review — the tabs dropped ~35px and Create moved from tab to tab (visual
 * audit, findings 3 and 4). Those controls now live in `SpaceToolbar`, the row
 * under the tabs, and Create with them, so this row is the same on every tab:
 * the space's name and key, the live indicator, the Agents presence chip and
 * the space menu.
 *
 * The Agents chip stays here although it can filter: it is the space's live
 * presence — the same on every tab — not a control belonging to one view.
 */
export function SpaceTopBar({ agentOnly, onAgentOnly }: SpaceTopBarProps) {
  /*
   * From the shell, not a prop: the rail reads the same value and one project
   * name should be one request (LAI-299). `slug` is the fallback while the
   * by-slug response is in flight — a URL is a poor name but a true one.
   */
  const { spaceName, spaceKey, route } = useShell();
  const slug = route.params.get('project') ?? undefined;

  const { stream, presence } = useLive();
  /*
   * `undefined` while presence is in flight, **not `0`** (LAI-295).
   * `agentCount(presence?.present)` returned 0 for "not asked yet" and 0 for
   * "asked, none there", so the chip stated a count it did not have and then
   * changed it. §5.1: every number in the shipped UI comes from a response.
   */
  const agents = presence === undefined ? undefined : agentCount(presence.present);
  /** Which coding agents those are (LAI-737) — marks on the chip, names in its title. */
  const live = agentsLive(presence?.present);

  return (
    <>
      <div className="space-bar-row">
        <div className="space-identity">
          {/*
            **The project name is the bar's** (owner, 2026-09-21; LAI-299): the
            rail names the product, and below 900px it is off-canvas entirely,
            so this headline is the only place the space is named.
          */}
          <span className="space-icon" aria-hidden="true">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--bg-card)"
              strokeWidth="2.2"
            >
              <path d="M5 20V9M12 20V4M19 20v-7" />
            </svg>
          </span>
          <h1 className="space-name">{spaceName ?? slug ?? 'No space'}</h1>
          {/* The key every task in it carries (`LC` for `LC-42`), from the same read. */}
          {spaceKey !== undefined && (
            <Tooltip content={`Tasks in this space are keyed ${spaceKey}-…`}>
              <span className="space-key">
                <span className="visually-hidden">Key </span>
                {spaceKey}
              </span>
            </Tooltip>
          )}
        </div>

        {/*
          The LIVE pill. Four states, because the stream has four and a pill
          that only ever says LIVE is decoration (§11.5).
        */}
        <span className={`space-live space-live-${stream}`}>
          <span className="space-live-dot" aria-hidden="true" />
          <span className="space-live-word">
            {stream === 'live'
              ? 'LIVE'
              : stream === 'catching-up'
                ? 'CATCHING UP'
                : stream === 'down'
                  ? 'OFFLINE'
                  : 'CONNECTING'}
          </span>
        </span>
      </div>

      <div className="space-bar-right">
        <Tooltip content={`Show only agent-authored work${agentSummary(agents, live)}`}>
          <button
            type="button"
            className={
              agentOnly
                ? 'space-chip space-chip-on space-agents-start'
                : 'space-chip space-agents-start'
            }
            aria-pressed={agentOnly}
            onClick={() => {
              onAgentOnly(!agentOnly);
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <rect x="4" y="8" width="16" height="12" rx="3" />
              <path d="M12 4v4M9 14h.01M15 14h.01" />
            </svg>
            {/*
              **Nothing until presence lands** (LAI-606): the word stays, the
              number arrives when it arrives.
            */}
            <span className="space-agents-label">
              <span className="space-agents-word">Agents</span> {agents}
            </span>
            {/*
              **The number counts people, the marks count agents** — what the
              number means, and which agents the marks are, is said in words for
              a screen reader and in the title for a pointer.
          */}
            {agents !== undefined && (
              <span className="visually-hidden">{agentSummary(agents, live)}</span>
            )}
            {live.length > 0 && <span className="space-agents-sep" aria-hidden="true" />}
            {live.slice(0, 3).map((client) => (
              <AgentMark key={client} client={client} size="sm" />
            ))}
          </button>
        </Tooltip>

        {slug !== undefined && <SpaceMenu slug={slug} />}
      </div>
    </>
  );
}

/** ` — 2 people with agent sessions, using Claude Code, Codex`, or nothing before presence lands. */
function agentSummary(people: number | undefined, live: readonly AgentClient[]): string {
  if (people === undefined) return '';
  const who = `${String(people)} ${people === 1 ? 'person' : 'people'} with agent sessions`;
  return live.length === 0
    ? ` — ${who}`
    : ` — ${who}, using ${live.map(agentClientName).join(', ')}`;
}
