import type { ActivityEvent } from '../../../api/activity.ts';
import type { Member } from '../../../api/tasks.ts';
import { agentLine } from '../../../api/agent-session.ts';
import { agentVia, type AgentNaming } from '../../../api/selected-agent.ts';

/**
 * Who did this, and how it is marked (SPEC §7, LAI-411).
 *
 * §7 says an agent's work is badged so a human can tell it apart — "same
 * `activity` row (with `actor_kind: agent`, **which is how the UI badges it**)".
 * The board rail and the task detail both render the same rows and **disagreed
 * about them**: the rail called a system row "Laika", the detail called it
 * "someone". One place to decide it means they cannot drift again.
 *
 * ## `actor_id === null` means the system, not an unknown person
 *
 * The schema constrains it — `activity_system_actor_check` is
 * `(actor_id IS NULL) = (actor_kind = 'system')`, so on an activity row a null
 * actor is *provably* the cron or the migration runner. The task detail rendered
 * it as "someone edited this task", which reads as an unidentified human and is
 * the one reading the constraint rules out. `personName` is still right for
 * `created_by` and `comment.author_id`, where a null really is a departed user —
 * which is why this is a separate function and not a change to that one.
 */

/**
 * The badge a row carries, or `undefined` for an ordinary person.
 *
 * **The value is the word shown.** The task detail renders it outright, which is
 * what keeps the badge from being colour alone (AC3). The rail cannot — a row is
 * 8.5px and a word will not fit — so there the marker is a *shape* and this is
 * the text a screen reader gets instead. A violet dot beside a grey dot differs
 * only by hue, so the two shapes differ as well; see `board-rail.css`.
 */
export type ActorBadge = 'agent' | 'system';

export interface ActorPresentation {
  readonly name: string;
  readonly badge: ActorBadge | undefined;
  /**
   * On an agent's row, **which** agent (LAI-538): *Claude Code · laptop-1*
   * where the reader can name it, *a registered agent* where they cannot, and
   * *agent (unregistered token)* for a legacy token, whose rows carry no
   * `agent_id`. The person stays the name — the agent acted *for* them.
   * When the row kept its session's snapshot (D-118, LAI-587) the session's
   * harness and model follow: *Claude Code · Belka · Codex · gpt-5.5*; an
   * older row is the agent alone.
   */
  readonly via: string | undefined;
}

const NO_AGENTS: ReadonlyMap<string, AgentNaming> = new Map();

/** *Pawan via Claude Code · laptop-1*, or the name alone on a person's row. */
export function actorLine(actor: ActorPresentation): string {
  return actor.via === undefined ? actor.name : `${actor.name} via ${actor.via}`;
}

/** What Laika calls itself when it acts. */
const SYSTEM_NAME = 'Laika';

/**
 * A person we have an id for but no record of — someone who has left, or a
 * member list that has not loaded. Deliberately not the raw id: a ULID is not a
 * name, and the panel is read by people.
 */
const UNKNOWN_NAME = 'Someone';

export function describeActor(
  event: Pick<ActivityEvent, 'actor_id' | 'actor_kind' | 'agent_id' | 'agent_session'>,
  members: ReadonlyMap<string, Member>,
  agents: ReadonlyMap<string, AgentNaming> | undefined = NO_AGENTS,
): ActorPresentation {
  switch (event.actor_kind) {
    case 'system':
      return { name: SYSTEM_NAME, badge: 'system', via: undefined };
    case 'agent':
      return {
        name: nameOf(event.actor_id, members),
        badge: 'agent',
        via: viaLine(event, agents),
      };
    case 'user':
      return { name: nameOf(event.actor_id, members), badge: undefined, via: undefined };
  }
}

function nameOf(id: string | null, members: ReadonlyMap<string, Member>): string {
  if (id === null) return UNKNOWN_NAME;
  return members.get(id)?.name ?? UNKNOWN_NAME;
}

/** The agent's name and what its session said ran, or `undefined` on a row no agent wrote. */
export function viaLine(
  event: Pick<ActivityEvent, 'actor_kind' | 'agent_id' | 'agent_session'>,
  agents: ReadonlyMap<string, AgentNaming>,
): string | undefined {
  const via = agentVia(event, agents);
  return via === undefined ? undefined : agentLine(via, event.agent_session);
}
