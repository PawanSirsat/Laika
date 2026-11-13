import {
  describeEvent,
  statusMoveNames,
  statusTransition,
  type ActivityEvent,
  type ActivitySession,
} from '../../../api/activity.ts';
import { sessionHarnessName } from '../../../api/agent-session.ts';
import {
  agentLabel,
  UNNAMED_AGENT,
  WITHHELD_SELECTION,
  type AgentNaming,
} from '../../../api/selected-agent.ts';
import type { IconName } from '../../../components/icon/icon-paths.ts';

/**
 * **One activity row as the task feed words it** (D-129, LAI-1122): a short
 * sentence in the design's words — *Created this task*, *Sent the work
 * request to Claude Code · laptop-1*, *Moved* with the two statuses as pills —
 * and the mark its circle draws.
 *
 * Panel-only. The Dashboard, the board rail and the organisation's history
 * read `describeEvent`, whose lines complete *"<who> …"*; the feed draws the
 * person once in the run's header, so its lines start with the verb. A row
 * this file has no wording for keeps `describeEvent`'s, capitalised, so a
 * type added on the server still reads as itself here.
 *
 * Plain functions, no JSX, so `node --test` pins every rule.
 */

/** The kind of thing that happened, as the circle beside it draws it. */
export type FeedIcon =
  'created' | 'request' | 'moved' | 'started' | 'sent_back' | 'finished' | 'edited' | 'other';

/**
 * The registry icon each kind draws (LAI-1213; typed characters until then):
 * decoration, the sentence beside it says the same.
 */
export const FEED_ICONS: Readonly<Record<FeedIcon, IconName>> = {
  created: 'plus',
  request: 'swap',
  moved: 'arrow-right',
  started: 'play',
  sent_back: 'reply',
  finished: 'check',
  edited: 'pencil',
  other: 'dot',
};

export interface FeedLine {
  readonly icon: FeedIcon;
  /** The sentence's verb phrase: *Sent the work request to*. */
  readonly text: string;
  /** What it was done to, in bold: an agent, a deliverable. */
  readonly object?: string | undefined;
  /** Words after the object: *built* in *Marked Terminal viewer built*. */
  readonly tail?: string | undefined;
  /** A status change's two status names, drawn as pills. */
  readonly move?: { readonly from: string; readonly to: string } | undefined;
}

/** `What this delivers`'s three lists, by their API names. */
const DELIVERS_FIELDS = new Set(['deliverables', 'solves', 'unlocks']);

function capitalised(line: string): string {
  return line === '' ? line : `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

function fallback(event: ActivityEvent, agents: ReadonlyMap<string, AgentNaming>): FeedLine {
  const icon: FeedIcon =
    event.type === 'task.updated' || event.type === 'comment.edited' ? 'edited' : 'other';
  return { icon, text: capitalised(describeEvent(event, agents)) };
}

interface Mark {
  readonly title: string;
  readonly to: string;
}

function marksOf(payload: unknown): Mark[] {
  const marked = (payload as { marked?: unknown } | null)?.marked;
  if (!Array.isArray(marked)) return [];
  return marked.flatMap((m: unknown): Mark[] => {
    const mark = m as { title?: unknown; to?: unknown } | null;
    return typeof mark?.title === 'string' && typeof mark.to === 'string'
      ? [{ title: mark.title, to: mark.to }]
      : [];
  });
}

function markLine(mark: Mark): FeedLine {
  if (mark.to === 'done') {
    return { icon: 'finished', text: 'Marked', object: mark.title, tail: 'built' };
  }
  if (mark.to === 'in_progress') return { icon: 'started', text: 'Started', object: mark.title };
  return { icon: 'edited', text: 'Reopened', object: mark.title };
}

function updatedLines(event: ActivityEvent, agents: ReadonlyMap<string, AgentNaming>): FeedLine[] {
  const payload = event.payload as { field?: unknown; to?: unknown; changed?: unknown } | null;
  if (payload?.field === 'claim') {
    return payload.to === null || payload.to === undefined
      ? [{ icon: 'other', text: 'Ended the claim' }]
      : [{ icon: 'started', text: 'Accepted and started work' }];
  }
  if (payload?.field === 'deliverables') {
    const marks = marksOf(payload);
    return marks.length === 0
      ? [{ icon: 'edited', text: 'Edited what this delivers' }]
      : marks.map(markLine);
  }
  if (Array.isArray(payload?.changed)) {
    const changed = payload.changed.filter((f): f is string => typeof f === 'string');
    const delivers = changed.some((f) => DELIVERS_FIELDS.has(f));
    const rest = changed.some((f) => !DELIVERS_FIELDS.has(f));
    if (delivers) {
      return [
        { icon: 'edited', text: 'Edited what this delivers' },
        ...(rest ? [fallback(event, agents)] : []),
      ];
    }
  }
  return [fallback(event, agents)];
}

function selectedLine(event: ActivityEvent, agents: ReadonlyMap<string, AgentNaming>): FeedLine {
  const payload = event.payload as { to?: unknown } | null | undefined;
  if (payload === null || payload === undefined) return fallback(event, agents);
  if (payload.to === null) {
    // A withheld agent may stand behind a null `to` (LAI-1011): not a withdrawal.
    return event.agent_redacted === true
      ? { icon: 'request', text: capitalised(WITHHELD_SELECTION) }
      : { icon: 'request', text: 'Withdrew the work request' };
  }
  if (typeof payload.to !== 'string') return fallback(event, agents);
  const agent = agents.get(payload.to);
  return {
    icon: 'request',
    text: 'Sent the work request to',
    object: agent === undefined ? UNNAMED_AGENT : agentLabel(agent),
  };
}

function movedLine(event: ActivityEvent, agents: ReadonlyMap<string, AgentNaming>): FeedLine {
  const move = statusMoveNames(event);
  if (move === undefined) return { ...fallback(event, agents), icon: 'moved' };
  const via = (event.payload as { via?: unknown } | null)?.via;
  if (via === 'send_back') return { icon: 'sent_back', text: 'Sent back', move };
  if (via === 'accept') return { icon: 'finished', text: 'Accepted', move };
  return {
    icon: statusTransition(event)?.to === 'done' ? 'finished' : 'moved',
    text: 'Moved',
    move,
  };
}

/** The feed's line, or lines, for one row: a row marking three deliverables reads as three. */
export function feedLines(
  event: ActivityEvent,
  agents: ReadonlyMap<string, AgentNaming> = new Map(),
): FeedLine[] {
  switch (event.type) {
    case 'task.created':
      return [{ icon: 'created', text: 'Created this task' }];
    case 'task.agent_selected':
      return [selectedLine(event, agents)];
    case 'task.status_changed':
      return [movedLine(event, agents)];
    case 'task.updated':
      return updatedLines(event, agents);
    case 'comment.added':
      return [{ icon: 'other', text: 'Commented' }];
    default:
      return [fallback(event, agents)];
  }
}

/** *Claude Code 2.1.280 · claude-opus-5-5*: what the session said ran, version and all. */
export function sessionMeta(session: ActivitySession | null | undefined): string | undefined {
  if (session === null || session === undefined) return undefined;
  const parts: string[] = [];
  const harness = session.harness?.trim() ?? '';
  if (harness !== '') {
    const version = session.harness_version?.trim() ?? '';
    parts.push(
      version === '' ? sessionHarnessName(harness) : `${sessionHarnessName(harness)} ${version}`,
    );
  }
  const model = session.model?.trim() ?? '';
  if (model !== '') parts.push(model);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const CHANNELS: Readonly<Record<string, string>> = { mcp: 'MCP', web: 'web', api: 'API' };

/** *via MCP · Polly*: the channel a task was created through, and the client when one is named. */
export function createdVia(channel: string, client: string | null): string {
  const said = CHANNELS[channel] ?? channel;
  return client === null || client.trim() === '' ? `via ${said}` : `via ${said} · ${client}`;
}

/**
 * The faint words after a line (LAI-1122): how a task was created, and what
 * an agent's session said ran when it took the task or moved it. Nothing for
 * a row the server withheld an agent from — no device, tool or model there.
 */
export function feedMeta(
  event: ActivityEvent,
  task: { readonly created_via: string; readonly created_by_client: string | null },
): string | undefined {
  if (event.type === 'task.created') return createdVia(task.created_via, task.created_by_client);
  if (event.actor_kind !== 'agent' || event.agent_redacted === true) return undefined;
  const claim = (event.payload as { field?: unknown; to?: unknown } | null) ?? null;
  const taken =
    event.type === 'task.updated' &&
    claim?.field === 'claim' &&
    claim.to !== null &&
    claim.to !== undefined;
  return taken || event.type === 'task.status_changed'
    ? sessionMeta(event.agent_session)
    : undefined;
}
