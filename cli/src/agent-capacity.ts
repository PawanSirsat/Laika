import { existsSync } from 'node:fs';

import type { EventDeps, EventRecord, PingAnswerer, StoreKey } from './agent-events.ts';
import {
  configPath,
  handoffsOn,
  type LauncherSnapshot,
  loadConfig,
  type PresenceOutcome,
  runningLauncher,
  workRequestsOn,
} from './agent-launcher.ts';
import {
  type AgentCredential,
  callBoard,
  credentialPath,
  type Fetch,
  type Harness,
  isLaikaId,
  isRecord,
  listStates,
} from './agent-session.ts';
import {
  type BatteryReading,
  DEFAULT_BATTERY_PERCENT,
  DEFAULT_PSI_PERCENT,
  type MemoryReading,
  type MetricsSource,
  systemMetrics,
} from './agent-watch.ts';
import { versionInfo } from './version.ts';

/**
 * The device's side of a capacity ping and of launcher presence (D-126,
 * LAI-1038's CLI half; plan §4–§5).
 *
 * **A ping is answered with the pinged agent's own token** (D-126 item 3),
 * once, with a closed object: whether a launcher picks work up here, how many
 * runs it has, whether the harness is ready, whether a session is live, and
 * battery and memory as the session watcher reads them — or `unsupported`.
 * **It carries no path, host name, repository or task text**, and the board
 * keeps it for whoever pinged and the agent's owner only.
 *
 * **Presence** is a per-agent report, every 60 s and on change, with that
 * agent's token. It is never a command channel: nothing the board says back
 * starts, stops or configures anything here.
 *
 * Both are slice A's routes (`POST /agents/me/capacity-pings/:id/reply`,
 * `PUT /agents/me/launcher`). **A board without them answers 404 or 405**,
 * and that is taken as "not supported by this board": presence is asked
 * again hourly, and a ping on such a board is settled unanswered.
 */

/** The closed answer (plan §4): every field fixed, numbers capped, no free text. */
export interface CapacityAnswer {
  readonly launcher: {
    readonly state: 'on' | 'off';
    readonly auto_pickup: { readonly work_requests: boolean; readonly handoffs: boolean };
    readonly running: number;
    readonly max_concurrent: number;
  };
  readonly harness_ready: boolean;
  readonly session_live: boolean;
  readonly battery: {
    readonly state: 'ok' | 'low' | 'unsupported' | 'unavailable';
    readonly percent?: number;
    readonly plugged?: boolean;
  };
  readonly memory: {
    readonly state: 'normal' | 'warn' | 'critical' | 'unsupported' | 'unavailable';
  };
  readonly cli_version: string;
  readonly answered_by: 'launcher' | 'session';
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(n)));

/** The CLI's version as one short token: `0.1.0+<12 hex>`, or `0.1.0`. */
export function cliVersion(): string {
  try {
    const info = versionInfo();
    const base = /^[0-9A-Za-z.+-]{1,32}$/.test(info.version) ? info.version : 'unknown';
    const commit =
      info.commit !== null && /^[0-9a-f]{7,40}$/.test(info.commit)
        ? `+${info.commit.slice(0, 12)}`
        : '';
    return `${base}${commit}`;
  } catch {
    return 'unknown';
  }
}

export function batteryState(r: BatteryReading): CapacityAnswer['battery'] {
  if (r.kind !== 'battery') return { state: r.kind };
  const percent = clamp(r.percent, 0, 100);
  return {
    state: r.onBattery && percent <= DEFAULT_BATTERY_PERCENT ? 'low' : 'ok',
    percent,
    plugged: !r.onBattery,
  };
}

/** macOS names its kernel pressure level (1 normal, 2 warn, 4 critical); Linux says only elevated. */
export function memoryState(r: MemoryReading): CapacityAnswer['memory'] {
  if (r.kind !== 'memory') return { state: r.kind };
  if (!r.elevated) return { state: 'normal' };
  return { state: /kernel level 4\b/.test(r.detail) ? 'critical' : 'warn' };
}

export interface AnswerInput {
  readonly snapshot: LauncherSnapshot | undefined;
  readonly harnessReady: boolean;
  readonly sessionLive: boolean;
  readonly battery: BatteryReading;
  readonly memory: MemoryReading;
  readonly cliVersion: string;
  readonly answeredBy: 'launcher' | 'session';
}

/** Build the answer from named readings only; nothing else can reach it. */
export function capacityAnswer(input: AnswerInput): CapacityAnswer {
  const s = input.snapshot;
  return {
    launcher: {
      state: s?.enabled === true ? 'on' : 'off',
      auto_pickup: {
        work_requests: s?.enabled === true && s.auto_pickup.work_requests,
        handoffs: s?.enabled === true && s.auto_pickup.handoffs,
      },
      running: clamp(s?.running ?? 0, 0, 4),
      max_concurrent: clamp(s?.max_concurrent ?? 1, 1, 4),
    },
    harness_ready: input.harnessReady,
    session_live: input.sessionLive,
    battery: batteryState(input.battery),
    memory: memoryState(input.memory),
    cli_version: /^[0-9A-Za-z.+-]{1,64}$/.test(input.cliVersion) ? input.cliVersion : 'unknown',
    answered_by: input.answeredBy,
  };
}

export type ReplyOutcome = 'answered' | 'closed' | 'unsupported' | 'error';

/**
 * `POST /agents/me/capacity-pings/:id/reply` with the pinged agent's token.
 * The first answer wins on the board, so `409` (`ping_expired`,
 * `already_answered`) and `404` (not this agent's, or no such route) are all
 * settled — never retried. Only a network failure or a 5xx is `error`.
 */
export async function replyPing(
  fetchFn: Fetch,
  credential: AgentCredential,
  pingId: string,
  answer: CapacityAnswer,
): Promise<ReplyOutcome> {
  if (!isLaikaId(pingId)) return 'closed';
  const result = await callBoard(
    fetchFn,
    credential,
    `/api/v1/agents/me/capacity-pings/${pingId}/reply`,
    answer,
    {},
    5000,
  );
  if (result.kind === 'ok') return 'answered';
  if (result.kind === 'http' && (result.status === 404 || result.status === 405)) {
    return result.code === undefined ? 'unsupported' : 'closed';
  }
  if (result.kind === 'http' && result.status >= 400 && result.status < 500) return 'closed';
  return 'error';
}

/** `PUT /agents/me/launcher` (plan §5): the snapshot, the CLI version, nothing else. */
export async function reportPresence(
  fetchFn: Fetch,
  credential: AgentCredential,
  snapshot: LauncherSnapshot,
  version: string = cliVersion(),
): Promise<PresenceOutcome> {
  const body = {
    enabled: snapshot.enabled,
    auto_pickup: snapshot.auto_pickup,
    running: clamp(snapshot.running, 0, 4),
    max_concurrent: clamp(snapshot.max_concurrent, 1, 4),
    cli_version: version,
    started_at: snapshot.started_at,
  };
  let response: Response;
  try {
    response = await fetchFn(`${credential.url.replace(/\/+$/, '')}/api/v1/agents/me/launcher`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return 'error';
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (response.status === 401) return 'refused';
  // The SPA answers 200 with HTML for a path it does not know: only a JSON answer is one.
  if (response.ok) return isRecord(parsed) ? 'ok' : 'unsupported';
  if (response.status === 404 || response.status === 405) return 'unsupported';
  return 'error';
}

export interface ReadingDeps {
  readonly metrics?: MetricsSource;
  readonly platform?: NodeJS.Platform;
}

function metricsOf(deps: ReadingDeps): MetricsSource {
  return (
    deps.metrics ??
    systemMetrics(deps.platform ?? process.platform, { psiPercent: DEFAULT_PSI_PERCENT })
  );
}

const sessionLive = (home: string, harness: Harness): boolean =>
  listStates(home).some((s) => s.harness === harness && s.status === 'live');

/** Answer one ping: the record's id, the readings, the reply. `true` once it is settled. */
async function answerOne(
  deps: EventDeps & ReadingDeps,
  record: EventRecord,
  key: StoreKey,
  credential: AgentCredential,
  snapshot: LauncherSnapshot | undefined,
  harnessReady: boolean,
  answeredBy: 'launcher' | 'session',
): Promise<boolean> {
  if (record.ping_id === undefined) return true; // Nothing to answer: settled.
  const metrics = metricsOf(deps);
  const [battery, memory] = await Promise.all([
    metrics.battery().catch((): BatteryReading => ({ kind: 'unavailable', why: 'failed' })),
    metrics.memory().catch((): MemoryReading => ({ kind: 'unavailable', why: 'failed' })),
  ]);
  const answer = capacityAnswer({
    snapshot,
    harnessReady,
    sessionLive: sessionLive(deps.home, key.harness),
    battery,
    memory,
    cliVersion: cliVersion(),
    answeredBy,
  });
  const outcome = await replyPing(deps.fetch, credential, record.ping_id, answer);
  return outcome !== 'error';
}

/**
 * The launcher's answerer: its own snapshot, `answered_by: launcher`. The
 * harness is ready when the launcher has its argv and this credential.
 */
export function launcherAnswerer(snapshot: () => LauncherSnapshot): PingAnswerer {
  return (deps, record, key, credential) => {
    const now = snapshot();
    return answerOne(
      deps,
      record,
      key,
      credential,
      now,
      now.harnesses.includes(key.harness),
      'launcher',
    );
  };
}

/**
 * The session's answer, when no launcher answers (D-126 item 3): a live
 * launcher that runs this harness is left to answer itself; otherwise the
 * session answers `launcher.state: off`, or what the config says if one is
 * enabled but not running (still off: nothing would start).
 */
export const sessionAnswer: PingAnswerer = async (deps, record, key, credential) => {
  const config = loadConfig(deps.home);
  const configured =
    config.kind === 'enabled' && config.config.harnesses[key.harness] !== undefined;
  if (configured && runningLauncher(deps.home) !== undefined) return false;
  const snapshot: LauncherSnapshot | undefined =
    config.kind === 'enabled'
      ? {
          enabled: false,
          auto_pickup: {
            work_requests: workRequestsOn(config.config),
            handoffs: handoffsOn(config.config),
          },
          running: 0,
          max_concurrent: config.config.max_concurrent,
          started_at: 0,
          harnesses: Object.keys(config.config.harnesses) as Harness[],
        }
      : undefined;
  const ready =
    configured &&
    existsSync(credentialPath(deps.home, key.harness)) &&
    existsSync(configPath(deps.home));
  return answerOne(deps, record, key, credential, snapshot, ready, 'session');
};
