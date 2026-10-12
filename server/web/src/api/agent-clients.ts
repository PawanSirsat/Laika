/**
 * Which coding agent is on the other end of a token (LAI-737, mirroring LAI-736).
 *
 * The server records a slug per token from the client's `clientInfo.name`, or,
 * when the client names itself generically (Omnigent and Hermes both send
 * `mcp`), from the **first word of the token's name** — which is why the
 * Connect screen names every token `<slug> on <OS>`. Presence entries carry the
 * same slugs.
 *
 * **A mirror of `AGENT_CLIENTS` in `server/src/auth/agent-clients.ts`**
 * (LAI-736). `agent-clients.test.ts` compares the two lists by name, from both
 * sides, the way `use-events.test.ts` guards `STREAM_TYPES`.
 *
 * A slug this list does not know is shown as *another agent* rather than
 * trusted: {@link asAgentClient} is the one gate every screen reads through, so
 * a server that learns a new client before this file does renders a neutral
 * mark instead of `undefined`.
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
  'zed',
  'cline',
  'roo',
  'continue',
  'kiro',
  'goose',
  'amp',
  'junie',
  'warp',
  'claude-desktop',
  'other',
] as const;

export type AgentClient = (typeof AGENT_CLIENTS)[number];

/** The product's own name, as a person would write it. */
export const AGENT_CLIENT_NAMES: Readonly<Record<AgentClient, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  'gemini-cli': 'Gemini CLI',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
  omnigent: 'Omnigent',
  hermes: 'Hermes',
  zed: 'Zed',
  cline: 'Cline',
  roo: 'Roo Code',
  continue: 'Continue',
  kiro: 'Kiro',
  goose: 'Goose',
  amp: 'Amp',
  junie: 'Junie',
  warp: 'Warp',
  'claude-desktop': 'Claude Desktop',
  other: 'another agent',
};

/**
 * Two letters drawn in a tile — never the vendor's logo.
 *
 * REPORT §Logos (LAI-737): Anthropic, OpenAI, Google and Microsoft forbid their
 * marks without written permission, and the rest range from *ask first* to
 * unstated. A monogram ships no third-party artwork, no new colour (D-020) and
 * no request to anybody's CDN (SPEC §13.4).
 */
export const AGENT_CLIENT_MONOGRAMS: Readonly<Record<AgentClient, string>> = {
  'claude-code': 'CC',
  codex: 'CX',
  cursor: 'CU',
  antigravity: 'AG',
  opencode: 'OC',
  'gemini-cli': 'GE',
  vscode: 'VS',
  windsurf: 'WS',
  omnigent: 'OM',
  hermes: 'HE',
  zed: 'ZE',
  cline: 'CL',
  roo: 'RO',
  continue: 'CO',
  kiro: 'KI',
  goose: 'GO',
  amp: 'AM',
  junie: 'JU',
  warp: 'WA',
  'claude-desktop': 'CD',
  other: '··',
};

/** The tile's tint: one of the theme's chip families, so both themes hold. */
export type MarkTone = 'blue' | 'green' | 'orange' | 'pink' | 'purple' | 'neutral';

export const AGENT_CLIENT_TONES: Readonly<Record<AgentClient, MarkTone>> = {
  'claude-code': 'orange',
  codex: 'neutral',
  cursor: 'blue',
  antigravity: 'purple',
  opencode: 'green',
  'gemini-cli': 'blue',
  vscode: 'blue',
  windsurf: 'green',
  omnigent: 'purple',
  hermes: 'pink',
  zed: 'blue',
  cline: 'neutral',
  roo: 'pink',
  continue: 'green',
  kiro: 'purple',
  goose: 'orange',
  amp: 'pink',
  junie: 'green',
  warp: 'purple',
  'claude-desktop': 'orange',
  other: 'neutral',
};

/**
 * A value off the wire, as a slug this client knows — or `null`.
 *
 * Takes `unknown` because presence fixtures written before LAI-736 carry no
 * `client` at all, and a server ahead of this list may send a slug it has never
 * seen. Both read as *no agent named*, never as a crash.
 */
export function asAgentClient(value: unknown): AgentClient | null {
  return AGENT_CLIENTS.find((slug) => slug === value) ?? null;
}

/** Every known slug in `values`, in order, once each. */
export function asAgentClients(values: unknown): AgentClient[] {
  if (!Array.isArray(values)) return [];
  const out: AgentClient[] = [];
  for (const value of values) {
    const slug = asAgentClient(value);
    if (slug !== null && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export function agentClientName(slug: AgentClient): string {
  return AGENT_CLIENT_NAMES[slug];
}
