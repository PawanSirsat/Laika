import {
  agentClientName,
  asAgentClient,
  asAgentClients,
  type AgentClient,
} from './agent-clients.ts';
import { request } from './client.ts';
import type { OrgRole } from './invites.ts';
import type { ProfileKind } from './profiles.ts';

/**
 * Who is working right now, and who has capacity (SPEC §9.3, §11.4.2).
 *
 * Server side by LAI-430/431/432, screen by LAI-439.
 *
 * ## The shapes here were measured, not copied from the task file
 *
 * LAI-439's Notes said `repo`, `branch`, `project_ids` and `matched_task_id` all
 * go **absent** for a reader who may not be told where somebody is working. Two
 * of those four are wrong, and the running instance settled it:
 *
 * ```json
 * { "user_id": "…", "name": "…", "matched_task_id": null, "project_ids": [],
 *   "is_agent": true, "last_seen": 1788272050095 }
 * ```
 *
 * **`repo` and `branch` are gone; `matched_task_id` is `null` and `project_ids`
 * is `[]`.** `presence.ts` spreads `...(located ? { repo, branch } : {})` and
 * then sets the other two unconditionally. Its comment — *"the task and the
 * project list follow the same gate"* — is true of the **gate** and not of the
 * **representation**, which is what makes it easy to read the other way.
 *
 * That is why `repo` is the discriminator below. Testing `matched_task_id`
 * would never fire.
 */

export interface PresenceEntry {
  readonly user_id: string;
  readonly name: string;
  /**
   * **Optional, and its absence is the whole of LAI-438.**
   *
   * Present only when the heartbeat attributes to a project this reader may
   * read. `LAIKA_URL` and `LAIKA_TOKEN` live in user settings (D-046), so the
   * hook fires in *every* repository a person opens — publishing each one would
   * turn consent to be seen working here into consent to broadcast the name of
   * everything else.
   *
   * **Absent is a normal state meaning *somebody is working, elsewhere*.** Not
   * loading, not an error, and not a row to hide: the entry still names the
   * person, the time, and whether it is an agent.
   */
  readonly repo?: string;
  readonly branch?: string;
  /** `null` both when §9.2 resolved nothing **and** when the reader may not be told. */
  readonly matched_task_id: string | null;
  /** Empty both when the repo matches no project **and** when the reader may not be told. */
  readonly project_ids: readonly string[];
  /** A heartbeat sent with a token, or a token's `/mcp` call (§4.8, D-076). */
  readonly is_agent: boolean;
  /**
   * The coding agent of the newest live agent session, or `null` when none is
   * live (LAI-736). **Read it through `asAgentClient`**, never directly: a
   * server ahead of this client's slug list sends a value the client does not
   * know, and a fixture from before LAI-736 sends none.
   *
   * An MCP-only session has no heartbeat, so it carries a `client` and **no
   * `repo`** — which is why "connected via Codex" is said where a repo would
   * otherwise be.
   */
  readonly client: AgentClient | null;
  /** Every distinct agent among this person's live sessions, newest first. */
  readonly clients: readonly AgentClient[];
  readonly last_seen: number;
}

export interface PresenceView {
  /**
   * **A fact, not something to infer** (§4.2, LAI-150).
   *
   * `{ enabled: false }` and an empty list are opposite claims — *"this org does
   * not record who is working"* against *"nobody is working"* — and since
   * LAI-150 a disabled org stores nothing, so an empty list is all that is left
   * to infer from. Inferring is permanently wrong.
   */
  readonly enabled: boolean;
  readonly present: readonly PresenceEntry[];
}

/**
 * Where a person stands (LAI-767): `online` inside §9.3's five minutes, `away`
 * inside the hour, `offline` after it, `never` with no signal at all.
 */
export type PersonStatus = 'online' | 'away' | 'offline' | 'never';

/** Which kind of signal `last_seen` is: a sign-in, a board action, an agent. */
export type SeenVia = 'web' | 'board' | 'agent';

/** The server's fixed load rule (LAI-767, SPEC §9.3), on committed work (D-092). */
export type LoadLevel = 'none' | 'light' | 'normal' | 'heavy';

/**
 * Open assigned work, counted over the projects this reader may read.
 * `in_progress`, `todo`, `backlog` and `in_review` partition `open`;
 * `committed` is in progress plus to do — **the load** (D-092, LAI-818).
 * Backlog is the pipeline and review waits on the reviewer, so neither is
 * load. `overdue` and `due_soon` cut across all four.
 */
export interface CapacityWorkload {
  readonly in_progress: number;
  /** To do only — committed, not started. Backlog is its own count since LAI-818. */
  readonly todo: number;
  readonly backlog: number;
  /** Waiting on reviewers, not on the assignee. */
  readonly in_review: number;
  readonly committed: number;
  readonly overdue: number;
  readonly due_soon: number;
  readonly open: number;
}

/**
 * One space a person has open work in, with the same counts and **that
 * space's load** by the server's rule — what the badge shows while the space
 * is selected (D-092, LAI-818).
 */
export interface CapacitySpace extends CapacityWorkload {
  readonly project_id: string;
  readonly slug: string;
  readonly name: string;
  readonly load: LoadLevel;
}

/**
 * The 14 days of board actions by who did them (LAI-818). `by_self` and
 * `by_agents` leave out bookkeeping — sprint moves and card reorders — which
 * is counted apart; the three sum to `activity_14d`.
 */
export interface ActivitySplit {
  readonly by_self: number;
  readonly by_agents: number;
  readonly bookkeeping: number;
}

/**
 * One coding agent beside a person. **Read `client` through `asAgentClient`**:
 * a server ahead of this client's slug list sends one it does not know.
 */
export interface CapacityAgent {
  readonly client: AgentClient;
  readonly running: boolean;
  readonly last_at: number | null;
}

export interface CapacityEntry {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly org_role: OrgRole;
  /** Distinct tokens beating: two tokens is two sessions (§11.4.2). */
  readonly active_sessions: number;
  /**
   * Task **ids**, not keys or titles, and filtered to what this reader may see.
   *
   * The person is kept and their list is shortened — dropping them would make
   * the headcount depend on who is asking.
   */
  readonly in_progress_tasks: readonly string[];
  readonly oldest_in_progress_ms: number | null;
  readonly tasks_in_review: readonly string[];
  /**
   * The newest of every signal — a sign-in, an activity-log row, an agent's
   * heartbeat, `/mcp` call or REST write (LAI-767). `null` with none, and
   * always `null` while presence is off.
   */
  readonly last_seen: number | null;
  readonly last_seen_via: SeenVia | null;
  /** `null` while presence is off: draw *Presence is off*, not *never seen*. */
  readonly status: PersonStatus | null;
  readonly workload: CapacityWorkload;
  readonly load: LoadLevel;
  readonly spaces: readonly CapacitySpace[];
  /** Running now for everyone; every agent they use for an owner or admin. */
  readonly agents: readonly CapacityAgent[];
  /**
   * **Absent, not empty**, for a reader without `audit_log.export`.
   *
   * `[]` claims *"this person has logged nothing"*, which is a different
   * statement from *"you may not be told"*. Render the section on the key being
   * present — never `?? []`.
   */
  readonly unlisted?: readonly string[];
  /** Owners and admins only (D-078); absent for everyone else. */
  readonly profile_kind?: ProfileKind;
  /** Board actions on each of the last 14 UTC days, oldest first. Owners and admins only. */
  readonly activity_14d?: readonly number[];
  /** The same days by who did them, bookkeeping apart. Gated with `activity_14d`. */
  readonly activity_14d_split?: ActivitySplit;
}

export interface CapacityView {
  readonly enabled: boolean;
  readonly people: readonly CapacityEntry[];
}

export function getPresence(signal?: AbortSignal): Promise<PresenceView> {
  return request<PresenceView>('/presence', signal === undefined ? {} : { signal });
}

export function getCapacity(signal?: AbortSignal): Promise<CapacityView> {
  return request<CapacityView>('/capacity', signal === undefined ? {} : { signal });
}

/**
 * May this entry say **where** the person is working? (LAI-438)
 *
 * `repo` is the discriminator, and the other candidates cannot stand in for it:
 * `matched_task_id` arrives `null` and `project_ids` arrives `[]` whether the
 * location was withheld **or** the repo simply matched no project — so a
 * predicate on either cannot tell the two apart, and `=== undefined` on them
 * never fires at all.
 *
 * **Lives here, with the type, because two screens ask it** — Capacity and the
 * Board's strip. It briefly existed twice in LAI-439 and one copy was unused;
 * this is the one, and `capacity-derive.ts` re-exports nothing.
 */
export function hasLocation(entry: PresenceEntry): boolean {
  return entry.repo !== undefined;
}

/**
 * The agents behind a session, newest first — empty for a person in the
 * browser (LAI-737).
 *
 * Read through `asAgentClients`, so a slug this client does not know is
 * dropped rather than drawn, and a fixture from before LAI-736 reads as none.
 */
export function agentsOf(entry: PresenceEntry): AgentClient[] {
  if (!entry.is_agent) return [];
  const all = asAgentClients(entry.clients);
  const newest = asAgentClient(entry.client);
  return newest === null || all.includes(newest) ? all : [newest, ...all];
}

/**
 * `connected via Codex` — what a row says where a repo would be, when the
 * session's agent is known (LAI-737).
 *
 * An MCP-only session has no heartbeat and so no `repo` (LAI-736), the same
 * shape as a location that is withheld. Both are true of it: the person is
 * working somewhere this reader is not told about, *through Codex*. Saying the
 * agent is the more useful half; `undefined` leaves the caller's own
 * *working elsewhere*.
 */
export function connectedVia(entry: PresenceEntry): string | undefined {
  const client = entry.is_agent ? asAgentClient(entry.client) : null;
  return client === null ? undefined : `connected via ${agentClientName(client)}`;
}
