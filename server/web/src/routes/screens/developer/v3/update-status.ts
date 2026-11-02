import type { AgentVerification } from '../../../../api/tool-setup.ts';
import type { StatusTone } from '../../../../components/wizard/StatusChip.tsx';

/**
 * Whether a tool's local helper needs updating (LAI-1065, plan LAI-1042 §H,
 * §E.6, §E.7, §F.5), worked out **only** from two things the board sent:
 *
 * - its compatibility answer (`GET /developer/compatibility`): the commit the
 *   board was built from — which is the helper it offers — its protocol, and
 *   the protocol each feature needs;
 * - the tool's own client report (`GET /agents/:id/verification`), which the
 *   helper sent with the tool's credential. Self-reported, so it is said as
 *   the helper said it.
 *
 * **Never "newest on GitHub".** The board runs one commit and the helper that
 * matches it is that commit (`laika update` moves to exactly it), so a tool
 * is compared with the board and nothing else.
 *
 * **No report is *Version unknown*, never *outdated*.** A tool set up before
 * version reports, or one whose helper has not reported, may be fine; the
 * page cannot tell and does not guess.
 *
 * Separate from the connection status on the same row: a tool can be
 * *Connected* and *Update available* at once.
 *
 * Kept free of React so `node --test` reaches every rule here.
 */

// ------------------------------------------------------------------ the board's side

/** One line of `release_notes.whats_new`: what a helper gains at that protocol. */
export interface WhatsNewEntry {
  readonly protocol: number;
  readonly summary: string;
}

/** The parts of the compatibility answer an update status reads. */
export interface UpdateManifest {
  /** The helper commit the board offers (`cli.source.commit`); null when the build does not know it. */
  readonly helperCommit: string | null;
  readonly protocol: { readonly current: number; readonly minClient: number };
  /** Each feature's protocol (`cli.min_protocol_for`). */
  readonly minProtocolFor: Readonly<Record<string, number>>;
  /** Features the board has switched on; a feature that is off needs nothing from a helper. */
  readonly enabled: readonly string[];
  readonly whatsNew: readonly WhatsNewEntry[];
}

const HEX = /^[0-9a-f]{7,40}$/;

function isProtocol(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The manifest in a compatibility answer, or `undefined` when there is none a
 * status could be measured against: an older board without one, or a body
 * whose protocol is missing. That is *Could not check*, never a guess.
 */
export function updateManifestOf(body: unknown): UpdateManifest | undefined {
  const root = record(body);
  const protocol = record(root?.protocol);
  if (protocol === undefined || !isProtocol(protocol.current)) return undefined;
  const minClient = isProtocol(protocol.min_client) ? protocol.min_client : 0;

  const cli = record(root?.cli);
  const source = record(cli?.source);
  const commit = source?.commit;
  const minFor: Record<string, number> = {};
  for (const [name, needs] of Object.entries(record(cli?.min_protocol_for) ?? {})) {
    if (isProtocol(needs)) minFor[name] = needs;
  }
  const enabled = Object.entries(record(root?.features) ?? {})
    .filter(([name, on]) => on === true && name in minFor)
    .map(([name]) => name);
  const notes = record(root?.release_notes)?.whats_new;
  const whatsNew = (Array.isArray(notes) ? notes : [])
    .map(record)
    .filter(
      (entry): entry is { protocol: number; summary: string } =>
        entry !== undefined &&
        isProtocol(entry.protocol) &&
        typeof entry.summary === 'string' &&
        entry.summary.trim() !== '',
    )
    .map((entry) => ({ protocol: entry.protocol, summary: entry.summary.trim() }))
    .sort((a, b) => a.protocol - b.protocol);

  return {
    helperCommit: typeof commit === 'string' && HEX.test(commit) ? commit : null,
    protocol: { current: protocol.current, minClient },
    minProtocolFor: minFor,
    enabled,
    whatsNew,
  };
}

// ------------------------------------------------------------------ the tool's side

export type ClientReport = NonNullable<AgentVerification['client_report']>;

/**
 * Where each side's answer stands: `undefined` while it is being read,
 * `'failed'` when the read failed.
 */
export type Read<T> = T | 'failed' | undefined;

export type UpdateKey =
  'checking' | 'up-to-date' | 'available' | 'required' | 'unknown' | 'unchecked';

export interface UpdateStatus {
  readonly key: UpdateKey;
  /** The word on the row: *Up to date*, *Update required for pairing devices*. */
  readonly word: string;
  readonly tone: StatusTone;
  /** Why, from the report and the board's answer only. */
  readonly reason: string;
  /** The features it is required for, in words; empty unless `required`. */
  readonly requiredFor: readonly string[];
  /** The report says the helper is ahead of the board (§H *Board update*). */
  readonly aheadOfBoard: boolean;
}

/**
 * What each feature is called on the page. A feature this build has no words
 * for is shown by its name rather than dropped: the board says it needs it.
 */
const FEATURE_WORDS: Readonly<Record<string, string>> = {
  device_pairing: 'pairing devices',
  tool_setup_exchange: 'adding tools without a secret',
  client_reports: 'version reports',
  project_setups: 'project setup',
};

export function featureWords(name: string): string {
  return FEATURE_WORDS[name] ?? name.replaceAll('_', ' ');
}

/** The first seven characters, as `git log --oneline` shows a commit. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** One commit named twice, each side perhaps abbreviated. */
export function sameCommit(a: string, b: string): boolean {
  if (!HEX.test(a) || !HEX.test(b)) return false;
  const n = Math.min(a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

function status(
  key: UpdateKey,
  word: string,
  tone: StatusTone,
  reason: string,
  over: Partial<Pick<UpdateStatus, 'requiredFor' | 'aheadOfBoard'>> = {},
): UpdateStatus {
  return { key, word, tone, reason, requiredFor: [], aheadOfBoard: false, ...over };
}

export const VERSION_UNKNOWN_REASON =
  'Its helper has not reported a version to this board, so there is nothing to compare';

/**
 * One tool's update status (§H), from the board's manifest and the tool's
 * report.
 *
 * - **Could not check**: either answer failed to arrive — said so, with Retry.
 * - **Version unknown**: no report, or one without a protocol.
 * - **Update required for** *feature*: a feature the board has switched on
 *   needs a newer protocol than the helper reported — or the helper is below
 *   the oldest protocol the board accepts.
 * - **Up to date**: the helper speaks the board's protocol or a newer one,
 *   whatever commit it runs. The same commit as the board's is said so; a
 *   different one is named beside the board's, with no update offered.
 * - **Update available**: the helper speaks a protocol the board accepts
 *   (at least `min_client`) but older than the board's; what it does now
 *   keeps working.
 */
export function updateStatus(
  manifest: Read<UpdateManifest>,
  report: Read<ClientReport | null>,
): UpdateStatus {
  if (manifest === 'failed') {
    return status(
      'unchecked',
      'Could not check',
      'warn',
      'The board’s update information could not be read',
    );
  }
  if (report === 'failed') {
    return status(
      'unchecked',
      'Could not check',
      'warn',
      'This tool’s version report could not be read',
    );
  }
  if (manifest === undefined || report === undefined) {
    return status('checking', 'Checking version', 'neutral', 'Reading what its helper reported');
  }
  if (report?.protocol == null) {
    return status('unknown', 'Version unknown', 'neutral', VERSION_UNKNOWN_REASON);
  }

  const speaks = report.protocol;
  const board = manifest.protocol;
  if (speaks < board.minClient) {
    return status(
      'required',
      'Update required',
      'danger',
      `This board needs helper protocol ${String(board.minClient)} or newer; this one speaks ${String(speaks)}`,
      { requiredFor: ['this board'] },
    );
  }
  const missing = manifest.enabled.filter((name) => (manifest.minProtocolFor[name] ?? 0) > speaks);
  if (missing.length > 0) {
    const words = missing.map(featureWords);
    const needs = Math.max(...missing.map((name) => manifest.minProtocolFor[name] ?? 0));
    return status(
      'required',
      `Update required for ${words.join(', ')}`,
      'danger',
      `${capitalise(words.join(', '))} ${words.length === 1 ? 'needs' : 'need'} helper protocol ${String(needs)}; this one speaks ${String(speaks)}. What it does now keeps working`,
      { requiredFor: words },
    );
  }

  const offered = manifest.helperCommit;
  const runs = report.cli_commit;
  if (offered !== null && runs !== null && sameCommit(offered, runs)) {
    return status(
      'up-to-date',
      'Up to date',
      'ok',
      `Runs the helper this board offers, ${shortCommit(offered)}`,
    );
  }
  if (speaks > board.current) {
    return status(
      'up-to-date',
      'Up to date',
      'ok',
      `This one speaks helper protocol ${String(speaks)}, newer than this board’s ${String(board.current)}`,
      { aheadOfBoard: true },
    );
  }
  if (speaks < board.current) {
    return status(
      'available',
      'Update available',
      'waiting',
      `This board speaks helper protocol ${String(board.current)}; this one speaks ${String(speaks)}. What it does now keeps working`,
    );
  }
  /*
   * The board's protocol, on another commit (review round 1, B1). The page
   * cannot tell whether that commit is behind the board's, ahead of it or on
   * a fork — and `laika update` refuses a target that is not ahead of the
   * checkout (`cli/src/update.ts`), so offering it would hand out a command
   * that fails. The protocol is what the board needs (plan §H: "or protocol
   * current"), so this is *Up to date*, naming both commits, with no update
   * offered. `laika update --check` on the device can still say more.
   */
  if (offered !== null && runs !== null && HEX.test(runs)) {
    return status(
      'up-to-date',
      'Up to date',
      'ok',
      `This one speaks this board’s helper protocol, ${String(board.current)}, on helper ${shortCommit(runs)}; this board offers ${shortCommit(offered)}`,
    );
  }
  return status(
    'up-to-date',
    'Up to date',
    'ok',
    `This one speaks this board’s helper protocol, ${String(board.current)}`,
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The keys a row offers the update actions on: there is something to update to. */
export function offersUpdate(key: UpdateKey): boolean {
  return key === 'available' || key === 'required';
}

// ------------------------------------------------------------------ what's new

export interface WhatsNewLine extends WhatsNewEntry {
  /** Newer than the protocol this tool's helper reported. */
  readonly newForTool: boolean;
}

/**
 * The board's release notes, each marked when it is newer than what this
 * tool's helper speaks. With no report, nothing is marked: the page does not
 * know what the helper lacks.
 */
export function whatsNew(
  manifest: UpdateManifest,
  report: ClientReport | null | undefined,
): WhatsNewLine[] {
  const speaks = report?.protocol ?? null;
  return manifest.whatsNew.map((entry) => ({
    ...entry,
    newForTool: speaks !== null && entry.protocol > speaks,
  }));
}

// ------------------------------------------------------------------ the command

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface UpdateCommand {
  /** What *Copy update command* copies: the check first, then the update. */
  readonly text: string;
  /** The board is plain http off loopback, so `laika update` needs `--allow-http`. */
  readonly allowHttp: boolean;
}

/**
 * `laika update --check`, then `laika update`, against **this** board
 * (§F.5). It names the board by its origin and nothing else: no token, no
 * path, no query — a page address carries none of those into an origin.
 *
 * `--allow-http` only when the board is plain http and not loopback, which
 * is the one case `laika update` refuses without it (`cli/src/update.ts`).
 * `--check` needs no flag; it only warns.
 */
export function updateCommand(origin: string): UpdateCommand {
  let url: URL | undefined;
  try {
    url = new URL(origin);
  } catch {
    url = undefined;
  }
  const board =
    url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:')
      ? url.origin
      : undefined;
  const allowHttp = url?.protocol === 'http:' && !LOOPBACK.has(url.hostname);
  const at = board === undefined ? '' : ` --board ${board}`;
  return {
    text: [
      `laika update --check${at}`,
      `laika update${at}${allowHttp ? ' --allow-http' : ''}`,
    ].join('\n'),
    allowHttp,
  };
}

export const ALLOW_HTTP_WHY =
  'This board is reached over plain http, so the commit it names could be changed on the way. laika update refuses to act on it unless you add --allow-http, and even then fetches only from a repository your checkout already has as a remote.';

/**
 * After the update (§H): what to run, and when the row changes. Today a
 * helper reports its version when a tool is set up or reconnected
 * (`laika tool add`), so the row is honest about that.
 */
export const AFTER_UPDATE =
  'Then run laika doctor on that device to confirm it. This row changes when the tool’s helper next reports its version to the board — reconnecting the tool sends one.';

// ------------------------------------------------------------------ a device

/** Worst first: what the device card names first. */
const ORDER: readonly UpdateKey[] = [
  'required',
  'available',
  'unchecked',
  'unknown',
  'checking',
  'up-to-date',
];

const SUMMARY_WORDS: Readonly<Record<UpdateKey, string>> = {
  required: 'update required',
  available: 'update available',
  unchecked: 'could not check',
  unknown: 'version unknown',
  checking: 'checking',
  'up-to-date': 'up to date',
};

/**
 * The device card's line: how many of its tools are in each update status,
 * worst first — *Helper updates: 1 update required, 1 up to date*. `undefined`
 * with no tools, or while every one is still being read.
 */
export function deviceUpdateSummary(statuses: readonly UpdateStatus[]): string | undefined {
  if (statuses.length === 0 || statuses.every((s) => s.key === 'checking')) return undefined;
  if (statuses.every((s) => s.key === 'up-to-date')) {
    return statuses.length === 1 ? 'Helper up to date' : 'Helpers up to date on every tool';
  }
  const parts = ORDER.flatMap((key) => {
    const n = statuses.filter((s) => s.key === key).length;
    if (n === 0 || key === 'checking') return [];
    return [`${String(n)} ${SUMMARY_WORDS[key]}`];
  });
  return `Helper updates: ${parts.join(', ')}`;
}

/** The worst status on a device, for its card's data attribute. */
export function worstUpdate(statuses: readonly UpdateStatus[]): UpdateKey | undefined {
  return ORDER.find((key) => statuses.some((s) => s.key === key));
}

// ------------------------------------------------------------------ the board

/**
 * §H *Board update*: shown to an org owner or admin, and **only** when what
 * the board was sent says the board is behind — a helper speaking a newer
 * protocol than the board. Nothing else here can say the board is behind,
 * so otherwise there is no line at all.
 */
export function boardBehindNote(
  orgRole: string | undefined,
  statuses: readonly UpdateStatus[],
): string | undefined {
  if (orgRole !== 'owner' && orgRole !== 'admin') return undefined;
  if (!statuses.some((s) => s.aheadOfBoard)) return undefined;
  return 'A tool’s helper is newer than this board. The board is updated by whoever runs this instance; your devices update themselves with laika update.';
}

/** What the live region says when a polled report changed a row. */
export function updateAnnouncement(label: string, next: UpdateStatus): string {
  return `${label}: ${next.word}.`;
}

/** The report's identity, to tell a new one from the same one read again. */
export function reportKey(report: ClientReport | null): string {
  if (report === null) return 'none';
  return [report.cli_version, report.cli_commit, report.protocol, report.reported_at].join('|');
}
