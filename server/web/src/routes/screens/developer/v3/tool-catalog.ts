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
 *   (Claude Code's entry is a user-scope `mcpServers.laika` in `~/.claude.json`
 *   that reads the tool's credential file; Codex's reads its own variable.)
 * - **`mcp-only`**: `laika tool add` installs the credential; the MCP entry is
 *   **set up by hand**, and the helper prints the exact step (LAI-1072). The
 *   tool reads and writes tasks, but opens no session and saves no checkpoint.
 * - **`manual`**: the tool's configuration would have to hold the token
 *   itself, which `laika tool add` never writes, so it refuses the tool and
 *   the person connects it by hand.
 * - **`unverified`**: no row in either CLI matrix, and `laika tool add` has
 *   no setup for it (it refuses the slug). The board accepts it; the person
 *   connects it by hand.
 *
 * `cliSetup` is what decides whether a command is printed at all.
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
  /**
   * `laika tool add <slug>` sets it up (`cli/src/tool-add.ts` `planFor`
   * answers anything but `refused`). When false the CLI refuses the slug, so
   * the wizard prints no command and shows the manual step instead.
   * `tool-catalog.test.ts` holds this to `planFor` for every slug.
   */
  readonly cliSetup: boolean;
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
    cliSetup: false,
    notes: [
      `\`laika tool add\` has no setup for ${name(harness)} yet and refuses it, so no command is shown. Until it has one, connect ${name(harness)} by hand: a personal token from Advanced, in ${name(harness)}’s own MCP settings. That token acts as you, not as a tool of its own.`,
    ],
    firstRequest: `Open ${name(harness)} and ${WHOAMI}.`,
  };
}

/** Every tool, in the order a picker shows them: the automatic ones first. */
export const TOOL_CATALOG: readonly ToolCapability[] = [
  {
    harness: 'claude-code',
    name: name('claude-code'),
    cliSetup: true,
    mode: 'automatic',
    sessions: true,
    tested: true,
    notes: [
      'Quit Claude Code and start it again — `laika-claude` for Laika’s commands too, or plain `claude`. Its Laika MCP entry in `~/.claude.json` reads this tool’s own credential. If that file already has a `laika` server, `laika tool add` keeps it and prints the entry to use instead.',
    ],
    firstRequest: `Start Claude Code again, then ${WHOAMI}.`,
  },
  {
    harness: 'codex',
    name: name('codex'),
    cliSetup: true,
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
    cliSetup: true,
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'MCP set up by hand. `laika tool add` prints the exact step: a line for your shell’s rc file that sets `LAIKA_AGENT_TOKEN_CURSOR` from this tool’s credential, and the `laika` entry for `~/.cursor/mcp.json`, with `"Authorization": "Bearer ${env:LAIKA_AGENT_TOKEN_CURSOR}"`.',
      'Start Cursor from a terminal, so it inherits that variable. For cursor-agent, run `cursor-agent mcp enable laika` once.',
    ],
    firstRequest: `Start Cursor from a terminal, then ${WHOAMI}.`,
  },
  {
    harness: 'gemini-cli',
    name: name('gemini-cli'),
    cliSetup: true,
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'MCP set up by hand. `laika tool add` prints the exact step: a line for your shell’s rc file that sets `LAIKA_AGENT_TOKEN_GEMINI_CLI` from this tool’s credential, and the `laika` entry for `~/.gemini/settings.json`, with `"Authorization": "Bearer ${LAIKA_AGENT_TOKEN_GEMINI_CLI}"`.',
      'Sign in to Gemini itself first; Laika cannot do that for you.',
    ],
    firstRequest: `Start \`gemini\`, then ${WHOAMI}.`,
  },
  {
    harness: 'vscode',
    name: name('vscode'),
    cliSetup: true,
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'MCP set up by hand. `laika tool add` prints the exact step: a line for your shell’s rc file that sets `LAIKA_AGENT_TOKEN_COPILOT_VSCODE` from this tool’s credential, and a `code --add-mcp` command for the `laika` server, with `"Authorization": "Bearer ${env:LAIKA_AGENT_TOKEN_COPILOT_VSCODE}"`.',
      'Start VS Code from a terminal, so it inherits that variable.',
    ],
    firstRequest: `Start VS Code from a terminal, then ${WHOAMI} in Copilot chat.`,
  },
  {
    harness: 'omnigent',
    name: name('omnigent'),
    cliSetup: true,
    mode: 'mcp-only',
    sessions: false,
    tested: false,
    notes: [
      'Omnigent holds the credential only: Laika sees its requests, but it opens no session and saves no checkpoint. MCP set up by hand: its Laika entry lives in each Omnigent agent’s own folder (`laika connect omnigent --dir <agent folder>` prints it).',
    ],
    firstRequest: `Run an Omnigent agent that has Laika, and ${WHOAMI}.`,
  },
  {
    harness: 'antigravity',
    name: name('antigravity'),
    cliSetup: false,
    mode: 'manual',
    sessions: false,
    tested: false,
    notes: [
      'Antigravity reads no environment variables, so its config would have to hold the token itself — which `laika tool add` never writes, so it refuses Antigravity and no command is shown. Connect it by hand: a personal token from Advanced, in `~/.gemini/config/mcp_config.json`. That token acts as you, not as a tool of its own.',
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
  'mcp-only':
    'Credential installed; MCP set up by hand — `laika tool add` prints the exact step. Reads and writes tasks; no session claims or automatic checkpoints.',
  manual: 'The helper cannot set it up safely; you connect it by hand.',
  unverified: 'Not tested with Laika, and the helper has no setup for it: by hand.',
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
