import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { type AgentHookReport, installAgentHooks } from './agent-hooks.ts';
import { ADAPTERS, type Harness } from './agent-adapters.ts';
import { claudeJsonPath, holdsEntry, isToolEntry } from './claude-mcp.ts';
import {
  agentsDir,
  credentialPath,
  isRecord,
  writeCredential,
  writePrivate,
} from './agent-session.ts';
import { bridgeCommand } from './agent-mcp-bridge.ts';
import {
  LAIKA_POLLY,
  laikaPollyDir,
  omniOnPath,
  omniVersion,
  pollySource,
  SUPPORTED_OMNIGENT,
} from './agent-omnigent.ts';
import { AGENT_HOOK_SCRIPT } from './agent-setup.ts';
import { codexLaikaLines, omnigentSidecar } from './agents.ts';
import {
  CLAUDE_HEADERS_HELPER,
  CODEX_HEADERS_HELPER,
  CODEX_HELPER_LINE,
  headersHelper,
  isSwitchingCodexTable,
} from './mcp-headers.ts';
import { reportOutcome, sendClientReport } from './client-report.ts';
import { apply, prepare, rcFileFor } from './connect.ts';
import {
  boardOriginOf,
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
import { confirm } from './prompt.ts';
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
  /** Where `omni` and Node are looked for; `process.env` when absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** A yes/no for a step that changes another program's state; absent is no. */
  readonly confirm?: (question: string) => Promise<boolean>;
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
  env: process.env,
  ...(process.stdin.isTTY === true ? { confirm: (question: string) => confirm(question) } : {}),
};

/** How `tool add` sets up a tool, by the board's harness slug (§4.63). */
export type ToolPlan =
  | { readonly kind: 'full'; readonly harness: Harness }
  | { readonly kind: 'credential-only'; readonly harness: Harness }
  | { readonly kind: 'mcp-manual'; readonly harness: Harness }
  | { readonly kind: 'refused'; readonly why: readonly string[] };

/**
 * The variable an older `tool add codex` pointed Codex's MCP entry at, and
 * exported from the shell rc (LAI-1060). Replaced by
 * {@link CODEX_HEADERS_HELPER} (LAI-1101): an exported token reaches every
 * child of every shell, and a launcher-started Codex has no shell rc at all
 * (D-117a item 6). Kept only to recognise, and retire, what it wrote.
 */
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
 * The headers helpers live in `mcp-headers.ts`, so the hook path can tell
 * whether a harness's MCP follows Omnigent runs without loading this module
 * (LAI-1101 review B1). Re-exported for the callers and tests that knew them
 * here.
 */
export { CLAUDE_HEADERS_HELPER, CODEX_HEADERS_HELPER, headersHelper };

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
  '  --from DIR  Omnigent: the polly agent folder to copy (default: the installed one)',
  '  --yes       Omnigent: run `omni agent add` without asking',
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
    lines.push(
      '  mcp         ~/.codex/config.toml [mcp_servers.laika] → http_headers_helper reads ~/.laika/agents/codex.json',
    );
    lines.push(`  shell       an older ${CODEX_TOKEN_VAR} export this command added is removed`);
  }
  if (h === 'omnigent') {
    lines.push(
      `  agent       a copy of Omnigent’s polly in ~/.laika/omnigent/${LAIKA_POLLY} (named ${LAIKA_POLLY}); a copy already there is kept as .bak-<time>`,
      '  mcp         its tools/mcp/laika.yaml runs `laika agent mcp-bridge` by absolute path — no ${VAR}',
      `  omnigent    omni agent add ~/.laika/omnigent/${LAIKA_POLLY}, once you say yes`,
      '  switch      a laika MCP entry tool add wrote in ~/.claude.json or ~/.codex/config.toml',
      '              now follows Omnigent runs (backed up); any other is left alone and named',
    );
  }
  if (plan.kind === 'full' && hooks)
    lines.push(`  hooks       laika agent hooks on --harness ${h}`);
  lines.push(
    '  also        another credential file for this board, only if this setup revokes its token',
  );
  lines.push('  untouched   ~/.laika/env, every other tool’s credential, every repository');
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
  // Other credential files for this board that work now (LAI-1088): any of them
  // that stops working once the exchange is redeemed held this agent's token,
  // and is brought along instead of being left with a revoked one.
  const siblings = await liveSiblings(io, origin, plan.harness);
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
  await bringAlong(io, siblings, origin, redeemed);

  const omnigent = target === 'omnigent' ? await omnigentAgent(io, argv) : 'none';
  if (target === 'omnigent') followOmnigent(io);

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
    await clientReport(
      io,
      redeemed.boardOrigin,
      redeemed.secret,
      hooksOn,
      ADAPTERS[target].agentHarness,
    );
  } else {
    io.out('  · the board does not take client reports yet; the setup stands');
  }

  io.out('');
  if (plan.kind === 'mcp-manual') {
    for (const line of manualMcp(target, redeemed.boardOrigin)) io.out(line);
    io.out('');
  }
  for (const line of nextSteps(target, hooksOn, mcp, omnigent)) io.out(line);
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

/** Another credential file under `~/.laika/agents/`, and the token it holds. */
interface Sibling {
  readonly name: string;
  readonly path: string;
  readonly token: string;
}

/**
 * Credential files beside this tool's own whose token works on this board
 * right now (LAI-1088). A manager such as Omnigent can read its token from a
 * file of its own (`polly.json`, LAI-589) rather than `<harness>.json`;
 * redeeming revokes every live token of the agent, so such a file would be
 * left holding a revoked one and everything reading it would get `401`.
 *
 * Only plain files directly in the directory, for this board's URL, are
 * asked about — never a symlink, never a backup — and each token goes only to
 * this board, in the `Authorization` header of a `GET /api/v1/me`.
 */
async function liveSiblings(io: ToolAddIo, origin: string, harness: Harness): Promise<Sibling[]> {
  const dir = agentsDir(io.home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: Sibling[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || name === `${harness}.json`) continue;
    const path = join(dir, name);
    try {
      if (!lstatSync(path).isFile()) continue;
    } catch {
      continue;
    }
    let saved: unknown;
    try {
      saved = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(saved) || typeof saved.token !== 'string' || saved.token === '') continue;
    if (typeof saved.url !== 'string' || boardOriginOf(saved.url) !== boardOriginOf(origin)) {
      continue;
    }
    if ((await tokenAnswers(io, origin, saved.token)) === 200) {
      found.push({ name, path, token: saved.token });
    }
  }
  return found;
}

/** What `GET /api/v1/me` answers this token with: the status, or `0` unreachable. */
async function tokenAnswers(io: ToolAddIo, origin: string, token: string): Promise<number> {
  try {
    const response = await io.fetch(`${origin}/api/v1/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.status;
  } catch {
    return 0;
  }
}

/**
 * Each sibling whose token the board now refuses (`401`) held this agent's
 * previous credential — redeeming revokes only this agent's, and the two
 * answers are seconds apart — so it gets the new one, its other fields kept,
 * the old file kept as `<name>.bak`. A token still working, any other answer,
 * or a board not answering leaves the file as it was.
 *
 * **Only ever the paired board** (review round 1): the tokens go to `origin`,
 * the board this machine was paired with, never to the origin a redeem answer
 * names — and if that answer names another board, nothing is brought along.
 */
async function bringAlong(
  io: ToolAddIo,
  siblings: readonly Sibling[],
  origin: string,
  redeemed: Redeemed,
): Promise<void> {
  if (siblings.length === 0) return;
  if (boardOriginOf(redeemed.boardOrigin) !== boardOriginOf(origin)) {
    io.out('  · the board named another address; no other credential file was touched');
    return;
  }
  for (const sibling of siblings) {
    if ((await tokenAnswers(io, origin, sibling.token)) !== 401) continue;
    try {
      const before = readFileSync(sibling.path, 'utf8');
      const saved = JSON.parse(before) as unknown;
      // Read again, so a file changed since it was asked about is left alone.
      if (!isRecord(saved) || saved.token !== sibling.token) continue;
      const next = `${JSON.stringify({ ...saved, token: redeemed.secret }, null, 2)}\n`;
      writePrivate(`${sibling.path}.bak`, before);
      writePrivate(sibling.path, next);
      io.out(
        `  ✓ also updated ~/.laika/agents/${sibling.name}, which held this tool’s previous credential (0600)`,
      );
    } catch {
      io.out(
        `  ! could not update ~/.laika/agents/${sibling.name}: it still holds this tool’s revoked credential; copy the new one from the tool’s own file there`,
      );
    }
  }
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
  return `[mcp_servers.laika]\nurl = ${JSON.stringify(`${url}/mcp`)}\n${CODEX_HELPER_LINE}\n`;
}

/**
 * The table an older `tool add codex` wrote (LAI-1060), exactly: it is this
 * command's to bring up to date. Any other `[mcp_servers.laika]` is the
 * person's, and is kept.
 */
const OLDER_CODEX_BLOCK = new RegExp(
  `^\\[mcp_servers\\.laika\\]\\nurl = "[^"\\n]*/mcp"\\nbearer_token_env_var = "${CODEX_TOKEN_VAR}"\\n`,
  'm',
);

/**
 * The rc line an older `tool add codex` appended, under its marker: it read
 * the token out of Codex's credential file and exported it to every shell.
 */
export const CODEX_RC_LINE = tokenExportLine('codex', CODEX_TOKEN_VAR);

function codexMcp(io: ToolAddIo, url: string): void {
  const path = join(io.home, '.codex', 'config.toml');
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const older = raw === undefined ? null : OLDER_CODEX_BLOCK.exec(raw);
  const prepared =
    raw !== undefined && older !== null
      ? ({
          ok: true,
          path,
          status: 'replaced',
          content: raw.replace(OLDER_CODEX_BLOCK, codexBlock(url)),
          existed: true,
          secret: false,
        } as const)
      : prepare({ kind: 'toml', path, block: codexBlock(url) });
  if (!prepared.ok) {
    io.out(`  ! mcp: ${prepared.message}`);
  } else if (prepared.status === 'kept') {
    io.out(`  · mcp: ${prepared.path} already has [mcp_servers.laika] — kept as it is.`);
    io.out(`      To use this tool's own credential, put this in that table instead:`);
    io.out(`        http_headers_helper = ${JSON.stringify(CODEX_HEADERS_HELPER)}`);
  } else if (prepared.status === 'unsure') {
    io.out(
      `  ! mcp: ${prepared.path} may already define laika in a form not read here — left alone.`,
    );
    io.out('      If it does not, add:');
    for (const line of codexBlock(url).trimEnd().split('\n')) io.out(`        ${line}`);
  } else {
    const backup = apply(prepared);
    io.out(
      `  ✓ mcp: [mcp_servers.laika] ${older === null ? prepared.status : 'brought up to date'} in ${prepared.path}, ` +
        `reading this tool's credential through http_headers_helper` +
        `${backup === undefined ? '' : ` (backup: ${backup})`}`,
    );
  }
  retireRcExport(io);
}

/**
 * Removes the export an older `tool add codex` appended — its marker line and
 * the line under it, exactly, and nothing else. Codex reads its token through
 * `http_headers_helper` now, so the token need be in no shell's environment
 * (D-117a item 6). The file is backed up first, once, as before.
 */
function retireRcExport(io: ToolAddIo): void {
  const rc = rcFileFor(io.shell, io.home);
  const existing = existsSync(rc) ? readFileSync(rc, 'utf8') : undefined;
  const block = `${CODEX_RC_MARKER}\n${CODEX_RC_LINE}\n`;
  if (!existing?.includes(block)) return;
  const backup = `${rc}.laika-backup`;
  const madeBackup = !existsSync(backup);
  if (madeBackup) copyFileSync(rc, backup);
  // The blank line the append put before the marker goes with it.
  const at = existing.indexOf(block);
  const from = at >= 2 && existing.slice(at - 2, at) === '\n\n' ? at - 1 : at;
  writeFileSync(rc, existing.slice(0, from) + existing.slice(at + block.length));
  io.out(
    `  ✓ shell: removed the ${CODEX_TOKEN_VAR} export from ${rc} — Codex no longer needs it` +
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

function nextSteps(
  harness: Harness,
  hooksOn: boolean,
  mcp: ClaudeMcp,
  omnigent: OmnigentAgent,
): string[] {
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
        'Next: start codex (a new terminal is not needed: it reads its credential file), and',
        ...(hooksOn
          ? ['trust the Laika hooks in /hooks — Codex runs a new hook only once you do.']
          : ['note hooks are off: no sessions, claims or automatic checkpoints.']),
        `Then ask it to call laika_whoami — the browser ticks "${connectedCheck(harness)}".`,
      ];
    case 'omnigent':
      return [
        ...(omnigent === 'installed'
          ? [
              'Next: quit Omnigent fully (Omnigent menu → Quit, not just the window) and open it',
              `again, then start ${LAIKA_POLLY} and ask it to call laika_whoami — the browser ticks`,
              `"${connectedCheck(harness)}".`,
            ]
          : omnigent === 'copied'
            ? [
                `Next: install it — omni agent add ~/.laika/omnigent/${LAIKA_POLLY} — then quit`,
                'Omnigent fully (Omnigent menu → Quit, not just the window) and open it again.',
                `Start ${LAIKA_POLLY} and ask it to call laika_whoami — the browser ticks`,
                `"${connectedCheck(harness)}".`,
              ]
            : [
                'No polly was set up, so Omnigent cannot reach the board yet. No new exchange is',
                'needed: write the sidecar into an agent folder of your own (a copy of polly with',
                'no symlinks), then install it —',
                '  laika connect omnigent --dir <agent-folder>',
                '  omni agent add <agent-folder>',
              ]),
        'Its sessions open through Claude Code’s hooks (polly runs on claude-sdk): run',
        '`laika agent hooks on --harness claude-code` if you have not.',
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

/* -------------------------------------------------------------------------- */
/* Omnigent                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What came of Omnigent's agent: `installed` — copied, and `omni agent add`
 * succeeded; `copied` — the folder is ready and the person installs it;
 * `none` — nothing could be set up.
 */
export type OmnigentAgent = 'installed' | 'copied' | 'none';

/** The environment `omni agent add` runs with: what it needs, and no token of any name. */
const OMNI_ENV = ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL'];

/** The first symlink under `dir`, or `undefined`; `dir` itself is already resolved. */
function firstSymlink(dir: string): string | undefined {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return path;
    if (stat.isDirectory()) {
      const inner = firstSymlink(path);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/**
 * Claude Code's and Codex's Laika MCP entries, brought to the helpers that
 * follow an Omnigent run to `~/.laika/agents/omnigent.json` (LAI-1101 review
 * B1, CHIEF's decision (a)). The board refuses a claim whose session is
 * another agent's, so an Omnigent worker's hooks and its MCP must speak as
 * the same agent: the hooks switch only when the MCP entry is the switching
 * helper (`hookCredential`, decision (b)), and here every entry `tool add`
 * itself wrote becomes that helper, so the switch happens where it can.
 *
 * - An `mcpServers.laika` in `~/.claude.json` that `tool add` wrote, any
 *   helper revision (`isToolEntry`), gets the current helper; its URL kept,
 *   the file backed up once as `.bak`, read back after writing.
 * - A `[mcp_servers.laika]` in `~/.codex/config.toml` exactly as an older
 *   `tool add codex` wrote it (`bearer_token_env_var =
 *   "LAIKA_AGENT_TOKEN_CODEX"`) gets the helper line instead, the file backed
 *   up once, and that command's shell-rc export removed.
 * - **Any other `laika` entry is left alone and named**: it is the person's,
 *   and that harness keeps acting as itself inside Omnigent, hooks included.
 *
 * Needs no token and no exchange: it reads and rewrites the two files only.
 */
export function followOmnigent(io: ToolAddIo): void {
  const where = claudeJsonPath(io.home);
  if ('refused' in where) {
    io.out(`  ! claude code: ${where.refused}.`);
  } else {
    const path = where.path;
    const laika = existingLaika(path);
    if (laika === undefined) {
      // No Laika entry: Claude Code has no Laika MCP to switch.
    } else if (
      isRecord(laika) &&
      laika.headersHelper === CLAUDE_HEADERS_HELPER &&
      isToolEntry(laika)
    ) {
      io.out(`  · claude code: mcpServers.laika in ${path} already follows Omnigent runs`);
    } else if (isToolEntry(laika) && isRecord(laika) && typeof laika.url === 'string') {
      const entry = { type: 'http', url: laika.url, headersHelper: CLAUDE_HEADERS_HELPER };
      const prepared = prepare({
        kind: 'json',
        path,
        container: 'mcpServers',
        entry,
        secret: true,
      });
      if (!prepared.ok) {
        io.out(`  ! claude code: ${prepared.message.split('\n').join(' ')}`);
      } else {
        const backup = apply(prepared);
        if (holdsEntry(path, entry)) {
          io.out(
            `  ✓ claude code: mcpServers.laika in ${path} now follows Omnigent runs` +
              `${backup === undefined ? '' : ` (backup: ${backup})`}; restart Claude Code`,
          );
        } else {
          io.out(
            `  ! claude code: ${path} does not hold the new entry after writing it — a running`,
          );
          io.out(
            '      Claude Code most likely wrote its own copy back. Quit it and run this again.',
          );
        }
      }
    } else {
      io.out(
        `  ! claude code: ${path} has an mcpServers.laika that laika tool add did not write — left alone.`,
      );
      io.out(
        '      Inside Omnigent, Claude Code keeps acting as its own agent, hooks and MCP alike.',
      );
      io.out('      To have it act as the Omnigent agent there, switch that entry to Laika’s:');
      io.out('      `laika tool add claude-code` prints how.');
    }
  }

  const toml = join(io.home, '.codex', 'config.toml');
  const raw = existsSync(toml) ? readFileSync(toml, 'utf8') : undefined;
  if (raw === undefined || codexLaikaLines(raw).length === 0) return;
  if (isSwitchingCodexTable(codexLaikaLines(raw))) {
    io.out(`  · codex: [mcp_servers.laika] in ${toml} already follows Omnigent runs`);
    return;
  }
  const older = OLDER_CODEX_BLOCK.exec(raw);
  if (older === null) {
    io.out(
      `  ! codex: ${toml} has a [mcp_servers.laika] that laika tool add did not write — left alone.`,
    );
    io.out('      Inside Omnigent, Codex keeps acting as its own agent, hooks and MCP alike.');
    io.out(
      '      To have it act as the Omnigent agent there: `laika tool add codex` prints the line.',
    );
    return;
  }
  const content = raw.replace(
    OLDER_CODEX_BLOCK,
    older[0].replace(`bearer_token_env_var = "${CODEX_TOKEN_VAR}"`, CODEX_HELPER_LINE),
  );
  const backup = apply({
    ok: true,
    path: toml,
    status: 'replaced',
    content,
    existed: true,
    secret: false,
  });
  io.out(
    `  ✓ codex: [mcp_servers.laika] in ${toml} now follows Omnigent runs` +
      `${backup === undefined ? '' : ` (backup: ${backup})`}`,
  );
  retireRcExport(io);
}

/**
 * `laika tool add omnigent` (LAI-1101, plan auto-pickup §8 D, F8): Omnigent
 * reaching the board **as its own agent**, on a fresh laptop, with nothing
 * set by hand.
 *
 * 1. Omnigent's polly is **copied** to `~/.laika/omnigent/laika-polly/` —
 *    never edited inside the installed package, which an upgrade replaces
 *    (and where an earlier hand-written `${VAR}` sidecar stopped every polly
 *    turn on 15 Oct). A copy already there is renamed `<dir>.bak-<time>`
 *    first. The copy is named `laika-polly`, so the built-in polly is never
 *    shadowed.
 * 2. Its `tools/mcp/laika.yaml` is the stdio sidecar (`omnigentSidecar`):
 *    Laika's MCP bridge, by absolute path, reading
 *    `~/.laika/agents/omnigent.json`. Any `${` refuses the write.
 * 3. `omni agent add <dir>` uploads it to the local Omnigent — only after a
 *    yes (or `--yes`), with an environment that carries no token.
 *
 * A failure here never undoes the credential: it is printed with the step
 * that remains.
 */
export async function omnigentAgent(
  io: ToolAddIo,
  argv: readonly string[],
): Promise<OmnigentAgent> {
  const env = io.env ?? process.env;
  const from = option(argv, '--from');
  const found = from ?? pollySource(env, io.home);
  const source = found === undefined || !existsSync(found) ? found : realpathSync(found);
  if (source === undefined || !existsSync(join(source, 'config.yaml'))) {
    io.out(
      from === undefined
        ? "  ! agent: Omnigent's polly agent was not found (is `omni` installed and on PATH?)"
        : `  ! agent: ${from} has no config.yaml — not an Omnigent agent folder`,
    );
    return 'none';
  }
  const sidecar = omnigentSidecar(bridgeCommand(env));
  if ('refused' in sidecar) {
    io.out(`  ! agent: ${sidecar.refused}`);
    return 'none';
  }
  // A symlink in the copy would be written through: the config and the
  // sidecar written below would land in whatever folder it points at — the
  // installed package, or the --from source (LAI-1101 review #3).
  const link = firstSymlink(source);
  if (link !== undefined) {
    io.out(`  ! agent: ${link} is a symlink — nothing copied. Copying it would write through it`);
    io.out('      into the folder it points at. Pass --from a copy of the agent without symlinks.');
    return 'none';
  }
  const config = readFileSync(join(source, 'config.yaml'), 'utf8');
  if (!/^name:[ \t]*\S+[ \t]*$/m.test(config)) {
    io.out(`  ! agent: ${join(source, 'config.yaml')} has no top-level name: line to rename`);
    return 'none';
  }

  const dest = laikaPollyDir(io.home);
  let backup: string | undefined;
  try {
    mkdirSync(join(io.home, '.laika', 'omnigent'), { recursive: true, mode: 0o700 });
    if (existsSync(dest)) {
      backup = `${dest}.bak-${new Date(io.now()).toISOString().replace(/[:.]/g, '-')}`;
      renameSync(dest, backup);
    }
    cpSync(source, dest, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (path) => !['__pycache__', '.DS_Store'].includes(basename(path)),
    });
    writeFileSync(
      join(dest, 'config.yaml'),
      config.replace(/^name:[ \t]*\S+[ \t]*$/m, `name: ${LAIKA_POLLY}`),
    );
    mkdirSync(join(dest, 'tools', 'mcp'), { recursive: true });
    writeFileSync(join(dest, 'tools', 'mcp', 'laika.yaml'), sidecar.yaml);
  } catch (cause) {
    io.out(
      `  ! agent: could not copy polly to ~/.laika/omnigent/${LAIKA_POLLY}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return 'none';
  }
  // Read back what Omnigent will read: no MCP file in the copy may hold a ${VAR}.
  const mcpDir = join(dest, 'tools', 'mcp');
  for (const name of readdirSync(mcpDir)) {
    if (readFileSync(join(mcpDir, name), 'utf8').includes('${')) {
      io.out(
        `  ! agent: ${join(mcpDir, name)} holds a \${VAR}, which a Dock-launched Omnigent cannot resolve —`,
      );
      io.out('      every turn of the agent would be refused. Remove that line, then install it.');
      return 'none';
    }
  }
  io.out(
    `  ✓ agent: polly copied to ~/.laika/omnigent/${LAIKA_POLLY}, its Laika MCP is the bridge` +
      `${backup === undefined ? '' : ` (the copy that was there: ${backup})`}`,
  );

  const omni = omniOnPath(env);
  const installCommand = `omni agent add ${shellWord(dest)}`;
  if (omni === undefined) {
    io.out(`  · omnigent: \`omni\` is not on PATH; install Omnigent, then run: ${installCommand}`);
    return 'copied';
  }
  const version = omniVersion(omni, io.home);
  if (version === undefined || !SUPPORTED_OMNIGENT.test(version)) {
    io.out(
      `  ! omnigent: this is Omnigent ${version ?? '(version unknown)'}; ${LAIKA_POLLY} was checked on 0.19.x`,
    );
  }
  const yes =
    argv.includes('--yes') ||
    (io.confirm !== undefined &&
      (await io.confirm(`Install ${LAIKA_POLLY} into Omnigent now (${installCommand})?`)));
  if (!yes) {
    io.out(`  · omnigent: not installed — run it when you are ready: ${installCommand}`);
    return 'copied';
  }
  const childEnv: Record<string, string> = {};
  for (const name of OMNI_ENV) {
    const value = env[name];
    if (value !== undefined) childEnv[name] = value;
  }
  try {
    execFileSync(omni, ['agent', 'add', dest], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      encoding: 'utf8',
    });
  } catch (cause) {
    const e = cause as { status?: number | null; stderr?: string };
    const last = (e.stderr ?? '').trim().split('\n').slice(-1)[0] ?? '';
    io.out(
      `  ! omnigent: omni agent add failed (exit ${String(e.status ?? '?')})${last === '' ? '' : `: ${last}`}`,
    );
    io.out(`      Run it yourself once Omnigent is running: ${installCommand}`);
    return 'copied';
  }
  io.out(`  ✓ omnigent: ${LAIKA_POLLY} installed (omni agent add)`);
  return 'installed';
}

/** A path as one shell word, quoted only when it needs to be. */
function shellWord(path: string): string {
  return /^[A-Za-z0-9_./~-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
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
  harness: string,
): Promise<void> {
  const info = versionInfo();
  const outcome = reportOutcome(
    await sendClientReport(
      io,
      url,
      token,
      { version: info.version, commit: info.commit, protocol: PROTOCOL },
      hooksOn,
      harness,
    ),
  );
  io.out(
    outcome === 'sent'
      ? '  ✓ reported this helper’s version to the board'
      : `  · could not report this helper’s version (${outcome}); the setup stands`,
  );
}
