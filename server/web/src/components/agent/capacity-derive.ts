import type { RegisteredAgent } from '../../api/agents.ts';
import {
  ANSWER_STALE_MS,
  type AutoPickup,
  type CapacityAnswer,
  type CapacityPing,
  type Launcher,
  type LauncherState,
} from '../../api/capacity.ts';
import { ApiError } from '../../api/errors.ts';
import type { MeProfile } from '../../api/me.ts';
import type { Project } from '../../api/projects.ts';
import { clockTime, timeLabel } from '../../api/time-label.ts';

/**
 * What the screens say about a launcher and a capacity ping (D-126, D-117a;
 * LAI-1102). Pure, so every sentence below is asserted in
 * `test/components/agent/capacity-derive.test.ts`.
 *
 * **The chip's word comes from `launcher.state` and nothing else.** The board
 * decides `on` — an enabled report under three minutes old — and a screen that
 * re-derived it from `reported_at` could disagree with the board. A stale
 * report is `unknown` there, and here it reads *not heard since …*, never *on*.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

export type AutoPickupTone = 'ok' | 'neutral' | 'warn';

export interface AutoPickupWords {
  /** The board's word, unchanged: the `data-` hook and the tests read it. */
  readonly state: LauncherState;
  /** The chip: *Auto-pickup: on · 40 s*, *Auto-pickup: off*, *Auto-pickup: not heard since 2:05 PM*. */
  readonly word: string;
  /** One line: why the chip says what it says, and what it means for work. */
  readonly reason: string;
  /** Repeats the word; never the only signal. */
  readonly tone: AutoPickupTone;
}

/** *40 s*, *2 min* — how long ago a fresh report came, which is never more than three minutes. */
function shortAge(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  return ms < MINUTE
    ? `${String(Math.floor(ms / SECOND))} s`
    : `${String(Math.floor(ms / MINUTE))} min`;
}

/** *reported 4 min ago* — `timeLabel`'s words, in a sentence. */
function reportedAgo(at: number, now: number): string {
  const text = timeLabel(at, now).text;
  return /ago$|^just now$/.test(text) ? `reported ${text}` : `last reported ${text}`;
}

/**
 * What the launcher starts by itself, as the rest of a sentence that begins
 * *it starts …* — or, with both switches off, a sentence of its own.
 */
function pickupSentence(pickup: AutoPickup | null): string {
  if (pickup === null) return '';
  if (pickup.work_requests && pickup.handoffs) {
    return 'It starts work requests and hand-offs addressed here by itself.';
  }
  if (pickup.work_requests) {
    return 'It starts work requests addressed here by itself, but not hand-offs.';
  }
  if (pickup.handoffs) {
    return 'It starts hand-offs addressed here by itself, but not work requests.';
  }
  return 'Both of its switches are off, so it starts neither work requests nor hand-offs.';
}

/**
 * The chip for one tool, or for a device (whose launcher is the best of its
 * active tools'). `device` names where the launcher runs. A revoked agent is
 * `off` on the board already; the screens show this for active tools only.
 */
export function autoPickupWords(launcher: Launcher, now: number, device: string): AutoPickupWords {
  const { state } = launcher;
  if (state === 'on') {
    const at = launcher.reported_at;
    const running =
      launcher.running === null || launcher.max_concurrent === null
        ? ''
        : ` ${String(launcher.running)} of ${String(launcher.max_concurrent)} running.`;
    const said = `The launcher on ${device} ${at === null ? 'says' : `${reportedAgo(at, now)} that`} it is running.`;
    const age = at === null ? '' : ` · ${shortAge(at, now)}`;
    const pickup = launcher.auto_pickup;
    // The board's `on` is a launcher that reported; it picks nothing up when
    // both of its switches are off, and the chip does not call that *on*
    // (LAI-1102 review).
    const nothing = pickup !== null && !pickup.work_requests && !pickup.handoffs;
    return {
      state,
      word: nothing ? `Auto-pickup: listening · picks up nothing${age}` : `Auto-pickup: on${age}`,
      reason: `${said} ${pickupSentence(pickup)}${running}`,
      tone: nothing ? 'neutral' : 'ok',
    };
  }
  if (state === 'unknown') {
    const at = launcher.reported_at;
    if (at === null) {
      // §4.2: the organisation keeps no presence times, so no age can be told.
      return {
        state,
        word: 'Auto-pickup: unknown',
        reason: `The launcher on ${device} said it is on, but this organisation keeps no presence times, so the board cannot say whether it still is.`,
        tone: 'neutral',
      };
    }
    const since = now - at < DAY ? clockTime(at) : timeLabel(at, now).text;
    return {
      state,
      word: `Auto-pickup: not heard since ${since}`,
      reason: `The launcher on ${device} said it was on, then stopped reporting over three minutes ago — the device may be asleep or offline, or the launcher stopped. Nothing starts here until it reports again.`,
      tone: 'warn',
    };
  }
  // `off`: never reported (every field null), or a report that said disabled.
  if (launcher.auto_pickup === null) {
    return {
      state,
      word: 'Auto-pickup: off',
      reason: `No launcher on ${device} has reported, so nothing starts here by itself. \`laika agent launcher enable\` on that device turns it on.`,
      tone: 'neutral',
    };
  }
  const at = launcher.reported_at;
  return {
    state,
    word: 'Auto-pickup: off',
    reason: `The launcher on ${device} ${at === null ? 'says' : reportedAgo(at, now) + ' that'} it is off, so nothing starts here by itself.`,
    tone: 'neutral',
  };
}

// ------------------------------------------------------------------ who may ping

/**
 * The space a Tools-panel ping is asked in, or `undefined` when there is none
 * — and then no Ping is offered. D-126 item 1 for a person: **their own agent
 * they could select there** — active, a `full` grant, agents allowed — on a
 * space they hold more than a viewer's role in. The first such space the
 * project list has, in its order. The board asks again and answers `404` if
 * this guessed wrong.
 */
export function pingProjectFor(
  agent: Pick<RegisteredAgent, 'status' | 'grants' | 'owner_user_id'>,
  projects: readonly Pick<Project, 'id' | 'slug' | 'agents_allowed' | 'archived_at'>[] | undefined,
  me: Pick<MeProfile, 'id' | 'org_role' | 'memberships'> | undefined,
): string | undefined {
  if (me === undefined || projects === undefined) return undefined;
  if (agent.owner_user_id !== me.id || agent.status !== 'active') return undefined;
  if (me.org_role === 'viewer') return undefined;
  const elevated = me.org_role === 'owner' || me.org_role === 'admin';
  for (const project of projects) {
    if (project.archived_at !== null || !project.agents_allowed) continue;
    const grant = agent.grants.find((g) => g.project_id === project.id);
    if (grant?.scope !== 'full') continue;
    const role = me.memberships.find((m) => m.project_id === project.id)?.role;
    if (elevated || role === 'member' || role === 'lead') return project.slug;
  }
  return undefined;
}

/** Why a tool panel offers no Ping, when {@link pingProjectFor} found no space. */
export type NoPing =
  /** The organisation role is viewer: pinging is for members and above. */
  | { readonly kind: 'viewer' }
  /** A space the tool could be selected in, where the reader is only a viewer. */
  | { readonly kind: 'space-viewer'; readonly space: string }
  /**
   * No space where it has full access with agents allowed — or none the
   * reader is a member of, where they would have a role to name.
   */
  | { readonly kind: 'no-space' };

/**
 * The reason, named by the role when the role is it (LAI-1102 review): a
 * viewer is told they are a viewer, not that the tool lacks access.
 */
export function whyNoPing(
  agent: Pick<RegisteredAgent, 'grants'>,
  projects: readonly Pick<Project, 'id' | 'name' | 'agents_allowed' | 'archived_at'>[],
  me: Pick<MeProfile, 'org_role' | 'memberships'>,
): NoPing {
  if (me.org_role === 'viewer') return { kind: 'viewer' };
  for (const project of projects) {
    if (project.archived_at !== null || !project.agents_allowed) continue;
    if (agent.grants.find((g) => g.project_id === project.id)?.scope !== 'full') continue;
    // Only a space the reader is a viewer *of*: one they are not a member of
    // gives them no role there to name (LAI-1108).
    if (me.memberships.find((m) => m.project_id === project.id)?.role !== 'viewer') continue;
    return { kind: 'space-viewer', space: project.name };
  }
  return { kind: 'no-space' };
}

/** {@link NoPing} in words, `target` being *Claude Code · Belka*. */
export function noPingWords(why: NoPing, target: string): string {
  switch (why.kind) {
    case 'viewer':
      return `Your role in this organisation is viewer, and pinging a tool is for members and above. You can still see ${target}’s launcher above.`;
    case 'space-viewer':
      return `Your role in ${why.space} is viewer, and pinging ${target} there is for members and above.`;
    case 'no-space':
      return `${target} has no space you could select it in — full access, with agents allowed — so there is nowhere to ping it.`;
  }
}

// ------------------------------------------------------------------ an answer

/** *answered 3 s ago*, *answered 4 min ago* — whatever the clocks disagree by, never negative. */
export function answeredAgo(answeredAt: number, now: number): string {
  const ms = Math.max(0, now - answeredAt);
  if (ms < MINUTE) return `answered ${String(Math.floor(ms / SECOND))} s ago`;
  return `answered ${timeLabel(answeredAt, now).text}`;
}

/** An answer older than five minutes is called stale (plan §4). */
export function isStale(ping: Pick<CapacityPing, 'answered_at'>, now: number): boolean {
  return ping.answered_at !== null && now - ping.answered_at > ANSWER_STALE_MS;
}

export interface AnswerItem {
  /** A `data-answer` hook: one per fact, so a test names what it reads. */
  readonly key: 'online' | 'pickup' | 'runs' | 'ready' | 'battery' | 'memory' | 'cli';
  readonly text: string;
}

const MEMORY_WORDS: Readonly<Record<CapacityAnswer['memory']['state'], string>> = {
  normal: 'normal',
  warn: 'under pressure',
  critical: 'critical',
  unsupported: 'unsupported on this device',
  unavailable: 'could not be read',
};

function batteryWords(b: CapacityAnswer['battery']): string {
  if (!('percent' in b)) {
    return b.state === 'unsupported'
      ? 'Battery: unsupported on this device'
      : 'Battery: could not be read';
  }
  const low = b.state === 'low' ? ', low' : '';
  const plugged = b.plugged === true ? ', plugged in' : b.plugged === false ? ', on battery' : '';
  return `Battery: ${String(b.percent)} %${low}${plugged}`;
}

/**
 * The answer, one fact an item, every one from the answer itself. A reading
 * the device could not take says so in words — never a number it did not send.
 */
export function answerItems(answer: CapacityAnswer): readonly AnswerItem[] {
  const items: AnswerItem[] = [
    {
      key: 'online',
      text:
        answer.answered_by === 'launcher'
          ? 'Online — its launcher answered'
          : 'Online — its open session answered; no launcher is running',
    },
  ];
  const l = answer.launcher;
  if (l.state === 'on') {
    const scope =
      l.auto_pickup.work_requests && l.auto_pickup.handoffs
        ? 'work requests and hand-offs'
        : l.auto_pickup.work_requests
          ? 'work requests only'
          : l.auto_pickup.handoffs
            ? 'hand-offs only'
            : undefined;
    items.push(
      {
        key: 'pickup',
        text:
          scope === undefined
            ? 'Auto-pickup: listening, picks up nothing — both switches off'
            : `Auto-pickup: on, for ${scope}`,
      },
      {
        key: 'runs',
        text: `Free runs: ${String(Math.max(0, l.max_concurrent - l.running))} of ${String(l.max_concurrent)}`,
      },
    );
  } else {
    items.push({ key: 'pickup', text: 'Auto-pickup: off' });
  }
  const missing = (['credential', 'argv', 'hooks'] as const).filter(
    (k) => !answer.harness_ready[k],
  );
  const missingWords: Readonly<Record<(typeof missing)[number], string>> = {
    credential: 'no saved credential',
    argv: 'its command does not check out',
    hooks: 'session hooks off',
  };
  items.push({
    key: 'ready',
    text:
      missing.length === 0
        ? 'Tool ready to run'
        : `Tool not ready: ${missing.map((k) => missingWords[k]).join(', ')}`,
  });
  items.push({ key: 'battery', text: batteryWords(answer.battery) });
  items.push(
    { key: 'memory', text: `Memory: ${MEMORY_WORDS[answer.memory.state]}` },
    { key: 'cli', text: `Laika CLI ${answer.cli_version}` },
  );
  return items;
}

// ------------------------------------------------------------------ a refusal

export type PingRefusal =
  /** The board's `404`: the same for an agent that does not exist and one this reader may not ping. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'limited'; readonly seconds: number }
  | { readonly kind: 'failed'; readonly message: string };

/** A failed ping, in the terms the screen speaks. */
export function pingRefusal(error: unknown): PingRefusal {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: 'refused' };
    if (error.code === 'rate_limited') {
      const seconds = (error.details as { retry_after_seconds?: unknown } | null)
        ?.retry_after_seconds;
      return {
        kind: 'limited',
        seconds: typeof seconds === 'number' && seconds >= 1 ? Math.ceil(seconds) : 60,
      };
    }
  }
  return {
    kind: 'failed',
    message: error instanceof Error && error.message !== '' ? error.message : 'The ping failed.',
  };
}

/** The words for each outcome that is not an answer. `target` is *Claude Code · Belka*. */
export const PING_WORDS = {
  waiting: (target: string): string => `Waiting for ${target}…`,
  /** A check inside the wait failed: still waiting, and saying so. */
  waitingLost: (target: string): string =>
    `Waiting for ${target}… The board did not answer the last check; asking again.`,
  noAnswer: (seconds: number): string =>
    `No answer within ${String(seconds)} s — the device may be offline or its launcher is off. Still listening until the ping expires.`,
  /** No answer within the wait, and the board could not be reached to check again. */
  noAnswerLost: (seconds: number, until: string): string =>
    `No answer within ${String(seconds)} s, and the board could not be reached to check again. Retrying until the ping expires at ${until}.`,
  expired: 'Expired: no answer within a minute — the device may be offline or its launcher is off.',
  /** It expired while the board could not be reached: answered or not is unknown. */
  expiredUnread: (target: string): string =>
    `The ping expired while the board could not be reached, so whether ${target} answered is unknown. Ping again to ask.`,
  refused: (target: string): string =>
    `${target} cannot be pinged here: the board knows no agent of yours by that id with full access to this space. It may have been revoked or lost its access.`,
  limited: (target: string, seconds: number): string =>
    `Too many pings for ${target} — try again in ${String(seconds)} s.`,
  failed: (message: string): string => `The ping failed: ${message}`,
  /** {@link PING_WORDS.failed}'s message when the ping itself never came back. */
  unanswered: (seconds: number): string =>
    `the board did not answer within ${String(seconds)} s. Ping again to ask.`,
} as const;
