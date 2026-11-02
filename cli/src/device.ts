import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';

import { isRecord, privateDir, readJson, writePrivate } from './agent-session.ts';
import { fetchCompatibility } from './doctor.ts';
import { PROTOCOL } from './protocol.ts';
import { versionInfo } from './version.ts';

/**
 * `laika device pair` (LAI-1060; plan LAI-1042 §F.3, server SPEC §4.79).
 *
 * The device makes its own Ed25519 key here, with `node:crypto` and nothing
 * else. The private half is written once, 0600, under `~/.laika/device/`, and
 * is read back only to sign. **It is never printed and never sent**: the board
 * gets the public half at claim and a signature at completion, and that is all
 * a request from this file ever carries.
 *
 * The fingerprint the person compares in the browser is computed **here**,
 * from the key this process made. The board's own copy is checked against it
 * and a difference stops the pairing: a board, or anything between, that
 * answered with another key's fingerprint would otherwise be vouched for by
 * the one line the person trusts.
 *
 * The code is on the command line. It is not a credential: single use, ten
 * minutes, and it grants nothing until a person approves the fingerprint.
 *
 * ## The board's manifest decides first (plan §F.3 step 1, LAI-1064)
 *
 * Before any key is made, `featureGate` asks `GET /developer/compatibility`.
 * A board that answers it is believed: `features.device_pairing` (or
 * `tool_setup_exchange` for `laika tool add`) must be `true`, and this CLI's
 * protocol must reach the board's `min_client` and the feature's
 * `cli.min_protocol_for`, or the command stops with nothing sent and nothing
 * written. Since LAI-1062 the flag is read off the routes the board mounts, so
 * `true` means the routes are there.
 *
 * A board too old to have the manifest (`404`, or a `200` that is not Laika's
 * JSON) is *Version unknown*, and the old fallback stands: the command goes on
 * and the device route's own answer decides — no Laika JSON means "does not
 * support device pairing yet", and nothing is kept. A board that does not
 * answer, or is not set up, is refused before anything is made.
 */

export interface DeviceIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const CONSOLE: DeviceIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
};

/** How often completion is asked while the person has not decided (plan §E.1: 2 s). */
export const POLL_MS = 2000;

export const deviceDir = (home: string): string => join(home, '.laika', 'device');
export const deviceKeyPath = (home: string): string => join(deviceDir(home), 'key.pem');
export const deviceFilePath = (home: string): string => join(deviceDir(home), 'device.json');

/** What `device.json` holds. No secret: the key is in its own file. */
export interface DeviceRecord {
  /** The board's origin, the one every signature names. */
  readonly board: string;
  /** `null` until the pairing completes. */
  readonly device_id: string | null;
  readonly fingerprint: string;
  readonly public_key: string;
  readonly display_name?: string;
  readonly kind?: string;
  readonly pairing_id?: string;
  readonly paired_at?: number;
}

export function readDevice(home: string): DeviceRecord | undefined {
  const raw = readJson(deviceFilePath(home));
  if (!isRecord(raw)) return undefined;
  const { board, device_id: deviceId, fingerprint, public_key: publicKey } = raw;
  if (typeof board !== 'string' || typeof fingerprint !== 'string') return undefined;
  if (typeof publicKey !== 'string') return undefined;
  if (deviceId !== null && typeof deviceId !== 'string') return undefined;
  return raw as unknown as DeviceRecord;
}

/** The private key, for signing only. `undefined` when it is missing or unreadable. */
export function readDeviceKey(home: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(readFileSync(deviceKeyPath(home), 'utf8'));
    return key.asymmetricKeyType === 'ed25519' ? key : undefined;
  } catch {
    return undefined;
  }
}

/** sha256 of the SPKI DER, its first 16 hex characters — the server's `keyFingerprint`. */
export function fingerprintOf(publicKeyBase64url: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyBase64url, 'base64url'))
    .digest('hex')
    .slice(0, 16);
}

/** Ed25519 over `message`, base64url: the only thing derived from the key that leaves. */
export function signWith(key: KeyObject, message: string): string {
  return sign(null, Buffer.from(message, 'utf8'), key).toString('base64url');
}

/** The bytes pairing signs (server `pairingMessage`). */
export const pairingMessage = (pairingId: string, nonce: string, origin: string): string =>
  `laika-pair-v1\n${pairingId}\n${nonce}\n${origin}`;

/** The bytes a redeem signs (server `toolRedeemMessage`). */
export const toolRedeemMessage = (
  exchangeId: string,
  deviceId: string,
  challenge: string,
  origin: string,
): string => `laika-tool-redeem-v1\n${exchangeId}\n${deviceId}\n${challenge}\n${origin}`;

/** A board URL as its origin, or `undefined` when it is not an http(s) URL. */
export function boardOriginOf(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Talking to the board                                                       */
/* -------------------------------------------------------------------------- */

export type Answer =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  /** Something answered that is not Laika's JSON: an old board's SPA, a proxy. */
  | { readonly kind: 'other'; readonly status: number }
  | { readonly kind: 'unreachable'; readonly message: string };

export async function postJson(
  io: { readonly fetch: typeof fetch },
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Answer> {
  let response: Response;
  try {
    response = await io.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    return { kind: 'unreachable', message: cause instanceof Error ? cause.message : String(cause) };
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return { kind: 'other', status: response.status };
  try {
    return { kind: 'json', status: response.status, body: await response.json() };
  } catch {
    return { kind: 'other', status: response.status };
  }
}

/** `details.reason` of the §6.3 error envelope, or the `code` when there is none. */
export function reasonOf(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const details = body.error.details;
  if (isRecord(details) && typeof details.reason === 'string') return details.reason;
  return typeof body.error.code === 'string' ? body.error.code : undefined;
}

/** The refusals any device route can give, in words a person can act on. */
export function commonRefusal(answer: Answer, origin: string): string | undefined {
  if (answer.kind === 'unreachable') return `nothing answered at ${origin} (${answer.message})`;
  if (answer.kind === 'other') {
    return `${origin} does not support device pairing yet (it answered ${String(answer.status)} without Laika's JSON) — use "Set up by hand" in the browser`;
  }
  const reason = reasonOf(answer.body);
  if (reason === 'public_url_unset') {
    return 'this board has no LAIKA_PUBLIC_URL, so it cannot pair devices — ask whoever runs it to set one';
  }
  if (answer.status === 429) {
    return 'the board is limiting requests from here — wait a minute and run the command again';
  }
  return undefined;
}

/** A manifest feature a device command needs, and what a person calls it. */
export type GatedFeature = 'device_pairing' | 'tool_setup_exchange';

const FEATURE_WORDS: Readonly<Record<GatedFeature, string>> = {
  device_pairing: 'device pairing',
  tool_setup_exchange: 'tool setup',
};

export type Gate =
  /** `features` is the manifest's, or `undefined` for a board too old to have one. */
  | { readonly kind: 'go'; readonly features: Readonly<Record<string, unknown>> | undefined }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Whether `origin` serves `feature`, from its compatibility manifest (see the
 * header). Only a `GET`: it sends nothing of this machine's.
 */
export async function featureGate(
  io: { readonly fetch: typeof fetch },
  origin: string,
  feature: GatedFeature,
  protocol: number = PROTOCOL,
): Promise<Gate> {
  const words = FEATURE_WORDS[feature];
  const result = await fetchCompatibility(origin, io.fetch);
  if (result.kind === 'unsupported') return { kind: 'go', features: undefined };
  if (result.kind === 'unreachable') {
    return { kind: 'refused', message: `could not ask ${origin} what it supports: ${result.why}` };
  }
  if (result.kind === 'not_set_up') {
    return { kind: 'refused', message: `${origin} has not been set up yet` };
  }
  const { body } = result;
  if (body.features[feature] !== true) {
    return {
      kind: 'refused',
      message: `this board doesn't support ${words} yet — ask your admin to update the board (${origin})`,
    };
  }
  const need = Math.max(body.protocol.min_client, body.cli.min_protocol_for[feature] ?? 0);
  if (protocol < need) {
    return {
      kind: 'refused',
      message: `${origin} needs protocol ${String(need)} for ${words} and this CLI speaks ${String(protocol)} — run: laika update`,
    };
  }
  return { kind: 'go', features: body.features };
}

/* -------------------------------------------------------------------------- */
/* `laika device pair`                                                        */
/* -------------------------------------------------------------------------- */

const USAGE = [
  'laika device pair --board <url> --code <code> [--name <name>] [--cloud] [--replace]',
  '',
  'Pair this machine with a board. Start in the browser (Developer access →',
  'Add device); it shows the command to run here, with a one-time code.',
  '',
  '  --name, --cloud  what you chose in the browser; checked against what the',
  '                   board recorded, and a difference is pointed out',
  '  --replace        pair again although this machine is already paired',
  '                   (the old key and record are kept as *.bak-<time>)',
].join('\n');

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** The machine as the claim describes it: no host name, no user name. */
function osLabel(): string {
  return `${platform()} ${release()}`.slice(0, 64);
}

/** Where a pairing in flight keeps its key and record until it completes. */
const pending = (path: string): string => `${path}.pending`;

export async function device(argv: readonly string[], io: DeviceIo = CONSOLE): Promise<number> {
  const sub = argv[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    io.out(USAGE);
    return sub === undefined ? 1 : 0;
  }
  if (sub !== 'pair') {
    io.err(`laika device: unknown command "${sub}"\n\n${USAGE}`);
    return 1;
  }
  return pair(argv.slice(1), io);
}

async function pair(argv: readonly string[], io: DeviceIo): Promise<number> {
  const boardRaw = option(argv, '--board');
  const code = option(argv, '--code');
  const wantName = option(argv, '--name');
  const wantCloud = argv.includes('--cloud');
  const replace = argv.includes('--replace');

  const origin = boardRaw === undefined ? undefined : boardOriginOf(boardRaw);
  if (origin === undefined || code === undefined || code.trim() === '') {
    io.err(`laika device pair: --board <url> and --code <code> are required\n\n${USAGE}`);
    return 1;
  }

  const existing = readDevice(io.home);
  const isPaired = existing !== undefined && existing.device_id !== null;
  if (existing !== undefined && isPaired && !replace) {
    io.err(
      `laika device pair: this machine is already paired with ${existing.board}` +
        `${existing.display_name === undefined ? '' : ` as ${existing.display_name}`}.`,
    );
    io.err('  Nothing was changed. To pair it again, add --replace (the old key is kept).');
    return 1;
  }
  // Asked before a key exists, so a refusal leaves nothing to clean up.
  const gate = await featureGate(io, origin, 'device_pairing');
  if (gate.kind === 'refused') {
    io.err(`laika device pair: ${gate.message}. Nothing was changed.`);
    return 1;
  }
  // **Nothing in place changes until the board says paired** (review S2): the
  // new key and record are staged beside the old ones and moved over them
  // only on completion. A refusal, an exception or Ctrl-C removes the staged
  // files, and a kill that leaves them leaves the old pairing working.
  const keyPath = deviceKeyPath(io.home);
  const recordPath = deviceFilePath(io.home);
  let done = false;
  const discard = (): void => {
    if (done) return;
    rmSync(pending(keyPath), { force: true });
    rmSync(pending(recordPath), { force: true });
  };
  const onInterrupt = (): void => {
    discard();
    io.err('\nlaika device pair: interrupted — this machine is as it was.');
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  try {
    return await pairStaged(
      io,
      { origin, code: code.trim(), wantName, wantCloud, isPaired },
      () => {
        done = true;
      },
    );
  } finally {
    discard();
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
  }
}

interface PairInput {
  readonly origin: string;
  readonly code: string;
  readonly wantName: string | undefined;
  readonly wantCloud: boolean;
  readonly isPaired: boolean;
}

async function pairStaged(io: DeviceIo, input: PairInput, completed: () => void): Promise<number> {
  const { origin, wantName, wantCloud } = input;
  const keyPath = deviceKeyPath(io.home);
  const recordPath = deviceFilePath(io.home);

  // A fresh key every time: one from an attempt that never completed is
  // already bound to that request on the board, and is worth nothing.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicB64 = publicDer.toString('base64url');
  const fingerprint = fingerprintOf(publicB64);

  privateDir(join(io.home, '.laika'));
  privateDir(deviceDir(io.home));
  writePrivate(pending(keyPath), privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

  const claim = await postJson(io, `${origin}/api/v1/device-pairing/claim`, {
    code: input.code,
    public_key: publicB64,
    os: osLabel(),
    cli_version: versionInfo().version,
  });
  const claimed = claimAnswer(claim, origin);
  if (typeof claimed === 'string') {
    io.err(`laika device pair: ${claimed}`);
    return 1;
  }
  if (claimed.fingerprint !== fingerprint) {
    io.err('laika device pair: STOP — the board reports a different key fingerprint than the');
    io.err('  key this machine just made. Do not approve anything in the browser; deny the');
    io.err('  request there and start again. Nothing was saved here.');
    return 1;
  }

  io.out('Pairing code accepted. In your browser, approve this device only if it shows');
  io.out('exactly this key fingerprint (computed on this machine):');
  io.out('');
  io.out(`    ${fingerprint}`);
  io.out('');
  io.out('If the browser shows anything else, deny the request there.');
  io.out('Waiting for your decision…');

  const message = pairingMessage(claimed.pairingId, claimed.nonce, origin);
  const signature = signWith(privateKey, message);
  const deadline = Math.min(claimed.expiresAt, io.now() + 15 * 60_000);

  for (;;) {
    const answer = await postJson(
      io,
      `${origin}/api/v1/device-pairing/${encodeURIComponent(claimed.pairingId)}/complete`,
      { signature },
    );
    const outcome = completeAnswer(answer, origin);
    if (outcome.kind === 'pending') {
      if (io.now() >= deadline) {
        io.err('laika device pair: the code expired before it was approved. Start again in the');
        io.err('  browser. Nothing was saved here.');
        return 1;
      }
      await io.sleep(POLL_MS);
      continue;
    }
    if (outcome.kind === 'refused') {
      io.err(`laika device pair: ${outcome.message} Nothing was saved here.`);
      return 1;
    }

    const paired: DeviceRecord = {
      board: outcome.boardOrigin,
      device_id: outcome.deviceId,
      fingerprint,
      public_key: publicB64,
      display_name: outcome.displayName,
      kind: outcome.deviceKind,
      paired_at: io.now(),
    };
    writePrivate(pending(recordPath), `${JSON.stringify(paired, null, 2)}\n`);
    // The old pairing is kept beside the new one, then the new one moves in.
    if (input.isPaired) {
      const at = String(io.now());
      for (const path of [keyPath, recordPath]) {
        if (!existsSync(path)) continue;
        copyFileSync(path, `${path}.bak-${at}`);
        io.out(`Kept the old pairing: ${path}.bak-${at}`);
      }
    }
    renameSync(pending(keyPath), keyPath);
    renameSync(pending(recordPath), recordPath);
    completed();

    io.out(`Paired as ${outcome.displayName}${outcome.deviceKind === 'cloud' ? ' (cloud)' : ''}.`);
    if (wantName !== undefined && wantName.trim() !== outcome.displayName) {
      io.out(
        `  The board named it "${outcome.displayName}", not "${wantName.trim()}"; rename it in the browser if you meant that.`,
      );
    }
    if (wantCloud && outcome.deviceKind !== 'cloud') {
      io.out('  The board recorded it as a local device, not cloud; pair again from the browser');
      io.out('  choosing Cloud if this machine is a cloud runner (its tokens then live 24 h).');
    }
    io.out('Next: add a tool to it in your browser, then run the command it shows here.');
    return 0;
  }
}

interface Claimed {
  readonly pairingId: string;
  readonly nonce: string;
  readonly fingerprint: string;
  readonly expiresAt: number;
}

function claimAnswer(answer: Answer, origin: string): Claimed | string {
  const common = commonRefusal(answer, origin);
  if (common !== undefined) return common;
  if (answer.kind !== 'json') return `unexpected answer from ${origin}`;
  const reason = reasonOf(answer.body);
  if (reason === 'pairing_already_claimed') {
    return 'Someone else claimed this code — deny the request in the browser and start again.';
  }
  if (answer.status === 404) {
    return 'the board knows no live request with that code — it may have expired (ten minutes) or been cancelled. Start again in the browser.';
  }
  if (answer.status !== 200 || !isRecord(answer.body)) {
    return `the board refused the claim (${String(answer.status)}${reason === undefined ? '' : `, ${reason}`})`;
  }
  const { pairing_id: pairingId, nonce, key_fingerprint: fp, expires_at: expiresAt } = answer.body;
  if (
    typeof pairingId !== 'string' ||
    typeof nonce !== 'string' ||
    typeof fp !== 'string' ||
    typeof expiresAt !== 'number'
  ) {
    return `the board's claim answer is missing fields`;
  }
  return { pairingId, nonce, fingerprint: fp, expiresAt };
}

type Completed =
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused'; readonly message: string }
  | {
      readonly kind: 'completed';
      readonly deviceId: string;
      readonly displayName: string;
      readonly deviceKind: string;
      readonly boardOrigin: string;
    };

const DECIDED: Readonly<Record<string, string>> = {
  pairing_denied: 'the request was denied in the browser.',
  pairing_cancelled: 'the request was cancelled in the browser.',
  pairing_expired: 'the code expired before it was approved. Start again in the browser.',
  pairing_completed: 'this request was already completed.',
  device_name_taken:
    'you already have a device with that name on the board. Start again with another name.',
  device_not_pairable: 'that device can no longer be paired. Start again in the browser.',
};

function completeAnswer(answer: Answer, origin: string): Completed {
  const common = commonRefusal(answer, origin);
  if (common !== undefined) return { kind: 'refused', message: `${common}.` };
  if (answer.kind !== 'json') return { kind: 'refused', message: 'unexpected answer.' };
  if (answer.status === 202) return { kind: 'pending' };
  const reason = reasonOf(answer.body);
  if (reason !== undefined && reason in DECIDED) {
    return { kind: 'refused', message: DECIDED[reason] ?? '' };
  }
  if (reason === 'device_signature_invalid') {
    return {
      kind: 'refused',
      message: `the board did not accept this machine's signature — is ${origin} exactly the board's public address?`,
    };
  }
  if (answer.status !== 200 || !isRecord(answer.body)) {
    return {
      kind: 'refused',
      message: `the board refused (${String(answer.status)}${reason === undefined ? '' : `, ${reason}`}).`,
    };
  }
  const {
    device_id: deviceId,
    display_name: displayName,
    kind,
    board_origin: boardOrigin,
  } = answer.body;
  if (
    typeof deviceId !== 'string' ||
    typeof displayName !== 'string' ||
    typeof kind !== 'string' ||
    typeof boardOrigin !== 'string'
  ) {
    return { kind: 'refused', message: "the board's answer is missing fields." };
  }
  return { kind: 'completed', deviceId, displayName, deviceKind: kind, boardOrigin };
}
