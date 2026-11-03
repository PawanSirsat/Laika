import type { CliSource } from '../../../../api/developer-compat.ts';
import type { PairingState } from '../../../../api/device-pairing.ts';
import type { Device } from '../../../../api/devices.ts';
import type { ToolSetup } from '../../../../api/tool-setup.ts';
import { ApiError, NetworkError } from '../../../../api/errors.ts';

/**
 * The pure half of *Add device* and *Add tool* (LAI-1061, plan LAI-1042
 * §E.1, §E.2, §F.3, §F.4, §F.6): the commands shown, how often to ask the
 * board again, and what each refusal means to the person reading it.
 *
 * **No command here carries a secret, and none is `npx`.** The pairing code
 * is a one-use binding code, not a credential — it grants nothing until a
 * person approves the key it brought — and the tool command names only an
 * exchange id. The credential itself is fetched by the device, signed with
 * its own key, and never passes through the browser.
 */

/** Where a fresh install puts the checkout, as plan §F.6 writes it. */
export const CHECKOUT = '~/laika';

/** A value pasted into a terminal: as is when it is plainly safe, quoted otherwise. */
export function shellWord(value: string): string {
  return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface Bootstrap {
  /** The lines, joined by newlines: what is shown, selected and copied. */
  readonly text: string;
  /** Said under the block when the board does not know its own commit. */
  readonly versionNote: string | undefined;
  /**
   * The device already has a helper: it must be brought up to date before it
   * pairs, by the *Update your Laika CLI* guide the step shows above the
   * block — not by a command in it (review round 1, N3).
   */
  readonly updateFirst: boolean;
}

/**
 * What to run on the device (§F.6). `pairCommand` is the server's own
 * `laika device pair …`, used as it came.
 *
 * - **Fresh**: clone the board's repository **at the board's own commit**,
 *   link the helper without asking for any token (`--no-credential`), then
 *   pair — through the checkout's own `laika`, since the shell that ran the
 *   installer has not re-read its `PATH` yet. **One `&&` list** (LAI-1093,
 *   review round 1): a clone refused because `~/laika` already exists must
 *   not go on to run the `install.sh` in it — one older than
 *   `--no-credential` ignores the flag and asks for a personal token.
 * - **Installed**: the pair command alone, with `updateFirst`. A helper old
 *   enough to need updating may have no `laika update` either (#200, #207) —
 *   `git -C ~/laika fetch && laika update` failed on exactly the CLI that
 *   needed it, and named no `--board` or `--allow-http` — so the update is the
 *   guide's, which covers a CLI with or without it (review round 1, N3).
 */
export function bootstrapCommands(
  source: CliSource | undefined,
  pairCommand: string,
  installed: boolean,
): Bootstrap {
  if (installed) {
    return { text: pairCommand, versionNote: undefined, updateFirst: true };
  }
  const pair = pairCommand.startsWith('laika ')
    ? `${CHECKOUT}/cli/bin/${pairCommand}`
    : pairCommand;
  if (source === undefined) {
    // No source to clone from: the pairing line alone, and the reason.
    return {
      text: pair,
      versionNote:
        'This board does not say where its helper comes from, so only the pairing line is shown. Install the helper from your Laika repository first.',
      updateFirst: false,
    };
  }
  const steps = [
    `git clone ${shellWord(source.url)} ${CHECKOUT}`,
    ...(source.commit === null ? [] : [`git -C ${CHECKOUT} checkout --detach ${source.commit}`]),
    `${CHECKOUT}/plugin/scripts/install.sh --no-credential`,
    pair,
  ];
  return {
    text: steps.join(' &&\n'),
    versionNote:
      source.commit === null
        ? 'Version unknown: this board does not know which commit it was built from, so this installs the newest on its repository’s default branch. How to update your Laika CLI has the ways to keep it current.'
        : undefined,
    updateFirst: false,
  };
}

/** Whether a device can take a tool: active, and holding a key this board approved. */
export function pairedDevice(device: Pick<Device, 'status' | 'paired_at'>): boolean {
  return device.status === 'active' && device.paired_at !== null;
}

/**
 * The command for an exchange this page made before a reload — exactly the
 * server's, since the `201` that carried it is gone. `services/tool-setup.ts`
 * builds it; `add-flow.test.ts` reads the template there, so the two cannot
 * part silently.
 */
export function toolAddCommand(harness: string, exchangeId: string): string {
  return `laika tool add ${harness} --exchange ${exchangeId}`;
}

/** A pairing request that will not move again. */
export function pairingFinished(state: PairingState): boolean {
  return (
    state === 'completed' || state === 'denied' || state === 'expired' || state === 'cancelled'
  );
}

/**
 * How far along a request is. The finished states all rank above the live
 * ones, so a decision is never undone by an answer that set out before it.
 */
const PAIRING_ORDER: Readonly<Record<PairingState, number>> = {
  open: 0,
  claimed: 1,
  approved: 2,
  completed: 3,
  denied: 3,
  expired: 3,
  cancelled: 3,
};

/**
 * Whether a poll answer may replace what is on screen: only if it is not
 * behind it. A read that left before Approve can land after it and say
 * `claimed`; taking it would bring the Approve button back for a moment.
 */
export function pairingNotBehind(current: PairingState | undefined, next: PairingState): boolean {
  return current === undefined || PAIRING_ORDER[next] >= PAIRING_ORDER[current];
}

/** An exchange that closed without being redeemed: nothing more will come of it. */
export function exchangeEnded(exchange: Pick<ToolSetup, 'state' | 'redeemed_at'>): boolean {
  return (
    (exchange.state === 'expired' || exchange.state === 'cancelled') &&
    exchange.redeemed_at === null
  );
}

/** How often to ask again (§E.1's 3 s), backing off while nothing changes. */
export const POLL_FIRST_MS = 3_000;
export const POLL_MAX_MS = 15_000;

/**
 * The next wait: back to the first when the answer changed, half as long
 * again when it did not, twice as long after a `429`, never past the cap.
 */
export function nextPollDelay(previous: number, changed: boolean, rateLimited: boolean): number {
  if (rateLimited) return Math.min(POLL_MAX_MS * 2, Math.max(previous, POLL_FIRST_MS) * 2);
  if (changed) return POLL_FIRST_MS;
  return Math.min(POLL_MAX_MS, Math.round(previous * 1.5));
}

/** `7F3A91C20B5E44D1` read in fours, as a terminal prints it — the characters unchanged. */
export function fingerprintGroups(fingerprint: string): readonly string[] {
  const clean = fingerprint.replace(/[\s-]/g, '');
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) groups.push(clean.slice(i, i + 4));
  return groups;
}

function reasonOf(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError)) return undefined;
  const details = cause.details as { reason?: unknown } | null | undefined;
  return typeof details?.reason === 'string' ? details.reason : undefined;
}

export interface Refusal {
  readonly message: string;
  /** The request is over and a new one is the way on. */
  readonly startAgain: boolean;
}

/** What a refused pairing call means, and what to do. */
export function pairingRefusal(cause: unknown, name: string): Refusal {
  if (cause instanceof NetworkError) {
    return {
      message: 'Could not reach the board. Check your connection and try again.',
      startAgain: false,
    };
  }
  if (!(cause instanceof ApiError)) {
    return { message: 'Something went wrong. Try again.', startAgain: false };
  }
  if (cause.code === 'rate_limited') {
    return {
      message: 'Too many requests just now. Wait a minute, then try again.',
      startAgain: false,
    };
  }
  if (cause.code === 'forbidden') {
    return {
      message: 'Pairing a device needs a signed-in browser session; this one is not allowed to.',
      startAgain: false,
    };
  }
  if (cause.code === 'not_found') {
    return { message: 'That pairing request is gone. Start again.', startAgain: true };
  }
  switch (reasonOf(cause)) {
    case 'public_url_unset':
      return {
        message:
          'This board has no public address (LAIKA_PUBLIC_URL), so no device can pair with it. Ask whoever runs this board to set it.',
        startAgain: false,
      };
    case 'too_many_open_pairings':
      return {
        message:
          'You have five pairing requests open. Cancel one, or wait for them to expire — ten minutes at most.',
        startAgain: false,
      };
    case 'device_name_taken':
      return {
        message: `You already have a device called ${name}. Choose another name — or, if this is that device and it was imported, choose it under Which device.`,
        startAgain: false,
      };
    case 'invalid_device_name':
      return { message: 'A device name is 1 to 80 characters.', startAgain: false };
    case 'device_already_paired':
      return { message: 'That device is paired already.', startAgain: false };
    case 'device_kind_mismatch':
      return {
        message: 'That device is a different kind. Pairing never changes a device’s kind.',
        startAgain: false,
      };
    case 'device_revoked':
      return { message: 'That device is revoked; add a new one instead.', startAgain: false };
    case 'pairing_key_changed':
      return {
        message:
          'The device’s key changed after this page showed it. Nothing was approved. Deny this request and start again.',
        startAgain: false,
      };
    case 'pairing_expired':
      return { message: 'This code expired. Start again for a new one.', startAgain: true };
    case 'pairing_denied':
    case 'pairing_cancelled':
      return { message: 'This request is closed. Start again.', startAgain: true };
    case 'pairing_completed':
      return { message: 'This device finished pairing already.', startAgain: false };
    default:
      return { message: cause.message, startAgain: false };
  }
}

export interface ToolRefusal {
  readonly message: string;
  /** Agent ids of a legacy duplicate pair to resolve first, when that is the refusal. */
  readonly duplicates?: readonly string[];
  /** The device must be paired first. */
  readonly needsPairing?: boolean;
}

/** What a refused add-tool or reconnect means, and what to do. */
export function toolRefusal(cause: unknown, toolName: string): ToolRefusal {
  if (cause instanceof NetworkError) {
    return { message: 'Could not reach the board. Check your connection and try again.' };
  }
  if (!(cause instanceof ApiError)) return { message: 'Something went wrong. Try again.' };
  if (cause.code === 'rate_limited') {
    return { message: 'Too many requests just now. Wait a minute, then try again.' };
  }
  if (cause.code === 'forbidden') {
    return {
      message: 'Adding a tool needs a signed-in browser session; this one is not allowed to.',
    };
  }
  if (cause.code === 'not_found') {
    return { message: 'That device or tool is not yours, or no longer exists.' };
  }
  const details = (cause.details ?? {}) as { agent_ids?: unknown };
  switch (reasonOf(cause)) {
    case 'agent_duplicates_need_resolution': {
      const ids = Array.isArray(details.agent_ids)
        ? details.agent_ids.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        message: `You have more than one ${toolName} on this device, from before one per device. Keep one in the device’s conflicts section, then add it again.`,
        duplicates: ids,
      };
    }
    case 'device_not_paired':
      return {
        message: 'This device is not paired yet. Pair it, then add the tool.',
        needsPairing: true,
      };
    case 'unsupported_harness':
      return { message: `${toolName} cannot be set up this way.` };
    case 'too_many_open_exchanges':
      return {
        message:
          'You have five tool setups open. Finish or cancel one, or wait for them to expire — ten minutes at most.',
      };
    case 'agent_revoked':
      return { message: `This ${toolName} is revoked. Add the tool again instead.` };
    default:
      return { message: cause.message };
  }
}
