import { ApiError } from '../errors.ts';

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
