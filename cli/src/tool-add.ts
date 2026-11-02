import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type AgentHookReport, installAgentHooks } from './agent-hooks.ts';
import { ADAPTERS, type Harness } from './agent-adapters.ts';
import { credentialPath, isRecord, writeCredential, writePrivate } from './agent-session.ts';
import { AGENT_HOOK_SCRIPT } from './agent-setup.ts';
import { apply, prepare, rcFileFor } from './connect.ts';
import {
  commonRefusal,
  type DeviceIo,
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
 * - **Claude Code**: credential, hooks, and `laika-claude` prefers this
 *   credential to the person's own — only because `tool add` wrote it
 *   (`source: "tool-add"`), so nobody is switched retroactively (§L2).
 * - **Codex**: credential, hooks, and an MCP entry reading its own variable,
 *   `LAIKA_AGENT_TOKEN_CODEX`. An existing `[mcp_servers.laika]` is kept.
 * - **Omnigent**: credential only — no hooks, no sessions.
 * - **Cursor, Gemini CLI, VS Code**: credential; MCP is set up by hand.
 * - **Antigravity** takes a token only written into its own config, so it is
 *   refused **before** anything is redeemed; so is any tool with no CLI
 *   harness. A refused exchange mints nothing.
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

export const CODEX_RC_MARKER =
  "# Laika — Codex's own agent token for its MCP entry (laika tool add codex)";

const SET_UP_BY_HAND = [
  'Set it up by hand instead: in the browser, cancel this setup and use',
  '"Set up by hand" for this tool. Nothing was redeemed, so no token exists.',
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
    io.err('  The token it minted is unused; disconnect that tool in the browser, or set it up');
    io.err('  by hand from its own row.');
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
  if (target === 'codex') codexMcp(io, redeemed.boardOrigin);
  if ((target === 'claude-code' || target === 'codex') && hooks) {
    const report = installAgentHooks(io.home, AGENT_HOOK_SCRIPT, target);
    installed.push(report);
    const mark = report.status === 'refused' || report.status === 'unsupported' ? '!' : '✓';
    io.out(`  ${mark} hooks: ${report.summary}`);
    for (const line of report.detail ?? []) io.out(`      ${line}`);
  }

  const hooksOn = installed.some((r) => r.status === 'installed' || r.status === 'unchanged');
  await clientReport(io, redeemed.boardOrigin, redeemed.secret, hooksOn);

  io.out('');
  for (const line of nextSteps(target, hooksOn)) io.out(line);
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
export const CODEX_RC_LINE =
  `[ -r "$HOME/.laika/agents/codex.json" ] && ` +
  `export ${CODEX_TOKEN_VAR}="$(sed -n 's/^ *"token": *"\\([^"]*\\)".*/\\1/p' "$HOME/.laika/agents/codex.json")"`;

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

function nextSteps(harness: Harness, hooksOn: boolean): string[] {
  switch (harness) {
    case 'claude-code':
      return [
        'Next: quit Claude Code and start it again with `laika-claude`. It now uses this',
        "tool's own credential instead of your personal token; plain `claude` gets no",
        'Laika tools. Then ask it to call laika_whoami — the browser ticks "Tool request seen".',
        ...(hooksOn ? [] : ['Hooks are off: no sessions, claims or automatic checkpoints.']),
      ];
    case 'codex':
      return [
        `Next: open a new terminal (so ${CODEX_TOKEN_VAR} is set), start codex, and`,
        ...(hooksOn
          ? ['trust the Laika hooks in /hooks — Codex runs a new hook only once you do.']
          : ['note hooks are off: no sessions, claims or automatic checkpoints.']),
        'Then ask it to call laika_whoami — the browser ticks "Tool request seen".',
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
        'automatic checkpoints. Its MCP config is set up by hand and is Documented-not-tested',
        '(cli/agent-adapters/CAPABILITIES.md); the credential is for `laika agent` commands.',
      ];
  }
}

/** Closed: the board refuses a capability it does not know (§4.81). */
const BASE_CAPABILITIES = [
  'device_pairing',
  'tool_setup_exchange',
  'client_report',
  'doctor',
  'update',
] as const;

/**
 * What this helper is, sent with the tool's own token (§4.81). Evidence for a
 * status word on the board, never a permission; a failure is reported and
 * does not undo the setup.
 */
async function clientReport(
  io: ToolAddIo,
  url: string,
  token: string,
  hooksOn: boolean,
): Promise<void> {
  const info = versionInfo();
  const body = {
    cli_version: /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(info.version) ? info.version : 'unknown',
    ...(info.commit !== null && /^[0-9a-f]{7,40}$/.test(info.commit)
      ? { cli_commit: info.commit }
      : {}),
    protocol: PROTOCOL,
    capabilities: [
      ...BASE_CAPABILITIES,
      ...(hooksOn ? (['session_hooks', 'claims', 'checkpoints'] as const) : []),
    ],
  };
  const answer = await postJson(io, `${url}/api/v1/agents/me/client-report`, body, {
    Authorization: `Bearer ${token}`,
  });
  if (answer.kind === 'json' && answer.status === 200) {
    io.out('  ✓ reported this helper’s version to the board');
  } else {
    io.out(
      `  · could not report this helper’s version (${answer.kind === 'unreachable' ? 'unreachable' : String(answer.status)}); the setup stands`,
    );
  }
}
