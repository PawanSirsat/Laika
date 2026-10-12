/**
 * Which coding agent is on the other end of a token (D-076, LAI-736).
 *
 * Every MCP client names itself in `initialize` (`clientInfo.name`). Laika
 * keeps that name and a normalised slug on the token, so presence can say
 * *Codex* rather than just *agent*, and the Connect screen can tell that the
 * token it just minted is the one that connected.
 *
 * **Never an authorisation input.** A client can call itself anything. The name
 * is a label the client chose, the same trust level as a `User-Agent` header.
 *
 * ## The names, as measured
 *
 * | agent | `clientInfo.name` |
 * | --- | --- |
 * | Claude Code | `claude-code` |
 * | Gemini CLI | `gemini-cli-mcp-client` |
 * | cursor-agent | `Cursor` |
 * | OpenCode | `opencode` |
 * | Omnigent | `mcp`, which says nothing |
 * | Codex, VS Code | not yet observed; matched loosely |
 *
 * A client that says nothing useful (`mcp`, or nothing) falls back to the first
 * word of the **token's** name, because the Connect screen names a token after
 * its agent: `omnigent on macOS`, `codex on Linux`. Tokens minted before that
 * are mostly `laika-claude on macOS`, which reads as Claude Code.
 */

/**
 * Every slug the normaliser can return. `other` is last and always possible.
 *
 * Exported so the web client can mirror the list and a drift check can compare
 * the two by name.
 */
export const AGENT_CLIENTS = [
  'claude-code',
  'codex',
  'cursor',
  'opencode',
  'gemini-cli',
  'vscode',
  'windsurf',
  'antigravity',
  'hermes',
  'omnigent',
  'other',
] as const;

export type AgentClient = (typeof AGENT_CLIENTS)[number];

/**
 * First match wins, tested against the lower-cased name.
 *
 * None of the measured names matches two patterns, so order decides only a
 * name that mentions two agents. `agy` is the one pattern with a word boundary:
 * three letters is short enough to turn up inside an unrelated word.
 */
const PATTERNS: readonly (readonly [RegExp, AgentClient])[] = [
  [/claude/, 'claude-code'],
  [/codex/, 'codex'],
  [/cursor/, 'cursor'],
  [/opencode/, 'opencode'],
  [/gemini/, 'gemini-cli'],
  [/visual studio code|vscode|copilot/, 'vscode'],
  [/windsurf|codeium/, 'windsurf'],
  [/antigravity|\bagy\b/, 'antigravity'],
  [/hermes/, 'hermes'],
  [/omnigent/, 'omnigent'],
];

function match(name: string | null | undefined): AgentClient | null {
  if (name === null || name === undefined) return null;

  const lower = name.toLowerCase();
  for (const [pattern, slug] of PATTERNS) if (pattern.test(lower)) return slug;
  return null;
}

/**
 * `clientInfo.name` → slug, falling back to the token name's first word, then
 * `other`.
 *
 * Only the first word of the token name counts. "agent for codex" is a person
 * describing a token, not the agent naming itself.
 */
export function agentClientSlug(
  clientName: string | null | undefined,
  tokenName: string | null | undefined,
): AgentClient {
  const firstWord = tokenName?.trim().split(/\s+/)[0];
  return match(clientName) ?? match(firstWord) ?? 'other';
}

/** The stored name is capped here, counted in characters rather than UTF-16 units. */
export const CLIENT_NAME_MAX_LENGTH = 64;

/**
 * Control (`Cc`) and format (`Cf`) characters. `Cf` covers the bidi overrides
 * (U+202A–U+202E, U+2066–U+2069) and the zero-width ones, any of which would
 * let a client's name rearrange or hide text on the Tokens screen.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * A client-supplied name, made safe to store and show, or `null` if nothing is
 * left. Takes `unknown` because it arrives from the wire.
 */
export function cleanClientName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(UNPRINTABLE, '').trim();
  if (cleaned === '') return null;

  // `Array.from` splits by code point, so the cap never leaves half a
  // surrogate pair at the end.
  return Array.from(cleaned).slice(0, CLIENT_NAME_MAX_LENGTH).join('').trimEnd();
}
