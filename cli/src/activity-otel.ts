import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { shellQuote } from './agents.ts';
import { asJson, backupOnce, isObject, parseConfig, paths, replaceFile } from './activity-hooks.ts';
import { REQUEST_TIMEOUT_MS } from './activity-sync.ts';
import { writePrivately } from './connect.ts';

/**
 * Claude Code's telemetry, set up once in `~/.claude/settings.json` by
 * `laika activity on` (LAI-867) — so every Claude Code on the laptop sends its
 * metrics to the board, the ones started from the Dock and Omnigent's SDK
 * sessions (`--setting-sources=user,project`) included, with no shell-profile
 * line.
 *
 * The owner's manual fix on Belka (2026-10-22) is the reference, and this
 * writes exactly it: six non-secret variables in `env`, and a top-level
 * `otelHeadersHelper` naming a 0700 script that reads `LAIKA_TOKEN` from
 * `~/.laika/env` each time it runs and prints the `Authorization` header as
 * JSON. **The token is never written** — not into settings.json, not into the
 * script.
 *
 * **What `on` added is recorded** in `~/.laika/otel.json`, the keys only, so
 * `off` removes exactly that: a key the person already had with the same value
 * was theirs before `on` and stays theirs after `off`. Each is removed only
 * while it still holds `on`'s value.
 */

/** Telemetry's own names, checked against code.claude.com/docs/en/monitoring-usage (LAI-773). */
export function otelEnv(board: string): Readonly<Record<string, string>> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${board}/api/v1/otlp/v1/metrics`,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
    OTEL_LOGS_EXPORTER: 'none',
  };
}

export const HELPER_KEY = 'otelHeadersHelper';
/** In the script, so a file of the same name that someone else wrote is never ours. */
const HELPER_MARKER = 'laika-otel-headers';

export const otelPaths = (home: string) => ({
  settings: paths.claude(home),
  helper: join(home, '.laika', 'otel-headers'),
  record: join(home, '.laika', 'otel.json'),
  env: join(home, '.laika', 'env'),
});

/** The value `otelHeadersHelper` holds: Claude Code runs it as a command. */
export const helperCommand = (home: string): string => shellQuote(otelPaths(home).helper);

/**
 * The script. It reads `~/.laika/env` the way `readEnvFile` does — the last
 * `LAIKA_…=` line, `export` and quotes allowed — and answers only for the
 * board it was written for, so a token for another board is never sent here.
 */
export function helperScript(home: string, board: string): string {
  const envFile = otelPaths(home).env;
  return [
    '#!/bin/sh',
    `# ${HELPER_MARKER}: Claude Code's OpenTelemetry Authorization header for Laika.`,
    '# Written by `laika activity on`, removed by `laika activity off` (LAI-867).',
    '# The token is read from ~/.laika/env each time this runs; it is never stored here.',
    `env_file=${shellQuote(envFile)}`,
    `board=${shellQuote(board)}`,
    'value() {',
    `  sed -n "s/^[[:space:]]*\\(export[[:space:]][[:space:]]*\\)\\{0,1\\}$1[[:space:]]*=[[:space:]]*//p" "$env_file" 2>/dev/null |`,
    `    tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^"\\(.*\\)"$/\\1/' -e "s/^'\\(.*\\)'$/\\1/"`,
    '}',
    "url=$(value LAIKA_URL | sed 's:/*$::')",
    'token=$(value LAIKA_TOKEN)',
    'if [ "$url" != "$board" ]; then',
    '  echo "laika: $env_file has no LAIKA_URL for $board" >&2',
    '  exit 1',
    'fi',
    'case $token in',
    "  '' | *[!A-Za-z0-9_]*)",
    '    echo "laika: $env_file has no LAIKA_TOKEN" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    `printf '{"Authorization":"Bearer %s"}\\n' "$token"`,
    '',
  ].join('\n');
}

interface OtelRecord {
  readonly board: string;
  /** The `env` keys `on` added, and `otelHeadersHelper` when it added that. */
  readonly added: readonly string[];
  /** Whether `on` created `env` itself, so `off` takes it away again once empty. */
  readonly created_env: boolean;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function readRecord(path: string): OtelRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      isObject(parsed) &&
      typeof parsed.board === 'string' &&
      Array.isArray(parsed.added) &&
      parsed.added.every((k) => typeof k === 'string')
    ) {
      return {
        board: parsed.board,
        added: parsed.added,
        created_env: parsed.created_env === true,
      };
    }
  } catch {
    // None, or not ours to read.
  }
  return undefined;
}

export interface OtelReport {
  readonly status: 'installed' | 'unchanged' | 'refused' | 'removed' | 'absent';
  readonly summary: string;
  /** A key of the person's own that holds another value — left as it is. */
  readonly kept: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* on                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `existed`: whether settings.json was there before this `on` began. The hooks
 * step runs first and may have just created it; a `.bak` is of the person's
 * original, never of a file Laika wrote a moment ago.
 */
export function installOtel(home: string, board: string, existed: boolean): OtelReport {
  const p = otelPaths(home);
  const parsed = parseConfig(p.settings);
  if (!parsed.ok) {
    return {
      status: 'refused',
      summary: `${p.settings} ${parsed.why} — telemetry not set up`,
      kept: [],
    };
  }
  if (parsed.doc.env !== undefined && !isObject(parsed.doc.env)) {
    return {
      status: 'refused',
      summary: `${p.settings} has an "env" that is not an object — telemetry not set up`,
      kept: [],
    };
  }
  const existing = readText(p.helper);
  if (existing !== undefined && !existing.includes(HELPER_MARKER)) {
    return {
      status: 'refused',
      summary: `${p.helper} exists and is not Laika's — left alone`,
      kept: [],
    };
  }

  const before = readRecord(p.record);
  const added = new Set(before?.board === board ? before.added : []);
  const kept: string[] = [];
  const env: Record<string, unknown> = isObject(parsed.doc.env) ? { ...parsed.doc.env } : {};
  for (const [key, value] of Object.entries(otelEnv(board))) {
    if (!(key in env)) {
      env[key] = value;
      added.add(key);
    } else if (env[key] !== value) kept.push(key);
  }
  const next: Record<string, unknown> = { ...parsed.doc, env };
  const command = helperCommand(home);
  if (!(HELPER_KEY in next)) {
    next[HELPER_KEY] = command;
    added.add(HELPER_KEY);
  } else if (next[HELPER_KEY] !== command) kept.push(HELPER_KEY);

  const script = helperScript(home, board);
  const record = asJson({
    board,
    added: [...added],
    created_env: before?.board === board ? before.created_env : parsed.doc.env === undefined,
  });
  const scriptSame = existing === script;
  const recordSame = readText(p.record) === record;
  const settingsSame = parsed.existed && isDeepStrictEqual(next, parsed.doc);
  if (!scriptSame) {
    mkdirSync(join(home, '.laika'), { recursive: true });
    writePrivately(p.helper, script);
  }
  // writePrivately leaves 0600; the helper is run, so 0700 — still no one else's.
  const modeSame = (statSync(p.helper).mode & 0o777) === 0o700;
  if (!modeSame) chmodSync(p.helper, 0o700);
  if (!recordSame) writePrivately(p.record, record);
  let backup: string | undefined;
  if (!settingsSame) {
    if (existed) backup = backupOnce(p.settings);
    replaceFile(p.settings, asJson(next));
  }
  const unchanged = scriptSame && modeSame && recordSame && settingsSame;
  return {
    status: unchanged ? 'unchanged' : 'installed',
    summary: unchanged
      ? `telemetry already set up in ${p.settings}`
      : `telemetry set up in ${p.settings}${backup === undefined ? '' : ` (backup: ${backup})`}`,
    kept,
  };
}

/* -------------------------------------------------------------------------- */
/* off                                                                        */
/* -------------------------------------------------------------------------- */

export function removeOtel(home: string): OtelReport {
  const p = otelPaths(home);
  const record = readRecord(p.record);
  if (record === undefined) {
    return { status: 'absent', summary: 'telemetry: nothing set up', kept: [] };
  }
  const parsed = parseConfig(p.settings);
  if (!parsed.ok) {
    return {
      status: 'refused',
      summary: `${p.settings} ${parsed.why} — left alone; remove ${HELPER_KEY} and the OTEL variables by hand`,
      kept: [],
    };
  }
  const expected = otelEnv(record.board);
  const kept: string[] = [];
  const next: Record<string, unknown> = { ...parsed.doc };
  const env: Record<string, unknown> = isObject(next.env) ? { ...next.env } : {};
  for (const key of record.added) {
    if (key === HELPER_KEY) {
      if (next[HELPER_KEY] === helperCommand(home)) delete next[HELPER_KEY];
      else if (HELPER_KEY in next) kept.push(key);
    } else if (key in env) {
      if (env[key] === expected[key]) delete env[key];
      else kept.push(key);
    }
  }
  if (isObject(next.env)) {
    if (Object.keys(env).length === 0 && record.created_env) delete next.env;
    else next.env = env;
  }
  if (parsed.existed && !isDeepStrictEqual(next, parsed.doc)) {
    replaceFile(p.settings, asJson(next));
  }
  rmSync(p.helper, { force: true });
  rmSync(p.record, { force: true });
  return {
    status: 'removed',
    summary: `telemetry removed from ${p.settings}${kept.length === 0 ? '' : `; changed since, so kept: ${kept.join(', ')}`}`,
    kept,
  };
}

/* -------------------------------------------------------------------------- */
/* status                                                                     */
/* -------------------------------------------------------------------------- */

export type OtelCheck =
  | { readonly state: 'not-set-up' }
  /** A key of the person's own disagrees with this board's. */
  | { readonly state: 'disagrees'; readonly keys: readonly string[] }
  /** The helper failed, or printed no `Authorization` header. */
  | { readonly state: 'helper-fails'; readonly why: string }
  /** The board answered 401, or 403 with this reason (`local_activity_off`). */
  | { readonly state: 'refused'; readonly status: number; readonly reason?: string }
  | { readonly state: 'unreachable'; readonly why: string }
  | { readonly state: 'reaching' };

function runHelper(
  command: string,
): Promise<{ ok: true; header: string } | { ok: false; why: string }> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      { timeout: REQUEST_TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          const said = stderr.trim().split('\n').at(-1) ?? '';
          resolve({ ok: false, why: said === '' ? error.message : said });
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (isObject(parsed) && typeof parsed.Authorization === 'string') {
            resolve({ ok: true, header: parsed.Authorization });
            return;
          }
        } catch {
          // Below.
        }
        resolve({ ok: false, why: 'it printed no Authorization header' });
      },
    );
  });
}

/**
 * Whether Claude Code's telemetry reaches `board`: settings.json as `on`
 * writes it, the helper run as Claude Code runs it, then one OTLP request
 * carrying **no metric** (`{"resourceMetrics":[]}`) with the header the
 * helper printed — the board's own answer, 2xx, 401 or 403. The helper is run
 * only when it is ours: a command of someone else's is never run from here.
 */
export async function checkOtel(home: string, board: string): Promise<OtelCheck> {
  const p = otelPaths(home);
  const parsed = parseConfig(p.settings);
  const doc = parsed.ok ? parsed.doc : {};
  const env = isObject(doc.env) ? doc.env : {};
  const expected = otelEnv(board);
  const command = helperCommand(home);
  const present = Object.keys(expected).filter((k) => k in env);
  if (present.length === 0 && doc[HELPER_KEY] === undefined) return { state: 'not-set-up' };
  const disagree = Object.entries(expected)
    .filter(([key, value]) => env[key] !== value)
    .map(([key]) => key);
  if (doc[HELPER_KEY] !== command) disagree.push(HELPER_KEY);
  if (disagree.length > 0) return { state: 'disagrees', keys: disagree };

  const helper = await runHelper(command);
  if (!helper.ok) return { state: 'helper-fails', why: helper.why };

  let response: Response;
  try {
    response = await fetch(expected.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? '', {
      method: 'POST',
      headers: { Authorization: helper.header, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceMetrics: [] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return { state: 'unreachable', why: cause instanceof Error ? cause.message : String(cause) };
  }
  if (response.ok) return { state: 'reaching' };
  let reason: string | undefined;
  try {
    const body = (await response.json()) as { error?: { details?: { reason?: unknown } } };
    const r = body.error?.details?.reason;
    if (typeof r === 'string') reason = r;
  } catch {
    reason = undefined;
  }
  return { state: 'refused', status: response.status, ...(reason === undefined ? {} : { reason }) };
}

/** One line for `laika activity status`. */
export function describeOtel(check: OtelCheck, board: string): string {
  switch (check.state) {
    case 'not-set-up':
      return 'not set up — Claude Code’s background calls are not counted; run `laika activity on`';
    case 'disagrees':
      return `set up, but your own settings disagree: ${check.keys.join(', ')} in ~/.claude/settings.json — not sent to ${board}`;
    case 'helper-fails':
      return `set up, but the header helper fails: ${check.why}`;
    case 'refused':
      return check.status === 401
        ? `set up, but ${board} refuses the token (401) — run \`laika connect\` or \`laika init\``
        : `set up, but ${board} refuses it (${String(check.status)}${check.reason === undefined ? '' : ` ${check.reason}`})`;
    case 'unreachable':
      return `set up, but ${board} did not answer: ${check.why}`;
    case 'reaching':
      return `reaching ${board} — every Claude Code on this machine sends its metrics`;
  }
}
