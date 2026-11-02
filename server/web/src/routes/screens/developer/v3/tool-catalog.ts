import { AGENT_CLIENT_NAMES, type AgentClient } from '../../../../api/agent-clients.ts';

/**
 * The coding tools *Add tool* offers, and what each can honestly do with
 * Laika (LAI-1061, plan LAI-1042 §E.6, §M).
 *
 * **Held in the web on purpose** (§E.6's recommended choice): the truth is
 * the CLI's adapter matrices (`cli/README.md`, `cli/agent-adapters/
 * CAPABILITIES.md`), and the image that serves the board does not carry
 * `cli/`. One entry per tool the server accepts on `POST /devices/:id/tools`
 * — every `AGENT_CLIENTS` slug but `other` — which `tool-catalog.test.ts`
 * holds by name, from both sides.
 *
 * - **`automatic`**: `laika tool add` installs the credential, the MCP entry
 *   and the session hooks. Sessions, claims and automatic checkpoints work.
 * - **`mcp-only`**: the credential and the MCP entry; the tool reads and
 *   writes tasks, but opens no session and saves no checkpoint.
 * - **`manual`**: the credential is installed; the tool's own configuration
 *   cannot be written safely, so the last step is by hand.
 * - **`unverified`**: no row in either CLI matrix. The board accepts it, and
 *   nobody has checked that `laika tool add` configures it.
 *
 * **Nothing here is evidence.** It says what a tool *can* show; only
 * `GET /agents/:id/verification` says what it *did*. *Ready* needs both.
 */

export type SetupMode = 'automatic' | 'mcp-only' | 'manual' | 'unverified';

export type CatalogTool = Exclude<AgentClient, 'other'>;

export interface ToolCapability {
  readonly harness: CatalogTool;
  readonly name: string;
  readonly mode: SetupMode;
  /**
   * Its hooks open sessions, which is what claims and automatic checkpoints
   * hang off. Only Claude Code and Codex (§M's UI rules); `Ready` then needs
   * a session as well as the tool's own request.
   */
  readonly sessions: boolean;
  /** The adapter is **Verified-and-tested** in the CLI matrix, not only documented. */
  readonly tested: boolean;
  /** What the person still does by hand, in the order they meet it. */
  readonly notes: readonly string[];
  /** How to make the tool's first request, for the *tool connected* check. */
  readonly firstRequest: string;
}

const WHOAMI = 'ask it to call `laika_whoami`';

const name = (harness: CatalogTool): string => AGENT_CLIENT_NAMES[harness];

function unverified(harness: CatalogTool): ToolCapability {
  return {
    harness,
    name: name(harness),
    mode: 'unverified',
    sessions: false,
    tested: false,
    notes: [
      `${name(harness)} is not in Laika’s tested tools: the command installs its credential, and you add Laika to ${name(harness)}’s own MCP settings by hand.`,
    ],
    firstRequest: `Open ${name(harness)} and ${WHOAMI}.`,
  };
}

/** Every tool, in the order a picker shows them: the automatic ones first. */
export const TOOL_CATALOG: readonly ToolCapability[] = [
  {
    harness: 'claude-code',
    name: name('claude-code'),
    mode: 'automatic',
    sessions: true,
    tested: true,
    notes: [
      'Quit Claude Code and start it again with `laika-claude`. Plain `claude` gets no Laika tools.',
    ],
    firstRequest: `Start Claude Code with \`laika-claude\`, then ${WHOAMI}.`,
  },
  {
    harness: 'codex',
    name: name('codex'),
    mode: 'automatic',
    sessions: true,
    tested: false,
    notes: [
      'Open Codex and trust Laika’s hooks in `/hooks`. Until you do, Codex runs no hook and opens no session.',
      'If your `config.toml` defines hooks itself, `laika tool add` leaves them alone and says so.',
    ],
    firstRequest: `Open Codex, trust the hooks in \`/hooks\`, then ${WHOAMI}.`,
  },
  {
    harness: 'cursor',
    name: name('cursor'),
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'Start Cursor from a terminal, so it inherits the credential’s environment. For cursor-agent, run `cursor-agent mcp enable laika` once.',
    ],
    firstRequest: `Start Cursor from a terminal, then ${WHOAMI}.`,
  },
  {
    harness: 'gemini-cli',
    name: name('gemini-cli'),
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: ['Sign in to Gemini itself first; Laika cannot do that for you.'],
    firstRequest: `Start \`gemini\`, then ${WHOAMI}.`,
  },
  {
    harness: 'vscode',
    name: name('vscode'),
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: ['Start VS Code from a terminal, so it inherits the credential’s environment.'],
    firstRequest: `Start VS Code from a terminal, then ${WHOAMI} in Copilot chat.`,
  },
  {
    harness: 'omnigent',
    name: name('omnigent'),
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'Omnigent holds the credential only: Laika sees its requests, but it opens no session and saves no checkpoint. Its Laika entry lives in each Omnigent agent’s own folder.',
    ],
    firstRequest: `Run an Omnigent agent that has Laika, and ${WHOAMI}.`,
  },
  {
    harness: 'antigravity',
    name: name('antigravity'),
    mode: 'manual',
    sessions: false,
    tested: false,
    notes: [
      'Antigravity takes its token only written into its own config, which `laika tool add` will not do. The command installs the credential and prints the last step for you to do by hand.',
      'Beta: remote headers have been reported answered Unauthorized (antigravity-cli issue 233).',
    ],
    firstRequest: `Finish Antigravity’s config by hand, then ${WHOAMI}.`,
  },
  ...(
    [
      'opencode',
      'windsurf',
      'zed',
      'cline',
      'roo',
      'continue',
      'kiro',
      'goose',
      'amp',
      'junie',
      'warp',
      'hermes',
      'claude-desktop',
    ] as const
  ).map(unverified),
];

/** A tool by its slug — or a guide id from an older link (`?tool=`) — when there is one. */
export function catalogTool(id: string | null | undefined): ToolCapability | undefined {
  if (id === null || id === undefined) return undefined;
  return TOOL_CATALOG.find((tool) => tool.harness === id);
}

export const MODE_WORDS: Readonly<Record<SetupMode, string>> = {
  automatic: 'Automatic',
  'mcp-only': 'MCP only',
  manual: 'Manual',
  unverified: 'Unverified',
};

/** What a mode means, said once beside the word. */
export const MODE_MEANING: Readonly<Record<SetupMode, string>> = {
  automatic: 'Credential, MCP entry and session hooks. Sessions, claims and checkpoints.',
  'mcp-only': 'Reads and writes tasks; no session claims or automatic checkpoints.',
  manual: 'The credential is installed; you finish the tool’s own config by hand.',
  unverified: 'Not tested with Laika: the credential is installed, the rest is by hand.',
};

/** The picker's groups, each with what its mode means. */
export function catalogGroups(): readonly {
  readonly mode: SetupMode;
  readonly tools: readonly ToolCapability[];
}[] {
  const modes: readonly SetupMode[] = ['automatic', 'mcp-only', 'manual', 'unverified'];
  return modes
    .map((mode) => ({ mode, tools: TOOL_CATALOG.filter((tool) => tool.mode === mode) }))
    .filter((group) => group.tools.length > 0);
}
