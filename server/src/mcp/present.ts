import { type CapacityPingView, type LauncherView } from '../services/agent-capacity.ts';
import { ApiError } from '../errors.ts';
import { CATEGORY_LABELS } from '../services/project-statuses.ts';
import { type TaskView } from '../services/tasks.ts';

/**
 * How a tool answers (SPEC §7.2, LAI-407).
 *
 * Every tool returns **both**: compact markdown a model can reason over, and a
 * structured payload it can parse when it does not. §7.2 asks for the pair
 * rather than a choice, because the two failure modes are opposite — prose the
 * model has to parse produces confident nonsense, and JSON alone wastes the
 * model's ability to read.
 *
 * No `outputSchema` is declared. The SDK validates `structuredContent` only when
 * one exists, and these payloads are the service views verbatim — a second
 * schema here would be a second declaration of shapes that already have one, and
 * would drift from them.
 */

export interface ToolAnswer {
  /** Set only on a refusal — see {@link toolError}. */
  isError?: boolean;
  // The SDK's `CallToolResult` carries an index signature for `_meta` and
  // future fields, so an exact interface is not assignable to it. Matching the
  // shape here rather than casting at four call sites.
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
}

/**
 * A task's status as a tool says it (LAI-738): the category an agent reasons
 * with, and the project's own name for the column when it is not just that
 * category's label — `review (QA)`, but plain `review` on a default board.
 * The category comes first because it is what `update_status` and §5 speak.
 */
export function statusText(task: Pick<TaskView, 'status' | 'status_name'>): string {
  return task.status_name === CATEGORY_LABELS[task.status]
    ? task.status
    : `${task.status} (${task.status_name})`;
}

export function answer(markdown: string, payload: Record<string, unknown>): ToolAnswer {
  return { content: [{ type: 'text', text: markdown }], structuredContent: payload };
}

/**
 * A failure an agent can branch on (SPEC §7.2).
 *
 * *"Errors are MCP tool errors carrying the §6.3 `code`, so an agent can branch
 * on `conflict` versus `forbidden` rather than parse prose."*
 *
 * Without this the SDK turns a thrown `ApiError` into its `message` alone —
 * "That task is already claimed" — and the code, the details and the assignee id
 * are all lost. An agent would have to regex the sentence, and the sentence is
 * the part we are free to reword.
 *
 * So the whole §6.3 envelope is returned as the error body, exactly as the REST
 * API would have sent it. `isError` is what makes it a tool error rather than a
 * result that happens to describe a failure.
 *
 * Anything that is not an `ApiError` is re-thrown: a `TypeError` is a bug in
 * Laika, not a refusal, and dressing it as one would tell an agent to handle
 * something it cannot.
 */
export function toolError(error: unknown): ToolAnswer {
  if (!(error instanceof ApiError)) throw error;

  return {
    content: [{ type: 'text', text: JSON.stringify(error.toBody()) }],
    structuredContent: error.toBody() as unknown as Record<string, unknown>,
    isError: true,
  };
}

/** `2026-08-31` — dates a person reads, from the unix-ms the API speaks. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * "3 days ago" — how old, in the unit a reader thinks in.
 *
 * Agents reason about staleness constantly ("what has been sitting?"), and a
 * unix timestamp makes that arithmetic the model's problem.
 */
export function ago(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;

  return `${String(Math.round(hours / 24))}d ago`;
}

/** A markdown bullet list, or a line saying there is nothing — never an empty gap. */
export function bullets(items: readonly string[], empty: string): string {
  return items.length === 0 ? `_${empty}_` : items.map((line) => `- ${line}`).join('\n');
}

/**
 * Names for ids, so a response reads `Ada` rather than `01M1BD…`.
 *
 * Returns the id itself when the person is unknown — a former member still
 * appears in old comments and activity, and dropping their line to avoid an
 * unresolved id would lose the row entirely.
 */
export function nameLookup(
  people: readonly { user_id: string; name: string }[],
): (id: string | null) => string {
  const names = new Map(people.map((p) => [p.user_id, p.name]));
  return (id) => (id === null ? 'nobody' : (names.get(id) ?? id));
}

/** A launcher as one line (D-126 item 4): the word, and how old the report is. */
export function launcherText(
  launcher: Pick<LauncherView, 'state' | 'reported_at' | 'running' | 'max_concurrent'>,
  now: number,
): string {
  const heard = launcher.reported_at === null ? '' : `, reported ${ago(launcher.reported_at, now)}`;
  const runs =
    launcher.running === null || launcher.max_concurrent === null
      ? ''
      : `, ${String(launcher.running)}/${String(launcher.max_concurrent)} running`;
  return `**${launcher.state}**${runs}${heard}`;
}

/** A capacity ping and its answer, as `ping_agent` and `get_agent_capacity` say it. */
export function capacityText(ping: CapacityPingView, now: number): string {
  if (ping.answer === null) {
    return ping.state === 'expired'
      ? `Ping \`${ping.id}\` **expired** unanswered: nothing on that device answered within a minute.`
      : `Ping \`${ping.id}\` is **pending** until ${new Date(ping.expires_at).toISOString()}; read it again with \`get_agent_capacity\`.`;
  }
  const a = ping.answer;
  const launcher =
    a.launcher.state === 'on'
      ? `on, ${String(a.launcher.running)}/${String(a.launcher.max_concurrent)} running, auto-pickup work requests ${a.launcher.auto_pickup.work_requests ? 'on' : 'off'}, hand-offs ${a.launcher.auto_pickup.handoffs ? 'on' : 'off'}`
      : 'off';
  const ready = a.harness_ready.credential && a.harness_ready.argv && a.harness_ready.hooks;
  const battery =
    a.battery.state === 'ok' || a.battery.state === 'low'
      ? `${a.battery.state} ${String(a.battery.percent)}%${a.battery.plugged === true ? ', plugged in' : ''}`
      : a.battery.state;
  return [
    `Ping \`${ping.id}\` **answered** ${ping.answered_at === null ? '' : ago(ping.answered_at, now)} by its ${a.answered_by}:`,
    `- launcher: ${launcher}`,
    `- harness ready: ${ready ? 'yes' : `no (credential ${String(a.harness_ready.credential)}, argv ${String(a.harness_ready.argv)}, hooks ${String(a.harness_ready.hooks)})`}`,
    `- session live: ${a.session_live ? 'yes' : 'no'}`,
    `- battery: ${battery}; memory: ${a.memory.state}; CLI ${a.cli_version}`,
  ].join('\n');
}
