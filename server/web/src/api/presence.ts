import {
  agentClientName,
  asAgentClient,
  asAgentClients,
  type AgentClient,
} from './agent-clients.ts';
import { request } from './client.ts';

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

export interface CapacityEntry {
  readonly user_id: string;
  readonly name: string;
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
  readonly last_seen: number | null;
  /**
   * **Absent, not empty**, for a reader without `audit_log.export`.
   *
   * `[]` claims *"this person has logged nothing"*, which is a different
   * statement from *"you may not be told"*. Render the section on the key being
   * present — never `?? []`.
   */
  readonly unlisted?: readonly string[];
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
