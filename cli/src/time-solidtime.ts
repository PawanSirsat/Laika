import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { addDays, localDay } from './activity-census.ts';
import { findCredentials } from './activity-sync.ts';
import { normaliseUrl, signIn, whoAmI } from './api.ts';
import { writePrivately } from './connect.ts';
import * as st from './solidtime.ts';
import { stMs, stTime, type Connection, type StEntry } from './solidtime.ts';

/**
 * `laika time connect|status|push|pull|people|map|start|stop|disconnect` —
 * the Solidtime bridge (LAI-788, D-088 items 6 and 10).
 *
 * **Solidtime is reached from here and only from here.** The person's own
 * Solidtime URL and key live in `~/.laika/solidtime.json`, `0600`, and go to
 * Solidtime and nowhere else: the board is never told either, and never calls
 * Solidtime itself (SPEC §13.4).
 *
 * **The board is reached signed in.** Pushing confirmed time means reading
 * it, and the board serves a person's hours to no token (§3.1) — so every run
 * that talks to the board asks for the Laika password, signs in, and signs
 * out at the end, keeping nothing. An agent holding this machine's Laika
 * token can neither read the hours nor send them anywhere.
 *
 * ## What goes where
 *
 * - **push** writes the person's confirmed entries to Solidtime as
 *   `KEY title` (Solidtime's own extension's form), on the project their
 *   space maps to, billable as that project is. Nothing in a closed period;
 *   never agent minutes, which never become entries at all.
 * - **pull** re-reads a window of recent days from Solidtime — it has no
 *   webhook and no `updated_at` — and sends the board, per entry, start, end,
 *   project id, a key read from the description and a digest. **Never the
 *   description.**
 *
 * ## No duplicates, though Solidtime has no idempotency
 *
 * Every entry this machine creates is written to `solidtime-sent.json` before
 * the board is told, and before each create the window is read back: an
 * entry this log names, or one with the same start, end and key, is taken as
 * the one already there rather than written again. Once the board records the
 * link (§4.54), the entry is never offered as new again, from any machine.
 *
 * ## Once there, Solidtime is the record
 *
 * A Laika edit or delete is written to Solidtime only while Solidtime still
 * holds what Laika last saw — compared here, before writing. If Solidtime
 * changed too, it is left alone, and the next pull brings its version in.
 */

export interface TimeIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowMs: () => number;
  readonly tz: string;
  readonly ask?: (question: string) => Promise<string>;
  readonly askSecret?: (question: string) => Promise<string>;
}

/** Pulled by default: five weeks, so a month's late edits are caught. */
export const PULL_DAYS_DEFAULT = 35;
export const PULL_DAYS_MAX = 92;
/** What one import may carry (SPEC §6.4). */
export const IMPORT_MAX = 2000;
/** Where a timeless entry starts: 09:00 on its day (SPEC §6.4). */
export const TIMELESS_START_MINUTE = 9 * 60;
/** Solidtime's longest description. */
const DESCRIPTION_MAX = 5000;
/** The sent-log forgets an entry this long after it wrote it. */
const SENT_KEPT_MS = 400 * 86_400_000;
const DAY_MS = 86_400_000;

export const TIME_SOLIDTIME_USAGE = [
  '  laika time connect [--url URL] [--org ID|NAME] [--since YYYY-MM-DD]',
  '                                 keep your Solidtime URL and API key on this machine',
  '                                 (0600, never sent to Laika); time from --since on is pushed',
  '  laika time status              where this machine sends time, and the last push and pull',
  '  laika time push [--since DAY] [--dry-run]',
  '                                 write your confirmed time to Solidtime as KEY title',
  '  laika time pull [--days N] [--all]',
  '                                 bring back what was logged in Solidtime in the last N days',
  '                                 (default 35); --all: everyone, for an owner or admin',
  '  laika time people              owners, admins: confirm which Solidtime member is who',
  '  laika time map [PROJECT SPACE [--push] | PROJECT --none]',
  '                                 owners, admins: which space a Solidtime project belongs to',
  '  laika time start KEY [--switch]',
  '                                 start a Solidtime timer for a card (you, never an agent)',
  '  laika time stop                stop your running Solidtime timer',
  '  laika time disconnect          forget Solidtime on this machine',
];

// -------------------------------------------------------------- the store

export interface Store {
  readonly v: 1;
  readonly url: string;
  readonly token: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly member_id: string;
  readonly member_name: string;
  /** The board this connection is for, and the Laika account that signs in to it. */
  readonly board: string;
  readonly laika_email: string;
  /** Confirmed time on or after this day is pushed. */
  readonly since: string;
  readonly connected_at: number;
  /** Each space's Solidtime project, as the last push learned it — for a timer. */
  readonly projects?: readonly { space: string; space_id: string; solidtime_project_id: string }[];
  readonly last_push?: Readonly<Record<string, number | string>>;
  readonly last_pull?: Readonly<Record<string, number | string>>;
}

interface SentLog {
  v: 1;
  sent: Record<string, { solidtime_id: string; revision: number; at: number }>;
}

export const storePath = (home: string): string => join(home, '.laika', 'solidtime.json');
export const sentPath = (home: string): string => join(home, '.laika', 'solidtime-sent.json');

function ensureLaikaDir(home: string): void {
  const dir = join(home, '.laika');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function readStore(home: string): Store | undefined {
  try {
    const parsed = JSON.parse(readFileSync(storePath(home), 'utf8')) as Partial<Store>;
    if (parsed.v !== 1 || typeof parsed.url !== 'string' || typeof parsed.token !== 'string') {
      return undefined;
    }
    return parsed as Store;
  } catch {
    return undefined;
  }
}

function writeStore(home: string, store: Store): void {
  ensureLaikaDir(home);
  writePrivately(storePath(home), `${JSON.stringify(store, null, 2)}\n`);
}

function readSent(home: string): SentLog {
  try {
    const parsed = JSON.parse(readFileSync(sentPath(home), 'utf8')) as Partial<SentLog>;
    if (parsed.v === 1 && typeof parsed.sent === 'object' && parsed.sent !== null) {
      return { v: 1, sent: parsed.sent };
    }
  } catch {
    // None yet, or unreadable: the board's links and the window check still hold.
  }
  return { v: 1, sent: {} };
}

function writeSent(home: string, log: SentLog, nowMs: number): void {
  for (const [id, s] of Object.entries(log.sent)) {
    if (nowMs - s.at > SENT_KEPT_MS) Reflect.deleteProperty(log.sent, id);
  }
  ensureLaikaDir(home);
  writePrivately(sentPath(home), `${JSON.stringify(log)}\n`);
}

const connection = (store: Store): Connection => ({
  url: store.url,
  token: store.token,
  organizationId: store.organization_id,
});

// ------------------------------------------------- keys, digests, instants

const KEY = /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9})(?![A-Za-z0-9_-])/g;
const LEADING_KEY = /^([A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9})(?![A-Za-z0-9_-])/;

/**
 * The card a Solidtime description names, by Laika's never-guess rule: the
 * key it **starts** with — `KEY title`, the form Solidtime's own extension
 * writes — or else the only key in it. None, or several and none first, is
 * no key: the entry stays on its project. Upper-cased, as outside ids are
 * kept. The board then resolves it, and refuses one two cards carry.
 */
export function keyIn(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  const lead = LEADING_KEY.exec(trimmed);
  if (lead?.[1] !== undefined) return lead[1].toUpperCase();
  const all = new Set([...trimmed.matchAll(KEY)].map((m) => (m[1] ?? '').toUpperCase()));
  return all.size === 1 ? ([...all][0] ?? null) : null;
}

/** The key of a Solidtime entry: its task's name wins over its description. */
export function entryKey(e: StEntry, taskNames: ReadonlyMap<string, string>): string | null {
  const fromTask = e.task_id === null ? null : keyIn(taskNames.get(e.task_id));
  return fromTask ?? keyIn(e.description);
}

/**
 * What Laika compares a Solidtime entry by (§4.54): start and end to the
 * second, project, task and the key — **not the description**, which never
 * leaves this machine, so a reworded description is not an edit.
 */
export function entryHash(e: StEntry, key: string | null): string {
  const end = e.end === null ? null : Math.floor(stMs(e.end) / 1000);
  return createHash('sha256')
    .update(JSON.stringify([Math.floor(stMs(e.start) / 1000), end, e.project_id, e.task_id, key]))
    .digest('hex');
}

function wall(ms: number, tz: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** The instant a wall-clock minute of a local day names in `tz`. */
export function localInstant(day: string, minute: number, tz: string): number {
  const want = Date.parse(`${day}T00:00:00Z`) + minute * 60_000;
  let at = want;
  for (let i = 0; i < 4; i += 1) {
    const w = wall(at, tz);
    const seen = Date.parse(`${w.day}T00:00:00Z`) + w.minute * 60_000;
    if (seen === want) break;
    at -= seen - want;
  }
  return at;
}

/** `3 h 12 min`, `45 min`. */
export function span(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${String(m)} min`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

// ------------------------------------------------------------- the board

interface Board {
  readonly url: string;
  readonly cookie: string;
}

type BoardResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly reason?: string;
      readonly message: string;
    };

async function boardCall<T>(
  b: Board,
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
): Promise<BoardResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${b.url}${path}`, {
      method,
      headers: {
        cookie: b.cookie,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(st.REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      message: `could not reach the board (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    const reason = (error?.details as { reason?: unknown } | null | undefined)?.reason;
    return {
      ok: false,
      status: response.status,
      ...(typeof reason === 'string' ? { reason } : {}),
      message: `the board answered ${String(response.status)}${
        typeof error?.message === 'string' ? `: ${error.message}` : ''
      }`,
    };
  }
  return { ok: true, value: parsed as T };
}

/** What a refusal means to the person, where the board said why. */
function explain(r: { reason?: string; status?: number; message: string }): string {
  switch (r.reason) {
    case 'time_off':
      return 'Time is off for this organisation on the board; an owner or admin turns it on.';
    case 'session_required':
      return 'The board wants a signed-in session for this, and the sign-in did not take.';
    case 'member_linked_elsewhere':
      return 'An admin confirmed this Solidtime account as somebody else on the board. Ask them to check `laika time people`.';
    default:
      return r.status === 403 ? `${r.message} — only an owner or admin may do this.` : r.message;
  }
}

/**
 * Sign in to the board for this run — the person's password, asked here and
 * never a flag (prompt.ts) — or `undefined` with the reason printed.
 */
async function signInToBoard(io: TimeIo, store: Store): Promise<Board | undefined> {
  if (acceptableUrl(store.board) === undefined) {
    io.err(plainHttp(store.board));
    return undefined;
  }
  if (io.askSecret === undefined) {
    io.err('This needs your Laika password, and nothing here can ask for it.');
    return undefined;
  }
  const password = await io.askSecret(`Laika password for ${store.laika_email}`);
  if (password === '') {
    io.err('No password given, so nothing was done.');
    return undefined;
  }
  const session = await signIn(store.board, store.laika_email, password);
  if (!session.ok) {
    io.err(`Could not sign in to ${store.board}: ${session.error.message}`);
    return undefined;
  }
  return { url: store.board, cookie: session.value.cookie };
}

/** End the run's session, so nothing signed in outlives it. */
async function signOut(b: Board): Promise<void> {
  try {
    await fetch(`${b.url}/api/v1/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: b.cookie, origin: b.url, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(st.REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The session expires on its own; nothing on this machine keeps it.
  }
}

/** Sign in, run, sign out — whatever happens in between. */
async function signedIn(
  io: TimeIo,
  store: Store,
  run: (b: Board) => Promise<number>,
): Promise<number> {
  const board = await signInToBoard(io, store);
  if (board === undefined) return 1;
  try {
    return await run(board);
  } finally {
    await signOut(board);
  }
}

// --------------------------------------------------------------- commands

function option(args: readonly string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return undefined;
  const arg = args[i] ?? '';
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (args[i + 1] ?? '');
}

const isDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function today(io: TimeIo): string {
  return localDay(Math.floor(io.nowMs() / 1000), io.tz);
}

function needStore(io: TimeIo): Store | undefined {
  const store = readStore(io.home);
  if (store === undefined) {
    io.err('This machine is not connected to Solidtime yet: laika time connect');
  }
  return store;
}

/** Why a board on plain http to another machine gets no password. */
function plainHttp(board: string): string {
  return `The board is ${board}: signing in would send your Laika password over plain http, where it can be read on the way. Use the board's https address (or one on this machine).`;
}

/** http only to this machine: a key sent in the clear can be read on the way. */
function acceptableUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
  return normaliseUrl(`${url.origin}${url.pathname}`);
}

export async function solidtimeCommand(
  command: string,
  args: readonly string[],
  io: TimeIo,
): Promise<number | undefined> {
  switch (command) {
    case 'connect':
      return connect(args, io);
    case 'status':
      return status(io);
    case 'push':
      return push(args, io);
    case 'pull':
      return pull(args, io);
    case 'people':
      return people(args, io);
    case 'map':
      return map(args, io);
    case 'start':
      return start(args, io);
    case 'stop':
      return stop(io);
    case 'disconnect':
      return disconnect(io);
    default:
      return undefined;
  }
}

async function connect(args: readonly string[], io: TimeIo): Promise<number> {
  const creds = findCredentials(io.home, io.env);
  if (creds === undefined) {
    io.err('This machine is not connected to a Laika board yet: laika connect (or laika init).');
    return 1;
  }
  // Each push and pull signs in to it with the password: refused here, first.
  if (acceptableUrl(creds.url) === undefined) {
    io.err(plainHttp(creds.url));
    return 1;
  }
  const laika = await whoAmI(creds.url, creds.token);
  if (!laika.ok) {
    io.err(`The board did not say who you are: ${laika.error.message}`);
    return 1;
  }
  const since = option(args, '--since') ?? today(io);
  if (!isDay(since)) {
    io.err('laika time connect: --since takes a day, YYYY-MM-DD');
    return 1;
  }
  const typed =
    option(args, '--url') ?? (await io.ask?.('Solidtime URL, such as https://time.example.com'));
  const url = acceptableUrl((typed ?? '').trim());
  if (url === undefined) {
    io.err(
      'That is not a Solidtime URL this will send a key to: https://, or http:// on this machine.',
    );
    return 1;
  }
  if (io.askSecret === undefined) {
    io.err('This needs your Solidtime API key, and nothing here can ask for it.');
    return 1;
  }
  // Never a flag: a key on a command line lands in shell history.
  const token = (
    await io.askSecret('Solidtime API key (your profile, API tokens; it stays on this machine)')
  ).trim();
  if (token === '') {
    io.err('No key given, so nothing was saved.');
    return 1;
  }
  const c: Connection = { url, token };
  const who = await st.me(c);
  if (!who.ok) {
    io.err(who.message);
    return 1;
  }
  // **Matched by email here, and only here** (D-088 item 10): neither address is sent anywhere.
  if (who.value.email.trim().toLowerCase() !== laika.value.email.trim().toLowerCase()) {
    io.err(
      `That Solidtime key is ${who.value.email}'s, and you are ${laika.value.email} on Laika.`,
    );
    io.err('Connect the Solidtime account that is yours; nothing was saved.');
    return 1;
  }
  const orgs = await st.memberships(c);
  if (!orgs.ok) {
    io.err(orgs.message);
    return 1;
  }
  const wanted = option(args, '--org');
  let chosen = orgs.value.length === 1 ? orgs.value[0] : undefined;
  if (wanted !== undefined) {
    chosen = orgs.value.find(
      (m) =>
        m.organization.id === wanted || m.organization.name.toLowerCase() === wanted.toLowerCase(),
    );
  } else if (orgs.value.length > 1 && io.ask !== undefined) {
    orgs.value.forEach((m, i) => {
      io.out(`  ${String(i + 1)}. ${m.organization.name}`);
    });
    const pick = Number(await io.ask('Which organisation'));
    chosen = orgs.value[pick - 1];
  }
  if (chosen === undefined) {
    io.err(
      orgs.value.length === 0
        ? 'That Solidtime account belongs to no organisation.'
        : `Name the organisation with --org: ${orgs.value.map((m) => m.organization.name).join(', ')}`,
    );
    return 1;
  }
  writeStore(io.home, {
    v: 1,
    url,
    token,
    organization_id: chosen.organization.id,
    organization_name: chosen.organization.name,
    member_id: chosen.id,
    member_name: who.value.name,
    board: creds.url,
    laika_email: laika.value.email,
    since,
    connected_at: io.nowMs(),
  });
  io.out(`Connected to Solidtime at ${url} as ${who.value.name}, in ${chosen.organization.name}.`);
  io.out('The URL and key are in ~/.laika/solidtime.json, readable only by you, and are never');
  io.out('sent to Laika. Each push and pull asks for your Laika password and signs out after.');
  io.out(`Your confirmed time from ${since} on goes to Solidtime with: laika time push`);
  io.out('What you log in Solidtime comes back to Laika with:           laika time pull');
  return 0;
}

async function status(io: TimeIo): Promise<number> {
  const store = readStore(io.home);
  if (store === undefined) {
    io.out('Not connected to Solidtime. Connect with: laika time connect');
    return 0;
  }
  const sent = Object.keys(readSent(io.home).sent).length;
  io.out(`Solidtime  ${store.url} — ${store.member_name} in ${store.organization_name}`);
  io.out(`Board      ${store.board}, signed in as ${store.laika_email} for each run`);
  io.out('The key stays in ~/.laika/solidtime.json (0600) and is never sent to Laika.');
  io.out(
    `Push       confirmed time from ${store.since}; ${String(sent)} written from this machine`,
  );
  const line = (what: string, last: Readonly<Record<string, number | string>> | undefined) =>
    last === undefined
      ? `${what} never`
      : `${what} ${new Date(Number(last.at)).toISOString().replace('T', ' ').slice(0, 16)}Z — ${Object.entries(
          last,
        )
          .filter(([k]) => k !== 'at')
          .map(([k, v]) => `${k} ${String(v)}`)
          .join(', ')}`;
  io.out(line('Last push ', store.last_push));
  io.out(line('Last pull ', store.last_pull));
  const running = await st.activeEntry(connection(store));
  if (!running.ok) io.out(`Timer      Solidtime did not answer: ${running.message}`);
  else if (running.value === null) io.out('Timer      none running');
  else {
    io.out(
      `Timer      ${running.value.description ?? '(no description)'}, running for ${span(
        (io.nowMs() - stMs(running.value.start)) / 60_000,
      )}`,
    );
  }
  return 0;
}

function disconnect(io: TimeIo): number {
  rmSync(storePath(io.home), { force: true });
  rmSync(sentPath(io.home), { force: true });
  io.out('Forgot Solidtime on this machine. Nothing changed in Solidtime or on the board.');
  return 0;
}

// ------------------------------------------------------------------ push

interface PushItem {
  entry_id: string;
  revision: number;
  action: 'create' | 'update' | 'delete';
  day: string;
  tz: string;
  started_at: number | null;
  offset_minutes: number;
  minutes: number;
  task: { key: string; title: string } | null;
  project: { slug: string; name: string } | null;
  solidtime_project_id: string | null;
  note: string | null;
  moved?: boolean;
  solidtime: { id: string; hash: string; started_at: number } | null;
}

interface Outbox {
  closed_through: string | null;
  push: PushItem[];
  held: { entry_id: string; day: string; reason: string }[];
  projects: { space: string; space_id: string; solidtime_project_id: string }[];
  taken?: string[];
}

interface Link {
  entry_id: string;
  revision: number;
  solidtime_id: string;
  hash: string;
  started_at: number;
  removed?: true;
}

/** `KEY title` for a card, Solidtime's own extension's form; the note otherwise. */
export function describe(item: Pick<PushItem, 'task' | 'note'>): string | null {
  const text = item.task === null ? item.note : `${item.task.key} ${item.task.title}`;
  return text === null ? null : text.slice(0, DESCRIPTION_MAX);
}

/** Where a new entry starts: its own start, or 09:00 local after the day's earlier timeless ones. */
function startOf(item: PushItem): number {
  const at =
    item.started_at ?? localInstant(item.day, TIMELESS_START_MINUTE + item.offset_minutes, item.tz);
  return Math.floor(at / 1000) * 1000;
}

const seconds = (ms: number): number => Math.floor(ms / 1000);

const HELD: Record<string, string> = {
  closed_period: 'in a closed period — Solidtime is not rewritten there',
  space_not_mapped: 'on a space no Solidtime project is mapped to (laika time map)',
  space_has_several_projects:
    'on a space several Solidtime projects map to, none marked --push (laika time map)',
};

async function push(args: readonly string[], io: TimeIo): Promise<number> {
  const store = needStore(io);
  if (store === undefined) return 1;
  const since = option(args, '--since') ?? store.since;
  if (!isDay(since)) {
    io.err('laika time push: --since takes a day, YYYY-MM-DD');
    return 1;
  }
  const dry = args.includes('--dry-run');
  return signedIn(io, store, async (board) => {
    const box = await boardCall<Outbox>(
      board,
      'GET',
      `/api/v1/me/time/solidtime?since=${encodeURIComponent(since)}`,
    );
    if (!box.ok) {
      io.err(explain(box));
      return 1;
    }
    const outbox = box.value;
    const c = connection(store);

    let billable = new Map<string, boolean>();
    if (outbox.push.some((p) => p.solidtime_project_id !== null)) {
      const list = await st.projects(c);
      if (!list.ok) {
        io.err(list.message);
        return 1;
      }
      billable = new Map(list.value.map((p) => [p.id, p.is_billable]));
    }

    // What Solidtime already holds around these entries, read whole — the
    // duplicate check and the compare-before-write both need all of it.
    const starts = outbox.push.map((p) =>
      p.action === 'create' ? startOf(p) : (p.solidtime?.started_at ?? startOf(p)),
    );
    let existing: StEntry[] = [];
    if (starts.length > 0) {
      const read = await st.entries(c, {
        fromMs: Math.min(...starts) - DAY_MS,
        toMs: Math.max(...starts) + DAY_MS,
        memberId: store.member_id,
      });
      if (!read.ok || !read.value.complete) {
        io.err(
          `Solidtime did not answer for the whole window, so nothing was written: ${
            read.ok ? (read.value.stopped ?? 'a page was missing') : read.message
          }`,
        );
        return 1;
      }
      existing = read.value.entries;
    }
    const byId = new Map(existing.map((e) => [e.id, e]));
    // Hashed exactly as a pull hashes, or a twin on a Solidtime task would
    // always look changed there and never be updated.
    let taskNames = new Map<string, string>();
    if (existing.some((e) => e.task_id !== null)) {
      const list = await st.tasks(c);
      if (!list.ok) {
        io.err(list.message);
        return 1;
      }
      taskNames = new Map(list.value.map((t) => [t.id, t.name]));
    }
    const taken = new Set(outbox.taken ?? []);
    // What this run itself took for an entry, and what it deleted: a
    // Solidtime entry taken for one is never deleted or rewritten for another,
    // and one deleted is never taken (review B1 — an hour lost from both).
    const linkedNow = new Set<string>();
    const deletedNow = new Set<string>();
    const sent = readSent(io.home);
    const links: Link[] = [];
    const done = { created: 0, matched: 0, updated: 0, deleted: 0 };
    const notes: string[] = [];
    const hashOf = (e: StEntry) => entryHash(e, entryKey(e, taskNames));
    const link = (item: PushItem, e: StEntry): void => {
      taken.add(e.id);
      linkedNow.add(e.id);
      links.push({
        entry_id: item.entry_id,
        revision: item.revision,
        solidtime_id: e.id,
        hash: hashOf(e),
        started_at: stMs(e.start),
      });
    };
    const label = (item: PushItem): string =>
      `${item.day} ${span(item.minutes)} ${describe(item) ?? item.project?.name ?? 'General'}`;

    for (const item of outbox.push) {
      const description = describe(item);
      const isBillable =
        item.solidtime_project_id !== null && billable.get(item.solidtime_project_id) === true;

      if (item.action === 'create') {
        const startMs = startOf(item);
        const endMs = startMs + item.minutes * 60_000;
        const prior = sent.sent[item.entry_id];
        const before = prior === undefined ? undefined : byId.get(prior.solidtime_id);
        if (before !== undefined) {
          // This machine wrote it and the board never heard: the same entry,
          // brought up to what Laika holds now if it was edited since.
          const drifted =
            before.end === null ||
            seconds(stMs(before.start)) !== seconds(startMs) ||
            seconds(stMs(before.end)) !== seconds(endMs) ||
            (before.description ?? null) !== description ||
            before.project_id !== item.solidtime_project_id;
          if (drifted && dry) {
            io.out(`  would update  ${label(item)}`);
            continue;
          }
          const now = drifted
            ? await st.updateEntry(c, before.id, {
                project_id: item.solidtime_project_id,
                start: stTime(startMs),
                end: stTime(endMs),
                billable: isBillable,
                description,
              })
            : ({ ok: true, value: before } as const);
          if (!now.ok) {
            notes.push(`  not updated   ${label(item)} — ${now.message}`);
            continue;
          }
          link(item, now.value);
          done.matched += 1;
          continue;
        }
        const same = existing.find(
          (e) =>
            !taken.has(e.id) &&
            !deletedNow.has(e.id) &&
            e.end !== null &&
            seconds(stMs(e.start)) === seconds(startMs) &&
            seconds(stMs(e.end)) === seconds(endMs) &&
            keyIn(e.description) === keyIn(description) &&
            (keyIn(description) !== null || (e.description ?? '') === (description ?? '')),
        );
        if (same !== undefined) {
          link(item, same);
          done.matched += 1;
          continue;
        }
        if (dry) {
          io.out(`  would create  ${label(item)}`);
          continue;
        }
        const made = await st.createEntry(c, {
          member_id: store.member_id,
          project_id: item.solidtime_project_id,
          task_id: null,
          start: stTime(startMs),
          end: stTime(endMs),
          billable: isBillable,
          description,
          tags: [],
          type: 'work',
        });
        if (!made.ok) {
          notes.push(
            `  not written   ${label(item)} — ${
              made.key === 'overlapping_time_entry'
                ? 'it overlaps an entry already in Solidtime; trim one of them'
                : made.message
            }`,
          );
          continue;
        }
        // Written down before the board hears of it: a run that dies here is
        // caught by this log next time, not by a second entry.
        sent.sent[item.entry_id] = {
          solidtime_id: made.value.id,
          revision: item.revision,
          at: io.nowMs(),
        };
        writeSent(io.home, sent, io.nowMs());
        link(item, made.value);
        done.created += 1;
        continue;
      }

      const twin = item.solidtime === null ? undefined : byId.get(item.solidtime.id);
      if (item.solidtime === null) continue;
      if (linkedNow.has(item.solidtime.id)) {
        notes.push(
          `  left alone    ${label(item)} — it is now another entry's in Solidtime, taken this run`,
        );
        continue;
      }
      if (twin === undefined) {
        if (item.action === 'delete') {
          if (!dry) links.push({ ...linkOf(item), removed: true });
          continue;
        }
        notes.push(
          `  left alone    ${label(item)} — deleted in Solidtime; the next pull takes that`,
        );
        continue;
      }
      if (hashOf(twin) !== item.solidtime.hash) {
        notes.push(
          `  left alone    ${label(item)} — changed in Solidtime too; Solidtime's is kept, and the next pull brings it`,
        );
        continue;
      }
      if (dry) {
        io.out(`  would ${item.action === 'delete' ? 'delete' : 'update'}  ${label(item)}`);
        continue;
      }
      if (item.action === 'delete') {
        const gone = await st.deleteEntry(c, twin.id);
        if (!gone.ok && gone.status !== 404) {
          notes.push(`  not deleted   ${label(item)} — ${gone.message}`);
          continue;
        }
        links.push({ ...linkOf(item), removed: true });
        deletedNow.add(twin.id);
        byId.delete(twin.id);
        done.deleted += 1;
        continue;
      }
      const startMs =
        item.started_at ??
        (localDay(seconds(stMs(twin.start)), item.tz) === item.day
          ? stMs(twin.start)
          : startOf(item));
      const moved = item.moved === true;
      const changed = await st.updateEntry(c, twin.id, {
        start: stTime(startMs),
        end: stTime(startMs + item.minutes * 60_000),
        // Solidtime's project and description are the person's words there:
        // changed only when Laika's card or space did.
        ...(moved
          ? { project_id: item.solidtime_project_id, description, billable: isBillable }
          : {}),
      });
      if (!changed.ok) {
        notes.push(`  not updated   ${label(item)} — ${changed.message}`);
        continue;
      }
      link(item, changed.value);
      done.updated += 1;
    }

    if (dry) {
      io.out(`Dry run: nothing was written to Solidtime or to the board.`);
      return 0;
    }
    for (let i = 0; i < links.length; i += IMPORT_MAX) {
      const recorded = await boardCall<{ linked: number; removed: number; retired: number }>(
        board,
        'PUT',
        '/api/v1/me/time/solidtime/links',
        { member_id: store.member_id, links: links.slice(i, i + IMPORT_MAX) },
      );
      if (!recorded.ok) {
        io.err(
          `Solidtime has the entries, and the board did not record them: ${explain(recorded)}`,
        );
        io.err('Run laika time push again: what was written is recognised, not written twice.');
        return 1;
      }
    }

    io.out(
      `Pushed to Solidtime: ${String(done.created)} new, ${String(done.updated)} updated, ${String(
        done.deleted,
      )} deleted${done.matched === 0 ? '' : `, ${String(done.matched)} already there`}.`,
    );
    for (const n of notes) io.out(n);
    for (const h of outbox.held) {
      io.out(`  held          ${h.day} ${HELD[h.reason] ?? h.reason}`);
    }
    writeStore(io.home, {
      ...store,
      projects: outbox.projects,
      last_push: {
        at: io.nowMs(),
        created: done.created,
        updated: done.updated,
        deleted: done.deleted,
        held: outbox.held.length,
      },
    });
    return notes.some((n) => n.startsWith('  not ')) ? 1 : 0;
  });
}

function linkOf(item: PushItem): Link {
  return {
    entry_id: item.entry_id,
    revision: item.revision,
    solidtime_id: item.solidtime?.id ?? '',
    hash: item.solidtime?.hash ?? '',
    started_at: item.solidtime?.started_at ?? 0,
  };
}

// ------------------------------------------------------------------ pull

interface ImportEntry {
  id: string;
  member_id?: string;
  start: number;
  end: number;
  project_id: string | null;
  key: string | null;
  hash: string;
}

interface ImportResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  ignored: number;
  conflicts: number;
  flagged: { solidtime_id: string; day: string; reason: string }[];
  not_on_laika?: { people: number; minutes: number };
}

const FLAGGED: Record<string, string> = {
  closed_period: 'changed in Solidtime after its period closed — not taken',
  day_full: 'would put more than 24 hours on the day — not taken',
  day_out_of_range: 'older than a year — not taken',
  too_long: 'longer than a day — not taken',
  member_linked_elsewhere: 'is somebody else’s on the board — not taken',
};

async function pull(args: readonly string[], io: TimeIo): Promise<number> {
  const store = needStore(io);
  if (store === undefined) return 1;
  const daysArg = option(args, '--days');
  const days = daysArg === undefined ? PULL_DAYS_DEFAULT : Number(daysArg);
  if (!Number.isInteger(days) || days < 1 || days > PULL_DAYS_MAX) {
    io.err(`laika time pull: --days takes 1 to ${String(PULL_DAYS_MAX)}`);
    return 1;
  }
  const everyone = args.includes('--all');
  const c = connection(store);
  const nowMs = io.nowMs();
  const fromDay = localDay(seconds(nowMs) - (days - 1) * 86_400, io.tz);
  const fromMs = localInstant(fromDay, 0, io.tz);
  // To the end of today, not to now: a typed entry is pushed at 09:00, and a
  // meeting is logged before it happens — both start later than a morning's
  // "now". Never past a day ahead, which the board refuses.
  const toMs = Math.min(
    localInstant(addDays(localDay(seconds(nowMs), io.tz), 1), 0, io.tz) - 1000,
    nowMs + DAY_MS,
  );

  // Solidtime first: if it cannot be read there is nothing to sign in for.
  let memberOf = new Map<string, string>([]);
  let covered: string[] = [store.member_id];
  if (everyone) {
    const list = await st.members(c);
    if (!list.ok) {
      io.err(
        list.status === 403
          ? 'Your Solidtime role cannot see everyone’s time (that needs manager or above). Pull your own without --all.'
          : list.message,
      );
      return 1;
    }
    memberOf = new Map(list.value.map((m) => [m.user_id, m.id]));
    covered = list.value.map((m) => m.id);
  }
  const read = await st.entries(c, {
    fromMs,
    toMs,
    ...(everyone ? {} : { memberId: store.member_id }),
  });
  if (!read.ok) {
    io.err(read.message);
    return 1;
  }
  const window = read.value;
  let taskNames = new Map<string, string>();
  if (window.entries.some((e) => e.task_id !== null)) {
    // A task's name is the key that wins (§4.2 of the research): without it a
    // key would be read from the description alone, and a card guessed wrong.
    const list = await st.tasks(c);
    if (!list.ok) {
      io.err(`Solidtime's task list could not be read, so nothing was sent: ${list.message}`);
      return 1;
    }
    taskNames = new Map(list.value.map((t) => [t.id, t.name]));
  }
  const running = window.entries.filter((e) => e.end === null).length;
  const byMember = new Map<string, ImportEntry[]>(covered.map((m) => [m, []]));
  for (const e of window.entries) {
    if (e.end === null) continue;
    const member = everyone ? memberOf.get(e.user_id) : store.member_id;
    if (member === undefined) continue;
    const key = entryKey(e, taskNames);
    byMember.get(member)?.push({
      id: e.id,
      ...(everyone ? { member_id: member } : {}),
      start: stMs(e.start),
      end: stMs(e.end),
      project_id: e.project_id,
      key,
      hash: entryHash(e, key),
    });
  }

  // Whole members to a batch, so an absence is only ever read as a delete
  // for a member whose every entry the batch carries.
  const batches: { members: string[]; entries: ImportEntry[] }[] = [];
  let current = { members: [] as string[], entries: [] as ImportEntry[] };
  for (const [member, list] of byMember) {
    if (list.length > IMPORT_MAX) {
      io.err(
        `Solidtime holds more than ${String(IMPORT_MAX)} entries in ${String(days)} days for one person; pull fewer --days.`,
      );
      return 1;
    }
    if (current.entries.length + list.length > IMPORT_MAX) {
      batches.push(current);
      current = { members: [], entries: [] };
    }
    current.members.push(member);
    current.entries.push(...list);
  }
  batches.push(current);

  return signedIn(io, store, async (board) => {
    const total: ImportResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      ignored: 0,
      conflicts: 0,
      flagged: [],
    };
    for (const batch of batches) {
      const body = {
        v: 1,
        tz: io.tz,
        from: fromMs,
        to: toMs,
        complete: window.complete,
        entries: batch.entries,
        ...(everyone ? { members: batch.members } : { member_id: store.member_id }),
      };
      const r = await boardCall<ImportResult>(
        board,
        'PUT',
        everyone ? '/api/v1/org/time/solidtime/import' : '/api/v1/me/time/solidtime/import',
        body,
      );
      if (!r.ok) {
        io.err(explain(r));
        return 1;
      }
      for (const k of [
        'created',
        'updated',
        'deleted',
        'unchanged',
        'ignored',
        'conflicts',
      ] as const) {
        total[k] += r.value[k];
      }
      total.flagged.push(...r.value.flagged);
      if (r.value.not_on_laika !== undefined) total.not_on_laika = r.value.not_on_laika;
    }
    const read = window.entries.length;
    io.out(
      `Read ${String(read)} ${read === 1 ? 'entry' : 'entries'} from Solidtime, ${fromDay} to today${
        everyone ? ', everyone' : ''
      }.`,
    );
    io.out(
      `In Laika: ${String(total.created)} new, ${String(total.updated)} changed, ${String(
        total.deleted,
      )} deleted, ${String(total.unchanged)} as they were.`,
    );
    if (total.conflicts > 0) {
      io.out(
        `  ${String(total.conflicts)} changed in Laika too; Solidtime's is kept, Laika's stays in the entry's history.`,
      );
    }
    for (const f of total.flagged) {
      io.out(`  flagged  ${f.day}  ${FLAGGED[f.reason] ?? f.reason}`);
    }
    if (running > 0) io.out(`  ${String(running)} still running in Solidtime: taken once stopped.`);
    if (total.ignored > 0) io.out(`  ${String(total.ignored)} under half a minute, left out.`);
    if (!window.complete) {
      io.out(
        `  Solidtime did not answer every page (${window.stopped ?? 'a page was missing'}): nothing was taken as deleted.`,
      );
    }
    if (total.not_on_laika !== undefined && total.not_on_laika.people > 0) {
      io.out(
        `  People not on Laika: ${String(total.not_on_laika.people)}, ${span(
          total.not_on_laika.minutes,
        )} — kept, not dropped (laika time people).`,
      );
    }
    writeStore(io.home, {
      ...store,
      last_pull: {
        at: io.nowMs(),
        days,
        read,
        created: total.created,
        updated: total.updated,
        deleted: total.deleted,
        flagged: total.flagged.length,
      },
    });
    return 0;
  });
}

// --------------------------------------------------------- people and map

interface Setup {
  closed_through: string | null;
  projects: {
    solidtime_project_id: string;
    name: string;
    push: boolean;
    space: { slug: string };
  }[];
  people: { solidtime_member_id: string; user: { id: string; name: string; email: string } }[];
  not_on_laika: {
    people: number;
    minutes: number;
    members: { member_id: string; minutes: number }[];
  };
}

interface LaikaUser {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
}

async function laikaUsers(board: Board): Promise<BoardResult<LaikaUser[]>> {
  const out: LaikaUser[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const r: BoardResult<{ data: LaikaUser[]; next_cursor: string | null }> = await boardCall(
      board,
      'GET',
      `/api/v1/users?limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
    );
    if (!r.ok) return r;
    out.push(...r.value.data);
    cursor = r.value.next_cursor;
    if (cursor === null) break;
  }
  return { ok: true, value: out };
}

async function people(args: readonly string[], io: TimeIo): Promise<number> {
  const store = needStore(io);
  if (store === undefined) return 1;
  const c = connection(store);
  const list = await st.members(c);
  if (!list.ok) {
    io.err(
      list.status === 403
        ? 'Your Solidtime role cannot list members (that needs manager or above).'
        : list.message,
    );
    return 1;
  }
  const undo = option(args, '--undo');
  return signedIn(io, store, async (board) => {
    const setup = await boardCall<Setup>(board, 'GET', '/api/v1/org/time/solidtime');
    if (!setup.ok) {
      io.err(explain(setup));
      return 1;
    }
    if (undo !== undefined) {
      const r = await boardCall(board, 'PUT', '/api/v1/org/time/solidtime/people', {
        people: [{ solidtime_member_id: undo, user_id: null }],
      });
      if (!r.ok) {
        io.err(explain(r));
        return 1;
      }
      io.out('Undone. Their imported hours are back with people not on Laika.');
      return 0;
    }
    const users = await laikaUsers(board);
    if (!users.ok) {
      io.err(explain(users));
      return 1;
    }
    const linked = new Map(setup.value.people.map((p) => [p.solidtime_member_id, p.user]));
    const linkedUsers = new Set(setup.value.people.map((p) => p.user.id));
    const byEmail = new Map(
      users.value.filter((u) => u.is_active).map((u) => [u.email.trim().toLowerCase(), u]),
    );
    const bucket = new Map(setup.value.not_on_laika.members.map((m) => [m.member_id, m.minutes]));
    const confirmed: { solidtime_member_id: string; user_id: string }[] = [];
    io.out(`Solidtime members of ${store.organization_name}, matched by email on this machine:`);
    for (const m of list.value) {
      const user = linked.get(m.id);
      if (user !== undefined) {
        io.out(`  ✓ ${m.name} — ${user.name} on Laika`);
        continue;
      }
      const match = byEmail.get(m.email.trim().toLowerCase());
      if (match !== undefined && !linkedUsers.has(match.id) && io.ask !== undefined) {
        const answer = (
          await io.ask(`  Is ${m.name} <${m.email}> in Solidtime ${match.name} on Laika? [y/N]`)
        )
          .trim()
          .toLowerCase();
        if (answer === 'y' || answer === 'yes') {
          confirmed.push({ solidtime_member_id: m.id, user_id: match.id });
          linkedUsers.add(match.id);
          continue;
        }
      }
      const minutes = bucket.get(m.id);
      io.out(
        `  · ${m.name} — not on Laika${minutes === undefined ? '' : `, ${span(minutes)} kept`}`,
      );
    }
    if (confirmed.length > 0) {
      // Only the pairing goes to the board: a Solidtime member id and a Laika person.
      const r = await boardCall(board, 'PUT', '/api/v1/org/time/solidtime/people', {
        people: confirmed,
      });
      if (!r.ok) {
        io.err(explain(r));
        return 1;
      }
    }
    io.out(
      `Confirmed ${String(confirmed.length)}. Their hours come in at the next laika time pull --all.`,
    );
    return 0;
  });
}

async function map(args: readonly string[], io: TimeIo): Promise<number> {
  const store = needStore(io);
  if (store === undefined) return 1;
  const c = connection(store);
  const list = await st.projects(c);
  if (!list.ok) {
    io.err(list.message);
    return 1;
  }
  const positional = args.filter((a) => !a.startsWith('--'));
  const [name, space] = positional;
  const none = args.includes('--none');
  return signedIn(io, store, async (board) => {
    const setup = await boardCall<Setup>(board, 'GET', '/api/v1/org/time/solidtime');
    if (!setup.ok) {
      io.err(explain(setup));
      return 1;
    }
    if (name === undefined) {
      const mapped = new Map(setup.value.projects.map((p) => [p.solidtime_project_id, p]));
      io.out(`Solidtime projects of ${store.organization_name}:`);
      for (const p of list.value.filter((x) => !x.is_archived)) {
        const m = mapped.get(p.id);
        io.out(
          `  ${p.name.padEnd(32)} ${m === undefined ? '(not mapped)' : `→ ${m.space.slug}${m.push ? ' (push)' : ''}`}`,
        );
      }
      io.out(
        'Map one with: laika time map "PROJECT" SPACE [--push]   unmap: laika time map "PROJECT" --none',
      );
      return 0;
    }
    const found = list.value.filter(
      (p) => p.id === name || p.name.toLowerCase() === name.toLowerCase(),
    );
    if (found.length !== 1 || found[0] === undefined) {
      io.err(
        found.length === 0
          ? `No Solidtime project "${name}".`
          : `Two Solidtime projects are called "${name}"; use its id.`,
      );
      return 1;
    }
    if (!none && space === undefined) {
      io.err('laika time map: name the space, or --none to unmap');
      return 1;
    }
    const project = found[0];
    const r = await boardCall(board, 'PUT', '/api/v1/org/time/solidtime/projects', {
      projects: [
        {
          solidtime_project_id: project.id,
          name: project.name,
          space: none ? null : space,
          ...(args.includes('--push') ? { push: true } : {}),
        },
      ],
    });
    if (!r.ok) {
      io.err(r.status === 404 ? `No space "${space ?? ''}" on the board.` : explain(r));
      return 1;
    }
    io.out(none ? `Unmapped ${project.name}.` : `${project.name} → ${space ?? ''}.`);
    return 0;
  });
}

// ---------------------------------------------------------------- timers

/**
 * D-086's automated sessions, and Omnigent's sub-agents: **a timer is a person
 * starting work**, so nothing an agent runs starts one (the activity hook's
 * rule, `plugin/scripts/laika-activity-hook`).
 */
export function automated(env: Readonly<Record<string, string | undefined>>): string | undefined {
  if ((env.CI ?? '') !== '') return 'CI is set';
  if ((env.LAIKA_ACTIVITY_SKIP ?? '') !== '') return 'LAIKA_ACTIVITY_SKIP is set';
  if (env.OMNIGENT === '1') {
    const launch = env.OMNIGENT_TERMINAL_LAUNCH_SESSION_ID ?? '';
    if (launch === '' || launch !== (env.OMNIGENT_RUNNER_PRIMARY_SESSION_ID ?? '')) {
      return 'this is an Omnigent agent’s session';
    }
  }
  return undefined;
}

async function start(args: readonly string[], io: TimeIo): Promise<number> {
  const key = args.find((a) => !a.startsWith('--'))?.toUpperCase();
  if (key === undefined || !/^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/.test(key)) {
    io.err('laika time start: name the card, such as laika time start ONR-123');
    return 1;
  }
  const why = automated(io.env);
  if (why !== undefined) {
    io.err(`A timer is a person starting work, and ${why}: nothing was started.`);
    return 1;
  }
  const store = needStore(io);
  if (store === undefined) return 1;
  const creds = findCredentials(io.home, io.env);
  if (creds === undefined) {
    io.err('This machine is not connected to a Laika board: laika connect');
    return 1;
  }
  // The card's title is no one's hours: the machine's token may read it,
  // through §7.1's `get_task_context`, which takes a key or an outside id —
  // the REST `GET /tasks/:id` takes an id only.
  const card = await cardByKey(creds, key);
  if (typeof card === 'string') {
    io.err(card);
    return 1;
  }
  const c = connection(store);
  const running = await st.activeEntry(c);
  if (!running.ok) {
    io.err(running.message);
    return 1;
  }
  if (running.value !== null) {
    if (!args.includes('--switch')) {
      io.err(
        `A timer is running: ${running.value.description ?? '(no description)'}. Stop it with laika time stop, or start this one with --switch.`,
      );
      return 1;
    }
    const stopped = await st.updateEntry(c, running.value.id, { end: stTime(io.nowMs()) });
    if (!stopped.ok) {
      io.err(stopped.message);
      return 1;
    }
  }
  const project =
    store.projects?.find((p) => p.space_id === card.project_id)?.solidtime_project_id ?? null;
  let isBillable = false;
  if (project !== null) {
    const list = await st.projects(c);
    isBillable = list.ok && list.value.find((p) => p.id === project)?.is_billable === true;
  }
  const made = await st.createEntry(c, {
    member_id: store.member_id,
    project_id: project,
    task_id: null,
    start: stTime(io.nowMs()),
    end: null,
    billable: isBillable,
    description: `${card.key} ${card.title}`.slice(0, DESCRIPTION_MAX),
    tags: [],
    type: 'work',
  });
  if (!made.ok) {
    io.err(made.message);
    return 1;
  }
  io.out(`Started ${card.key} ${card.title} in Solidtime.`);
  if (project === null) {
    io.out(
      '  On no project: run laika time push once so this machine learns where each space goes.',
    );
  }
  io.out('Stop it with laika time stop; the next laika time pull brings it to Laika.');
  return 0;
}

interface Card {
  readonly key: string;
  readonly title: string;
  readonly project_id: string;
}

/** A card by key, from the board's MCP endpoint (stateless, one request), or why not. */
async function cardByKey(
  creds: { readonly url: string; readonly token: string },
  key: string,
): Promise<Card | string> {
  let response: Response;
  try {
    response = await fetch(`${creds.url}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_task_context', arguments: { task: key } },
      }),
      signal: AbortSignal.timeout(st.REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return `Could not reach the board (${cause instanceof Error ? cause.message : String(cause)}).`;
  }
  if (!response.ok) return `The board answered ${String(response.status)}.`;
  try {
    const body = (await response.json()) as {
      result?: { isError?: boolean; structuredContent?: { task?: Partial<Card> } };
    };
    const task = body.result?.structuredContent?.task;
    if (
      body.result?.isError === true ||
      typeof task?.key !== 'string' ||
      typeof task.title !== 'string' ||
      typeof task.project_id !== 'string'
    ) {
      return `No card ${key} on the board that you can read.`;
    }
    return { key: task.key, title: task.title, project_id: task.project_id };
  } catch {
    return 'The board’s answer was not one this understands.';
  }
}

async function stop(io: TimeIo): Promise<number> {
  const store = needStore(io);
  if (store === undefined) return 1;
  const c = connection(store);
  const running = await st.activeEntry(c);
  if (!running.ok) {
    io.err(running.message);
    return 1;
  }
  if (running.value === null) {
    io.out('No Solidtime timer is running.');
    return 0;
  }
  const stopped = await st.updateEntry(c, running.value.id, { end: stTime(io.nowMs()) });
  if (!stopped.ok) {
    io.err(stopped.message);
    return 1;
  }
  io.out(
    `Stopped ${running.value.description ?? 'the timer'} after ${span(
      (io.nowMs() - stMs(running.value.start)) / 60_000,
    )}. The next laika time pull brings it to Laika.`,
  );
  return 0;
}
