import { readFileSync } from 'node:fs';

import type { AgentIo } from './agent.ts';
import {
  type CheckpointDeps,
  consentGiven,
  DEFAULT_RETENTION_DAYS,
  type Note,
  parseNote,
  PENDING,
  pruneCandidates,
  reverify,
  save,
  statusLines,
  writeNoteFor,
} from './agent-checkpoint.ts';
import {
  type AgentCredential,
  type Harness,
  HARNESSES,
  isHarness,
  isLaikaId,
  isRecord,
  listStates,
  readCredential,
} from './agent-session.ts';
import { gitRunner, Refusal } from './checkpoint-git.ts';
import { ask, askSecret, closePrompt } from './prompt.ts';

/**
 * `laika agent checkpoint save|note|status|reverify|consent` and
 * `laika agent checkpoints prune --dry-run` (LAI-547). The rules are in
 * `agent-checkpoint.ts` and `checkpoint-git.ts`; this file reads arguments
 * and prints.
 */

export const CHECKPOINT_USAGE = [
  'laika agent checkpoint — save the task’s work so another agent can continue it.',
  '',
  '  laika agent checkpoint save [--note-file F|-] [--file NEW]… [--task T] [--harness H]',
  '                                  commit tracked changes (and each --file new file) on the task',
  '                                  branch, push it and one tag, register',
  '  laika agent checkpoint note     < note.json   keep a continuation note for the next save',
  '  laika agent checkpoint status   the saves made here, retried if unregistered, and their verification',
  '  laika agent checkpoint reverify <id>          push a fresh tag at the same commit (D-116)',
  '  laika agent checkpoint consent status|on|off [--harness H] [--email E]',
  '                                  automatic saves by the hooks: off until the agent’s owner turns them on',
  '  laika agent checkpoints prune --dry-run [--days 90]   list tags past retention; deletes nothing',
  '',
  'A note is JSON with any of: work_done, next_step, decisions, open_questions, failing.',
  'It is refused if it looks like it holds a secret; it is shown to everyone who can read the task.',
].join('\n');

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function options(argv: readonly string[], name: string): string[] {
  const found: string[] = [];
  argv.forEach((arg, i) => {
    const value = argv[i + 1];
    if (arg === name && value !== undefined) found.push(value);
  });
  return found;
}

export function checkpointDeps(io: AgentIo): CheckpointDeps {
  return {
    home: io.home,
    env: io.env,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    git: gitRunner(io.env),
  };
}

/** `--harness`, checked: absent is `undefined`, anything but a known harness is refused. */
function harnessOption(argv: readonly string[]): Harness | undefined {
  const named = option(argv, '--harness');
  if (named === undefined) return undefined;
  if (!isHarness(named)) {
    throw new Refusal(`--harness must be one of ${HARNESSES.join(', ')}`, 'bad_arguments');
  }
  return named;
}

function readNoteArg(io: AgentIo, source: string): Note {
  const text = source === '-' ? io.stdin() : readFileSync(source, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(0, 64 * 1024));
  } catch {
    throw new Refusal('the note is not JSON', 'bad_note');
  }
  return parseNote(parsed);
}

function credentialFor(
  io: AgentIo,
  harness: Harness | undefined,
): { harness: Harness; credential: AgentCredential } {
  const candidates = harness === undefined ? HARNESSES : [harness];
  const found = candidates
    .map((h) => ({ harness: h, credential: readCredential(io.home, h, io.env) }))
    .filter(
      (c): c is { harness: Harness; credential: AgentCredential } => c.credential !== undefined,
    );
  const only = found[0];
  if (only === undefined || found.length > 1) {
    throw new Refusal(
      found.length > 1
        ? 'more than one harness has an agent token here: name it with --harness'
        : 'no agent token here: run `laika agent login <harness>` first',
      'no_credential',
    );
  }
  return only;
}

/** A password's bytes as a JSON string's contents, escaped byte by byte, into a buffer. */
function jsonStringBytes(secret: Buffer): Buffer {
  const out = Buffer.alloc(secret.length * 6);
  let at = 0;
  for (const byte of secret) {
    if (byte === 0x22 || byte === 0x5c) {
      out[at++] = 0x5c;
      out[at++] = byte;
    } else if (byte < 0x20) {
      at += out.write(`\\u00${byte.toString(16).padStart(2, '0')}`, at, 'latin1');
    } else {
      out[at++] = byte;
    }
  }
  const body = Buffer.from(out.subarray(0, at));
  out.fill(0);
  return body;
}

/**
 * Sign in as the agent's owner for one consent change, and **zero the
 * password's bytes afterwards** — the buffer it arrived in and the request
 * body built from it. Only the session cookie is kept. (The prompt hands the
 * password over as a JavaScript string first, which no code can wipe; this is
 * the narrowest the window can be made.)
 */
export async function signInWithPassword(
  url: string,
  email: string,
  password: Buffer,
  fetchFn: (input: string, init: RequestInit) => Promise<Response> = (input, init) =>
    fetch(input, init),
): Promise<string> {
  const escaped = jsonStringBytes(password);
  const body = Buffer.concat([
    Buffer.from(`{"email":${JSON.stringify(email)},"password":"`, 'utf8'),
    escaped,
    Buffer.from('"}', 'utf8'),
  ]);
  try {
    const response = await fetchFn(`${url}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Refusal(
        `could not sign in: the board answered ${String(response.status)}`,
        'sign_in_failed',
      );
    }
    const cookie = response.headers.getSetCookie().join('; ');
    if (cookie === '') throw new Refusal('the sign-in returned no session', 'sign_in_failed');
    return cookie;
  } finally {
    password.fill(0);
    escaped.fill(0);
    body.fill(0);
  }
}

async function consent(
  io: AgentIo,
  argv: readonly string[],
  deps: CheckpointDeps,
): Promise<number> {
  const mode = argv[0] ?? 'status';
  const harness = harnessOption(argv);
  const { harness: h, credential } = credentialFor(io, harness);
  const fromState = listStates(io.home).find(
    (s) => s.harness === h && isLaikaId(s.agent_id),
  )?.agent_id;
  const agentId = option(argv, '--agent') ?? fromState;
  if (!isLaikaId(agentId)) {
    throw new Refusal(
      `the agent's id is not known here yet: start a ${h} session with the hooks on, or pass --agent <id> (the Agents screen)`,
      'no_agent',
    );
  }

  if (mode === 'status') {
    const given = await consentGiven(deps, credential, agentId);
    if (given === undefined)
      throw new Refusal('the board did not answer the consent', 'board_failed');
    io.out(
      given
        ? `Automatic checkpoints are ON for agent ${agentId}: the hooks save after tool activity and at session end.`
        : `Automatic checkpoints are OFF for agent ${agentId}. Manual \`laika agent checkpoint save\` still works.`,
    );
    return 0;
  }
  if (mode !== 'on' && mode !== 'off') throw new Refusal('consent status|on|off', 'bad_arguments');

  // `PUT`/`DELETE` are the owner's, signed in (`agent.manage_own` is
  // session-only): the agent's own token cannot consent for itself.
  if (!io.isTTY) {
    throw new Refusal(
      'giving or withdrawing consent needs the agent owner’s password, asked in a terminal — never piped or passed as a flag',
      'needs_terminal',
    );
  }
  let cookie: string;
  try {
    const email = option(argv, '--email') ?? (await ask('Your Laika email (the agent’s owner)'));
    const password = Buffer.from(await askSecret('Your Laika password'), 'utf8');
    cookie = await signInWithPassword(credential.url, email.trim(), password);
  } finally {
    closePrompt();
  }
  try {
    if (mode === 'on') {
      io.out('Automatic checkpoints commit work-in-progress on the task’s branch, push it and one');
      io.out('tag, and register a save on the board after tool activity and at session end —');
      io.out(
        'only in a task worktree on its own branch, never master, never a secret-shaped file.',
      );
    }
    const response = await fetch(
      `${credential.url}/api/v1/agents/${encodeURIComponent(agentId)}/checkpoint-consent`,
      {
        method: mode === 'on' ? 'PUT' : 'DELETE',
        headers: { cookie, origin: credential.url },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body)) {
      throw new Refusal(`the board answered ${String(response.status)}`, 'board_failed');
    }
    io.out(
      body.given === true
        ? 'Consent given: automatic checkpoints are on for this agent.'
        : 'Consent withdrawn: automatic checkpoints are off; manual saves keep working.',
    );
    return 0;
  } finally {
    await fetch(`${credential.url}/api/v1/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, origin: credential.url, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

async function run(io: AgentIo, argv: readonly string[]): Promise<number> {
  const deps = checkpointDeps(io);
  const sub = argv[0];

  if (sub === 'save') {
    const harness = harnessOption(argv);
    const noteSource = option(argv, '--note-file');
    const note = noteSource === undefined ? undefined : readNoteArg(io, noteSource);
    const generationRaw = option(argv, '--generation');
    if (generationRaw !== undefined && !/^\d{1,9}$/.test(generationRaw)) {
      throw new Refusal('--generation must be a whole number', 'bad_arguments');
    }
    const maxRaw = option(argv, '--max-file-bytes');
    if (maxRaw !== undefined && !/^\d{1,10}$/.test(maxRaw)) {
      throw new Refusal('--max-file-bytes must be a whole number', 'bad_arguments');
    }
    const files = options(argv, '--file');
    const task = option(argv, '--task');
    const outcome = await save(deps, {
      cwd: process.cwd(),
      auto: false,
      ...(note === undefined ? {} : { note }),
      ...(files.length === 0 ? {} : { files }),
      ...(maxRaw === undefined ? {} : { maxFileBytes: Number(maxRaw) }),
      claim: {
        ...(harness === undefined ? {} : { harness }),
        ...(task === undefined ? {} : { task }),
        ...(generationRaw === undefined ? {} : { generation: Number(generationRaw) }),
      },
    });
    const r = outcome.record;
    if (outcome.kind === 'unchanged') {
      io.out(`Nothing new since checkpoint ${r.id} (${r.commit_sha.slice(0, 12)}); nothing saved.`);
      return 0;
    }
    if (outcome.kind === 'retried') {
      // Nothing new to commit, but the save it matches had not registered.
      if (r.stage === 'registered') {
        io.out(
          `Checkpoint ${r.id} registered on the board — ${r.verification === 'verified' ? 'Verified' : PENDING}`,
        );
        io.out(`  (${r.commit_sha.slice(0, 12)} was already pushed; nothing new to save)`);
        return 0;
      }
      io.err(
        r.stage === 'refused'
          ? `Checkpoint ${r.id}: the board refused the registration (${r.last_error ?? 'unknown'})`
          : `Checkpoint ${r.id} is saved here but still not registered (${r.stage.replace('_', ' ')}` +
              `${r.last_error === undefined ? '' : `; last: ${r.last_error}`}); it is retried with the same key`,
      );
      return 1;
    }
    io.out(`Checkpoint ${r.id} at ${r.commit_sha}`);
    io.out(`  pushed ${r.branch} and ${r.tag_ref.slice('refs/tags/'.length)} to ${r.remote}`);
    io.out(
      `  ${String(r.manifest.length)} file(s) in the manifest; note: ${r.summary === null ? 'none' : r.summary_commit_sha === r.commit_sha ? 'this save' : 'an earlier save (stale)'}`,
    );
    if (r.stage === 'registered') {
      io.out(`  registered on the board — ${r.verification === 'verified' ? 'Verified' : PENDING}`);
      if (r.last_error !== undefined) io.err(`  warning: ${r.last_error}`);
      return 0;
    }
    if (r.stage === 'refused') {
      io.err(`  the board refused the registration: ${r.last_error ?? 'unknown'}`);
      return 1;
    }
    io.err(
      `  not registered yet (${r.last_error ?? 'unknown'}); the next save or \`status\` retries it with the same key`,
    );
    return 1;
  }

  if (sub === 'note') {
    const note = readNoteArg(io, '-');
    const top = writeNoteFor(deps, process.cwd(), note);
    io.out(`Kept the note for the next save in ${top}.`);
    return 0;
  }

  if (sub === 'status') {
    for (const line of await statusLines(deps)) io.out(line);
    return 0;
  }

  if (sub === 'reverify') {
    const id = argv[1];
    if (!isLaikaId(id)) throw new Refusal('reverify <checkpoint id>', 'bad_arguments');
    const { retag } = await reverify(deps, id);
    io.out(`Pushed ${retag.ref.slice('refs/tags/'.length)} at the same commit — ${PENDING}`);
    return 0;
  }

  if (sub === 'consent') return consent(io, argv.slice(1), deps);

  io.err(CHECKPOINT_USAGE);
  return 1;
}

async function prune(io: AgentIo, argv: readonly string[]): Promise<number> {
  if (argv[0] !== 'prune' || !argv.includes('--dry-run')) {
    io.err(
      'laika agent checkpoints prune --dry-run [--days N] [--remote R] — it only lists; there is no other mode',
    );
    return 1;
  }
  const daysRaw = option(argv, '--days');
  if (daysRaw !== undefined && !/^\d{1,5}$/.test(daysRaw))
    throw new Refusal('--days must be a whole number', 'bad_arguments');
  const harness = harnessOption(argv);
  const { credential } = credentialFor(io, harness);
  const days = daysRaw === undefined ? DEFAULT_RETENTION_DAYS : Number(daysRaw);
  const remote = option(argv, '--remote') ?? 'origin';
  const { due, kept } = await pruneCandidates(
    checkpointDeps(io),
    process.cwd(),
    credential,
    remote,
    days,
  );
  for (const ref of due) io.out(ref);
  io.out(
    `${String(due.length)} checkpoint tag(s) on ${remote} are past ${String(days)} days after their task closed; ` +
      `${String(kept)} kept. Dry run: nothing was deleted. An operator deletes tags deliberately (D-116).`,
  );
  return 0;
}

export async function checkpointCommand(
  io: AgentIo,
  command: 'checkpoint' | 'checkpoints',
  argv: readonly string[],
): Promise<number> {
  try {
    return command === 'checkpoint' ? await run(io, argv) : await prune(io, argv);
  } catch (cause) {
    if (cause instanceof Refusal) {
      io.err(`laika agent ${command}: ${cause.message}`);
      return 2;
    }
    io.err(`laika agent ${command}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}
