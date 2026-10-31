import { agentClientName, AGENT_CLIENTS, type AgentClient } from './agent-clients.ts';
import type { RegisteredAgent } from './agents.ts';
import { ApiError } from './errors.ts';
import { request } from './client.ts';
import type { Task, TaskEdit, TaskSummary } from './tasks.ts';

/**
 * A task's **selected agent** (proposal §3, D-114 item 7; API by LAI-535,
 * screens by LAI-538).
 *
 * Four facts, kept apart, as the server keeps them: the **assignee** is the
 * person accountable; the **selected agent** is the agent meant to do the
 * work; the **claim** is who is doing it (LAI-541, not yet served); the
 * **owner** is whose agent it is. Selecting one opens a work request and
 * changes nothing else — so nothing here touches the assignee, and no screen
 * counts an agent as a person.
 *
 * Plain data and functions, no JSX, so `node --test` can pin every rule.
 */

/** `SelectedAgentView` in `server/src/services/work-requests.ts`. Never a token, never a grant. */
export interface SelectedAgent {
  readonly id: string;
  /**
   * Its registered name — sent to its owner only (D-120, LAI-1001); `null`
   * for anyone else. Never the label, which is `harness` and `device_label`.
   */
  readonly display_name: string | null;
  /** Self-reported; decides nothing. Read through {@link selectedHarness}. */
  readonly harness: string;
  /** Self-reported; decides nothing. */
  readonly device_label: string | null;
  readonly status: 'active' | 'revoked';
  readonly owner: { readonly id: string; readonly name: string };
}

/** The harness as a known client, or `other` — a value the server did not send is not trusted. */
export function selectedHarness(agent: Pick<SelectedAgent, 'harness'>): AgentClient {
  return AGENT_CLIENTS.find((slug) => slug === agent.harness) ?? 'other';
}

/** What an agent whose harness Laika does not know is labelled by (D-120): never its own name. */
export const OTHER_HARNESS = 'Other harness';

/** What an agent that reported no device is labelled by (D-120): null and blank are one device. */
export const NO_DEVICE = 'No device';

/** A harness as every label writes it: *Claude Code*, or *Other harness* — never *another agent*. */
export function harnessName(client: AgentClient): string {
  return client === 'other' ? OTHER_HARNESS : agentClientName(client);
}

/**
 * The agent's product name: *Claude Code*. A harness Laika does not know reads
 * *Other harness* — never the name its owner typed, which D-120 took out of
 * every label.
 */
export function agentProductName(agent: Pick<SelectedAgent, 'harness'>): string {
  return harnessName(selectedHarness(agent));
}

/** Where it runs: the device it reported, trimmed, or *No device* — never its own name (D-120). */
export function agentDevice(agent: Pick<SelectedAgent, 'device_label'>): string {
  const device = agent.device_label?.trim() ?? '';
  return device === '' ? NO_DEVICE : device;
}

/**
 * *Omnigent · Belka* — **the** label of an agent (D-120, LAI-1001): its
 * harness and its device, and nothing its owner typed. The chip's words, the
 * List's, the filter's, History's and the Agents tab's. Two of one owner's
 * active agents can no longer share it (LAI-1000's `409`); a legacy pair that
 * already does is told apart by {@link twinNames}, and only then.
 */
export function agentLabel(agent: Pick<SelectedAgent, 'harness' | 'device_label'>): string {
  return `${agentProductName(agent)} · ${agentDevice(agent)}`;
}

// ------------------------------------------------------------------ telling two apart

/** What naming an agent apart from another takes: its id as well. */
type Peer = Pick<SelectedAgent, 'id' | 'harness' | 'display_name' | 'device_label'>;

/**
 * **The device each agent shows, told apart only where two collide**
 * (LAI-583). D-118 names an agent `<harness> · <device>` — *Claude Code ·
 * Belka* — and that is what every screen shows. Where two of the agents given
 * share that label, each gets a {@link twinNames} mark after the device:
 * *Belka (polly workers)*.
 *
 * By id, for every agent given. An agent listed twice is one agent.
 */
export function distinctDevices(agents: Iterable<Peer>): ReadonlyMap<string, string> {
  const all = [...agents];
  const twins = twinNames(all);
  return new Map(
    all.map((agent) => {
      const twin = twins.get(agent.id);
      const device = agentDevice(agent);
      return [agent.id, twin === undefined ? device : `${device} (${twin})`] as const;
    }),
  );
}

/** The longest mark {@link twinNames} draws from a registered name; longer is cut in the middle. */
export const TWIN_MARK_MAX = 24;

/** *a-very-long-agent-name-2* → *a-very-long-…ent-name-2*: both ends kept, where names differ. */
export function middleCut(text: string, max = TWIN_MARK_MAX): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/**
 * The marks that tell colliding agents apart — *polly workers* — by id, and
 * only for agents whose `harness · device` label another given agent shares.
 * The card chip and the List cell show the mark itself, which no ellipsis
 * cuts, because it is at most {@link TWIN_MARK_MAX} characters or an id.
 *
 * In a group that shares a label, sorted by id so the answer never depends on
 * the order given:
 *
 * 1. an agent's registered name, cut in the middle past {@link TWIN_MARK_MAX},
 *    when it says something the label does not and no other in the group
 *    would show the same mark;
 * 2. every other agent: its id's last 4 characters, grown one at a time until
 *    no two marks in the group are equal; ids are distinct, so at their full
 *    length they always are.
 *
 * Then **the final labels are checked across every agent given** — a device
 * could itself read *Belka (worker)* — and any that still match another are
 * marked with their whole id. Two whole-id labels end in `(<id>)`; with ids
 * of one length (ULIDs), equal labels would need equal ids. So, for distinct
 * ids of one length, every label this produces among the agents given is
 * different — and the tests construct the cases that broke the first version.
 */
export function twinNames(agents: Iterable<Peer>): ReadonlyMap<string, string> {
  const byId = new Map<string, Peer>();
  for (const agent of agents) byId.set(agent.id, agent);
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map<string, Peer[]>();
  for (const agent of sorted) {
    const key = agentLabel(agent).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const said = (agent: Peer): string | undefined => {
      const name = (agent.display_name ?? '').trim();
      const lower = name.toLowerCase();
      return name === '' ||
        lower === agentLabel(agent).toLowerCase() ||
        lower === agentDevice(agent).toLowerCase()
        ? undefined
        : middleCut(name);
    };
    const named = new Map<string, string>();
    for (const agent of group) {
      const mark = said(agent);
      if (mark === undefined) continue;
      const shared = group.filter((other) => said(other) === mark).length > 1;
      if (!shared) named.set(agent.id, mark);
    }
    const rest = group.filter((agent) => !named.has(agent.id));
    const longest = Math.max(4, ...rest.map((agent) => agent.id.length));
    for (let n = 4; n <= longest; n += 1) {
      const marks = new Map(named);
      for (const agent of rest) marks.set(agent.id, agent.id.slice(-n));
      if (new Set(marks.values()).size === marks.size || n === longest) {
        for (const [id, mark] of marks) out.set(id, mark);
        break;
      }
    }
  }
  // The final labels, across every agent given.
  const final = (agent: Peer): string => {
    const twin = out.get(agent.id);
    return twin === undefined ? agentLabel(agent) : `${agentLabel(agent)} (${twin})`;
  };
  // Each pass moves at least one agent to its whole id, so this many passes suffice.
  let passes = sorted.length;
  while (passes > 0) {
    passes -= 1;
    const seen = new Map<string, Peer[]>();
    for (const agent of sorted) seen.set(final(agent), [...(seen.get(final(agent)) ?? []), agent]);
    const clashing = [...seen.values()].filter((same) => same.length > 1).flat();
    if (clashing.length === 0) break;
    for (const agent of clashing) out.set(agent.id, agent.id);
  }
  return out;
}

/** `agent` with the device {@link distinctDevices} gave it, so every label built from it agrees. */
export function shownAs<T extends Peer>(agent: T, devices: ReadonlyMap<string, string>): T {
  const device = devices.get(agent.id);
  return device === undefined || device === agentDevice(agent)
    ? agent
    : { ...agent, device_label: device };
}

/**
 * {@link twinNames} for the agents selected on a set of tasks — the board's
 * cards. Kept per map, since every card asks of the same one.
 */
const onTasks = new WeakMap<object, ReadonlyMap<string, string>>();
export function twinsOnTasks(
  tasks: ReadonlyMap<string, Pick<TaskSummary, 'selected_agent'>>,
): ReadonlyMap<string, string> {
  const known = onTasks.get(tasks);
  if (known !== undefined) return known;
  const twins = twinNames(selectedOn([...tasks.values()]));
  onTasks.set(tasks, twins);
  return twins;
}

/** A task's selected agent; a view served before LAI-535 carries none. */
export function selectedAgentOf(task: Pick<TaskSummary, 'selected_agent'>): SelectedAgent | null {
  return task.selected_agent ?? null;
}

// ------------------------------------------------------------------ selecting

/**
 * `PATCH /tasks/:id { selected_agent_id }`. `null` withdraws; the same id
 * twice is a no-op. `signal` ends a request that never answers
 * (`agent-writes.ts`).
 */
export function selectTaskAgent(
  taskId: string,
  agentId: string | null,
  signal?: AbortSignal,
): Promise<Task> {
  const edit: TaskEdit = { selected_agent_id: agentId };
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: edit,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** The server's refusals, by `details.reason` (LAI-535). §6.3's codes are closed, so it is a reason. */
export const SELECTED_AGENT_REFUSALS = [
  'agent_not_found',
  'agent_other_owner',
  'agent_wrong_org',
  'agent_revoked',
  'agent_not_granted',
  'agent_read_only',
  'agents_off',
] as const;
export type SelectedAgentRefusal = (typeof SELECTED_AGENT_REFUSALS)[number];

/**
 * Each refusal as the drawer says it: **what is wrong and what fixes it**.
 * The server's own message is shown for a reason this map does not know.
 */
export const REFUSAL_WORDS: Readonly<Record<SelectedAgentRefusal, string>> = {
  agent_not_found: 'That agent no longer exists.',
  agent_other_owner: 'Only your own agents can be picked for now.',
  agent_wrong_org: 'That agent belongs to another organisation.',
  agent_revoked: 'That agent is revoked. Register or pick another.',
  agent_not_granted: 'That agent has no access to this space. Grant it under Developer → Agents.',
  agent_read_only: 'That agent may only read in this space. Give it a full grant to do the work.',
  agents_off: 'This space does not let agents make changes.',
};

function isRefusal(value: unknown): value is SelectedAgentRefusal {
  return (SELECTED_AGENT_REFUSALS as readonly unknown[]).includes(value);
}

/** The refusal's reason, when the error is a `422` about `selected_agent_id`. */
export function refusalOf(error: unknown): SelectedAgentRefusal | undefined {
  if (!(error instanceof ApiError) || error.code !== 'unprocessable') return undefined;
  const details = error.details as { field?: unknown; reason?: unknown } | null;
  if (details?.field !== 'selected_agent_id') return undefined;
  return isRefusal(details.reason) ? details.reason : undefined;
}

/** The selected agent, as a `selected_for_another_agent` refusal names it — when the caller may see it. */
type NamedAgent = Pick<SelectedAgent, 'harness' | 'display_name' | 'device_label'>;

function namedAgentOf(details: unknown): NamedAgent | undefined {
  const agent = (details as { selected_agent?: unknown } | null)?.selected_agent;
  if (typeof agent !== 'object' || agent === null) return undefined;
  const a = agent as Record<string, unknown>;
  if (typeof a.display_name !== 'string' || typeof a.harness !== 'string') return undefined;
  return {
    display_name: a.display_name,
    harness: a.harness,
    device_label: typeof a.device_label === 'string' ? a.device_label : null,
  };
}

/**
 * D-119's refusal in words (LAI-586): *"once a task names its agent, only that
 * agent can start it."* `409 conflict` with `reason:
 * selected_for_another_agent`; the agent is named only when the server named
 * it, which it does only to a caller who may read the project. `undefined` for
 * any other error.
 */
export function selectedForAnotherAgentWords(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'conflict') return undefined;
  const details = error.details as { reason?: unknown } | null;
  if (details?.reason !== 'selected_for_another_agent') return undefined;
  const agent = namedAgentOf(details);
  return agent === undefined
    ? 'Selected for another agent — only that agent can start it.'
    : `Selected for ${agentLabel(agent)} — only that agent can start it.`;
}

/** A failed selection, in words — the reason when there is one, the server's message else. */
export function selectionErrorWords(error: unknown): string {
  const another = selectedForAnotherAgentWords(error);
  if (another !== undefined) return another;
  const reason = refusalOf(error);
  if (reason !== undefined) return REFUSAL_WORDS[reason];
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Could not change the agent. Try again.';
}

// ------------------------------------------------------------------ the picker's list

/**
 * `AgentAvailability` in `components/agent/agent-states.ts`, spelled here so
 * the API layer imports nothing from the components; the two are one union,
 * and the picker's typecheck fails if they part.
 */
export type AgentAvailability = 'available' | 'offline' | 'unavailable';

/**
 * How recently an agent must have been seen to read as **Available** — the
 * server throttles `last_seen_at` to a minute, so this is fifteen of its
 * ticks. Longer is **Offline**, which is still selectable: the work request
 * waits for it (proposal §3).
 */
export const AVAILABLE_WITHIN_MS = 15 * 60_000;

/** Why an agent cannot be picked here, from what the client can know — the server's own checks, in its order. */
export function ineligibleReason(
  agent: Pick<RegisteredAgent, 'status' | 'grants'>,
  projectId: string,
  agentsAllowed: boolean,
): SelectedAgentRefusal | undefined {
  if (agent.status !== 'active') return 'agent_revoked';
  const grant = agent.grants.find((g) => g.project_id === projectId);
  if (grant === undefined) return 'agent_not_granted';
  if (grant.scope !== 'full') return 'agent_read_only';
  if (!agentsAllowed) return 'agents_off';
  return undefined;
}

/** Short words for a disabled row: the list has no room for the whole sentence. */
export const INELIGIBLE_SHORT: Readonly<Record<SelectedAgentRefusal, string>> = {
  agent_not_found: 'No longer exists',
  agent_other_owner: 'Another member’s agent',
  agent_wrong_org: 'Another organisation',
  agent_revoked: 'Revoked',
  agent_not_granted: 'Not granted on this space',
  agent_read_only: 'Read-only on this space',
  agents_off: 'Agents are off in this space',
};

export function availabilityOf(
  agent: Pick<RegisteredAgent, 'last_seen_at'>,
  now: number,
): Exclude<AgentAvailability, 'unavailable'> {
  return agent.last_seen_at !== null && now - agent.last_seen_at <= AVAILABLE_WITHIN_MS
    ? 'available'
    : 'offline';
}

interface PickerChoiceBase {
  readonly id: string;
  readonly client: AgentClient;
  readonly owner: string;
  readonly device: string;
  /** {@link twinNames}' mark, when another listed agent shares harness and device. */
  readonly twin?: string | undefined;
}

/**
 * One row of the picker: `AgentChoice`'s shape, built from a real `GET /agents`
 * — including its rule that an `unavailable` row always carries its reason
 * (LAI-536), so a disabled agent is never shown without one.
 */
export type PickerChoice =
  | (PickerChoiceBase & {
      readonly availability: Exclude<AgentAvailability, 'unavailable'>;
      readonly reason?: undefined;
    })
  | (PickerChoiceBase & { readonly availability: 'unavailable'; readonly reason: string });

/**
 * The picker's rows: **the caller's own agents** (`GET /agents` answers only
 * those — another member's agent is a `404`, so nothing here can list an agent
 * the reader may not see), every one listed, an ineligible one disabled with
 * its reason. Revoked agents are left out unless one is the current choice:
 * a revoked agent can never come back, and a list of them is noise.
 *
 * The task's current agent is always a row, so the field can show it — even
 * when it is another member's, which the caller may withdraw but not pick.
 */
export function pickerChoices(input: {
  readonly agents: readonly RegisteredAgent[];
  readonly ownerName: string;
  readonly projectId: string;
  readonly agentsAllowed: boolean;
  readonly current: SelectedAgent | null;
  readonly now: number;
}): readonly PickerChoice[] {
  const { agents, ownerName, projectId, agentsAllowed, current, now } = input;
  // Told apart among what the picker lists (LAI-583).
  const listed = agents.filter((a) => a.status !== 'revoked' || a.id === current?.id);
  const peers = current === null ? listed : [...listed, current];
  const devices = distinctDevices(peers);
  const twins = twinNames(peers);
  const rows: PickerChoice[] = [];
  for (const agent of listed) {
    const refusal = ineligibleReason(agent, projectId, agentsAllowed);
    const view = { harness: agent.harness, display_name: agent.display_name };
    const base = {
      id: agent.id,
      client: selectedHarness(view),
      owner: ownerName,
      device: devices.get(agent.id) ?? agentDevice(agent),
      twin: twins.get(agent.id),
    };
    rows.push(
      refusal === undefined
        ? { ...base, availability: availabilityOf(agent, now) }
        : { ...base, availability: 'unavailable', reason: INELIGIBLE_SHORT[refusal] },
    );
  }
  // Available first, then offline, then the ones that cannot be picked.
  const rank: Readonly<Record<AgentAvailability, number>> = {
    available: 0,
    offline: 1,
    unavailable: 2,
  };
  rows.sort((a, b) => rank[a.availability] - rank[b.availability]);

  if (current !== null && !rows.some((row) => row.id === current.id)) {
    rows.push({
      id: current.id,
      client: selectedHarness(current),
      owner: current.owner.name,
      device: devices.get(current.id) ?? agentDevice(current),
      twin: twins.get(current.id),
      availability: 'unavailable',
      reason:
        current.status === 'revoked' ? INELIGIBLE_SHORT.agent_revoked : 'Another member’s agent',
    });
  }
  return rows;
}

// ------------------------------------------------------------------ the agent filter

/** `?selected_agent=` — an agent id, or one of these two. */
export const AGENT_FILTER_ANY = 'any';
export const AGENT_FILTER_NONE = 'none';

/** Whether a task passes `?selected_agent=`. No value passes everything. */
export function matchesAgentFilter(
  task: Pick<TaskSummary, 'selected_agent'>,
  value: string | undefined,
): boolean {
  if (value === undefined || value === '') return true;
  const agent = selectedAgentOf(task);
  if (value === AGENT_FILTER_ANY) return agent !== null;
  if (value === AGENT_FILTER_NONE) return agent === null;
  return agent?.id === value;
}

/**
 * The agents the filter offers: **the ones selected on a task the reader
 * already holds**, by label. Read from the task set, so it fetches nothing and
 * can name no agent the reader could not already see on a card.
 */
export function agentsOnTasks(
  tasks: readonly Pick<TaskSummary, 'selected_agent'>[],
): readonly SelectedAgent[] {
  const seen = selectedOn(tasks);
  // Two that share a harness and a device are told apart (LAI-583).
  const devices = distinctDevices(seen);
  return seen
    .map((agent) => shownAs(agent, devices))
    .sort((a, b) => agentLabel(a).localeCompare(agentLabel(b)));
}

/** Each agent selected on `tasks`, once, as the server sent it. */
function selectedOn(tasks: readonly Pick<TaskSummary, 'selected_agent'>[]): SelectedAgent[] {
  const seen = new Map<string, SelectedAgent>();
  for (const task of tasks) {
    const agent = selectedAgentOf(task);
    if (agent !== null && !seen.has(agent.id)) seen.set(agent.id, agent);
  }
  return [...seen.values()];
}

/** The filter's chip and the List's empty state: `Agent: Claude Code · laptop-1`. */
export function agentFilterLabel(
  value: string,
  agents: ReadonlyMap<string, SelectedAgent>,
  known: boolean,
): string {
  if (value === AGENT_FILTER_ANY) return 'Agent: Any agent';
  if (value === AGENT_FILTER_NONE) return 'Agent: No agent';
  const agent = agents.get(value);
  if (agent !== undefined) return `Agent: ${agentLabel(agent)}`;
  return known ? 'Agent: Unknown agent' : 'Agent: …';
}

// ------------------------------------------------------------------ who wrote a row

/** What naming an agent takes: its harness, its own name and its device. */
export type AgentNaming = Pick<SelectedAgent, 'harness' | 'display_name' | 'device_label'>;

/**
 * Every agent **this reader may see**, by id: their own (`GET /agents`, which
 * answers the caller's agents and nobody else's) and the agents selected on
 * tasks they hold (`TaskView.selected_agent`, which the server sent them). A
 * row by any other agent stays *a registered agent* — nothing here guesses.
 */
export function agentNamesFrom(
  own: readonly Pick<RegisteredAgent, 'id' | 'harness' | 'display_name' | 'device_label'>[],
  tasks: readonly Pick<TaskSummary, 'selected_agent'>[],
): ReadonlyMap<string, AgentNaming> {
  const names = new Map<string, Peer>();
  for (const agent of selectedOn(tasks)) names.set(agent.id, agent);
  for (const agent of own) names.set(agent.id, agent);
  // Told apart across both sources, so History never names two agents alike (LAI-583).
  const devices = distinctDevices(names.values());
  return new Map([...names].map(([id, agent]) => [id, shownAs(agent, devices)] as const));
}

/** What an agent-written row says after the person: an agent we can name, or what we know. */
export const UNREGISTERED_AGENT = 'agent (unregistered token)';
export const UNNAMED_AGENT = 'a registered agent';
/** A row whose agent the server withheld from this reader (LAI-1011). */
export const WITHHELD_AGENT = 'an agent';

/**
 * *Claude Code · laptop-1*, *a registered agent* or *agent (unregistered
 * token)* — the part after *via* on a row an agent wrote; `undefined` on a
 * row a person or Laika wrote.
 *
 * `agent_id` is set on every row a **registered** agent's token wrote
 * (LAI-535) and null on a legacy token's, which is how the two are told apart.
 * An agent this reader cannot name — another member's, not on this task — is
 * *a registered agent*: true, and never a guess. One the server withheld
 * (`agent_redacted`, LAI-1011) comes with a null id and is *an agent*, not
 * an unregistered token.
 */
export function agentVia(
  event: {
    readonly actor_kind: string;
    readonly agent_id?: string | null | undefined;
    readonly agent_redacted?: boolean | undefined;
  },
  agents: ReadonlyMap<string, Pick<SelectedAgent, 'harness' | 'display_name' | 'device_label'>>,
): string | undefined {
  if (event.actor_kind !== 'agent') return undefined;
  const id = event.agent_id ?? null;
  if (id === null) return event.agent_redacted === true ? WITHHELD_AGENT : UNREGISTERED_AGENT;
  const agent = agents.get(id);
  return agent === undefined ? UNNAMED_AGENT : agentLabel(agent);
}

/**
 * `task.agent_selected`'s line, with the agent named where the reader can
 * name it: *selected Claude Code · laptop-1*, *withdrew the agent*. The payload
 * is `{ from, to }`, both agent ids or null. On a row the server withheld an
 * agent from (`redacted`, LAI-1011) a null `to` may be an agent this reader
 * may not see, so it reads neutrally rather than as a withdrawal.
 */
export function describeAgentSelected(
  payload: unknown,
  agents: ReadonlyMap<string, Pick<SelectedAgent, 'harness' | 'display_name' | 'device_label'>>,
  redacted = false,
): string | undefined {
  const sent = payload as { from?: unknown; to?: unknown } | null | undefined;
  if (sent === null || sent === undefined) return undefined;
  if (sent.to === null) {
    return redacted
      ? 'changed the agent selection on this task'
      : 'withdrew the agent from this task';
  }
  if (typeof sent.to !== 'string') return undefined;
  const agent = agents.get(sent.to);
  return agent === undefined
    ? 'selected an agent for this task'
    : `selected ${agentLabel(agent)} for this task`;
}
