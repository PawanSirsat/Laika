import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The agents `laika connect` knows, and what each one's config looks like
 * (LAI-737).
 *
 * ## Where the shapes come from
 *
 * Every entry and snippet here is copied from the client research done for this
 * task — the key names, the env-var spelling and the paths — not reconstructed
 * from memory. **The env-var spelling is the part that differs per client** and
 * the part that fails silently: OpenCode sends an empty `Bearer ` for an unset
 * or misspelt variable, so a wrong `${env:…}` looks like a refused token rather
 * than a typo. Where the research could not confirm something, the printed text
 * says `[UNVERIFIED]` rather than presenting a guess as settled.
 *
 * ## Pure, and why
 *
 * Nothing in this file writes. The builders take a URL and return an object;
 * `detectAgents` only reads. `connect.ts` decides what to do with them, so a
 * test can assert the exact shape a client will read without a HOME to clean up.
 */

export type AgentSlug =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'antigravity'
  | 'opencode'
  | 'gemini-cli'
  | 'vscode'
  | 'windsurf'
  | 'omnigent'
  | 'hermes'
  | 'zed'
  | 'cline'
  | 'roo'
  | 'continue'
  | 'kiro'
  | 'goose'
  | 'amp'
  | 'junie'
  | 'warp'
  | 'claude-desktop'
  | 'other';

export interface Agent {
  readonly slug: AgentSlug;
  readonly name: string;
  /** One line for `--list`: which file it writes, or that it prints. */
  readonly does: string;
}

export const AGENTS: readonly Agent[] = [
  {
    slug: 'claude-code',
    name: 'Claude Code',
    does: 'prints the plugin route and `claude mcp add`; --project writes .mcp.json',
  },
  {
    slug: 'codex',
    name: 'OpenAI Codex CLI',
    does: 'appends [mcp_servers.laika] to ~/.codex/config.toml (--project: .codex/config.toml)',
  },
  {
    slug: 'cursor',
    name: 'Cursor (editor and cursor-agent)',
    does: 'writes ~/.cursor/mcp.json (--project: .cursor/mcp.json)',
  },
  {
    slug: 'antigravity',
    name: 'Google Antigravity',
    does: 'writes ~/.gemini/config/mcp_config.json with the token inline, 0600 (beta)',
  },
  {
    slug: 'opencode',
    name: 'OpenCode',
    does: 'writes ~/.config/opencode/opencode.json (--project: opencode.json)',
  },
  {
    slug: 'gemini-cli',
    name: 'Gemini CLI',
    does: 'writes ~/.gemini/settings.json (--project: .gemini/settings.json)',
  },
  {
    slug: 'vscode',
    name: 'VS Code + GitHub Copilot',
    does: 'prints `code --add-mcp`; --project writes .vscode/mcp.json',
  },
  {
    slug: 'windsurf',
    name: 'Windsurf / Devin Desktop',
    does: 'prints a snippet (its config path is in flux)',
  },
  {
    slug: 'omnigent',
    name: 'Omnigent',
    does: 'writes tools/mcp/laika.yaml in --dir <agent> (or here, with --project); else prints',
  },
  { slug: 'hermes', name: 'Hermes Agent', does: 'prints a ~/.hermes/config.yaml snippet' },
  { slug: 'zed', name: 'Zed', does: 'prints an mcp-remote bridge for Zed settings.json' },
  { slug: 'cline', name: 'Cline', does: 'prints a cline_mcp_settings.json snippet' },
  { slug: 'roo', name: 'Roo Code', does: 'prints a .roo/mcp.json snippet' },
  { slug: 'continue', name: 'Continue', does: 'prints .continue/mcpServers/laika.yaml' },
  { slug: 'kiro', name: 'Kiro', does: 'prints an mcp-remote bridge for ~/.kiro/settings/mcp.json' },
  { slug: 'goose', name: 'Goose', does: 'prints a ~/.config/goose/config.yaml snippet' },
  { slug: 'amp', name: 'Amp', does: 'prints a ~/.config/amp/settings.json snippet' },
  {
    slug: 'junie',
    name: 'Junie (JetBrains)',
    does: 'prints an mcp-remote bridge for ~/.junie/mcp/mcp.json',
  },
  { slug: 'warp', name: 'Warp', does: 'prints the JSON for Settings → MCP servers' },
  {
    slug: 'claude-desktop',
    name: 'Claude Desktop',
    does: 'prints an mcp-remote bridge for claude_desktop_config.json',
  },
  {
    slug: 'other',
    name: 'Any other MCP client',
    does: 'prints the generic JSON shape and the mcp-remote bridge',
  },
];

/** Names people will type for these. Kept to the obvious ones. */
export const ALIASES: Readonly<Record<string, AgentSlug>> = {
  claude: 'claude-code',
  gemini: 'gemini-cli',
  copilot: 'vscode',
  code: 'vscode',
  agy: 'antigravity',
};

export function resolveAgent(input: string): Agent | undefined {
  const slug = ALIASES[input.toLowerCase()] ?? input.toLowerCase();
  return AGENTS.find((agent) => agent.slug === slug);
}

export type JsonObject = Readonly<Record<string, unknown>>;

const mcp = (url: string): string => `${url}/mcp`;

/*
 * The entries connect writes. `url` is the literal board URL wherever the
 * client does not interpolate it — Codex, Cursor, Gemini, OpenCode, VS Code and
 * Antigravity all get the address itself, and only the token goes by reference.
 */

/** `.mcp.json` — the one file that carries neither value, so it may be committed. */
export function claudeProjectEntry(): JsonObject {
  return {
    type: 'http',
    url: '${LAIKA_URL}/mcp',
    headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
  };
}

export function cursorEntry(url: string): JsonObject {
  return { url: mcp(url), headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' } };
}

export function geminiEntry(url: string): JsonObject {
  return {
    type: 'http',
    url: mcp(url),
    headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
  };
}

/** `{env:…}` with **no `$`** — OpenCode's own spelling. */
export function opencodeEntry(url: string): JsonObject {
  return {
    type: 'remote',
    url: mcp(url),
    enabled: true,
    oauth: false,
    headers: { Authorization: 'Bearer {env:LAIKA_TOKEN}' },
  };
}

export function vscodeEntry(url: string): JsonObject {
  return {
    type: 'http',
    url: mcp(url),
    headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
  };
}

/**
 * The one entry that holds the token itself. Antigravity has no env-var
 * expansion at all, so there is nothing to reference — see `connect.ts` for
 * the 0600 file mode and the refusal to write it into a project.
 */
export function antigravityEntry(url: string, token: string): JsonObject {
  return { serverUrl: mcp(url), headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Codex takes the variable's **name**; it does not interpolate.
 *
 * The URL goes through `JSON.stringify`: a JSON string is a valid TOML basic
 * string for anything a URL can hold — the escapes the two share are the only
 * ones a URL can need.
 */
export function codexBlock(url: string): string {
  return `[mcp_servers.laika]\nurl = ${JSON.stringify(mcp(url))}\nbearer_token_env_var = "LAIKA_TOKEN"\n`;
}

/**
 * One TOML key path. Dots split it **only outside quotes**, so
 * `"laika.v2"` stays one name (re-review).
 */
function keyPath(raw: string): string[] {
  const parts: string[] = [];
  let part = '';
  let quote: string | undefined;
  for (const ch of raw) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else part += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '.') {
      parts.push(part.trim());
      part = '';
    } else part += ch;
  }
  parts.push(part.trim());
  return parts;
}

/** Index of the first `=` outside quotes, or -1. */
function equalsAt(line: string): number {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '=') return i;
  }
  return -1;
}

/** `{`/`[` minus `}`/`]` outside quoted strings — how far a value is left open. */
function openBrackets(value: string): number {
  const bare = value.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '');
  return (bare.match(/[[{]/g)?.length ?? 0) - (bare.match(/[\]}]/g)?.length ?? 0);
}

const FENCES = ['"""', "'''"] as const;

/**
 * Does `~/.codex/config.toml` already define the `laika` server — in any of
 * the forms TOML allows (review round 1)?
 *
 * - a `[mcp_servers.laika]` header, or a sub-table of it;
 * - an inline table: `laika = { … }` under `[mcp_servers]`, or
 *   `mcp_servers = { laika = … }` at the top level;
 * - a dotted key: `laika.url = …` under `[mcp_servers]`, or
 *   `mcp_servers.laika.url = …` above the first table; quoted or not.
 *
 * Appending a `[mcp_servers.laika]` block beside any of them defines the table
 * twice, which every TOML parser — Codex's included — rejects, so the agent
 * would not start at all.
 *
 * **What it does not count** (re-review): `laika` anywhere outside the
 * `mcp_servers` tables (a trusted project folder called laika is not a
 * server); a quoted name that merely contains it (`"laika.v2"`); and anything
 * inside a multi-line string.
 *
 * **`unsure` means hands off.** A value under `mcp_servers` left open across
 * lines (a multi-line inline table) that mentions `laika` cannot be placed by
 * a line scanner. `connect` then leaves the file alone and prints the block.
 */
export function codexLaikaState(toml: string): 'present' | 'absent' | 'unsure' {
  let table: string[] = [];
  let inString: (typeof FENCES)[number] | undefined;
  let open = 0;
  let openInServers = false;
  let unsure = false;

  for (const raw of toml.split('\n')) {
    if (inString !== undefined) {
      if (raw.includes(inString)) inString = undefined;
      continue;
    }
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (open > 0) {
      if (openInServers && /\blaika\b/.test(line)) unsure = true;
      open += openBrackets(line);
      continue;
    }

    const header = /^\[\[?(.+?)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      table = keyPath(header[1] ?? '');
      if (table[0] === 'mcp_servers' && table[1] === 'laika') return 'present';
      continue;
    }

    const eq = equalsAt(line);
    if (eq < 0) continue;
    const key = [...table, ...keyPath(line.slice(0, eq))];
    const value = line.slice(eq + 1).trim();
    if (key[0] === 'mcp_servers' && key[1] === 'laika') return 'present';
    if (
      key.length === 1 &&
      key[0] === 'mcp_servers' &&
      /(?:^|[{,\s])(?:laika|"laika"|'laika')\s*[=.]/.test(value)
    ) {
      return 'present';
    }

    for (const fence of FENCES) {
      if (value.startsWith(fence) && !value.slice(3).includes(fence)) inString = fence;
    }
    if (inString === undefined) {
      open = Math.max(0, openBrackets(value));
      openInServers = key[0] === 'mcp_servers';
    }
  }
  return unsure ? 'unsure' : 'absent';
}

/** For `laika whoami`: is the server defined, in any form? */
export function hasCodexLaikaTable(toml: string): boolean {
  return codexLaikaState(toml) === 'present';
}

/** A single-quoted shell word that survives any character, `'` included. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Omnigent's sidecar spec. Omnigent expands both variables itself. */
export const OMNIGENT_SIDECAR =
  'name: laika\n' +
  'transport: http\n' +
  'url: ${LAIKA_URL}/mcp\n' +
  'headers:\n' +
  '  Authorization: "Bearer ${LAIKA_TOKEN}"\n';

export const OMNIGENT_INLINE =
  'tools:\n' +
  '  laika:\n' +
  '    type: mcp\n' +
  '    url: ${LAIKA_URL}/mcp\n' +
  '    headers:\n' +
  '      Authorization: "Bearer ${LAIKA_TOKEN}"\n';

/** Where each written agent's user-scope file lives. */
export const USER_CONFIG = {
  cursor: (home: string) => join(home, '.cursor', 'mcp.json'),
  codex: (home: string) => join(home, '.codex', 'config.toml'),
  'gemini-cli': (home: string) => join(home, '.gemini', 'settings.json'),
  opencode: (home: string) => join(home, '.config', 'opencode', 'opencode.json'),
  antigravity: (home: string) => join(home, '.gemini', 'config', 'mcp_config.json'),
} as const;

const pretty = (value: unknown): string[] => JSON.stringify(value, null, 2).split('\n');

/** The token placeholder. Printed output never carries the real one. */
export const PLACEHOLDER = 'lai_...';

/**
 * `mcp-remote` as a stdio bridge, for clients that cannot send a header to
 * plain http. `--allow-http` is mandatory — mcp-remote refuses any non-HTTPS,
 * non-localhost URL without it — and the `Bearer` value lives in `env` so no
 * client's argument escaping has to cope with the space in it.
 */
export function bridgeEntry(url: string): JsonObject {
  return {
    command: 'npx',
    args: [
      '-y',
      'mcp-remote@0.14.3',
      mcp(url),
      '--allow-http',
      '--transport',
      'http-only',
      '--header',
      'Authorization:${LAIKA_AUTH}',
    ],
    env: { LAIKA_AUTH: `Bearer ${PLACEHOLDER}` },
  };
}

function bridge(url: string, where: string, key = 'mcpServers'): string[] {
  return [
    `Add this to ${where}:`,
    '',
    ...pretty({ [key]: { laika: bridgeEntry(url) } }),
    '',
    `Replace ${PLACEHOLDER} with the LAIKA_TOKEN value in ~/.laika/env. mcp-remote`,
    'expands ${LAIKA_AUTH} itself from that env block, so this works in clients that',
    'expand nothing. Needs Node 18 or newer.',
    '',
    'As one command line — it reads LAIKA_TOKEN from your environment, and the single',
    'quotes hand ${LAIKA_AUTH} to mcp-remote unexpanded, which expands it itself:',
    `  LAIKA_AUTH="Bearer $LAIKA_TOKEN" npx -y mcp-remote@0.14.3 ${shellQuote(mcp(url))} --allow-http --transport http-only --header 'Authorization:\${LAIKA_AUTH}'`,
  ];
}

/**
 * What to print for an agent connect does not write for. Every env-referencing
 * snippet uses that client's own spelling; every snippet that has to carry the
 * token uses {@link PLACEHOLDER} and says where the real one is.
 */
export function printedSnippet(slug: AgentSlug, url: string): string[] | undefined {
  switch (slug) {
    case 'windsurf':
      return [
        'Windsurf is now Devin Desktop, and which config file it reads is [UNVERIFIED]:',
        '  ~/.codeium/windsurf/mcp_config.json  (classic Windsurf)',
        '  ~/.codeium/mcp_config.json           (Devin Desktop FAQ)',
        '  ~/.config/devin/mcp_config.json      (Devin Cascade MCP page)',
        '',
        ...pretty({
          mcpServers: {
            laika: {
              serverUrl: mcp(url),
              headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
            },
          },
        }),
        '',
        'Its docs say the URL should be https://; whether http:// is refused is [UNVERIFIED].',
      ];

    case 'hermes':
      return [
        'Add this to ~/.hermes/config.yaml (Hermes has no project-level MCP file):',
        '',
        'mcp_servers:',
        '  laika:',
        `    url: "${mcp(url)}"`,
        '    headers:',
        '      Authorization: "Bearer ${LAIKA_TOKEN}"',
        '',
        `Or: hermes mcp add laika --url ${mcp(url)} --auth header`,
        '    (it asks for the token and keeps its own copy in ~/.hermes/.env)',
        'Then: hermes mcp test laika',
        '',
        'An unset LAIKA_TOKEN fails closed. Hermes probes the URL before connecting, so',
        'expect a short-lived "hermes-probe" session on the board.',
      ];

    case 'cline':
      return [
        'Add this to ~/.cline/data/settings/cline_mcp_settings.json',
        '(or the file $CLINE_MCP_SETTINGS_PATH names):',
        '',
        ...pretty({
          mcpServers: {
            laika: {
              type: 'streamableHttp',
              url: mcp(url),
              headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
              disabled: false,
              autoApprove: [],
            },
          },
        }),
        '',
        '"type": "streamableHttp" is required: without it Cline falls back to legacy SSE.',
        'An unset LAIKA_TOKEN is sent literally, not as an empty value.',
      ];

    case 'roo':
      return [
        'Add this to .roo/mcp.json in the project, or to Roo Code’s global mcp_settings.json:',
        '',
        ...pretty({
          mcpServers: {
            laika: {
              type: 'streamable-http',
              url: mcp(url),
              headers: { Authorization: 'Bearer ${env:LAIKA_TOKEN}' },
            },
          },
        }),
        '',
        'Confirmed for Roo: "streamable-http" and ${env:…}. The surrounding shape follows',
        'Cline, which Roo was forked from, and is [UNVERIFIED]. Roo Code’s repository was',
        'archived on 2026-05-15.',
      ];

    case 'continue':
      return [
        'Continue reads MCP servers per workspace. Create .continue/mcpServers/laika.yaml:',
        '',
        'name: Laika',
        'version: 0.0.1',
        'schema: v1',
        'mcpServers:',
        '  - name: laika',
        '    type: streamable-http',
        `    url: ${mcp(url)}`,
        '    requestOptions:',
        '      headers:',
        '        Authorization: Bearer ${{ secrets.LAIKA_TOKEN }}',
        '',
        '${{ secrets.LAIKA_TOKEN }} is looked up in ~/.continue/.env, the workspace’s',
        '.continue/.env and .env, then the process environment.',
      ];

    case 'goose':
      return [
        'Add this to ~/.config/goose/config.yaml:',
        '',
        'extensions:',
        '  laika:',
        '    name: laika',
        '    type: streamable_http',
        '    enabled: true',
        `    uri: "${mcp(url)}"`,
        '    env_keys: [LAIKA_TOKEN]',
        '    headers:',
        '      Authorization: "Bearer ${LAIKA_TOKEN}"',
        '    timeout: 300',
        '',
        'Goose expands ${LAIKA_TOKEN} only because it is listed in env_keys.',
      ];

    case 'amp':
      return [
        'Add this to ~/.config/amp/settings.json (or .amp/settings.json in the project):',
        '',
        ...pretty({
          'amp.mcpServers': {
            laika: { url: mcp(url), headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' } },
          },
        }),
        '',
        '`amp mcp add` has no header flag, so edit the JSON. Amp’s docs show https://',
        'URLs only; plain http:// is [UNVERIFIED].',
      ];

    case 'warp':
      return [
        'Warp has no config file for this. In Settings → MCP servers, add:',
        '',
        ...pretty({
          laika: { url: mcp(url), headers: { Authorization: `Bearer ${PLACEHOLDER}` } },
        }),
        '',
        `Replace ${PLACEHOLDER} with the LAIKA_TOKEN value in ~/.laika/env. Whether Warp`,
        'expands environment variables for a remote server is [UNVERIFIED], so the token',
        'goes in literally. http:// works for localhost; to an IP it is [UNVERIFIED].',
      ];

    case 'kiro':
      return [
        'Kiro accepts http:// only for localhost, so a plain-http board needs the bridge.',
        ...bridge(url, '~/.kiro/settings/mcp.json — user scope only, because it holds your token'),
        '',
        'With an https:// board the native form works instead — and Kiro expands only',
        'environment variables you have explicitly approved:',
        '  "laika": { "url": "https://…/mcp",',
        '             "headers": { "Authorization": "Bearer ${LAIKA_TOKEN}" } }',
      ];

    case 'claude-desktop':
      return [
        'Claude Desktop’s custom connectors need HTTPS and a request-headers beta, so the',
        'route that works today is the bridge.',
        ...bridge(
          url,
          'claude_desktop_config.json\n' +
            '  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json\n' +
            '  Windows: %APPDATA%\\Claude\\claude_desktop_config.json',
        ),
      ];

    case 'zed':
      return [
        'Zed expands no environment variables, so both forms below hold the token in',
        '~/.config/zed/settings.json — user scope only; never .zed/ in a project.',
        '',
        ...pretty({
          context_servers: {
            laika: { url: mcp(url), headers: { Authorization: `Bearer ${PLACEHOLDER}` } },
          },
        }),
        '',
        'Or through the bridge, which also keeps the token in settings.json (its env block).',
        'The exact keys Zed takes for a command entry are [UNVERIFIED] here.',
        ...bridge(url, 'Zed settings.json', 'context_servers'),
        '',
        'To keep the token out of settings.json, start Zed from a terminal that has',
        'LAIKA_TOKEN exported and let mcp-remote expand it from the environment it',
        'inherits — [UNVERIFIED] that Zed passes its environment to the bridge:',
        '',
        ...pretty({
          context_servers: {
            laika: {
              command: 'npx',
              args: [
                '-y',
                'mcp-remote@0.14.3',
                mcp(url),
                '--allow-http',
                '--transport',
                'http-only',
                '--header',
                'Authorization:Bearer ${LAIKA_TOKEN}',
              ],
            },
          },
        }),
      ];

    case 'junie':
      return [
        'Junie — ~/.junie/mcp/mcp.json, user scope only, because it holds your token:',
        '',
        ...pretty({
          mcpServers: {
            laika: { url: mcp(url), headers: { Authorization: `Bearer ${PLACEHOLDER}` } },
          },
        }),
        '',
        `Replace ${PLACEHOLDER} with the LAIKA_TOKEN value in ~/.laika/env. Junie's docs show`,
        'the token written out; whether it expands a variable is [UNVERIFIED].',
        '',
        'JetBrains AI Assistant documents no header field at all, so it takes the bridge',
        '(Settings → Tools → AI Assistant → Model Context Protocol — user scope only):',
        ...bridge(url, 'AI Assistant'),
      ];

    case 'other':
      return [
        'Most clients take some variant of this:',
        '',
        ...pretty({
          mcpServers: {
            laika: {
              type: 'http',
              url: mcp(url),
              headers: { Authorization: 'Bearer ${LAIKA_TOKEN}' },
            },
          },
        }),
        '',
        'The env-var spelling is the part that varies: ${env:LAIKA_TOKEN} (Cursor, VS Code,',
        'Cline, Windsurf), {env:LAIKA_TOKEN} (OpenCode), ${LAIKA_TOKEN} (Claude Code,',
        'Gemini CLI, Hermes, Amp). Key variants: serverUrl (Antigravity, Windsurf); type',
        '"remote", "streamableHttp" or "streamable-http"; top key servers, mcp or',
        'context_servers.',
        '',
        'A client that expands nothing, or cannot send a header, can use the bridge.',
        ...bridge(url, 'its config'),
      ];

    default:
      return undefined;
  }
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function hasEntry(path: string, container: string): boolean {
  const servers = readJsonObject(path)?.[container];
  return typeof servers === 'object' && servers !== null && 'laika' in servers;
}

/**
 * Which agents have a `laika` entry at user scope — for `laika whoami`.
 *
 * **Read-only and quiet**: an unreadable or malformed file is "not configured",
 * never an error, because whoami's job is to report what it can. It looks at
 * the files `connect` writes at user scope, plus `~/.claude.json` for Claude
 * Code, where `claude mcp add --scope user` puts it. It says nothing about
 * whether the entry works — only that one is there.
 */
export function detectAgents(home: string): AgentSlug[] {
  const found: AgentSlug[] = [];
  if (hasEntry(join(home, '.claude.json'), 'mcpServers')) found.push('claude-code');

  let toml = '';
  try {
    toml = readFileSync(USER_CONFIG.codex(home), 'utf8');
  } catch {
    // No Codex config — not configured.
  }
  if (hasCodexLaikaTable(toml)) found.push('codex');

  if (hasEntry(USER_CONFIG.cursor(home), 'mcpServers')) found.push('cursor');
  if (hasEntry(USER_CONFIG.antigravity(home), 'mcpServers')) found.push('antigravity');
  if (hasEntry(USER_CONFIG.opencode(home), 'mcp')) found.push('opencode');
  if (hasEntry(USER_CONFIG['gemini-cli'](home), 'mcpServers')) found.push('gemini-cli');
  return found;
}
