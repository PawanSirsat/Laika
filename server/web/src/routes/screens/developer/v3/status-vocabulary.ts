import type { RegisteredAgent } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import type { AgentVerification } from '../../../../api/tool-setup.ts';
import type { ChipTone } from './DesignChip.tsx';
import type { ListedStatus, ToolStatusKey } from './devices-view.ts';
import { ACTIVE_MS, OFFLINE_MS } from './overview-state.ts';
import type { ToolCapability } from './tool-catalog.ts';
import { checkLines, type ReadinessKey } from './tool-readiness.ts';
import type { UpdateKey, UpdateStatus } from './update-status.ts';

/**
 * Every status the Tools and Devices tabs can show, in words (LAI-1086, the
 * owner: *"nothing tells the developer why two say Connected and one says
 * Ready"*). **One vocabulary**: the chips take their word from here, the
 * *What do these statuses mean?* legend lists these entries, and each chip's
 * own description is built from its row's evidence plus the entry's *what
 * to do* — so a chip and its definition cannot say different things.
 *
 * Where each status is worked out, and therefore what each entry may claim:
 *
 * - **A tool** — `listedStatus` (`devices-view.ts`): `readiness()`
 *   (`tool-readiness.ts`) once the tool's own verification is in, otherwise
 *   `toolStatus()` from the agent's own stamps. `readiness()` keeps its own
 *   words (LAI-1088 owns that file); `status-vocabulary.test.ts` drives every
 *   branch of both and fails on any word not written here.
 * - **Duplicate** — `ListedTool.inConflict`: two active agents of one harness
 *   on one device (D-120).
 * - **A tool's helper** — `updateStatus()` and the row chip `versionChip()`
 *   (`update-status.ts`), which takes its words from here.
 * - **A device** — `deviceChip()` (`devices-view.ts`), which takes its words
 *   from here.
 *
 * The time thresholds are the code's own constants, `ACTIVE_MS` and
 * `OFFLINE_MS`, said in words — never retyped.
 *
 * Kept free of React so `node --test` reaches every rule here.
 */

export interface StatusCopy {
  /** The chip's word, exactly. */
  readonly word: string;
  readonly tone: ChipTone;
  /** One plain sentence: what it means. */
  readonly meaning: string;
  /** One line: what to do about it. */
  readonly todo: string;
}

function minutes(ms: number): string {
  const n = Math.round(ms / 60_000);
  return `${String(n)} ${n === 1 ? 'minute' : 'minutes'}`;
}

function days(ms: number): string {
  const n = Math.round(ms / 86_400_000);
  return `${String(n)} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * The window a request must fall in to count as recent: `ACTIVE_MS`, in words.
 * A function, read when a sentence is built: `overview-state.ts` and
 * `devices-view.ts` import each other, so a constant here could be read
 * before theirs exist.
 */
export function recent(): string {
  return minutes(ACTIVE_MS);
}

/** Past this, a tool reads as offline: `OFFLINE_MS`, in words. */
export function stale(): string {
  return days(OFFLINE_MS);
}

// ------------------------------------------------------------------ a tool

/** Every key a tool's status chip can carry: `toolStatus()`'s and `readiness()`'s. */
export type ToolChipKey = ToolStatusKey | ReadinessKey;

/** The legend's order: best first, then the ways it can fall short. */
export const TOOL_ORDER: readonly ToolChipKey[] = [
  'ready',
  'connected',
  'needs-setup',
  'idle',
  'offline',
  'revoked',
];

export const TOOL_STATUS: Readonly<Record<ToolChipKey, StatusCopy>> = {
  ready: {
    word: 'Ready',
    tone: 'ok',
    get meaning() {
      return `The tool itself called the board on its own credential in the last ${recent()}, and everything else it needs is in: the helper’s report of what it needs and, for a tool with hooks, a session.`;
    },
    todo: 'Nothing to do.',
  },
  connected: {
    word: 'Connected',
    tone: 'accent',
    meaning:
      'Its credential has reached the board, but not all of the evidence for Ready is in yet: the tool’s own request naming itself, the helper’s report of what it needs, or a session from its hooks.',
    todo: 'Open Details: its checklist names what is missing and how to send it.',
  },
  'needs-setup': {
    word: 'Needs setup',
    tone: 'accent',
    meaning:
      'There is no live credential for it on the device yet, its credential has expired, or nothing has used the one it has.',
    todo: 'Run its Add tool command on the device, or use Finish setup → on its row.',
  },
  idle: {
    word: 'Idle',
    tone: 'neutral',
    get meaning() {
      return `Its last request was between ${recent()} and ${stale()} ago.`;
    },
    todo: 'Nothing is wrong. Use the tool on its device and it reads Ready or Connected again.',
  },
  offline: {
    word: 'Offline',
    tone: 'warn',
    get meaning() {
      return `Its last request was more than ${stale()} ago.`;
    },
    todo: 'Start the tool on its device. If it no longer runs there, disconnect it in Details.',
  },
  revoked: {
    word: 'Revoked',
    tone: 'neutral',
    meaning: 'It was disconnected: its credentials no longer work.',
    todo: 'Nothing. Show revoked lists it for the record; to use it again, add it with + Add tool.',
  },
};

export const DUPLICATE: StatusCopy = {
  word: 'Duplicate',
  tone: 'warn',
  meaning:
    'Two or more active tools of the same kind on one device, set up before Laika kept one of each a device; each keeps working.',
  todo: 'Open Details to rename one, or disconnect the one you no longer use.',
};

// ------------------------------------------------------------------ a tool's helper

/** Every helper status a row chip shows; *Checking* shows no chip. */
export type UpdateChipKey = Exclude<UpdateKey, 'checking'>;

export const UPDATE_ORDER: readonly UpdateChipKey[] = [
  'up-to-date',
  'available',
  'required',
  'unknown',
  'unchecked',
];

/** A device's chip speaks for all of its tools; this is its word when every one is up to date. */
export const ALL_UP_TO_DATE = 'Helpers up to date';

export const UPDATE_STATUS: Readonly<Record<UpdateChipKey, StatusCopy>> = {
  'up-to-date': {
    word: 'Helper up to date',
    tone: 'ok',
    meaning:
      'The Laika helper on its device speaks this board’s helper protocol or a newer one (a device says Helpers up to date when every tool on it does).',
    todo: 'Nothing to do.',
  },
  available: {
    word: 'Update available',
    tone: 'accent',
    meaning:
      'Its helper speaks an older protocol that this board still accepts: what it does now keeps working, and newer features need the update.',
    todo: 'On that device run laika update --check, then laika update. Details has the command.',
  },
  required: {
    word: 'Update required',
    tone: 'danger',
    meaning:
      'This board has switched on a feature its helper is too old for — in Details it reads Update required for that feature — or the helper is older than the oldest this board accepts.',
    todo: 'Update the Laika CLI on that device: How to update your Laika CLI, in Details.',
  },
  unknown: {
    word: 'Version unknown',
    tone: 'neutral',
    meaning:
      'Its helper has not reported a version to this board, so there is nothing to compare, and it may well be fine.',
    todo: 'Run laika update on that device: it reports the helper’s version to this board.',
  },
  unchecked: {
    word: 'Could not check',
    tone: 'neutral',
    meaning:
      'The board’s update information, or this tool’s version report, could not be read just now.',
    todo: 'Use Retry in its Details.',
  },
};

// ------------------------------------------------------------------ a device

/** Every key `deviceChip()` can return. */
export type DeviceChipKey = 'paired' | 'confirm' | 'imported' | 'revoked';

export const DEVICE_ORDER: readonly DeviceChipKey[] = ['paired', 'confirm', 'imported', 'revoked'];

export const DEVICE_STATUS: Readonly<Record<DeviceChipKey, StatusCopy>> = {
  paired: {
    word: 'Paired',
    tone: 'ok',
    meaning:
      'The device holds a key this board approved, so tools are added to it without a secret passing through the browser.',
    todo: 'Nothing. Add tool → puts a coding tool on it.',
  },
  confirm: {
    word: 'Imported — confirm it’s yours',
    tone: 'warn',
    meaning:
      'Laika made this device from the name your tools reported when they were registered, and nobody has confirmed it yet.',
    todo: 'Open Details and confirm it if you recognise it; disconnect it if you do not.',
  },
  imported: {
    word: 'Imported',
    tone: 'neutral',
    meaning:
      'Laika made this device from the name your tools reported, and it was confirmed but never paired with a key.',
    todo: 'Nothing. Its tools keep working.',
  },
  revoked: {
    word: 'Revoked',
    tone: 'neutral',
    meaning: 'The device was disconnected from this board.',
    todo: 'Nothing. Show revoked lists it for the record; to use the machine again, add it with + Add device.',
  },
};

// ------------------------------------------------------------------ one row's description

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * A tool chip's own description: its word, the row, the reason the code gave
 * for **this** row, and what to do — for *Connected* and *Needs setup* the
 * first check its verification still fails, in that check's own words, which
 * say what is missing and how to send it. Nothing the server did not send.
 */
export function toolChipDescription(input: {
  readonly label: string;
  readonly status: Pick<ListedStatus, 'key' | 'reason' | 'evidence'>;
  readonly agent: Pick<RegisteredAgent, 'last_seen_at'>;
  readonly verification: AgentVerification | undefined;
  readonly tool: ToolCapability | undefined;
  readonly deviceName: string;
  readonly now: number;
}): string {
  const { label, status, verification, tool, deviceName, now } = input;
  const copy = TOOL_STATUS[status.key];
  const short = status.key === 'connected' ? `${copy.word}, not Ready` : copy.word;
  const parts = [`${short}: ${label}.`, sentence(status.reason)];
  const seen = input.agent.last_seen_at;
  if (status.key === 'connected' && status.evidence && seen !== null) {
    parts.push(`Its credential last reached the board ${timeLabel(seen, now).text}.`);
  }
  const missing =
    status.evidence && verification !== undefined && tool !== undefined
      ? checkLines(verification, tool, deviceName).find((line) => line.state === 'fail')
      : undefined;
  if ((status.key === 'connected' || status.key === 'needs-setup') && missing !== undefined) {
    parts.push(
      `${status.key === 'connected' ? 'To make it Ready' : 'Next'}: ${sentence(missing.detail)}`,
    );
  } else {
    parts.push(copy.todo);
  }
  return parts.join(' ');
}

/** The *Duplicate* chip's description: which row, and what to do. */
export function duplicateDescription(label: string): string {
  return `${DUPLICATE.word}: ${label} is one of two or more active tools of the same kind on this device. ${DUPLICATE.todo}`;
}

/** A helper chip's description: the reason `updateStatus` gave for this row, and what to do. */
export function updateChipDescription(
  label: string,
  status: Pick<UpdateStatus, 'key' | 'word' | 'reason'>,
): string {
  if (status.key === 'checking') return `${label}: ${status.reason}.`;
  const copy = UPDATE_STATUS[status.key];
  return `${status.word}: ${label}. ${sentence(status.reason)} ${copy.todo}`;
}

/** A device's helper chip: its tools' statuses counted, worst first, and what to do about the worst. */
export function deviceVersionDescription(
  name: string,
  summary: string,
  worst: UpdateChipKey,
): string {
  return `${name}: ${sentence(summary)} ${UPDATE_STATUS[worst].todo}`;
}

/** Which entry a device's chip is. */
export function deviceChipKey(
  device: Pick<Device, 'status' | 'origin'>,
  needsConfirm: boolean,
): DeviceChipKey {
  if (device.status === 'revoked') return 'revoked';
  if (device.origin === 'paired') return 'paired';
  return needsConfirm ? 'confirm' : 'imported';
}

/** A device chip's description: the row's own facts, and what to do. */
export function deviceChipDescription(
  device: Pick<Device, 'display_name' | 'paired_at' | 'revoked_at'>,
  key: DeviceChipKey,
  now: number,
): string {
  const copy = DEVICE_STATUS[key];
  const name = device.display_name;
  let fact: string;
  switch (key) {
    case 'paired':
      fact =
        device.paired_at === null
          ? `${name} holds a key this board approved.`
          : `${name} holds a key this board approved ${timeLabel(device.paired_at, now).text}.`;
      break;
    case 'confirm':
      fact = `Laika made ${name} from the name your tools reported, and nobody has confirmed it yet.`;
      break;
    case 'imported':
      fact = `Laika made ${name} from the name your tools reported; it was confirmed, and never paired with a key.`;
      break;
    case 'revoked':
      fact =
        device.revoked_at === null
          ? `${name} was disconnected from this board.`
          : `${name} was disconnected from this board ${timeLabel(device.revoked_at, now).text}.`;
      break;
  }
  return `${copy.word}: ${fact} ${copy.todo}`;
}
