import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentIo } from './agent.ts';
import {
  type AutoOutcome,
  autoCheckpointResult,
  type CheckpointDeps,
  type CheckpointRecord,
  readRecord,
} from './agent-checkpoint.ts';
import { checkpointDeps } from './agent-checkpoint-cli.ts';
import {
  type AgentCredential,
  callBoard,
  isLaikaId,
  isRecord,
  listStates,
  log,
  logPath,
  readCredential,
} from './agent-session.ts';

/**
 * `laika agent watch` — the resource watcher (proposal §4.7, LAI-552).
 *
 * Before a laptop dies it asks for a checkpoint: when the battery is below a
 * threshold (15 %) **while unplugged**, or when the OS reports memory
 * pressure **sustained** for 60 s. It is opt-in: nothing starts it but a
 * person running it.
 *
 * ## What it reads, and what it never pretends
 *
 * | | macOS | Linux |
 * | --- | --- | --- |
 * | battery | `pmset -g batt` | `/sys/class/power_supply/*` (`type` Battery: `capacity`, `status`) |
 * | memory pressure | `sysctl -n kern.memorystatus_vm_pressure_level` (1 normal, 2 warn, 4 critical) | `/proc/pressure/memory`, `some avg10` |
 *
 * **Not `memory_pressure`.** Run with no flags that tool *allocates memory*
 * until the system is under pressure; the kernel level it reports is the
 * sysctl read here, without the side effect.
 *
 * Any other OS, a Mac with no battery, a kernel without PSI, a command that
 * fails: the metric is printed as `unsupported` or `unavailable` with why —
 * **never as a number**, and it never triggers anything.
 *
 * ## Hysteresis and dedup
 *
 * Each condition fires **once** and is then disarmed. The battery re-arms
 * when it is plugged in or climbs {@link BATTERY_REARM_BAND} points above the
 * threshold; memory re-arms after {@link MEMORY_CLEAR_MS} of normal readings.
 * Before it fires, one normal memory reading restarts the 60 s, so a spike
 * does not count as sustained. Two conditions firing on one tick make one
 * request, not two.
 *
 * ## What a trigger does — and does not
 *
 * It **requests** the same automatic save the hooks make (`autoCheckpoint`):
 * consent from the board first, a quiet repo and no tool running, the task's
 * own branch, never `master`. It writes no continuation note — the note is the
 * agent's to write. It says a save succeeded only when the board registered
 * it; a save committed here but not registered is reported as exactly that.
 * With `--offer-to <agent>` it then offers the task to that agent through
 * `POST /tasks/:id/handoff-offers`, and only from a checkpoint the board
 * calls `verified`. With no live claim on this machine, or consent off, it
 * says why and does nothing.
 */

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

/** A metric this machine cannot give: printed with its reason, never as zero. */
export interface NoReading {
  readonly kind: 'unsupported' | 'unavailable';
  readonly why: string;
}

export type BatteryReading =
  { readonly kind: 'battery'; readonly percent: number; readonly onBattery: boolean } | NoReading;

export type MemoryReading =
  { readonly kind: 'memory'; readonly elevated: boolean; readonly detail: string } | NoReading;

export interface MetricsSource {
  readonly battery: () => Promise<BatteryReading>;
  readonly memory: () => Promise<MemoryReading>;
}

/** `pmset -g batt`, read. A Mac with no internal battery is unsupported, not empty. */
export function parsePmset(text: string): BatteryReading {
  const source = /Now drawing from '([^']+)'/.exec(text)?.[1];
  const line = text.split('\n').find((l) => l.includes('InternalBattery'));
  if (line === undefined) return { kind: 'unsupported', why: 'no battery found (pmset)' };
  const percent = /(\d{1,3})%/.exec(line)?.[1];
  if (percent === undefined || source === undefined) {
    return { kind: 'unavailable', why: 'pmset printed no charge or power source' };
  }
  return {
    kind: 'battery',
    percent: Math.min(100, Number(percent)),
    onBattery: source === 'Battery Power',
  };
}

/** `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function parseMacPressure(text: string): MemoryReading {
  const level = text.trim();
  const named: Record<string, string> = { '1': 'normal', '2': 'warn', '4': 'critical' };
  const name = named[level];
  if (name === undefined) {
    return { kind: 'unavailable', why: `unknown pressure level "${level.slice(0, 20)}"` };
  }
  return { kind: 'memory', elevated: level !== '1', detail: `kernel level ${level}, ${name}` };
}

/** `/proc/pressure/memory`: elevated when `some avg10` reaches `percent`. */
export function parsePsi(text: string, percent: number): MemoryReading {
  const avg10 = /^some\b.*\bavg10=(\d+(?:\.\d+)?)/m.exec(text)?.[1];
  if (avg10 === undefined) return { kind: 'unavailable', why: 'no "some avg10" in PSI' };
  const value = Number(avg10);
  return {
    kind: 'memory',
    elevated: value >= percent,
    detail: `PSI some avg10=${avg10}%`,
  };
}

export interface LinuxFs {
  readonly list: (dir: string) => string[];
  readonly read: (path: string) => string;
}

const REAL_FS: LinuxFs = {
  list: (dir) => readdirSync(dir),
  read: (path) => readFileSync(path, 'utf8'),
};

/** The first battery under `/sys/class/power_supply`, by name (`BAT0` before `BAT1`). */
export function linuxBattery(fs: LinuxFs, root = '/sys/class/power_supply'): BatteryReading {
  let names: string[];
  try {
    names = fs.list(root).sort();
  } catch {
    return { kind: 'unsupported', why: `no ${root}` };
  }
  for (const name of names) {
    const dir = join(root, name);
    let type: string;
    try {
      type = fs.read(join(dir, 'type')).trim();
    } catch {
      continue;
    }
    if (type !== 'Battery') continue;
    try {
      const capacity = fs.read(join(dir, 'capacity')).trim();
      const status = fs.read(join(dir, 'status')).trim();
      if (!/^\d{1,3}$/.test(capacity)) {
        return { kind: 'unavailable', why: `${name} capacity unreadable` };
      }
      return {
        kind: 'battery',
        percent: Math.min(100, Number(capacity)),
        onBattery: status === 'Discharging',
      };
    } catch {
      return { kind: 'unavailable', why: `${name} could not be read` };
    }
  }
  return { kind: 'unsupported', why: 'no battery found' };
}

export function linuxMemory(fs: LinuxFs, percent: number): MemoryReading {
  let text: string;
  try {
    text = fs.read('/proc/pressure/memory');
  } catch {
    return { kind: 'unsupported', why: 'no /proc/pressure/memory (kernel without PSI)' };
  }
  return parsePsi(text, percent);
}

export type Run = (file: string, args: readonly string[]) => Promise<string>;

/**
 * The system tools, by absolute path: a `pmset` earlier on `PATH` is never
 * the one run.
 */
export const PMSET = '/usr/bin/pmset';
export const SYSCTL = '/usr/sbin/sysctl';

/**
 * Everything a system tool is given of the environment: a fixed system
 * `PATH` and the C locale, built from nothing — **not** a copy of this
 * process's environment with names removed — so no token of any name (the
 * agent's `LAIKA_AGENT_TOKEN`, the person's, a cloud key) reaches it.
 */
export const TOOL_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
});

export interface ToolOptions {
  readonly timeout: number;
  readonly encoding: 'utf8';
  readonly env: Readonly<Record<string, string>>;
}

export type ExecFile = (
  file: string,
  args: string[],
  options: ToolOptions,
  callback: (error: Error | null, stdout: string) => void,
) => unknown;

/** A {@link Run} over `execFile`, injectable so a test can see what each child is given. */
export function toolRun(exec: ExecFile = execFile): Run {
  return (file, args) =>
    new Promise((resolve, reject) => {
      if (!file.startsWith('/')) {
        reject(new Error(`${file} is not an absolute path`));
        return;
      }
      exec(
        file,
        [...args],
        { timeout: 5_000, encoding: 'utf8', env: { ...TOOL_ENV } },
        (error, stdout) => {
          if (error) reject(new Error(`${file} failed: ${error.message}`));
          else resolve(stdout);
        },
      );
    });
}

/** The readers for this OS; any other OS reports both metrics unsupported. */
export function systemMetrics(
  platform: NodeJS.Platform,
  options: { readonly psiPercent: number; readonly run?: Run; readonly fs?: LinuxFs },
): MetricsSource {
  const run = options.run ?? toolRun();
  const fs = options.fs ?? REAL_FS;
  if (platform === 'darwin') {
    return {
      battery: () =>
        run(PMSET, ['-g', 'batt']).then(parsePmset, () => ({
          kind: 'unavailable' as const,
          why: 'pmset failed',
        })),
      memory: () =>
        run(SYSCTL, ['-n', 'kern.memorystatus_vm_pressure_level']).then(parseMacPressure, () => ({
          kind: 'unavailable' as const,
          why: 'sysctl failed',
        })),
    };
  }
  if (platform === 'linux') {
    return {
      battery: () => Promise.resolve(linuxBattery(fs)),
      memory: () => Promise.resolve(linuxMemory(fs, options.psiPercent)),
    };
  }
  const none: NoReading = { kind: 'unsupported', why: `not supported on ${platform}` };
  return { battery: () => Promise.resolve(none), memory: () => Promise.resolve(none) };
}

export function batteryLine(r: BatteryReading): string {
  return r.kind === 'battery'
    ? `battery: ${String(r.percent)}%, ${r.onBattery ? 'unplugged' : 'plugged in'}`
    : `battery: ${r.kind} (${r.why})`;
}

export function memoryLine(r: MemoryReading): string {
  return r.kind === 'memory'
    ? `memory pressure: ${r.elevated ? 'elevated' : 'normal'} (${r.detail})`
    : `memory pressure: ${r.kind} (${r.why})`;
}

/* -------------------------------------------------------------------------- */
/* Thresholds, hysteresis, dedup                                              */
/* -------------------------------------------------------------------------- */

export const DEFAULT_BATTERY_PERCENT = 15;
/** Points above the threshold the battery climbs before it can fire again. */
export const BATTERY_REARM_BAND = 5;
export const DEFAULT_MEMORY_SUSTAIN_MS = 60_000;
/** Normal readings, continuously, before memory pressure can fire again. */
export const MEMORY_CLEAR_MS = 30_000;
export const DEFAULT_PSI_PERCENT = 10;

export interface WatchConfig {
  readonly batteryPercent: number;
  readonly memorySustainMs: number;
  readonly memoryClearMs: number;
}

export interface WatchState {
  readonly batteryArmed: boolean;
  readonly memoryArmed: boolean;
  /** When the current unbroken run of elevated readings began. */
  readonly elevatedSince?: number;
  /** When the current unbroken run of normal readings began, while disarmed. */
  readonly normalSince?: number;
}

export const INITIAL: WatchState = { batteryArmed: true, memoryArmed: true };

export type Trigger = 'battery_low' | 'memory_pressure';

const TRIGGER_WORDS: Record<Trigger, string> = {
  battery_low: 'battery low and unplugged',
  memory_pressure: 'memory pressure sustained',
};

export interface Step {
  readonly state: WatchState;
  readonly triggers: readonly Trigger[];
  /** What changed this tick, to print: a condition firing, or re-arming. */
  readonly notices: readonly string[];
}

/** One tick: pure, so every threshold and every re-arm is tested with injected readings and time. */
export function step(
  state: WatchState,
  battery: BatteryReading,
  memory: MemoryReading,
  now: number,
  config: WatchConfig,
): Step {
  const triggers: Trigger[] = [];
  const notices: string[] = [];
  let { batteryArmed, memoryArmed, elevatedSince, normalSince } = state;

  if (battery.kind === 'battery') {
    const low = battery.onBattery && battery.percent <= config.batteryPercent;
    if (batteryArmed && low) {
      batteryArmed = false;
      triggers.push('battery_low');
      notices.push(
        `battery ${String(battery.percent)}% and unplugged (threshold ${String(config.batteryPercent)}%)`,
      );
    } else if (
      !batteryArmed &&
      (!battery.onBattery || battery.percent >= config.batteryPercent + BATTERY_REARM_BAND)
    ) {
      batteryArmed = true;
      notices.push('battery recovered: the battery trigger is armed again');
    }
  }

  if (memory.kind !== 'memory') {
    // Nothing known: neither a sustained run nor a recovery can be claimed.
    elevatedSince = undefined;
    normalSince = undefined;
  } else if (memory.elevated) {
    normalSince = undefined;
    elevatedSince ??= now;
    if (memoryArmed && now - elevatedSince >= config.memorySustainMs) {
      memoryArmed = false;
      triggers.push('memory_pressure');
      notices.push(
        `memory pressure ${memory.detail} for ${String(Math.round((now - elevatedSince) / 1000))} s`,
      );
    }
  } else {
    elevatedSince = undefined;
    if (!memoryArmed) {
      normalSince ??= now;
      if (now - normalSince >= config.memoryClearMs) {
        memoryArmed = true;
        normalSince = undefined;
        notices.push('memory pressure normal: the memory trigger is armed again');
      }
    }
  }

  return {
    state: {
      batteryArmed,
      memoryArmed,
      ...(elevatedSince === undefined ? {} : { elevatedSince }),
      ...(normalSince === undefined ? {} : { normalSince }),
    },
    triggers,
    notices,
  };
}

/* -------------------------------------------------------------------------- */
/* What a trigger requests                                                    */
/* -------------------------------------------------------------------------- */

export interface RequestDeps extends CheckpointDeps {
  /** The hooks' automatic save, with the record it made; injected in tests. */
  readonly autoSave?: typeof autoCheckpointResult;
}

export interface RequestOptions {
  readonly reason: string;
  readonly offerTo?: string;
  readonly offerWaitMs: number;
}

const SAVE_WORDS: Record<Exclude<AutoOutcome, 'saved' | 'unchanged' | 'retried'>, string> = {
  nothing: 'no file-changing tool activity since its last save; nothing to save',
  no_session: 'its session is not live; nothing saved',
  no_consent:
    'automatic checkpoints are off for this agent; nothing saved (its owner turns them on with `laika agent checkpoint consent on`)',
  consent_unknown: 'the board did not answer the consent; nothing saved',
  busy: 'a tool or git operation was still running; nothing saved',
  refused: 'the save was refused',
  no_hooks:
    'this harness has no hooks reporting its tools, so nothing is saved automatically; run `laika agent checkpoint save` in it',
};

async function verificationOf(
  deps: CheckpointDeps,
  credential: AgentCredential,
  record: CheckpointRecord,
): Promise<string | undefined> {
  const r = await callBoard(
    deps.fetch,
    credential,
    `/api/v1/tasks/${encodeURIComponent(record.task_id)}/checkpoints`,
    undefined,
    {},
    10_000,
    'GET',
  );
  if (r.kind !== 'ok' || !isRecord(r.body) || !Array.isArray(r.body.data)) return undefined;
  const found = r.body.data.find((c: unknown) => isRecord(c) && c.id === record.id) as unknown;
  return isRecord(found) && typeof found.verification === 'string' ? found.verification : undefined;
}

async function offer(
  deps: CheckpointDeps,
  credential: AgentCredential,
  record: CheckpointRecord,
  options: RequestOptions & { readonly offerTo: string },
): Promise<string> {
  const deadline = deps.now() + options.offerWaitMs;
  let verification = await verificationOf(deps, credential, record);
  while (verification !== 'verified' && deps.now() < deadline) {
    await deps.sleep(5_000);
    verification = await verificationOf(deps, credential, record);
  }
  if (verification !== 'verified') {
    return `not offered: checkpoint ${record.id} is ${verification ?? 'unknown to the board'}, and an offer needs a verified one`;
  }
  const r = await callBoard(
    deps.fetch,
    credential,
    `/api/v1/tasks/${encodeURIComponent(record.task_id)}/handoff-offers`,
    {
      idempotency_key: `watch-${record.id}-${options.offerTo}`,
      to_agent_id: options.offerTo,
      checkpoint_id: record.id,
      reason: `Resource watcher: ${options.reason}`.slice(0, 500),
    },
    { 'X-Laika-Claim-Generation': String(record.generation) },
  );
  if (r.kind === 'ok' && isRecord(r.body) && typeof r.body.id === 'string') {
    return `offered to ${options.offerTo}: offer ${r.body.id} is ${String(r.body.state)}; this claim is paused until it is accepted, declined or expires`;
  }
  const why =
    r.kind === 'network'
      ? `network: ${r.message}`
      : r.kind === 'http'
        ? `the board answered ${String(r.status)}`
        : 'an unreadable answer';
  return `not offered: ${why}`;
}

/**
 * One request, for every live session on this machine that holds a claim.
 * Each line says what the board confirmed, and nothing more.
 */
export async function requestCheckpoint(
  deps: RequestDeps,
  options: RequestOptions,
): Promise<string[]> {
  const lines: string[] = [];
  const sessions = listStates(deps.home).filter(
    (s) => s.status === 'live' && s.claims.length > 0 && isLaikaId(s.agent_id),
  );
  if (sessions.length === 0) {
    return ['no agent session on this machine holds a live claim: nothing saved, nothing offered'];
  }
  const autoSave = deps.autoSave ?? autoCheckpointResult;
  for (const s of sessions) {
    const who = `${s.harness} session ${s.session_id ?? s.harness_session_id}`;
    const credential = readCredential(deps.home, s.harness, deps.env);
    if (credential === undefined) {
      lines.push(`${who}: no agent token here; nothing saved`);
      continue;
    }
    const result = await autoSave(deps, s.harness, s.harness_session_id, credential);
    const outcome = result.outcome;
    if (outcome !== 'saved' && outcome !== 'unchanged' && outcome !== 'retried') {
      const extra = outcome === 'refused' ? ` — the reason is in ${logPath(deps.home)}` : '';
      lines.push(`${who}: ${SAVE_WORDS[outcome]}${extra}`);
      continue;
    }
    // Exactly the record this save made or matched — never "the newest" on
    // disk, which for a session holding two tasks can be the other task's.
    // Re-read by its id for the latest stage the save left it at.
    const record =
      result.record === undefined
        ? undefined
        : (readRecord(deps.home, result.record.id) ?? result.record);
    if (record === undefined) {
      lines.push(
        `${who}: the save reported ${outcome}, but no record of it is here; not confirmed`,
      );
      continue;
    }
    if (record.stage !== 'registered') {
      lines.push(
        `${who}: checkpoint ${record.id} is ${record.stage.replace('_', ' ')} here but NOT registered on the board` +
          `${record.last_error === undefined ? '' : ` (${record.last_error})`}; \`laika agent checkpoint status\` retries it`,
      );
      continue;
    }
    lines.push(
      `${who}: checkpoint ${record.id} (${record.commit_sha.slice(0, 12)}) registered on the board for ${record.task_segment}` +
        `${outcome === 'saved' ? '' : ' — nothing new since it'}`,
    );
    if (options.offerTo === undefined) {
      lines.push(`${who}: no offer made (pass --offer-to <agent id> to offer the task on)`);
      continue;
    }
    lines.push(
      `${who}: ${await offer(deps, credential, record, { ...options, offerTo: options.offerTo })}`,
    );
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

export const WATCH_USAGE = [
  'laika agent watch — ask for a checkpoint before this machine runs out of battery or memory.',
  '',
  '  laika agent watch [--battery-percent 15] [--memory-seconds 60] [--interval-seconds 10]',
  '                    [--psi-percent 10] [--offer-to AGENT_ID] [--offer-wait-seconds 120]',
  '  laika agent watch --once            print the readings and exit',
  '',
  'Fires once when the battery is at or below the threshold while unplugged, or when',
  'memory pressure lasts the given seconds; each re-arms only after it recovers.',
  'A trigger requests the hooks’ automatic save: it needs the owner’s consent and a',
  'live claim held by an agent session on this machine, and does nothing without them.',
  'A metric this machine cannot read is printed as unsupported, never as a number.',
].join('\n');

export interface WatchDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly metrics: MetricsSource;
  readonly request: (options: RequestOptions) => Promise<string[]>;
  /** Stop after this many ticks; tests only. */
  readonly maxTicks?: number;
  readonly stopped?: () => boolean;
}

function wholeOption(
  argv: readonly string[],
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  const raw = argv[at + 1] ?? '';
  const value = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    throw new Error(`${name} must be a whole number from ${String(min)} to ${String(max)}`);
  }
  return value;
}

export async function watch(
  io: Pick<AgentIo, 'out' | 'err'>,
  argv: readonly string[],
  deps: WatchDeps,
): Promise<number> {
  const config: WatchConfig = {
    batteryPercent: wholeOption(argv, '--battery-percent', DEFAULT_BATTERY_PERCENT, 1, 99),
    memorySustainMs:
      wholeOption(argv, '--memory-seconds', DEFAULT_MEMORY_SUSTAIN_MS / 1000, 1, 3600) * 1000,
    memoryClearMs: MEMORY_CLEAR_MS,
  };
  const intervalMs = wholeOption(argv, '--interval-seconds', 10, 1, 3600) * 1000;
  const offerWaitMs = wholeOption(argv, '--offer-wait-seconds', 120, 0, 3600) * 1000;
  const offerAt = argv.indexOf('--offer-to');
  const offerTo = offerAt === -1 ? undefined : argv[offerAt + 1];
  if (offerAt !== -1 && !isLaikaId(offerTo)) {
    throw new Error('--offer-to must be an agent id (the Agents screen)');
  }

  let state = INITIAL;
  let last = '';
  for (let tick = 0; deps.maxTicks === undefined || tick < deps.maxTicks; tick += 1) {
    if (deps.stopped?.() === true) break;
    const [battery, memory] = await Promise.all([deps.metrics.battery(), deps.metrics.memory()]);
    const readings = `${batteryLine(battery)}; ${memoryLine(memory)}`;
    if (argv.includes('--once')) {
      io.out(batteryLine(battery));
      io.out(memoryLine(memory));
      return 0;
    }
    if (readings !== last) io.out(readings);
    last = readings;

    const result = step(state, battery, memory, deps.now(), config);
    state = result.state;
    for (const notice of result.notices) io.out(`watch: ${notice}`);
    if (result.triggers.length > 0) {
      const reason = `${result.triggers.map((t) => TRIGGER_WORDS[t]).join(' and ')} (${readings})`;
      io.out('watch: requesting a checkpoint');
      const lines = await deps.request({
        reason,
        ...(offerTo === undefined ? {} : { offerTo }),
        offerWaitMs,
      });
      for (const line of lines) io.out(`watch: ${line}`);
    }
    await deps.sleep(intervalMs);
  }
  return 0;
}

/** The command as the router runs it: the real readers, clock and save. */
export async function watchCommand(io: AgentIo, argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(WATCH_USAGE);
    return 0;
  }
  let stop = false;
  const onSignal = (): void => {
    stop = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const cdeps = checkpointDeps(io);
    return await watch(io, argv, {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      metrics: systemMetrics(process.platform, {
        psiPercent: wholeOption(argv, '--psi-percent', DEFAULT_PSI_PERCENT, 1, 100),
      }),
      request: async (options) => {
        const lines = await requestCheckpoint(cdeps, options);
        for (const line of lines) log(io.home, `watch: ${line}`);
        return lines;
      },
      stopped: () => stop,
    });
  } catch (cause) {
    io.err(`laika agent watch: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
