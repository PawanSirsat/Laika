import type { AgentClient } from '../../../api/agent-clients.ts';
import {
  ACTIVITY_ON,
  PLACEHOLDER_TOKEN,
  PLUGIN_HOME,
  PLUGIN_REPO,
  machinePrompt,
  manualCommands,
} from './connect-copy.ts';

/**
 * What each coding agent needs to reach this board (LAI-737).
 *
 * **Every config shape here comes from `/tmp/agent-client-configs/REPORT.md`**,
 * researched against each client's docs, source or installed binary on
 * 2026-10-12. The parts that differ between clients — the top-level key
 * (`mcpServers`, `servers`, `mcp`, `context_servers`), `url` against
 * `serverUrl`, and above all the spelling of an environment variable
 * (`${VAR}`, `${env:VAR}`, `{env:VAR}`, `${{ secrets.VAR }}`, a variable *name*)
 * — are exactly the parts a person cannot debug from a `401`, so
 * `connect-agents.test.ts` asserts them key by key. What the report marks
 * unverified is said so on the page, not smoothed over.
 *
 * Pure: no React, no DOM, so every block is asserted without a browser.
 *
 * ## The token, and the three kinds of block
 *
 * - `none` — **never carries the token.** A config that references
 *   `LAIKA_TOKEN` can be committed, pasted into a ticket or screenshotted.
 *   `connect-agents.test.ts` asserts no such block contains the secret or even
 *   the `lai_` shape.
 * - `secret` — a terminal command or a shell profile line whose whole job is to
 *   put the token somewhere private (`~/.laika/env`, `~/.zshrc`). It carries
 *   the token on purpose, the same trade LAI-622 made for the setup prompt.
 * - `inline` — a config file that carries the token because that client cannot
 *   read an environment variable. Only where the report says so, and always
 *   with a warning.
 */

export type AgentChoice = Exclude<AgentClient, 'other' | 'roo'> | 'any' | 'rest';

export type TokenUse = 'none' | 'secret' | 'inline';

export interface SetupBlock {
  /** Stable, for tests and React keys. */
  readonly key: string;
  /** Which heading on the page it sits under. */
  readonly group: 'recommended' | 'manual' | 'alternative';
  /** The bar above the block — usually the file and its scope. */
  readonly label: string;
  /** The copy button's object: `Copy the Codex config`. */
  readonly what: string;
  readonly lang: 'sh' | 'json' | 'toml' | 'yaml' | 'text';
  readonly text: string;
  readonly token: TokenUse;
  /** A sentence under the block. */
  readonly note?: string;
  /** Said louder than a note: an inline token, or something unverified. */
  readonly warn?: string;
}

export interface StartGuide {
  readonly body: string;
  readonly command?: string;
  readonly commandWhat?: string;
}

/** How step 4 knows it worked: an MCP call on the token, or any API call. */
export type LiveVia = 'mcp' | 'api';

export interface AgentGuide {
  readonly id: AgentChoice;
  readonly name: string;
  /** The mark it is drawn with. */
  readonly client: AgentClient;
  readonly primary: boolean;
  /** Present when the path is not proven against Laika yet — said on the page. */
  readonly beta?: string;
  /**
   * The first word of the token's default name. LAI-736 falls back to it when
   * a client names itself generically (Omnigent and Hermes send `mcp`), so it
   * must be a word the server's normaliser recognises.
   */
  readonly tokenWord: string;
  readonly via: LiveVia;
}

/**
 * Primary first, the rest under *More* — `connect-agents.test.ts` holds the
 * order. *Any MCP client* and *No MCP* close the primary row because they are
 * the two answers for somebody whose agent is not a tile.
 */
export const AGENT_GUIDES: readonly AgentGuide[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    client: 'claude-code',
    primary: true,
    tokenWord: 'claude-code',
    via: 'mcp',
  },
  { id: 'codex', name: 'Codex', client: 'codex', primary: true, tokenWord: 'codex', via: 'mcp' },
  {
    id: 'cursor',
    name: 'Cursor',
    client: 'cursor',
    primary: true,
    tokenWord: 'cursor',
    via: 'mcp',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    client: 'antigravity',
    primary: true,
    beta: 'Beta — not yet verified against Laika. Antigravity opens with a handshake other servers have tripped on, it cannot read environment variables, and antigravity-cli issue 233 reports remote headers answered Unauthorized.',
    tokenWord: 'antigravity',
    via: 'mcp',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    client: 'opencode',
    primary: true,
    tokenWord: 'opencode',
    via: 'mcp',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    client: 'gemini-cli',
    primary: true,
    tokenWord: 'gemini-cli',
    via: 'mcp',
  },
  {
    id: 'vscode',
    name: 'VS Code / Copilot',
    client: 'vscode',
    primary: true,
    tokenWord: 'vscode',
    via: 'mcp',
  },
  {
    id: 'omnigent',
    name: 'Omnigent',
    client: 'omnigent',
    primary: true,
    tokenWord: 'omnigent',
    via: 'mcp',
  },
  {
    id: 'any',
    name: 'Any MCP client',
    client: 'other',
    primary: true,
    tokenWord: 'mcp-client',
    via: 'mcp',
  },
  {
    id: 'rest',
    name: 'No MCP (REST / CLI)',
    client: 'other',
    primary: true,
    tokenWord: 'rest',
    via: 'api',
  },

  {
    id: 'windsurf',
    name: 'Windsurf',
    client: 'windsurf',
    primary: false,
    tokenWord: 'windsurf',
    via: 'mcp',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    client: 'hermes',
    primary: false,
    tokenWord: 'hermes',
    via: 'mcp',
  },
  { id: 'zed', name: 'Zed', client: 'zed', primary: false, tokenWord: 'zed', via: 'mcp' },
  {
    id: 'cline',
    name: 'Cline / Roo Code',
    client: 'cline',
    primary: false,
    tokenWord: 'cline',
    via: 'mcp',
  },
  {
    id: 'continue',
    name: 'Continue',
    client: 'continue',
    primary: false,
    tokenWord: 'continue',
    via: 'mcp',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    client: 'claude-desktop',
    primary: false,
    tokenWord: 'claude-desktop',
    via: 'mcp',
  },
  { id: 'kiro', name: 'Kiro', client: 'kiro', primary: false, tokenWord: 'kiro', via: 'mcp' },
  { id: 'goose', name: 'Goose', client: 'goose', primary: false, tokenWord: 'goose', via: 'mcp' },
  { id: 'amp', name: 'Amp', client: 'amp', primary: false, tokenWord: 'amp', via: 'mcp' },
  {
    id: 'junie',
    name: 'JetBrains / Junie',
    client: 'junie',
    primary: false,
    tokenWord: 'junie',
    via: 'mcp',
  },
  { id: 'warp', name: 'Warp', client: 'warp', primary: false, tokenWord: 'warp', via: 'mcp' },
];

/** The guide for a choice off the URL or storage — Claude Code when it names nothing known. */
export function guideFor(id: string | null | undefined): AgentGuide {
  // The list is a non-empty literal whose first entry is the default, which
  // `connect-agents.test.ts` holds; `!` says so rather than inventing a guide.
  return AGENT_GUIDES.find((guide) => guide.id === id) ?? AGENT_GUIDES[0]!;
}

export interface GuideContext {
  readonly origin: string;
  /** The minted secret, or `undefined` before one exists. */
  readonly secret: string | undefined;
  /**
   * The organisation collects local activity (D-102 amended): the automatic
   * blocks end by turning the collector on for this machine (LAI-997).
   * Absent or `false`, they do not.
   */
  readonly insightsOn?: boolean | undefined;
}

// ------------------------------------------------------------------ pieces

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** `mcp-remote` 0.14.3 (REPORT, Generic b): pinned, HTTP-only, and `--allow-http` for a plain-http board. */
const BRIDGE_PACKAGE = 'mcp-remote@0.14.3';

function bridgeServer(url: string, token: string): Record<string, unknown> {
  return {
    command: 'npx',
    args: [
      '-y',
      BRIDGE_PACKAGE,
      url,
      '--allow-http',
      '--transport',
      'http-only',
      '--header',
      // `Bearer …` lives in the env value, not here: mcp-remote's README warns
      // that Cursor and Claude Desktop on Windows mangle spaces in arguments.
      'Authorization:${LAIKA_AUTH}',
    ],
    env: { LAIKA_AUTH: `Bearer ${token}` },
  };
}

const BRIDGE_NOTE =
  'A small local bridge (mcp-remote, needs Node 18+) that speaks to Laika over HTTP for a client that cannot. `--allow-http` is required for any board that is not on https or localhost.';

function inlineWarn(where: string): string {
  return `This file carries your token in plain text. Keep it in ${where} — never in a repository — and revoke the token on Tokens if it is ever shared.`;
}

/** The two commands that store the token once and let the CLI write the config. */
function cliBlock(origin: string, token: string, id: AgentChoice, note: string): SetupBlock {
  return {
    key: 'cli',
    group: 'recommended',
    label: 'Terminal',
    what: 'the setup commands',
    lang: 'sh',
    token: 'secret',
    text: `git clone ${PLUGIN_REPO} ${PLUGIN_HOME} 2>/dev/null || git -C ${PLUGIN_HOME} pull --ff-only
${PLUGIN_HOME}/plugin/scripts/install.sh <<'LAIKA_SETUP'
${origin}
${token}
LAIKA_SETUP
${PLUGIN_HOME}/cli/bin/laika connect ${id}`,
    note: `The installer stores the board and token in ~/.laika/env, readable only by you. \`laika connect ${id}\` then ${note} It backs up any file it changes to <file>.bak and refuses one it cannot parse. Needs Node 22.18+.`,
  };
}

/** A single-quoted shell word that survives any character, `'` included. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The marker `laika connect` writes, so the two never add the line twice. */
const RC_MARKER = '# Laika — export LAIKA_URL and LAIKA_TOKEN for coding agents (laika connect)';
const RC_LINE = '[ -r "$HOME/.laika/env" ] && { set -a; . "$HOME/.laika/env"; set +a; }';

/**
 * The variable every env-reading config points at — stored where the CLI
 * stores it (review round 1).
 *
 * The token goes in `~/.laika/env`, made `0600` **before** it is written —
 * `umask` covers only a file it creates, so an existing `0644` one is narrowed
 * first (re-review) — in a `0700` directory, and
 * the shell profile only **sources** that file. It used to be two `export`
 * lines for `~/.zshrc`, which put the token in a file that dotfile managers
 * commit and sync. Same file, same marker and same line as `laika connect`,
 * so either can run after the other and the profile gains the line once.
 */
function envBlock(origin: string, token: string): SetupBlock {
  return {
    key: 'env',
    group: 'manual',
    label: 'Terminal — stores the token in ~/.laika/env and loads it in new shells',
    what: 'the environment setup',
    lang: 'sh',
    token: 'secret',
    text: `mkdir -p ~/.laika && chmod 700 ~/.laika
(umask 077 && touch ~/.laika/env) && chmod 600 ~/.laika/env
cat > ~/.laika/env <<'LAIKA_ENV'
LAIKA_URL="${origin}"
LAIKA_TOKEN="${token}"
LAIKA_ENV
RC=~/.profile; [ -n "$ZSH_VERSION" ] && RC=~/.zshrc; [ -n "$BASH_VERSION" ] && RC=~/.bashrc
grep -qF '(laika connect)' "$RC" 2>/dev/null || printf '%s\\n' ${shellQuote(RC_MARKER)} ${shellQuote(RC_LINE)} >> "$RC"`,
    note: 'Your shell profile only sources ~/.laika/env, so it never holds the token. Open a new terminal afterwards. An app started from the Dock or Start menu does not read your shell profile — start it from that terminal so it sees LAIKA_TOKEN.',
  };
}

const VSCODE_HOSTED =
  'It runs inside VS Code, which sees LAIKA_TOKEN only when started from a terminal that has it (`code .`), or when the variable is set system-wide.';

// ------------------------------------------------------------------ blocks

/**
 * Step 3 for one agent: what to put where. **Once per machine**, every block
 * of it (LAI-997): nothing here writes into a repository; the project block is
 * the Projects tab's.
 *
 * Grouped as the page shows them — *recommended*, *by hand*, *alternatives* —
 * and ordered within each group as a person would do them. When the
 * organisation collects local activity, every `cli` block (the CLI route for
 * Codex, Cursor, …) gains `laika activity on` as its last line, the same way
 * the Claude Code prompt gains it as a step.
 */
export function setupBlocks(id: AgentChoice, context: GuideContext): readonly SetupBlock[] {
  const insightsOn = context.insightsOn === true;
  return rawBlocks(id, context).map((block) =>
    block.key === 'cli' && insightsOn
      ? {
          ...block,
          text: `${block.text}\n${ACTIVITY_ON}`,
          note: `${block.note ?? ''} The last line turns on local activity for this machine, which your organisation collects (counts only, never the work).`.trim(),
        }
      : block,
  );
}

function rawBlocks(
  id: AgentChoice,
  { origin, secret, insightsOn }: GuideContext,
): readonly SetupBlock[] {
  const token = secret ?? PLACEHOLDER_TOKEN;
  const url = `${origin}/mcp`;

  switch (id) {
    case 'claude-code':
      return [
        {
          key: 'claude-prompt',
          group: 'recommended',
          label: 'Paste into Claude Code',
          what: 'the setup prompt',
          lang: 'text',
          token: 'secret',
          text: machinePrompt({ origin, secret, insightsOn: insightsOn === true }),
          note: 'Open Claude Code anywhere — plain `claude` is fine, nothing is installed yet — and paste this. It installs the Laika plugin and checks the board answers; it writes into no repository. Adding a project is the Projects tab.',
        },
        {
          key: 'claude-manual',
          group: 'manual',
          label: 'Terminal',
          what: 'the install commands',
          lang: 'sh',
          token: 'none',
          text: manualCommands(),
          note: `The same thing by hand. The installer asks for the board URL — ${origin} — and the token from step 2.`,
        },
        {
          key: 'claude-mcp-add',
          group: 'alternative',
          label: 'Terminal — plain `claude`, no plugin',
          what: 'the claude mcp add command',
          lang: 'sh',
          token: 'none',
          text: `claude mcp add --transport http --scope user laika "$LAIKA_URL/mcp" \\
  --header "Authorization: Bearer $LAIKA_TOKEN"`,
          note: 'Without the plugin: the tools, but no /laika commands and no Capacity heartbeat. Needs LAIKA_URL and LAIKA_TOKEN exported first — and the double quotes write the token’s value into ~/.claude.json.',
          warn: 'Not verified: single-quoting the header to keep ${LAIKA_TOKEN} as a reference instead of its value has not been tested.',
        },
        {
          key: 'claude-mcp-json',
          group: 'alternative',
          label: '.mcp.json — project scope, safe to commit',
          what: 'the .mcp.json config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: {
                type: 'http',
                url: '${LAIKA_URL}/mcp',
                headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
              },
            },
          }),
          note: 'Claude Code expands ${VAR} in a remote server’s url and headers, and asks once before using a project server.',
          warn: 'Not verified: Claude Code reads some credential variables as empty in a remote server’s headers; that LAIKA_TOKEN is not one of them is untested — check once with claude --debug.',
        },
      ];

    case 'codex':
      return [
        cliBlock(
          origin,
          token,
          id,
          'adds a [mcp_servers.laika] table to ~/.codex/config.toml if it has none.',
        ),
        envBlock(origin, token),
        {
          key: 'codex-toml',
          group: 'manual',
          label: '~/.codex/config.toml — user scope (or .codex/config.toml in a trusted project)',
          what: 'the Codex config',
          lang: 'toml',
          token: 'none',
          text: `[mcp_servers.laika]
url = "${url}"
bearer_token_env_var = "LAIKA_TOKEN"`,
          note: 'Codex takes the variable by name and reads it at start-up. It does not expand variables inside the URL, so the board is written out.',
        },
        {
          key: 'codex-add',
          group: 'alternative',
          label: 'Terminal — the same, by command',
          what: 'the codex mcp add command',
          lang: 'sh',
          token: 'none',
          text: `codex mcp add laika --url "${url}" --bearer-token-env-var LAIKA_TOKEN`,
        },
      ];

    case 'cursor':
      return [
        cliBlock(origin, token, id, 'merges a laika server into ~/.cursor/mcp.json.'),
        envBlock(origin, token),
        {
          key: 'cursor-json',
          group: 'manual',
          label: '~/.cursor/mcp.json — user scope (or .cursor/mcp.json in the project)',
          what: 'the Cursor config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: { laika: { url, headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' } } },
          }),
          note: 'The editor and the cursor-agent CLI read the same file. Merge the laika entry into mcpServers if the file already has servers.',
        },
        {
          key: 'cursor-enable',
          group: 'manual',
          label: 'Terminal — for cursor-agent',
          what: 'the cursor-agent command',
          lang: 'sh',
          token: 'none',
          text: 'cursor-agent mcp enable laika',
        },
      ];

    case 'antigravity':
      return [
        cliBlock(
          origin,
          token,
          id,
          'merges a laika server into ~/.gemini/config/mcp_config.json — with the token inline, because Antigravity cannot read a variable — and makes the file readable only by you.',
        ),
        {
          key: 'antigravity-json',
          group: 'manual',
          label: '~/.gemini/config/mcp_config.json — user scope',
          what: 'the Antigravity config',
          lang: 'json',
          token: 'inline',
          text: json({
            mcpServers: {
              laika: { serverUrl: url, headers: { Authorization: `Bearer ${token}` } },
            },
          }),
          warn: `Antigravity has no environment-variable expansion (antigravity-cli issue 233), so the token is in this file. ${inlineWarn('your home directory, not .agents/ inside a project')}`,
          note: 'The key is serverUrl — Antigravity ignores url and httpUrl.',
        },
      ];

    case 'opencode':
      return [
        cliBlock(origin, token, id, 'merges a laika server into ~/.config/opencode/opencode.json.'),
        envBlock(origin, token),
        {
          key: 'opencode-json',
          group: 'manual',
          label: '~/.config/opencode/opencode.json — user scope (or opencode.json in the project)',
          what: 'the OpenCode config',
          lang: 'json',
          token: 'none',
          text: json({
            $schema: 'https://opencode.ai/config.json',
            mcp: {
              laika: {
                type: 'remote',
                url,
                enabled: true,
                oauth: false,
                headers: { Authorization: 'Bearer {env:LAIKA_TOKEN}' },
              },
            },
          }),
          note: 'OpenCode writes the variable as {env:LAIKA_TOKEN} — no dollar sign. Unset, it sends an empty token and Laika answers 401.',
        },
        {
          key: 'opencode-add',
          group: 'alternative',
          label: 'Terminal — OpenCode 1.19 or newer',
          what: 'the opencode mcp add command',
          lang: 'sh',
          token: 'none',
          text: `opencode mcp add laika --url "${url}" --header 'Authorization=Bearer {env:LAIKA_TOKEN}'`,
          note: 'Older OpenCode asks interactively instead, and only 1.19+ reads Laika’s working rules from the server.',
        },
      ];

    case 'gemini-cli':
      return [
        cliBlock(origin, token, id, 'merges a laika server into ~/.gemini/settings.json.'),
        envBlock(origin, token),
        {
          key: 'gemini-json',
          group: 'manual',
          label: '~/.gemini/settings.json — user scope (or .gemini/settings.json in the project)',
          what: 'the Gemini CLI config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: { type: 'http', url, headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' } },
            },
          }),
        },
        {
          key: 'gemini-add',
          group: 'alternative',
          label: 'Terminal — the same, by command',
          what: 'the gemini mcp add command',
          lang: 'sh',
          token: 'none',
          text: `gemini mcp add -s user -t http laika "${url}" -H 'Authorization: Bearer \${LAIKA_TOKEN}'`,
          note: 'Single quotes keep ${LAIKA_TOKEN} as a reference for Gemini to expand at start-up. Without -s user it is added to the current project only.',
          warn: 'Not verified: that the single-quoted reference survives and expands at load is read from Gemini’s code, not run.',
        },
      ];

    case 'vscode':
      return [
        envBlock(origin, token),
        {
          key: 'vscode-json',
          group: 'manual',
          label: '.vscode/mcp.json — this workspace, safe to commit',
          what: 'the VS Code config',
          lang: 'json',
          token: 'none',
          text: json({
            servers: {
              laika: { type: 'http', url, headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' } },
            },
          }),
          note: 'The file holds no token. VS Code sees LAIKA_TOKEN only when started from a terminal that has it (`code .`), or when the variable is set system-wide.',
        },
        {
          key: 'vscode-add',
          group: 'alternative',
          label: 'Terminal — user profile, reads LAIKA_TOKEN',
          what: 'the code --add-mcp command',
          lang: 'sh',
          token: 'none',
          text: `code --add-mcp ${shellQuote(JSON.stringify({ name: 'laika', type: 'http', url, headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' } }))}`,
          warn: 'VS Code documents --add-mcp with a local server only; this HTTP form is inferred from its config shape, not tested.',
        },
        {
          key: 'vscode-input-json',
          group: 'alternative',
          label: '.vscode/mcp.json — VS Code asks for the token instead',
          what: 'the VS Code prompt config',
          lang: 'json',
          token: 'none',
          text: json({
            inputs: [
              {
                type: 'promptString',
                id: 'laika-token',
                description: 'Laika personal token',
                password: true,
              },
            ],
            servers: {
              laika: {
                type: 'http',
                url,
                headers: { Authorization: 'Bearer ${input:laika-token}' },
              },
            },
          }),
          note: 'VS Code prompts once and keeps the token in its secret storage. Its docs now steer away from this form, which is why the environment variable leads.',
        },
      ];

    case 'omnigent':
      return [
        envBlock(origin, token),
        {
          key: 'omnigent-sidecar',
          group: 'manual',
          label: '<agent folder>/tools/mcp/laika.yaml',
          what: 'the Omnigent tool file',
          lang: 'yaml',
          token: 'none',
          text: `name: laika
transport: http
url: \${LAIKA_URL}/mcp
headers:
  Authorization: "Bearer \${LAIKA_TOKEN}"`,
          note: 'Omnigent has no user-wide MCP list — each agent spec declares its own tools. `laika connect omnigent --dir <agent folder>` writes this file for you. An unset variable stops the spec loading, by design.',
        },
        {
          key: 'omnigent-inline',
          group: 'alternative',
          label: '<agent folder>/config.yaml — inline, under tools:',
          what: 'the Omnigent inline tool',
          lang: 'yaml',
          token: 'none',
          text: `tools:
  laika:
    type: mcp
    url: \${LAIKA_URL}/mcp
    headers:
      Authorization: "Bearer \${LAIKA_TOKEN}"`,
          note: 'Omnigent introduces itself as a generic client, so Laika recognises it by the token’s name — keep the default “omnigent on …”.',
        },
      ];

    case 'windsurf':
      return [
        envBlock(origin, token),
        {
          key: 'windsurf-json',
          group: 'manual',
          label: '~/.codeium/windsurf/mcp_config.json — user scope',
          what: 'the Windsurf config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: { serverUrl: url, headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' } },
            },
          }),
          warn: 'Not verified. Windsurf is now Devin Desktop and its docs name ~/.config/devin/mcp_config.json and ~/.codeium/mcp_config.json as well — use the one your version reads (Cascade → MCP → View raw config). Its docs also describe https URLs only.',
        },
      ];

    case 'hermes':
      return [
        {
          key: 'hermes-add',
          group: 'recommended',
          label: 'Terminal',
          what: 'the hermes mcp add command',
          lang: 'sh',
          token: 'none',
          text: `hermes mcp add laika --url ${url} --auth header
hermes mcp test laika`,
          note: 'Hermes asks for the token itself and keeps it in ~/.hermes/.env. Paste the one from step 2.',
        },
        envBlock(origin, token),
        {
          key: 'hermes-yaml',
          group: 'alternative',
          label: '~/.hermes/config.yaml — by hand',
          what: 'the Hermes config',
          lang: 'yaml',
          token: 'none',
          text: `mcp_servers:
  laika:
    url: "${url}"
    headers:
      Authorization: "Bearer \${LAIKA_TOKEN}"`,
          note: 'Hermes refuses to start the server if LAIKA_TOKEN is unset, and names the variable.',
        },
      ];

    case 'zed':
      return [
        {
          key: 'zed-bridge',
          group: 'recommended',
          label: '~/.config/zed/settings.json — under context_servers',
          what: 'the Zed bridge config',
          lang: 'json',
          token: 'inline',
          text: json({ context_servers: { laika: bridgeServer(url, token) } }),
          warn: `Zed cannot read an environment variable, so the token is in your settings. ${inlineWarn('your user settings, not .zed/ inside a project')} Zed’s command form for a local server is inferred, not tested against Laika.`,
          note: BRIDGE_NOTE,
        },
        {
          key: 'zed-env',
          group: 'alternative',
          label: '~/.config/zed/settings.json — bridge reading LAIKA_TOKEN from Zed’s environment',
          what: 'the Zed tokenless bridge config',
          lang: 'json',
          token: 'none',
          text: json({
            context_servers: {
              laika: {
                command: 'npx',
                args: [
                  '-y',
                  BRIDGE_PACKAGE,
                  url,
                  '--allow-http',
                  '--transport',
                  'http-only',
                  '--header',
                  'Authorization:Bearer ${LAIKA_TOKEN}',
                ],
              },
            },
          }),
          note: 'Keeps the token out of settings.json: mcp-remote expands ${LAIKA_TOKEN} from the environment it inherits, so start Zed from a terminal that has it.',
          warn: 'Not verified: that Zed passes its environment to the bridge it starts.',
        },
        {
          key: 'zed-direct',
          group: 'alternative',
          label: '~/.config/zed/settings.json — direct, no bridge',
          what: 'the Zed direct config',
          lang: 'json',
          token: 'inline',
          text: json({
            context_servers: { laika: { url, headers: { Authorization: `Bearer ${token}` } } },
          }),
          warn: inlineWarn('your user settings'),
        },
      ];

    case 'cline':
      return [
        envBlock(origin, token),
        {
          key: 'cline-json',
          group: 'manual',
          label: 'Cline — cline_mcp_settings.json (MCP Servers → Configure)',
          what: 'the Cline config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: {
                type: 'streamableHttp',
                url,
                headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
                disabled: false,
                autoApprove: [],
              },
            },
          }),
          note:
            'type must be streamableHttp — without it Cline falls back to the old SSE transport. An unset variable is sent literally. ' +
            VSCODE_HOSTED,
        },
        {
          key: 'roo-json',
          group: 'alternative',
          label: 'Roo Code — .roo/mcp.json or the global mcp_settings.json',
          what: 'the Roo Code config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: {
                type: 'streamable-http',
                url,
                headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
              },
            },
          }),
          note:
            'Roo Code’s repository is archived, so this shape will not change. ' + VSCODE_HOSTED,
        },
      ];

    case 'continue':
      return [
        {
          key: 'continue-yaml',
          group: 'manual',
          label: '.continue/mcpServers/laika.yaml — in the workspace',
          what: 'the Continue config',
          lang: 'yaml',
          token: 'none',
          text: `name: Laika
version: 0.0.1
schema: v1
mcpServers:
  - name: laika
    type: streamable-http
    url: ${url}
    requestOptions:
      headers:
        Authorization: Bearer \${{ secrets.LAIKA_TOKEN }}`,
          note: 'Continue resolves the secret from ~/.continue/.env, then the workspace .env files, then your environment — the last only when the editor was started from a terminal that has it, or the variable is set system-wide.',
        },
        {
          key: 'continue-env',
          group: 'manual',
          label: '~/.continue/.env — outside any repository',
          what: 'the Continue secret',
          lang: 'sh',
          token: 'secret',
          text: `LAIKA_TOKEN=${token}`,
        },
      ];

    case 'claude-desktop':
      return [
        {
          key: 'claude-desktop-bridge',
          group: 'recommended',
          label: 'claude_desktop_config.json — Settings → Developer → Edit Config',
          what: 'the Claude Desktop config',
          lang: 'json',
          token: 'inline',
          text: json({ mcpServers: { laika: bridgeServer(url, token) } }),
          warn: `Claude Desktop starts from the Dock and never sees your shell’s variables, so the token is in this file. ${inlineWarn('Claude’s own settings folder')}`,
          note: `${BRIDGE_NOTE} A custom connector needs an https address and a beta most organisations do not have, so the bridge is the route that works on a plain-http board today.`,
        },
      ];

    case 'kiro':
      return [
        {
          key: 'kiro-bridge',
          group: 'recommended',
          label: '~/.kiro/settings/mcp.json — user scope only, it holds your token',
          what: 'the Kiro config',
          lang: 'json',
          token: 'inline',
          text: json({ mcpServers: { laika: bridgeServer(url, token) } }),
          warn: `Kiro accepts plain http only for localhost, and expands only variables you have approved, so this goes through the bridge with the token in its env. ${inlineWarn('your home directory, not .kiro/ inside a project')}`,
          note: BRIDGE_NOTE,
        },
      ];

    case 'goose':
      return [
        envBlock(origin, token),
        {
          key: 'goose-yaml',
          group: 'manual',
          label: '~/.config/goose/config.yaml — under extensions',
          what: 'the Goose config',
          lang: 'yaml',
          token: 'none',
          text: `extensions:
  laika:
    name: laika
    type: streamable_http
    enabled: true
    uri: "${url}"
    env_keys: [LAIKA_TOKEN]
    headers:
      Authorization: "Bearer \${LAIKA_TOKEN}"
    timeout: 300`,
          note: 'Goose expands only the variables listed in env_keys.',
        },
      ];

    case 'amp':
      return [
        envBlock(origin, token),
        {
          key: 'amp-json',
          group: 'manual',
          label: '~/.config/amp/settings.json — user scope (or .amp/settings.json)',
          what: 'the Amp config',
          lang: 'json',
          token: 'none',
          text: json({
            'amp.mcpServers': {
              laika: { url, headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' } },
            },
          }),
          warn: 'Amp’s docs show https servers only; a plain-http board is not verified.',
        },
      ];

    case 'junie':
      return [
        {
          key: 'junie-json',
          group: 'manual',
          label: 'Junie — ~/.junie/mcp/mcp.json, user scope only, it holds your token',
          what: 'the Junie config',
          lang: 'json',
          token: 'inline',
          text: json({
            mcpServers: { laika: { url, headers: { Authorization: `Bearer ${token}` } } },
          }),
          warn: `Junie’s docs show the token written out; whether it expands a variable is not verified. ${inlineWarn('your home directory, not .junie/ inside a project')}`,
        },
        {
          key: 'jetbrains-bridge',
          group: 'alternative',
          label:
            'JetBrains AI Assistant — Settings → Tools → AI Assistant → Model Context Protocol (global)',
          what: 'the AI Assistant bridge config',
          lang: 'json',
          token: 'inline',
          text: json({ mcpServers: { laika: bridgeServer(url, token) } }),
          warn: `AI Assistant documents no way to send a header, so it goes through the bridge. ${inlineWarn('the IDE’s global settings')}`,
          note: BRIDGE_NOTE,
        },
      ];

    case 'warp':
      return [
        {
          key: 'warp-json',
          group: 'manual',
          label: 'Warp — Settings → MCP servers → Add, as JSON',
          what: 'the Warp config',
          lang: 'json',
          token: 'inline',
          text: json({ laika: { url, headers: { Authorization: `Bearer ${token}` } } }),
          warn: `Not verified: Warp documents environment variables for local servers only, and shows localhost examples. ${inlineWarn('Warp’s own settings')}`,
        },
      ];

    case 'any':
      return [
        envBlock(origin, token),
        {
          key: 'any-json',
          group: 'manual',
          label: 'The usual shape — your client’s MCP config',
          what: 'the generic config',
          lang: 'json',
          token: 'none',
          text: json({
            mcpServers: {
              laika: { type: 'http', url, headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' } },
            },
          }),
          note: 'Streamable HTTP at /mcp with a bearer token. What differs between clients is the spelling: ${LAIKA_TOKEN}, ${env:LAIKA_TOKEN} or {env:LAIKA_TOKEN}; url or serverUrl; and mcpServers, servers or mcp as the top key.',
        },
        {
          key: 'any-bridge',
          group: 'alternative',
          label: 'Any client that runs a command — the bridge',
          what: 'the bridge config',
          lang: 'json',
          token: 'inline',
          text: json({ mcpServers: { laika: bridgeServer(url, token) } }),
          warn: `For a client that cannot send a header or reach plain http. ${inlineWarn('your user settings')}`,
          note: BRIDGE_NOTE,
        },
      ];

    case 'rest':
      return [
        envBlock(origin, token),
        {
          key: 'rest-curl',
          group: 'manual',
          label: 'Terminal — the REST API',
          what: 'the curl commands',
          lang: 'sh',
          token: 'none',
          text: `curl -sS -H "Authorization: Bearer $LAIKA_TOKEN" "$LAIKA_URL/api/v1/me"
curl -sS -H "Authorization: Bearer $LAIKA_TOKEN" "$LAIKA_URL/api/v1/projects"`,
          note: 'Every MCP tool has a REST twin under /api/v1, with the same permissions.',
        },
        {
          key: 'rest-cli',
          group: 'alternative',
          label: 'Terminal — the laika CLI',
          what: 'the laika CLI commands',
          lang: 'sh',
          token: 'none',
          text: `git clone ${PLUGIN_REPO} ${PLUGIN_HOME} 2>/dev/null || git -C ${PLUGIN_HOME} pull --ff-only
${PLUGIN_HOME}/plugin/scripts/install.sh
laika whoami`,
          note: 'The installer asks for the board URL and the token, and puts the laika command on your PATH.',
        },
      ];
  }
}

// ------------------------------------------------------------ step 4: start

export function startGuide(id: AgentChoice): StartGuide {
  switch (id) {
    case 'claude-code':
      return {
        body: 'Open a new terminal — the installer changed your PATH — then, from any project folder, start a session with laika-claude. Use it exactly like claude; every flag passes through. Inside, /laika:status names this board.',
        command: 'laika-claude',
        commandWhat: 'the laika-claude command',
      };
    case 'codex':
      return {
        body: 'Open a new terminal so LAIKA_TOKEN is set, start Codex in your project, and ask it to call laika_whoami. /mcp lists the servers it loaded.',
        command: 'codex',
        commandWhat: 'the codex command',
      };
    case 'cursor':
      return {
        body: 'Start Cursor from a terminal that has LAIKA_TOKEN, so it inherits it. Settings → MCP should list laika with its tools. In Agent chat, ask it to call laika_whoami.',
        command: 'cursor .',
        commandWhat: 'the cursor command',
      };
    case 'antigravity':
      return {
        body: 'Restart Antigravity, open the MCP panel (or /mcp in agy) and check laika is listed and enabled. Then ask the agent to call laika_whoami.',
      };
    case 'opencode':
      return {
        body: 'Open a new terminal, run opencode in your project and ask it to call laika_whoami. opencode mcp list shows whether the server connected.',
        command: 'opencode',
        commandWhat: 'the opencode command',
      };
    case 'gemini-cli':
      return {
        body: 'Open a new terminal, start gemini in your project, and run /mcp list — laika should show its tools. Then ask it to call laika_whoami.',
        command: 'gemini',
        commandWhat: 'the gemini command',
      };
    case 'vscode':
      return {
        body: 'Run “MCP: List Servers” from the command palette and start laika — VS Code asks for the token once. In Copilot Chat, switch to Agent mode and ask it to call laika_whoami.',
      };
    case 'omnigent':
      return {
        body: 'From a terminal with LAIKA_TOKEN set, run the agent whose folder holds the tool file, and ask it to call laika_whoami.',
      };
    case 'windsurf':
      return {
        body: 'Refresh the MCP list in Cascade (or restart Windsurf from a terminal with LAIKA_TOKEN), then ask Cascade to call laika_whoami.',
      };
    case 'hermes':
      return {
        body: 'hermes mcp test laika checks the connection. Then start a session and ask it to call laika_whoami.',
        command: 'hermes mcp test laika',
        commandWhat: 'the hermes test command',
      };
    case 'zed':
      return {
        body: 'Save settings.json; the Agent panel’s settings show laika with a green dot when it is running. Ask the agent to call laika_whoami.',
      };
    case 'cline':
      return {
        body: 'Open the MCP Servers panel and check laika is connected (restart it there if not), then ask the agent to call laika_whoami.',
      };
    case 'continue':
      return {
        body: 'Reload the window, switch Continue to Agent mode, and ask it to call laika_whoami.',
      };
    case 'claude-desktop':
      return {
        body: 'Quit Claude Desktop completely and reopen it. The tools menu in a new chat should list laika; ask Claude to call laika_whoami.',
      };
    case 'kiro':
      return {
        body: 'Open the MCP servers view in Kiro’s panel and check laika is running, then ask the agent to call laika_whoami.',
      };
    case 'goose':
      return {
        body: 'Start a new goose session and ask it to call laika_whoami.',
        command: 'goose session',
        commandWhat: 'the goose command',
      };
    case 'amp':
      return {
        body: 'Start a new Amp thread from a terminal with LAIKA_TOKEN set, and ask it to call laika_whoami.',
      };
    case 'junie':
      return {
        body: 'Restart the IDE (or run /mcp in Junie) and check laika is listed, then ask it to call laika_whoami.',
      };
    case 'warp':
      return {
        body: 'Start the laika server from Settings → MCP servers, then ask Warp’s agent to call laika_whoami.',
      };
    case 'any':
      return {
        body: 'Restart your client so it reads the new config, then ask the agent to call laika_whoami — any tool call proves the connection.',
      };
    case 'rest':
      return {
        body: 'Run the curl line above in a new terminal. It should print your name and email — and step 4 then sees the token answer.',
      };
  }
}

// ------------------------------------------------------------ step 4: when it is slow

const UNSET =
  'LAIKA_TOKEN is not set in the environment the agent started from — open a new terminal after adding it, and start the agent from there. The board’s 401 then says it received an empty Bearer or an unexpanded variable placeholder.';
const DOCK =
  'The app was started from the Dock or Start menu, so it never read your shell profile. Quit it and start it from a terminal.';
const RESTART =
  'The agent was already running when the config changed — restart it so it reads the file again.';

/** Why step 4 might time out for this agent, most likely first. */
export function likelyCauses(id: AgentChoice): readonly string[] {
  switch (id) {
    case 'claude-code':
      return [
        'The terminal is older than the installer — open a new one.',
        'The session was started with claude rather than laika-claude.',
        'With claude mcp add instead of the plugin: LAIKA_TOKEN was not exported when you ran it.',
      ];
    case 'codex':
      return [
        UNSET,
        'A project-level .codex/config.toml is read only in a trusted project.',
        RESTART,
      ];
    case 'cursor':
      return [
        `${UNSET} ${DOCK}`,
        'In cursor-agent, the server is not enabled yet: cursor-agent mcp enable laika.',
        RESTART,
      ];
    case 'antigravity':
      return [
        'The placeholder token is still in mcp_config.json — mint a token and copy the block again.',
        'Antigravity’s handshake is not yet verified against Laika; its open issues report failures against servers shaped like this one.',
        RESTART,
      ];
    case 'opencode':
      return [`${UNSET} Unset, OpenCode sends an empty token and the board refuses it.`, RESTART];
    case 'gemini-cli':
      return [UNSET, 'gemini mcp add without -s user added it to a different project.', RESTART];
    case 'vscode':
      return [
        'The server is configured but not started — MCP: List Servers → laika → Start.',
        'Copilot Chat is in Ask or Edit mode; tools run in Agent mode.',
        DOCK,
      ];
    case 'omnigent':
      return [
        `${UNSET} Omnigent refuses to load a spec with an unset variable.`,
        'The tool file is in a different agent folder from the one you ran.',
      ];
    case 'windsurf':
      return [
        'The config file is not the one your Windsurf version reads — check Cascade → MCP → View raw config.',
        `${UNSET} ${DOCK}`,
      ];
    case 'hermes':
      return ['hermes mcp test laika reports why — usually the pasted token.', RESTART];
    case 'zed':
      return [
        'The placeholder token is still in settings.json — mint a token and copy the block again.',
        'npx is not on the PATH Zed starts with.',
      ];
    case 'cline':
      return [
        `${UNSET} Cline sends an unset variable literally.`,
        'type is missing or misspelled, so it tried the old SSE transport.',
      ];
    case 'continue':
      return [
        'LAIKA_TOKEN is not in ~/.continue/.env or your environment.',
        'Continue is not in Agent mode.',
      ];
    case 'claude-desktop':
      return [
        'Claude Desktop was not fully quit — it reads the config only at launch.',
        'The placeholder token is still in the config.',
        'npx is not installed, or Node is older than 18.',
      ];
    case 'kiro':
      return [
        'The placeholder token is still in mcp.json.',
        'npx is not installed, or Node is older than 18.',
        RESTART,
      ];
    case 'goose':
      return [`${UNSET} Goose expands it only when it is listed in env_keys.`, RESTART];
    case 'amp':
      return [UNSET, 'Amp may refuse a plain-http board — that path is not verified.'];
    case 'junie':
      return [
        'The placeholder token is still in the config.',
        'For AI Assistant: npx is not installed, or Node is older than 18.',
        RESTART,
      ];
    case 'warp':
      return [
        'The server is added but not started in Settings → MCP servers.',
        'The placeholder token is still in the config.',
      ];
    case 'any':
      return [
        `${UNSET} ${DOCK}`,
        'Your client spells the variable differently — some want ${env:LAIKA_TOKEN} or {env:LAIKA_TOKEN}.',
        RESTART,
      ];
    case 'rest':
      return [UNSET, 'The request went to a different board — check LAIKA_URL.'];
  }
}

// ---------------------------------------------- the project's instructions

export interface InstructionsTarget {
  /** Where the block goes — a repository path, or for a client with no file, where in its UI. */
  readonly path: string;
  /** The file's content around the block — frontmatter for a rule file. */
  readonly wrap: (block: string) => string;
  /** False when there is no file to commit (Claude Desktop keeps it in its UI). */
  readonly committable: boolean;
  /** What else decides whether the agent reads it — a file that wins over it. */
  readonly note?: string;
}

const plain = (path: string, note?: string): InstructionsTarget => ({
  path,
  wrap: (block) => block,
  committable: true,
  ...(note === undefined ? {} : { note }),
});

/**
 * Which file a project's agents read their standing instructions from.
 *
 * AGENTS.md is the default because most agents read it (Codex, OpenCode, Amp,
 * Goose, Hermes, Zed, Warp, and Cursor's CLI); the rest are each client's own
 * rule location from the report. Where a client reads the *first* of several
 * files, the note says which ones win over AGENTS.md (review round 1).
 */
export function instructionsTarget(id: AgentChoice): InstructionsTarget {
  switch (id) {
    case 'claude-code':
      return plain('CLAUDE.md');
    case 'gemini-cli':
    case 'antigravity':
      return plain('GEMINI.md');
    case 'cursor':
      return {
        path: '.cursor/rules/laika.mdc',
        committable: true,
        wrap: (block) => `---
description: How agents work the Laika board for this project
alwaysApply: true
---

${block}`,
      };
    case 'vscode':
      return plain('.github/copilot-instructions.md');
    case 'windsurf':
      return plain('.windsurf/rules/laika.md');
    case 'cline':
      return plain(
        '.clinerules/laika.md',
        'Roo Code reads .roo/rules/laika.md instead — put the same block there.',
      );
    case 'continue':
      return plain('.continue/rules/laika.md');
    case 'kiro':
      return plain('.kiro/steering/laika.md');
    case 'junie':
      return plain('.junie/AGENTS.md');
    case 'claude-desktop':
      return {
        path: 'Claude Desktop project instructions',
        committable: false,
        wrap: (block) => block,
        note: 'Claude Desktop has no instructions file: paste the block into a project’s Project instructions in its UI.',
      };
    case 'zed':
      return plain(
        'AGENTS.md',
        'Zed reads only the first it finds of .rules, .cursorrules, .windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md — an earlier one in that list wins, so put the block there instead if the repo has one.',
      );
    case 'hermes':
      return plain(
        'AGENTS.md',
        'Hermes reads .hermes.md or HERMES.md first, then AGENTS.override.md, before AGENTS.md — if the repo has one of those, it wins; put the block there instead.',
      );
    case 'warp':
      return plain(
        'AGENTS.md',
        'Warp reads WARP.md instead when both exist — if the repo has a WARP.md, put the block there.',
      );
    default:
      return plain('AGENTS.md');
  }
}
