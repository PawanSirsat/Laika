import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type AgentHookReport, installAgentHooks } from './agent-hooks.ts';
import { ADAPTERS, type Harness } from './agent-adapters.ts';
import { claudeJsonPath, holdsEntry, isToolEntry } from './claude-mcp.ts';
import { credentialPath, isRecord, writeCredential, writePrivate } from './agent-session.ts';
import { AGENT_HOOK_SCRIPT } from './agent-setup.ts';
import { reportOutcome, sendClientReport } from './client-report.ts';
import { apply, prepare, rcFileFor } from './connect.ts';
import {
  commonRefusal,
  type DeviceIo,
  featureGate,
  postJson,
  readDevice,
  readDeviceKey,
  reasonOf,
  signWith,
  toolRedeemMessage,
} from './device.ts';
import { PROTOCOL } from './protocol.ts';
import { versionInfo } from './version.ts';

/**
 * `laika tool add <harness> --exchange <id>` (LAI-1060; plan LAI-1042 §F.4,
 * server SPEC §4.80).
 *
 * The browser made an exchange for one tool on this paired device and shows
 * the command. Here the device redeems it by signing the board's challenge
 * with the key it paired, and the board mints that tool's token **in the
 * answer to that request** — so the token arrives over the one HTTPS response
 * and goes straight into `~/.laika/agents/<harness>.json`, 0600. It is never
 * an argument, never in the environment this process prints, never in a
 * prompt or a transcript, never in a repository, and never printed.
 *
 * **`~/.laika/env` is never written here.** That file is the person's own
 * token; a tool's credential is the tool's.
 *
 * What each tool gets is what `cli/agent-adapters/CAPABILITIES.md` and plan
 * §M say it can honestly have, and nothing is promised past that:
 *
 * - **Claude Code**: credential, hooks, and a user-scope MCP entry in
 *   `~/.claude.json` whose `headersHelper` reads the token out of
 *   `~/.laika/agents/claude-code.json` each time Claude Code connects — so the
 *   token is in no config file, and a Reconnect needs no edit (LAI-1072). An
 *   existing `mcpServers.laika` is kept. `laika-claude` prefers this
 *   credential to the person's own too — only because `tool add` wrote it
 *   (`source: "tool-add"`), so nobody is switched retroactively (§L2).
 * - **Codex**: credential, hooks, and an MCP entry reading its own variable,
 *   `LAIKA_AGENT_TOKEN_CODEX`. An existing `[mcp_servers.laika]` is kept.
 * - **Omnigent**: credential only — no hooks, no sessions.
 * - **Cursor, Gemini CLI, VS Code**: credential; **MCP set up by hand** — the
 *   exact entry and the shell line that sets its variable are printed.
 * - **Antigravity** takes a token only written into its own config, so it is
 *   refused **before** anything is redeemed; so is any tool with no CLI
 *   harness. A refused exchange mints nothing.
 *
 * Before redeeming — and in `--dry-run` too, which only reads — the paired
 * board's manifest must say `tool_setup_exchange: true` (`featureGate` in
 * `device.ts`, LAI-1064). The client report after setup is sent only when the
 * manifest says `client_reports: true`, or when the board is too old to have a
 * manifest and its answer decides, as before.
 */

export interface ToolAddIo extends DeviceIo {
  readonly shell: string | undefined;
}

const CONSOLE: ToolAddIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
  shell: process.env.SHELL,
};

/** How `tool add` sets up a tool, by the board's harness slug (§4.63). */
export type ToolPlan =
  | { readonly kind: 'full'; readonly harness: Harness }
  | { readonly kind: 'credential-only'; readonly harness: Harness }
  | { readonly kind: 'mcp-manual'; readonly harness: Harness }
  | { readonly kind: 'refused'; readonly why: readonly string[] };

/** The variable Codex's MCP entry reads its token from. Its own, never `LAIKA_TOKEN`. */
export const CODEX_TOKEN_VAR = 'LAIKA_AGENT_TOKEN_CODEX';

/** The variable a hand-set MCP entry reads a tool's own token from: `LAIKA_AGENT_TOKEN_CURSOR`. */
export function tokenVar(harness: Harness): string {
  return `LAIKA_AGENT_TOKEN_${harness.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** A shell line that sets `variable` from `harness`'s own credential file, and holds no token. */
export function tokenExportLine(harness: Harness, variable: string): string {
  return (
    `[ -r "$HOME/.laika/agents/${harness}.json" ] && ` +
    `export ${variable}="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/${harness}.json")"`
  );
}

/**
 * Claude Code's `headersHelper` for the Laika entry: prints the
 * `Authorization` header from the tool's own credential file each time Claude
 * Code connects. User scope runs it from `~/.claude`, with the person's
 * environment, without a trust prompt (code.claude.com/docs/en/mcp, *Use
 * dynamic headers*). The token is never in `~/.claude.json`. With no token
 * there (the file gone, or no `token` line) it prints nothing and exits 1, so
 * Claude Code reports a failed helper rather than sending `Bearer ` (LAI-1074).
 */
export const CLAUDE_HEADERS_HELPER =
  `t="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/claude-code.json")" && ` +
  `[ -n "$t" ] && printf '{"Authorization":"Bearer %s"}' "$t"`;

/** The `mcpServers.laika` entry `tool add` writes into `~/.claude.json`. */
export function claudeToolEntry(url: string): Record<string, string> {
  return { type: 'http', url: `${url}/mcp`, headersHelper: CLAUDE_HEADERS_HELPER };
}

export const CODEX_RC_MARKER =
  "# Laika — Codex's own agent token for its MCP entry (laika tool add codex)";

/**
 * Where a refused tool goes instead — the web's Add tool wizard says the same
 * (`tool-catalog.ts`, LAI-1061): a personal token, in the tool's own MCP
 * settings. V3 has no "Set up by hand" for a tool.
 */
const SET_UP_BY_HAND = [
  'Connect it by hand instead: create a personal token under Developer access →',
  "Advanced, and add it in the tool's own MCP settings. That token acts as you,",
  'not as a tool of its own. Nothing was redeemed, so no token exists.',
];

export function planFor(slug: string): ToolPlan {
  switch (slug) {
    case 'claude-code':
    case 'codex':
      return { kind: 'full', harness: slug };
    case 'omnigent':
      return { kind: 'credential-only', harness: 'omnigent' };
    case 'cursor':
    case 'gemini-cli':
      return { kind: 'mcp-manual', harness: slug };
    // The board names Copilot in VS Code `vscode` (D-076); the helper's file is
    // `copilot-vscode`.
    case 'vscode':
    case 'copilot-vscode':
      return { kind: 'mcp-manual', harness: 'copilot-vscode' };
    case 'antigravity':
      return {
        kind: 'refused',
        why: [
          'Antigravity expands no environment variables, so its MCP config would have',
          'to hold the token itself (~/.gemini/config/mcp_config.json). `laika tool add`',
          'never writes a token into a tool’s config.',
          ...SET_UP_BY_HAND,
        ],
      };
    case 'copilot-cloud':
      return {
        kind: 'refused',
        why: [
          'Copilot cloud agent runs on GitHub with an empty, throwaway home, so a',
          'credential file here would not reach it. Put a 24 h token in the',
          "runner's secret store instead.",
          ...SET_UP_BY_HAND,
        ],
      };
    default:
      return {
        kind: 'refused',
        why: [
          `The helper has no setup for "${slug}": it would be MCP only, configured by hand.`,
          ...SET_UP_BY_HAND,
        ],
      };
  }
}

const USAGE = [
  'laika tool add <harness> --exchange <id> [--no-hooks] [--dry-run]',
  '',
  'Install one tool’s own credential on this paired device. Start in the',
  'browser (Developer access → a device → Add tool); it shows this command.',
  '',
  '  --no-hooks  do not install session hooks (Claude Code, Codex)',
  '  --dry-run   say what would happen; redeem nothing, write nothing',
].join('\n');

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export async function tool(argv: readonly string[], io: ToolAddIo = CONSOLE): Promise<number> {
  const sub = argv[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    io.out(USAGE);
    return sub === undefined ? 1 : 0;
  }
  if (sub !== 'add') {
    io.err(`laika tool: unknown command "${sub}"\n\n${USAGE}`);
    return 1;
  }
  return add(argv.slice(1), io);
}

/** The lines `tool add` would act on, for `--dry-run` and the plan it prints first. */
function describe(plan: Exclude<ToolPlan, { kind: 'refused' }>, hooks: boolean): string[] {
  const h = plan.harness;
  const lines = [`  credential  ~/.laika/agents/${h}.json (0600), this tool's own token`];
  if (h === 'claude-code') {
    lines.push(
      '  mcp         ~/.claude.json mcpServers.laika → reads ~/.laika/agents/claude-code.json',
      '  first       quit Claude Code: this rewrites ~/.claude.json, which a running one also writes',
    );
  }
  if (plan.kind === 'mcp-manual')
    lines.push('  mcp         set up by hand — the exact step is printed');
  if (h === 'codex') {
    lines.push(`  mcp         ~/.codex/config.toml [mcp_servers.laika] → ${CODEX_TOKEN_VAR}`);
    lines.push(`  shell       an export of ${CODEX_TOKEN_VAR} from the credential file`);
  }
  if (plan.kind === 'full' && hooks)
    lines.push(`  hooks       laika agent hooks on --harness ${h}`);
  lines.push('  untouched   ~/.laika/env, other tools’ credentials, every repository');
  return lines;
}

async function add(argv: readonly string[], io: ToolAddIo): Promise<number> {
  const slug = argv[0];
  const exchange = option(argv, '--exchange');
  const noHooks = argv.includes('--no-hooks');
  const dryRun = argv.includes('--dry-run');
  if (slug === undefined || slug.startsWith('-') || exchange === undefined || exchange === '') {
    io.err(`laika tool add: name the tool and --exchange <id>\n\n${USAGE}`);
    return 1;
  }

  const plan = planFor(slug);
  if (plan.kind === 'refused') {
    io.err(`laika tool add: not set up — ${slug}`);
    for (const line of plan.why) io.err(`  ${line}`);
    return 1;
  }

  const paired = readDevice(io.home);
  const key = readDeviceKey(io.home);
  const deviceId = paired?.device_id ?? null;
  if (paired === undefined || deviceId === null || key === undefined) {
    io.err('laika tool add: this machine is not paired with a board yet.');
    io.err('  Run `laika device pair` with the command the browser shows under Add device.');
    return 1;
  }
  const origin = paired.board;
  const hooks = plan.kind === 'full' && !noHooks;

  const gate = await featureGate(io, origin, 'tool_setup_exchange');
  if (gate.kind === 'refused') {
    io.err(`laika tool add: ${gate.message}. Nothing was redeemed or written.`);
    return 1;
  }

  io.out(`${dryRun ? 'Would set up' : 'Setting up'} ${ADAPTERS[plan.harness].name} on ${origin}:`);
  for (const line of describe(plan, hooks)) io.out(line);
  if (dryRun) {
    io.out('');
    io.out('Dry run: nothing was redeemed and nothing was written.');
    return 0;
  }

  const redeemUrl = `${origin}/api/v1/tool-setup/${encodeURIComponent(exchange)}/redeem`;
  const challenge = await postJson(io, redeemUrl, { device_id: deviceId });
  const asked = challengeAnswer(challenge, origin);
  if (typeof asked === 'string') {
    io.err(`laika tool add: ${asked}`);
    return 1;
  }
  const signature = signWith(key, toolRedeemMessage(exchange, deviceId, asked.challenge, origin));
  const redeemed = redeemAnswer(
    await postJson(io, redeemUrl, { device_id: deviceId, signature }),
    origin,
  );
  if (typeof redeemed === 'string') {
    io.err(`laika tool add: ${redeemed}`);
    return 1;
  }

  // **The minted agent decides where the token may go, never the typed name**
  // (review S1). An exchange made for another tool is a command copied from
  // the wrong row: nothing is set up for the tool typed here.
  const minted = planFor(redeemed.agentHarness);
  if (minted.kind === 'refused') {
    io.err(
      `laika tool add: this setup was made for ${redeemed.agentHarness}, not ${slug}, and ` +
        `${redeemed.agentHarness} cannot be set up here — nothing was saved.`,
    );
    io.err('  The token it minted is unused; disconnect that tool in the browser, and connect');
    io.err('  it with a personal token from Developer access → Advanced in its own MCP settings.');
    return 1;
  }
  if (minted.harness !== plan.harness) {
    saveCredential(io, minted.harness, redeemed, deviceId);
    io.err(
      `laika tool add: this setup was made for ${redeemed.agentHarness}, not ${slug}. Its ` +
        `credential is saved as ~/.laika/agents/${minted.harness}.json and nothing was set up for ${slug}.`,
    );
    io.err(
      `  Run the command from ${ADAPTERS[minted.harness].name}'s row to finish setting it up.`,
    );
    return 1;
  }
  const target = plan.harness;
  saveCredential(io, target, redeemed, deviceId);

  const installed: AgentHookReport[] = [];
  let mcp: ClaudeMcp = target === 'codex' ? 'tool' : 'none';
  if (target === 'codex') codexMcp(io, redeemed.boardOrigin);
  if (target === 'claude-code') mcp = claudeMcp(io, redeemed.boardOrigin);
  if ((target === 'claude-code' || target === 'codex') && hooks) {
    const report = installAgentHooks(io.home, AGENT_HOOK_SCRIPT, target);
    installed.push(report);
    const mark = report.status === 'refused' || report.status === 'unsupported' ? '!' : '✓';
    io.out(`  ${mark} hooks: ${report.summary}`);
    for (const line of report.detail ?? []) io.out(`      ${line}`);
  }

  const hooksOn = installed.some((r) => r.status === 'installed' || r.status === 'unchanged');
  if (gate.features === undefined || gate.features.client_reports === true) {
    await clientReport(io, redeemed.boardOrigin, redeemed.secret, hooksOn);
  } else {
    io.out('  · the board does not take client reports yet; the setup stands');
  }

  io.out('');
  if (plan.kind === 'mcp-manual') {
    for (const line of manualMcp(target, redeemed.boardOrigin)) io.out(line);
    io.out('');
  }
  for (const line of nextSteps(target, hooksOn, mcp)) io.out(line);
  return 0;
}

/**
 * The token, into the one file it belongs in. A file it replaces is kept as
 * `<harness>.json.bak` whenever it differs from what is written, so the last
 * credential there before this one is always recoverable.
 */
function saveCredential(
  io: ToolAddIo,
  harness: Harness,
  redeemed: Redeemed,
  deviceId: string,
): void {
  const path = credentialPath(io.home, harness);
  const extra = { agent_id: redeemed.agentId, device_id: deviceId, source: 'tool-add' };
  const next = `${JSON.stringify({ url: redeemed.boardOrigin, token: redeemed.secret, ...extra }, null, 2)}\n`;
  if (existsSync(path)) {
    const before = readFileSync(path, 'utf8');
    if (before !== next) writePrivate(`${path}.bak`, before);
  }
  writeCredential(io.home, harness, { url: redeemed.boardOrigin, token: redeemed.secret }, extra);
  io.out(`  ✓ credential saved in ~/.laika/agents/${harness}.json (0600)`);
}

/* -------------------------------------------------------------------------- */
/* Redeeming                                                                  */
/* -------------------------------------------------------------------------- */

const REDEEM_REFUSED: Readonly<Record<string, string>> = {
  exchange_redeemed: 'this setup was already used. Add the tool again in the browser.',
  exchange_expired: 'this setup expired (ten minutes). Add the tool again in the browser.',
  exchange_cancelled:
    'this setup was cancelled or replaced. Copy the newest command from the browser.',
  agent_revoked: 'that tool was disconnected on the board. Add it again in the browser.',
  device_revoked: 'this device was revoked on the board. Pair it again.',
  device_signature_invalid:
    "the board did not accept this machine's signature — is this the device the browser chose?",
};

function refused(answer: Parameters<typeof commonRefusal>[0], origin: string): string | undefined {
  const common = commonRefusal(answer, origin);
  if (common !== undefined) return common;
  if (answer.kind !== 'json') return `unexpected answer from ${origin}`;
  const reason = reasonOf(answer.body);
  if (reason !== undefined && reason in REDEEM_REFUSED) return REDEEM_REFUSED[reason];
  if (answer.status === 404) {
    return 'the board has no such setup for this device. Copy the command again from the browser, on the device it was made for.';
  }
  return undefined;
}

function challengeAnswer(
  answer: Parameters<typeof commonRefusal>[0],
  origin: string,
): { readonly challenge: string } | string {
  const why = refused(answer, origin);
  if (why !== undefined) return why;
  if (answer.kind !== 'json' || answer.status !== 200 || !isRecord(answer.body)) {
    return `the board refused (${answer.kind === 'json' ? String(answer.status) : 'no JSON'})`;
  }
  const { challenge } = answer.body;
  if (typeof challenge !== 'string' || challenge === '') return 'the board sent no challenge';
  return { challenge };
}

interface Redeemed {
  readonly secret: string;
  readonly agentId: string;
  readonly agentHarness: string;
  readonly boardOrigin: string;
}

function redeemAnswer(
  answer: Parameters<typeof commonRefusal>[0],
  origin: string,
): Redeemed | string {
  const why = refused(answer, origin);
  if (why !== undefined) return why;
  if (answer.kind !== 'json' || answer.status !== 201 || !isRecord(answer.body)) {
    return `the board refused (${answer.kind === 'json' ? String(answer.status) : 'no JSON'})`;
  }
  const { secret, agent, board_origin: boardOrigin } = answer.body;
  if (
    typeof secret !== 'string' ||
    secret === '' ||
    !isRecord(agent) ||
    typeof agent.id !== 'string' ||
    typeof agent.harness !== 'string'
  ) {
    return "the board's answer is missing fields; nothing was saved";
  }
  return {
    secret,
    agentId: agent.id,
    agentHarness: agent.harness,
    boardOrigin: typeof boardOrigin === 'string' && boardOrigin !== '' ? boardOrigin : origin,
  };
}

/* -------------------------------------------------------------------------- */
/* Per tool                                                                   */
/* -------------------------------------------------------------------------- */

export function codexBlock(url: string): string {
  return `[mcp_servers.laika]\nurl = ${JSON.stringify(`${url}/mcp`)}\nbearer_token_env_var = "${CODEX_TOKEN_VAR}"\n`;
}

/**
 * The rc line: reads the token out of Codex's own credential file when a shell
 * starts, so the secret is in no file but that 0600 one. Every child of the
 * shell can see an exported variable — isolation per tool is per file, not
 * per process (plan §L).
 */
export const CODEX_RC_LINE = tokenExportLine('codex', CODEX_TOKEN_VAR);

function codexMcp(io: ToolAddIo, url: string): void {
  const prepared = prepare({
    kind: 'toml',
    path: join(io.home, '.codex', 'config.toml'),
    block: codexBlock(url),
  });
  if (!prepared.ok) {
    io.out(`  ! mcp: ${prepared.message}`);
  } else if (prepared.status === 'kept') {
    io.out(`  · mcp: ${prepared.path} already has [mcp_servers.laika] — kept as it is.`);
    io.out(`      To use this tool's own credential, set in that table:`);
    io.out(`        bearer_token_env_var = "${CODEX_TOKEN_VAR}"`);
  } else if (prepared.status === 'unsure') {
    io.out(
      `  ! mcp: ${prepared.path} may already define laika in a form not read here — left alone.`,
    );
    io.out('      If it does not, add:');
    for (const line of codexBlock(url).trimEnd().split('\n')) io.out(`        ${line}`);
  } else {
    const backup = apply(prepared);
    io.out(
      `  ✓ mcp: [mcp_servers.laika] ${prepared.status} in ${prepared.path}` +
        `${backup === undefined ? '' : ` (backup: ${backup})`}`,
    );
  }

  const rc = rcFileFor(io.shell, io.home);
  const existing = existsSync(rc) ? readFileSync(rc, 'utf8') : undefined;
  if (existing?.includes(CODEX_RC_MARKER) === true) {
    io.out(`  · shell: ${CODEX_TOKEN_VAR} is already exported by ${rc}`);
    return;
  }
  const backup = `${rc}.laika-backup`;
  const madeBackup = existing !== undefined && !existsSync(backup);
  if (madeBackup) copyFileSync(rc, backup);
  const lead =
    existing === undefined || existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(rc, `${lead}${CODEX_RC_MARKER}\n${CODEX_RC_LINE}\n`);
  io.out(
    `  ✓ shell: ${rc} exports ${CODEX_TOKEN_VAR} from the credential file` +
      `${madeBackup ? ` (backup: ${backup})` : ''}`,
  );
}

/**
 * What came of Claude Code's MCP entry: `tool` — `mcpServers.laika` reads this
 * tool's credential; `kept` — the person's own `laika` entry stays, and it
 * decides who Claude Code acts as; `none` — nothing could be written.
 */
export type ClaudeMcp = 'tool' | 'kept' | 'none';

/** The JSON of the tool entry, indented for printing. */
function printEntry(io: ToolAddIo, entry: Record<string, string>): void {
  for (const line of JSON.stringify({ laika: entry }, null, 2).split('\n'))
    io.out(`        ${line}`);
}

/**
 * Claude Code's Laika MCP entry, merged into `~/.claude.json` the way
 * `laika connect` merges a JSON config (`prepare`/`apply`): every other key
 * and server is kept, the original is backed up once beside it, a file that
 * does not parse is left alone, a symlink is written through. An entry this
 * command wrote before (any helper revision) is brought up to date. **Any
 * other `mcpServers.laika` is kept** — it may be the person's own — and it,
 * not this tool's credential, decides who Claude Code acts as; how to switch
 * is printed. The file is read back after writing (LAI-1074).
 */
function claudeMcp(io: ToolAddIo, url: string): ClaudeMcp {
  const entry = claudeToolEntry(url);
  const where = claudeJsonPath(io.home);
  if ('refused' in where) {
    io.out(`  ! mcp: ${where.refused}.`);
    io.out('      MCP set up by hand: add this under "mcpServers" in the file it should point to:');
    printEntry(io, entry);
    return 'none';
  }
  const path = where.path;
  const via = path === join(io.home, '.claude.json') ? '' : ` (through the symlink ~/.claude.json)`;
  const prepared = prepare({ kind: 'json', path, container: 'mcpServers', entry, secret: true });
  if (!prepared.ok) {
    io.out(`  ! mcp: ${prepared.message.split('\n').join(' ')}`);
    io.out('      MCP set up by hand: add this under "mcpServers" in ~/.claude.json:');
    printEntry(io, entry);
    return 'none';
  }
  if (prepared.status === 'unchanged') {
    io.out(`  · mcp: ${prepared.path}${via} already has this tool's laika entry`);
    return 'tool';
  }
  if (prepared.status === 'replaced' && !isToolEntry(existingLaika(path))) {
    io.out(`  · mcp: ${prepared.path}${via} already has its own mcpServers.laika — kept as it is.`);
    io.out('      That entry, not this tool’s credential, decides who Claude Code acts as on');
    io.out('      Laika — under `laika-claude` too, whose own laika server it overrides.');
    io.out("      To switch it to this tool's own credential, with Claude Code quit:");
    io.out('        claude mcp remove laika --scope user');
    io.out(`        claude mcp add-json laika --scope user '${JSON.stringify(entry)}'`);
    io.out('      or replace the entry in that file with:');
    printEntry(io, entry);
    return 'kept';
  }
  const backup = apply(prepared);
  if (!holdsEntry(path, entry)) {
    io.out(`  ! mcp: ${path}${via} does not hold the laika entry after writing it — something`);
    io.out('      rewrote the file, most likely a running Claude Code. Quit Claude Code, then');
    io.out('      add this under "mcpServers" in ~/.claude.json, or run a new setup command:');
    printEntry(io, entry);
    return 'none';
  }
  io.out(
    `  ✓ mcp: mcpServers.laika ${prepared.status === 'replaced' ? 'updated' : prepared.status} in ${prepared.path}${via}, reading this tool's credential` +
      `${backup === undefined ? '' : ` (backup: ${backup})`}`,
  );
  return 'tool';
}

/** The `mcpServers.laika` already in `path`, if any. */
function existingLaika(path: string): unknown {
  try {
    const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers.laika : undefined;
  } catch {
    return undefined;
  }
}

/** Where a hand-set MCP entry goes, per tool `tool add` cannot configure itself. */
export function manualMcp(harness: Harness, url: string): string[] {
  const variable = tokenVar(harness);
  const mcpUrl = `${url}/mcp`;
  const head = `MCP set up by hand — ${ADAPTERS[harness].name} reads this tool's credential through ${variable}:`;
  const env = [
    `  1. Add this line to your shell's rc file, then open a new terminal:`,
    `       ${tokenExportLine(harness, variable)}`,
  ];
  const json = (entry: unknown): string[] =>
    JSON.stringify({ laika: entry }, null, 2)
      .split('\n')
      .map((line) => `       ${line}`);
  switch (harness) {
    case 'cursor':
      return [
        head,
        ...env,
        '  2. Add this under "mcpServers" in ~/.cursor/mcp.json, and start Cursor from that terminal:',
        ...json({ url: mcpUrl, headers: { Authorization: `Bearer \${env:${variable}}` } }),
      ];
    case 'gemini-cli':
      return [
        head,
        ...env,
        '  2. Add this under "mcpServers" in ~/.gemini/settings.json:',
        ...json({
          type: 'http',
          url: mcpUrl,
          headers: { Authorization: `Bearer \${${variable}}` },
        }),
      ];
    case 'copilot-vscode':
      return [
        head,
        ...env,
        '  2. Run this once, then start VS Code from that terminal:',
        `       code --add-mcp '${JSON.stringify({ name: 'laika', type: 'http', url: mcpUrl, headers: { Authorization: `Bearer \${env:${variable}}` } })}'`,
      ];
    default:
      return [
        head,
        ...env,
        `  2. Point ${ADAPTERS[harness].name}'s MCP settings at ${mcpUrl} with that variable.`,
      ];
  }
}

/**
 * The browser's check for a tool's own first request — `tool-readiness.ts`'s
 * `${name} connected`, with the board's name for the tool (`AGENT_CLIENT_NAMES`):
 * the board calls Copilot in VS Code *VS Code*.
 */
export const connectedCheck = (harness: Harness): string =>
  `${harness === 'copilot-vscode' ? 'VS Code' : ADAPTERS[harness].name} connected`;

function nextSteps(harness: Harness, hooksOn: boolean, mcp: ClaudeMcp): string[] {
  switch (harness) {
    case 'claude-code':
      return [
        ...(mcp === 'tool'
          ? [
              'Next: quit Claude Code and start it again — `laika-claude` (with the Laika',
              "commands) or plain `claude`. Its Laika MCP entry uses this tool's own credential.",
            ]
          : mcp === 'kept'
            ? [
                'Next: quit Claude Code and start it again. Its Laika tools act as whoever your',
                'own mcpServers.laika entry says — with `laika-claude` too — until you switch it',
                'as shown above.',
              ]
            : [
                'Next: quit Claude Code and start it again with `laika-claude`, which uses this',
                "tool's own credential unless ~/.claude.json defines a laika server of its own;",
                'plain `claude` gets no Laika tools until the entry above is set.',
              ]),
        `Then ask it to call laika_whoami — the browser ticks "${connectedCheck(harness)}".`,
        ...(hooksOn ? [] : ['Hooks are off: no sessions, claims or automatic checkpoints.']),
      ];
    case 'codex':
      return [
        `Next: open a new terminal (so ${CODEX_TOKEN_VAR} is set), start codex, and`,
        ...(hooksOn
          ? ['trust the Laika hooks in /hooks — Codex runs a new hook only once you do.']
          : ['note hooks are off: no sessions, claims or automatic checkpoints.']),
        `Then ask it to call laika_whoami — the browser ticks "${connectedCheck(harness)}".`,
      ];
    case 'omnigent':
      return [
        'Omnigent is credential only: no hooks, no sessions, no automatic checkpoints.',
        'Point its MCP config at the board by hand (laika connect omnigent --dir <agent>',
        'prints the sidecar). A ${VAR} in that file which Omnigent’s server cannot see',
        'stops every turn, so set the variable where Omnigent runs before you add it.',
      ];
    default:
      return [
        `${ADAPTERS[harness].name}: MCP only — reads and writes tasks; no session claims or`,
        'automatic checkpoints. Its MCP entry is set up by hand (above) and is',
        'Documented-not-tested (cli/agent-adapters/CAPABILITIES.md).',
        `Then ask it to call laika_whoami — the browser ticks "${connectedCheck(harness)}".`,
      ];
  }
}

/**
 * What this helper is, sent with the tool's own token (§4.81, `client-report.ts`).
 * A failure is reported and does not undo the setup.
 */
async function clientReport(
  io: ToolAddIo,
  url: string,
  token: string,
  hooksOn: boolean,
): Promise<void> {
  const info = versionInfo();
  const outcome = reportOutcome(
    await sendClientReport(
      io,
      url,
      token,
      { version: info.version, commit: info.commit, protocol: PROTOCOL },
      hooksOn,
    ),
  );
  io.out(
    outcome === 'sent'
      ? '  ✓ reported this helper’s version to the board'
      : `  · could not report this helper’s version (${outcome}); the setup stands`,
  );
}
