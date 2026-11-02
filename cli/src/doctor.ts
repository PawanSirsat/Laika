import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ADAPTERS, HARNESSES, type Harness } from './agent-adapters.ts';
import { AGENT_MARKER, hookFile } from './agent-hooks.ts';
import { credentialPath } from './agent-session.ts';
import { detectAgents } from './agents.ts';
import { normaliseUrl } from './api.ts';
import { readSettings } from './config.ts';
import { PROTOCOL } from './protocol.ts';
import { tildePath, versionInfo, type VersionDeps, type VersionInfo } from './version.ts';
import { readEnvFile } from './whoami.ts';

/**
 * `laika doctor` (alias `laika status`) — is this machine's Laika set up, and
 * is it the version the board expects? (LAI-1043, the LAI-1042 plan §F.2, §H.)
 *
 * ## Read-only
 *
 * It writes nothing: no config, no credential, no report to the board. The
 * only requests it makes are `GET`s — the board's public compatibility answer,
 * and one `GET /agents/me/work-requests` per saved agent credential to say
 * whether the board still accepts it. `--offline` makes none at all.
 *
 * ## Never a secret
 *
 * A credential is reported by **which file holds it**, and whether it is
 * there, never by its value, its prefix or its length. A token is read only to
 * send it in an `Authorization` header to the board it was saved for.
 *
 * ## Exit codes
 *
 * `0` everything checked is fine; `1` something needs action; `2` nothing
 * needs action but something could not be checked (the board did not answer,
 * or is too old to say); `64` the command line itself was wrong (`EX_USAGE`,
 * sysexits.h), so a script cannot mistake a typo for a finding.
 *
 * ## A URL is printed only as `displayUrl` shows it
 *
 * A board URL can carry a secret — `https://bob:lai_…@host`, or
 * `?token=lai_…` — and it comes from four places a person may have pasted
 * into: `LAIKA_URL`, `~/.claude/settings.json`, `~/.laika/env` and an agent's
 * credential file. Every line and every `--json` field shows the URL with its
 * user, password, query and fragment removed, and a URL that carries any of
 * them is an ACTION and is **never fetched**: sending it would hand the
 * secret to whatever answers.
 */

export type Status = 'ok' | 'action' | 'unknown' | 'info' | 'skipped';

export interface Check {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

/** The board's `GET /developer/compatibility` body, as much as doctor reads. */
export interface Compatibility {
  readonly server: { readonly version: string; readonly build_commit: string | null };
  readonly protocol: { readonly current: number; readonly min_client: number };
  readonly features: Readonly<Record<string, unknown>>;
  readonly cli: {
    readonly min_protocol_for: Readonly<Record<string, number>>;
    readonly source: { readonly url: string; readonly commit: string | null };
  };
}

export type CompatResult =
  | { readonly kind: 'ok'; readonly body: Compatibility }
  /** `404`, or an answer that is not the body: a board older than LAI-1043. */
  | { readonly kind: 'unsupported'; readonly status: number }
  /** `409` before first-boot setup. */
  | { readonly kind: 'not_set_up' }
  | { readonly kind: 'unreachable'; readonly why: string };

export interface DoctorIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly version?: VersionDeps;
}

const CONSOLE: DoctorIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  fetch: (input, init) => fetch(input, init),
};

const TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `EX_USAGE`: the arguments were wrong, which is not a finding about this machine. */
export const USAGE_EXIT = 64;

/**
 * The URL with its user, password, query and fragment removed: what may be
 * printed. Something that does not parse prints as a placeholder, because the
 * raw text could be a secret pasted into the wrong field.
 */
export function displayUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return '<not a valid URL>';
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** Whether a board URL carries anything that may be a secret, or does not parse. */
export function urlProblem(raw: string): 'credentials' | 'invalid' | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid';
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return 'credentials';
  }
  // `new URL` drops an empty `?` or `#`; still not a plain board address.
  if (raw.includes('?') || raw.includes('#')) return 'credentials';
  return undefined;
}

/** Only the fields doctor relies on are checked; anything else is ignored. */
function asCompatibility(raw: unknown): Compatibility | undefined {
  if (!isRecord(raw)) return undefined;
  const { server, protocol, features, cli } = raw;
  if (!isRecord(server) || !isRecord(protocol) || !isRecord(features) || !isRecord(cli)) {
    return undefined;
  }
  if (typeof protocol.current !== 'number' || typeof protocol.min_client !== 'number') {
    return undefined;
  }
  if (!isRecord(cli.source) || !isRecord(cli.min_protocol_for)) return undefined;
  return raw as unknown as Compatibility;
}

export async function fetchCompatibility(
  board: string,
  fetchImpl: typeof fetch,
): Promise<CompatResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${board}/api/v1/developer/compatibility`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable', why: `nothing answered at ${displayUrl(board)}` };
  }
  if (response.status === 409) {
    // Only the setup gate's own 409 means "not set up"; any other conflict is
    // an answer doctor does not understand.
    let details: unknown;
    try {
      const raw = (await response.json()) as { error?: { details?: unknown } };
      details = raw.error?.details;
    } catch {
      details = undefined;
    }
    if (isRecord(details) && details.setup_required === true) return { kind: 'not_set_up' };
    return { kind: 'unreachable', why: 'the board answered 409' };
  }
  if (response.status === 404) return { kind: 'unsupported', status: 404 };
  if (!response.ok) {
    return { kind: 'unreachable', why: `the board answered ${String(response.status)}` };
  }
  // A 200 that is not the body — an SPA's index.html, a proxy's page — is a
  // board that cannot say, not one that said yes.
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { kind: 'unsupported', status: response.status };
  }
  const body = asCompatibility(raw);
  return body === undefined
    ? { kind: 'unsupported', status: response.status }
    : { kind: 'ok', body };
}

/**
 * The local integration's update status (plan §H): *Up to date*, *Update
 * available*, *Update required*, for this checkout against the board.
 */
export function updateStatus(
  local: VersionInfo,
  body: Compatibility,
  protocol: number = PROTOCOL,
): Check {
  // `laika update`, never `git pull`: the board names the commit to run, and
  // the newest commit on a branch is not it (LAI-1051).
  const pull = local.checkout === null ? 'update this Laika checkout' : 'laika update';
  if (protocol < body.protocol.min_client) {
    return {
      name: 'update',
      status: 'action',
      detail: `Update required: this board needs protocol ${String(body.protocol.min_client)} or later and this CLI speaks ${String(protocol)}. Run: ${pull}`,
    };
  }
  const blocked = Object.entries(body.cli.min_protocol_for)
    .filter(([feature, min]) => body.features[feature] === true && protocol < min)
    .map(([feature]) => feature);
  if (blocked.length > 0) {
    return {
      name: 'update',
      status: 'action',
      detail: `Update required for ${blocked.join(', ')}: the board has it on and this CLI speaks protocol ${String(protocol)}. Run: ${pull}`,
    };
  }
  const boardCommit = body.cli.source.commit;
  // Either may be short: the board's comes from a build arg, ours from git.
  const sameCommit =
    boardCommit !== null &&
    local.commit !== null &&
    (local.commit.startsWith(boardCommit) || boardCommit.startsWith(local.commit));
  if (sameCommit)
    return { name: 'update', status: 'ok', detail: 'Up to date: the board’s own commit' };
  if (protocol < body.protocol.current) {
    return {
      name: 'update',
      status: 'info',
      detail: `Update available: the board speaks protocol ${String(body.protocol.current)}, this CLI ${String(protocol)}. Run: ${pull}`,
    };
  }
  const which =
    boardCommit === null
      ? 'the board does not say which commit it runs'
      : `the board runs ${boardCommit.slice(0, 7)}`;
  return {
    name: 'update',
    status: 'ok',
    detail: `Up to date: protocol ${String(protocol)} (${which})`,
  };
}

/** Where the board URL comes from, in order; shared with `laika update`. */
export function pickBoard(
  io: Pick<DoctorIo, 'env' | 'home'>,
  flag: string | undefined,
): { url?: string; from: string } {
  if (flag !== undefined) return { url: flag, from: '--board' };
  const live = io.env.LAIKA_URL;
  if (live !== undefined && live !== '') return { url: live, from: 'the environment' };
  try {
    const fromSettings = readSettings(join(io.home, '.claude', 'settings.json')).env?.LAIKA_URL;
    if (typeof fromSettings === 'string' && fromSettings !== '') {
      return { url: fromSettings, from: '~/.claude/settings.json' };
    }
  } catch {
    // Reported by the config check; the board may still be found below.
  }
  const fromEnvFile = readEnvFile(join(io.home, '.laika', 'env')).LAIKA_URL;
  if (fromEnvFile !== undefined) return { url: fromEnvFile, from: '~/.laika/env' };
  for (const harness of HARNESSES) {
    const saved = readCredentialFile(io.home, harness);
    if (saved?.url !== undefined)
      return { url: saved.url, from: `~/.laika/agents/${harness}.json` };
  }
  return { from: 'nowhere' };
}

interface SavedCredential {
  readonly url?: string;
  readonly token?: string;
  /** `tool-add` when `laika tool add` wrote it (a V3 tool), absent for `laika agent login`. */
  readonly source?: string;
  readonly malformed: boolean;
}

function readCredentialFile(home: string, harness: Harness): SavedCredential | undefined {
  const path = credentialPath(home, harness);
  if (!existsSync(path)) return undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(raw)) return { malformed: true };
    const url = typeof raw.url === 'string' && raw.url !== '' ? raw.url : undefined;
    const token = typeof raw.token === 'string' && raw.token !== '' ? raw.token : undefined;
    const source = typeof raw.source === 'string' ? raw.source : undefined;
    return {
      malformed: url === undefined || token === undefined,
      ...(url === undefined ? {} : { url }),
      ...(token === undefined ? {} : { token }),
      ...(source === undefined ? {} : { source }),
    };
  } catch {
    return { malformed: true };
  }
}

function hooksOn(home: string, harness: Harness): boolean {
  if (!ADAPTERS[harness].hooks) return false;
  try {
    return readFileSync(hookFile(home, harness), 'utf8').includes(AGENT_MARKER);
  } catch {
    return false;
  }
}

/**
 * What fixes a credential the board refuses. A V3 tool's (`laika tool add`,
 * LAI-1072) is replaced from the browser: Reconnect makes a new setup command
 * for the same tool. `laika agent login` is the older path, for the older file.
 */
export const RECONNECT_ADVICE =
  'reconnect it in the browser (Developer access → Devices → ⋯ → Reconnect) and run the laika tool add command it shows';

async function credentialAccepted(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  source: string | undefined,
): Promise<{ status: Status; detail: string }> {
  const fix = source === 'tool-add' ? RECONNECT_ADVICE : 'log the agent in again';
  let response: Response;
  try {
    response = await fetchImpl(`${normaliseUrl(url)}/api/v1/agents/me/work-requests`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      status: 'unknown',
      detail: 'the board did not answer, so the credential could not be checked',
    };
  }
  if (response.ok) return { status: 'ok', detail: 'the board accepts it' };
  if (response.status === 401) {
    return {
      status: 'action',
      detail: `the board refused it (revoked or expired): ${fix}`,
    };
  }
  if (response.status === 403) {
    return {
      status: 'action',
      detail: `the board says it is not an agent’s credential: ${fix}`,
    };
  }
  return { status: 'unknown', detail: `the board answered ${String(response.status)}` };
}

async function toolChecks(io: DoctorIo, offline: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  for (const harness of HARNESSES) {
    const saved = readCredentialFile(io.home, harness);
    const hooks = hooksOn(io.home, harness);
    if (saved === undefined && !hooks) continue;
    const name = `tool ${harness}`;
    const file = `~/.laika/agents/${harness}.json`;

    if (saved === undefined) {
      checks.push({
        name,
        status: 'action',
        detail: `hooks are on but there is no credential in ${file}: run laika agent login ${harness}`,
      });
      continue;
    }
    if (saved.malformed || saved.url === undefined || saved.token === undefined) {
      checks.push({
        name,
        status: 'action',
        detail: `${file} is not a complete credential: run laika agent login ${harness}`,
      });
      continue;
    }
    const mode = statSync(credentialPath(io.home, harness)).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      checks.push({
        name,
        status: 'action',
        detail: `${file} can be read by other users (mode ${mode.toString(8)}): chmod 600 it`,
      });
      continue;
    }
    const hookWord = ADAPTERS[harness].hooks
      ? hooks
        ? 'hooks on'
        : 'hooks off'
      : 'no hooks for this tool';
    if (offline) {
      checks.push({
        name,
        status: 'skipped',
        detail: `credential in ${file}, ${hookWord}; not checked against the board (--offline)`,
      });
      continue;
    }
    if (urlProblem(saved.url) !== undefined) {
      checks.push({
        name,
        status: 'action',
        detail: `the board URL in ${file} carries credentials or is not a valid URL, so the credential was not sent: run laika agent login ${harness}`,
      });
      continue;
    }
    const accepted = await credentialAccepted(saved.url, saved.token, io.fetch, saved.source);
    const codex = harness === 'codex' && hooks ? '. Codex asks you to trust the hook once' : '';
    checks.push({
      name,
      status: accepted.status,
      detail: `credential in ${file}, ${accepted.detail}; ${hookWord}${codex}`,
    });
  }
  if (checks.length === 0) {
    checks.push({
      name: 'tools',
      status: 'info',
      detail: 'no agent credential on this machine: laika agent login <harness> adds one',
    });
  }
  return checks;
}

function legacyChecks(io: DoctorIo): Check[] {
  const checks: Check[] = [];
  const envFile = join(io.home, '.laika', 'env');
  if (existsSync(envFile)) {
    const token = readEnvFile(envFile).LAIKA_TOKEN;
    checks.push({
      name: 'personal token',
      status: 'info',
      detail:
        token === undefined
          ? '~/.laika/env exists with no LAIKA_TOKEN'
          : '~/.laika/env holds a personal token (LAIKA_TOKEN); laika-claude and MCP entries written by laika connect read it',
    });
  }
  const settingsPath = join(io.home, '.claude', 'settings.json');
  try {
    const token = readSettings(settingsPath).env?.LAIKA_TOKEN;
    if (typeof token === 'string' && token !== '') {
      checks.push({
        name: 'personal token',
        status: 'info',
        detail:
          '~/.claude/settings.json holds a personal token (LAIKA_TOKEN), written by laika init',
      });
    }
  } catch {
    checks.push({
      name: 'config',
      status: 'action',
      detail: '~/.claude/settings.json is not valid JSON: fix or move it',
    });
  }
  const mcp = detectAgents(io.home);
  checks.push({
    name: 'mcp entries',
    status: 'info',
    detail:
      mcp.length === 0
        ? 'no tool on this machine has a laika MCP entry'
        : `a laika MCP entry for ${mcp.join(', ')}`,
  });
  return checks;
}

const MIN_NODE: readonly [number, number] = [22, 18];

function nodeCheck(info: VersionInfo): Check {
  const [major = 0, minor = 0] = info.node.split('.').map(Number);
  const old = major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]);
  if (old && info.fromSource) {
    return {
      name: 'node',
      status: 'action',
      detail: `node ${info.node}: running from source needs 22.18 or later`,
    };
  }
  return { name: 'node', status: 'ok', detail: `node ${info.node}` };
}

function checkoutCheck(info: VersionInfo): Check {
  if (info.commit === null) {
    return {
      name: 'checkout',
      status: 'unknown',
      detail: 'not a git checkout, so its commit is unknown',
    };
  }
  const where = info.checkout === null ? '' : ` at ${tildePath(info.checkout)}`;
  return info.dirty === true
    ? {
        name: 'checkout',
        status: 'info',
        detail: `${info.commit.slice(0, 7)}${where}, with local changes in cli/ or plugin/`,
      }
    : { name: 'checkout', status: 'ok', detail: `${info.commit.slice(0, 7)}${where}, clean` };
}

async function boardChecks(
  io: DoctorIo,
  info: VersionInfo,
  flag: string | undefined,
  offline: boolean,
): Promise<Check[]> {
  const board = pickBoard(io, flag);
  if (board.url === undefined) {
    return [
      {
        name: 'board',
        status: 'unknown',
        detail: 'no board configured: pass --board <url>, or run laika init',
      },
    ];
  }
  const problem = urlProblem(board.url);
  if (problem !== undefined) {
    return [
      {
        name: 'board',
        status: 'action',
        detail:
          problem === 'credentials'
            ? `LAIKA_URL carries credentials: the board URL from ${board.from} has a user, password, query or fragment in it, so it was not used. Keep only ${displayUrl(board.url)} there; credentials belong in the token`
            : `LAIKA_URL is not a valid http(s) URL: the board URL from ${board.from} could not be used`,
      },
    ];
  }
  const url = normaliseUrl(board.url);
  const shown = displayUrl(url);
  if (offline)
    return [
      {
        name: 'board',
        status: 'skipped',
        detail: `${shown} (from ${board.from}); not asked (--offline)`,
      },
    ];

  const result = await fetchCompatibility(url, io.fetch);
  if (result.kind === 'unreachable') {
    return [{ name: 'board', status: 'unknown', detail: `Could not check: ${result.why}` }];
  }
  if (result.kind === 'not_set_up') {
    return [
      {
        name: 'board',
        status: 'unknown',
        detail: `Could not check: ${shown} has not been set up yet`,
      },
    ];
  }
  if (result.kind === 'unsupported') {
    return [
      {
        name: 'board',
        status: 'unknown',
        detail: `Version unknown: ${shown} does not report compatibility (a board older than this CLI)`,
      },
    ];
  }
  const { body } = result;
  const build =
    body.server.build_commit === null
      ? 'build unknown'
      : `build ${body.server.build_commit.slice(0, 7)}`;
  const mode =
    typeof body.features.developer_access === 'string'
      ? `, developer access ${body.features.developer_access}`
      : '';
  return [
    {
      name: 'board',
      status: 'ok',
      detail: `${shown} (from ${board.from}): Laika ${body.server.version}, ${build}, protocol ${String(body.protocol.current)}${mode}`,
    },
    updateStatus(info, body),
  ];
}

export function exitCode(checks: readonly Check[]): number {
  if (checks.some((c) => c.status === 'action')) return 1;
  if (checks.some((c) => c.status === 'unknown')) return 2;
  return 0;
}

const LABEL: Readonly<Record<Status, string>> = {
  ok: 'OK',
  action: 'ACTION',
  unknown: 'UNKNOWN',
  info: 'INFO',
  skipped: 'SKIPPED',
};

const USAGE = 'Usage: laika doctor [--board <url>] [--offline] [--json]';

export async function doctor(argv: readonly string[], io: DoctorIo = CONSOLE): Promise<number> {
  let board: string | undefined;
  let json = false;
  let offline = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--offline') offline = true;
    else if (arg === '--board') {
      board = argv[++i];
      if (board === undefined || board === '') {
        io.err(`laika doctor: --board needs a URL. ${USAGE}`);
        return USAGE_EXIT;
      }
    } else {
      io.err(`laika doctor: unknown option "${arg ?? ''}". ${USAGE}`);
      return USAGE_EXIT;
    }
  }

  const info = versionInfo(io.version);
  const checks: Check[] = [
    nodeCheck(info),
    checkoutCheck(info),
    ...(await boardChecks(io, info, board, offline)),
    ...(await toolChecks(io, offline)),
    ...legacyChecks(io),
  ];
  const code = exitCode(checks);

  if (json) {
    io.out(JSON.stringify({ protocol: PROTOCOL, checks, exit: code }, null, 2));
    return code;
  }
  io.out('laika doctor — read-only; nothing on this machine or the board is changed.');
  io.out('');
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const check of checks) {
    io.out(`  ${LABEL[check.status].padEnd(8)} ${check.name.padEnd(width)}  ${check.detail}`);
  }
  io.out('');
  io.out(
    code === 0
      ? 'Nothing needs doing.'
      : code === 1
        ? 'Something above needs doing (ACTION).'
        : 'Nothing needs doing, but something could not be checked (UNKNOWN).',
  );
  return code;
}
