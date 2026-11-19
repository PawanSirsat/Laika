import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname } from 'node:path';
import { HARNESSES, type Harness, isHarness } from './agent-adapters.ts';
import { agentsDir, readCredential } from './agent-session.ts';
import { normaliseUrl } from './api.ts';
import { scanFile, SECRET_WORDS } from './attach-scan.ts';

/**
 * `laika attach <TASK-KEY> <file…>` — put files a person should see on a task
 * (D-162, LAI-1351).
 *
 * Screenshots, a generated sheet, a test report, a short recording: an agent
 * runs one command, and the task gets the files with a caption each, in one
 * comment that links them. What it does, in order:
 *
 * 1. **Checks every file here first**, before anything is sent: it exists, it
 *    is not empty, there are 1–20 of them, and none holds a secret
 *    (`attach-scan.ts` — text by its contents, an `.xlsx` or `.docx` by its
 *    cells and paragraphs, a key by its name). A secret refuses the whole
 *    command, names the file, the kind of secret and where, never the value,
 *    and says to mask it. **There is no override.**
 * 2. Finds the task — its key, the outside id it carries, or its id — over the
 *    board's `/mcp` `get_task_context`, as `laika time start` does, and the
 *    board's largest file from `GET /org`.
 * 3. For each file: `POST /projects/:slug/attachments`, a plain `PUT` of the
 *    bytes to the presigned URL with exactly the headers it came with, then
 *    `POST /attachments/:id/complete` — where the board scans a text file again.
 * 4. Posts **one comment** whose `**Attached**` block links every file with
 *    its caption (`POST /tasks/:id/comments`), and reads the task's files back
 *    to confirm each one is on it.
 *
 * **All of them, or none.** The uploads name the project, not the task, so no
 * file is on the task until the comment links them all in one write — a file
 * named with its task would join it as soon as its own upload completed, and a
 * failure on the third would leave the first two behind. When anything fails,
 * every upload already made is deleted, and the exit code says nothing was
 * linked. An upload that cannot be deleted is named, by id, in capitals: the
 * board's sweep removes an upload no task took within 24 hours, and that is
 * the backstop, not the plan.
 *
 * `--unlisted <repo> --project <slug>` logs **a new unlisted finding** that
 * holds the files instead (`log_unlisted_work`, D-162 item 8): the board can
 * attach files to a finding only as it is logged, so `--comment` is its note.
 *
 * **The credential** is the tool's own (`~/.laika/agents/<tool>.json`, or
 * `LAIKA_AGENT_TOKEN` with `LAIKA_AGENT_URL`), so the files and the comment
 * are attributed to the agent; the person's token is the fallback. It goes
 * only into the `Authorization` header of a request to its own board, and the
 * presigned URL is used once and never printed.
 *
 * Exit: 0 every file attached; 1 nothing was linked (a refusal or a failure,
 * said on stderr); 64 a usage error.
 */

/** The most files at once: the board's own limit on links per write (D-162). */
export const MAX_FILES = 20;

/** The board's caption limit, in characters. */
export const MAX_CAPTION = 200;

const API_TIMEOUT_MS = 30_000;

export interface AttachIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
}

const CONSOLE: AttachIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  fetch: (input, init) => fetch(input, init),
};

export const ATTACH_USAGE = [
  'Usage: laika attach <TASK-KEY> <file…> [--caption "…"]… [--comment "text"] [--json]',
  '       laika attach --unlisted <repo> --project <slug> <file…> --comment "note" [--caption "…"]…',
  '',
  'Uploads files a person should see — screenshots, a generated sheet, a report,',
  'a short recording — and links them on the task in one comment, a caption each.',
  '',
  '  --caption   one per file, in order; a file with none is captioned by its name',
  '  --comment   the comment the files are attached under',
  '  --unlisted  log a NEW unlisted finding about <repo> that holds the files',
  '              (it cannot add files to a finding already logged); needs',
  '              --project (where they are uploaded) and --comment (its note)',
  '  --harness   whose credential to use: claude-code, codex, … (default: the tool',
  '              this runs in, else the only one here, else your own token)',
  '  --json      one JSON object on stdout',
  '',
  `1–${String(MAX_FILES)} files, each up to the board's limit. Every file is checked here for`,
  'secrets before anything is sent — text by its contents, .xlsx and .docx by their',
  'cells, keys by their names. A secret refuses the command: attach a masked copy.',
  '',
  'Exit: 0 every file attached, 1 nothing was linked, 64 usage.',
].join('\n');

interface Args {
  ref?: string;
  files: string[];
  captions: string[];
  comment?: string;
  unlisted?: string;
  project?: string;
  harness?: Harness;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { files: [], captions: [], json: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = (): string | undefined => {
      const v = argv[i + 1];
      i += 1;
      return v;
    };
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--caption': {
        const v = value();
        if (v === undefined) return '--caption needs a caption';
        args.captions.push(v);
        break;
      }
      case '--comment': {
        const v = value();
        if (v === undefined || v.trim() === '') return '--comment needs text';
        args.comment = v;
        break;
      }
      case '--unlisted': {
        const v = value();
        if (v === undefined || v.trim() === '')
          return '--unlisted needs the repo the finding is about';
        args.unlisted = v.trim();
        break;
      }
      case '--project': {
        const v = value();
        if (v === undefined || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(v)) {
          return '--project needs a project slug';
        }
        args.project = v;
        break;
      }
      case '--harness': {
        const v = value();
        if (!isHarness(v)) return `--harness must be one of: ${HARNESSES.join(', ')}`;
        args.harness = v;
        break;
      }
      default:
        if (arg.startsWith('--')) return `unknown option "${arg}"`;
        positional.push(arg);
    }
  }
  if (args.help) return args;
  if (args.unlisted !== undefined) {
    if (args.project === undefined)
      return '--unlisted needs --project <slug>: where the files are uploaded';
    if (args.comment === undefined) return '--unlisted needs --comment: the finding’s note';
    args.files = positional;
  } else {
    if (args.project !== undefined) return '--project goes with --unlisted; a task names its own';
    const [ref, ...files] = positional;
    if (ref === undefined) return 'name the task: laika attach <TASK-KEY> <file…>';
    args.ref = ref;
    args.files = files;
  }
  if (args.files.length === 0) return 'name at least one file';
  if (args.files.length > MAX_FILES) {
    return `at most ${String(MAX_FILES)} files at once (${String(args.files.length)} named)`;
  }
  if (args.captions.length > args.files.length) {
    return `${String(args.captions.length)} captions for ${String(args.files.length)} files: one --caption per file, at most`;
  }
  for (const caption of args.captions) {
    if (caption.trim() === '') return 'a --caption cannot be empty';
    if ([...caption].length > MAX_CAPTION) {
      return `a caption is at most ${String(MAX_CAPTION)} characters`;
    }
  }
  return args;
}

/* -------------------------------------------------------------------------- */
/* The credential                                                             */
/* -------------------------------------------------------------------------- */

export interface AttachCredential {
  readonly url: string;
  readonly token: string;
  /** Whose it is, in words: `claude-code's credential`, `your own token`. */
  readonly via: string;
}

/** The tools with a credential file here, by name. */
function savedTools(home: string): Harness[] {
  try {
    return readdirSync(agentsDir(home))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((name): name is Harness => isHarness(name))
      .sort();
  } catch {
    return [];
  }
}

/** A board URL that is safe to send a token to: http(s), no user, password, query or fragment. */
function sendable(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      return undefined;
    }
    return normaliseUrl(raw);
  } catch {
    return undefined;
  }
}

/**
 * Which credential attach acts with: `--harness`'s, else `LAIKA_AGENT_TOKEN`
 * with `LAIKA_AGENT_URL`, else Claude Code's when this runs inside Claude Code,
 * else the only tool set up here, else the person's own token. A tool's
 * credential first, so the files are the agent's; the person's when none
 * decides it.
 */
export async function attachCredential(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  harness?: Harness,
): Promise<AttachCredential | { readonly refused: string }> {
  const pick = (
    url: string,
    token: string,
    via: string,
  ): AttachCredential | { refused: string } => {
    const board = sendable(url);
    return board === undefined
      ? { refused: `the board URL in ${via} is not a plain http(s) URL, so nothing was sent` }
      : { url: board, token: token.trim(), via };
  };
  if (harness !== undefined) {
    const own = readCredential(home, harness, env);
    if (own === undefined) {
      return {
        refused: `no ${harness} credential here: add it in the browser (Developer access → this device → Add tool)`,
      };
    }
    return pick(own.url, own.token, `${harness}'s credential`);
  }
  const envToken = env.LAIKA_AGENT_TOKEN;
  const envUrl = env.LAIKA_AGENT_URL;
  if (envToken !== undefined && envToken !== '' && envUrl !== undefined && envUrl !== '') {
    return pick(envUrl, envToken, 'LAIKA_AGENT_TOKEN');
  }
  const saved = savedTools(home);
  const running: Harness | undefined =
    env.CLAUDECODE === '1' && saved.includes('claude-code') ? 'claude-code' : undefined;
  const only = saved.length === 1 ? saved[0] : undefined;
  const tool = running ?? only;
  if (tool !== undefined) {
    const own = readCredential(home, tool, {});
    if (own !== undefined) return pick(own.url, own.token, `${tool}'s credential`);
  }
  // Loaded here, not at the top: activity-sync's graph reaches back to
  // doctor.ts, which imports this module, and a static import made a cycle
  // that left `activity-store`'s constants uninitialised (`laika status`).
  const { findCredentials } = await import('./activity-sync.ts');
  const personal = findCredentials(home, env);
  if (personal !== undefined) return pick(personal.url, personal.token, 'your own token');
  return {
    refused:
      saved.length > 1
        ? `several tools are set up here (${saved.join(', ')}): pass --harness <tool>`
        : 'this machine is not connected to a board: no tool credential and no token of yours',
  };
}

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

type Reply =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly why: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The board's own words for a refusal (§6.3), or its status. Never a store's body. */
function refusal(status: number, body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const message = typeof error?.message === 'string' ? error.message : undefined;
  const details = isRecord(error?.details) ? error.details : undefined;
  const reason = typeof details?.reason === 'string' ? ` (${details.reason})` : '';
  return message === undefined
    ? `the board answered ${String(status)}`
    : `the board answered ${String(status)}: ${message}${reason}`;
}

async function api(
  fetchImpl: typeof fetch,
  c: AttachCredential,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  let response: Response;
  try {
    response = await fetchImpl(`${c.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      why: `the board did not answer (${cause instanceof Error ? cause.name : 'error'})`,
    };
  }
  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { ok: true, status: response.status, body: parsed };
}

/** One MCP tool, over the board's stateless `/mcp`: its structured answer, or why not. */
async function mcpTool(
  fetchImpl: typeof fetch,
  c: AttachCredential,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; why: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`${c.url}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      why: `the board did not answer (${cause instanceof Error ? cause.name : 'error'})`,
    };
  }
  if (!response.ok) return { ok: false, why: `the board answered ${String(response.status)}` };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, why: 'the board’s answer was not one this understands' };
  }
  const result = isRecord(body) && isRecord(body.result) ? body.result : undefined;
  if (result === undefined) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    return { ok: false, why: typeof error?.message === 'string' ? error.message : 'no answer' };
  }
  if (result.isError === true) {
    const first = Array.isArray(result.content) ? (result.content[0] as unknown) : undefined;
    const text = isRecord(first) && typeof first.text === 'string' ? first.text : '';
    try {
      const parsed = JSON.parse(text) as unknown;
      const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
      if (typeof error?.message === 'string') return { ok: false, why: error.message };
    } catch {
      // Not the §6.3 envelope: the text itself.
    }
    return { ok: false, why: text.slice(0, 300) || 'refused' };
  }
  return isRecord(result.structuredContent)
    ? { ok: true, value: result.structuredContent }
    : { ok: false, why: 'the board’s answer was not one this understands' };
}

interface TaskRef {
  readonly id: string;
  readonly key: string;
  readonly projectId: string;
}

async function findTask(io: AttachIo, c: AttachCredential, ref: string): Promise<TaskRef | string> {
  const got = await mcpTool(io.fetch, c, 'get_task_context', { task: ref });
  if (!got.ok) return `no task ${ref} that this credential can read (${got.why})`;
  const task = isRecord(got.value.task) ? got.value.task : undefined;
  if (
    typeof task?.id !== 'string' ||
    typeof task.key !== 'string' ||
    typeof task.project_id !== 'string'
  ) {
    return `no task ${ref} that this credential can read`;
  }
  return { id: task.id, key: task.key, projectId: task.project_id };
}

/** The slug of the project with this id, from the projects this credential can read. */
async function projectSlug(
  io: AttachIo,
  c: AttachCredential,
  projectId: string,
): Promise<string | undefined> {
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const query: string =
      cursor === null ? '?limit=200' : `?limit=200&cursor=${encodeURIComponent(cursor)}`;
    const got = await api(io.fetch, c, 'GET', `/api/v1/projects${query}`);
    if (!got.ok || got.status !== 200 || !isRecord(got.body)) return undefined;
    const data = Array.isArray(got.body.data) ? got.body.data : [];
    for (const row of data) {
      if (isRecord(row) && row.id === projectId && typeof row.slug === 'string') return row.slug;
    }
    cursor = typeof got.body.next_cursor === 'string' ? got.body.next_cursor : null;
    if (cursor === null) return undefined;
  }
  return undefined;
}

/** The board's largest file, `null` when attachments are off, or why it could not be read. */
export async function boardCap(
  fetchImpl: typeof fetch,
  c: AttachCredential,
): Promise<
  { ok: true; maxBytes: number | null } | { ok: false; why: string; status: number | null }
> {
  const got = await api(fetchImpl, c, 'GET', '/api/v1/org');
  if (!got.ok) return { ok: false, why: got.why, status: null };
  if (got.status !== 200 || !isRecord(got.body)) {
    return { ok: false, why: refusal(got.status, got.body), status: got.status };
  }
  const attachments = got.body.attachments;
  if (attachments === null || attachments === undefined) return { ok: true, maxBytes: null };
  const max = isRecord(attachments) ? attachments.max_bytes : undefined;
  return typeof max === 'number'
    ? { ok: true, maxBytes: max }
    : { ok: false, why: 'the board did not say its limit', status: got.status };
}

/**
 * The projects this credential may upload to — a lead or a member of, as
 * `GET /me` says (§3.1: attaching is *Add comment*'s right) — for `laika
 * doctor`, which asks with `GET`s only.
 */
export async function uploadableProjects(
  fetchImpl: typeof fetch,
  c: AttachCredential,
): Promise<{ ok: true; count: number } | { ok: false; why: string }> {
  const got = await api(fetchImpl, c, 'GET', '/api/v1/me');
  if (!got.ok) return { ok: false, why: got.why };
  if (got.status !== 200 || !isRecord(got.body))
    return { ok: false, why: refusal(got.status, got.body) };
  const memberships = Array.isArray(got.body.memberships) ? got.body.memberships : [];
  const count = memberships.filter(
    (m) => isRecord(m) && (m.role === 'lead' || m.role === 'member'),
  ).length;
  return { ok: true, count };
}

/**
 * The file store's origin, as the board names it in its `connect-src` — the
 * one origin besides its own a page may send to, and only when attachments
 * are on (§13.1) — and whether it answers from here. Any HTTP answer is an
 * answer: a store refuses an unsigned request, and that is it reachable.
 */
export async function storeReachable(
  fetchImpl: typeof fetch,
  boardUrl: string,
): Promise<{ origin: string | null; answered: boolean | null }> {
  let csp: string | null;
  try {
    const health = await fetchImpl(`${boardUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    await health.body?.cancel().catch(() => undefined);
    csp = health.headers.get('content-security-policy');
  } catch {
    return { origin: null, answered: null };
  }
  const connect = (csp ?? '')
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === 'connect-src');
  const origin = connect?.slice(1).find((v) => /^https?:\/\//.test(v)) ?? null;
  if (origin === null) return { origin: null, answered: null };
  try {
    const answer = await fetchImpl(origin, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
    await answer.body?.cancel().catch(() => undefined);
    return { origin, answered: true };
  } catch {
    return { origin, answered: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

const TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

/** A file's media type, from its extension; anything unknown is octet-stream. */
export function contentTypeOf(filename: string): string {
  return TYPES[extname(filename).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** A caption as the board keeps one: one line, at most 200 characters, the file's name when empty. */
export function captionLine(caption: string, filename: string): string {
  const text = [...caption.replace(/\s+/g, ' ').trim()].slice(0, MAX_CAPTION).join('');
  return text === '' ? filename : text;
}

/** {@link captionLine} as a link's text, the way the board writes it: `\`, `[` and `]` escaped. */
export function captionText(caption: string, filename: string): string {
  return captionLine(caption, filename).replace(/[\\[\]]/g, (ch) => `\\${ch}`);
}

interface Local {
  readonly path: string;
  readonly filename: string;
  readonly caption: string;
  readonly size: number;
  readonly sha256: string;
  readonly contentType: string;
}

interface Done {
  readonly id: string;
  readonly filename: string;
  readonly caption: string;
  readonly contentType: string;
  readonly size: number;
  readonly inline: boolean;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every file read and checked here. A refusal names the file and why, never a secret's value. */
function checkFiles(args: Args): { readonly files: Local[]; readonly problems: string[] } {
  const problems: string[] = [];
  const files: Local[] = [];
  for (const [i, path] of args.files.entries()) {
    const filename = basename(path);
    let bytes: Buffer;
    try {
      if (!statSync(path).isFile()) {
        problems.push(`${path}: not a file`);
        continue;
      }
      bytes = readFileSync(path);
    } catch {
      problems.push(`${path}: cannot be read`);
      continue;
    }
    if (bytes.length === 0) {
      problems.push(`${path}: empty — there is nothing to show`);
      continue;
    }
    if (filename.length > 255) {
      problems.push(`${path}: the name is longer than 255 characters`);
      continue;
    }
    const verdict = scanFile(filename, bytes);
    if (!verdict.ok) {
      problems.push(
        verdict.pattern === 'unreadable'
          ? `${path}: could not be opened to check it for secrets${verdict.where === 'its contents' ? '' : ` (${verdict.where})`} — attach a PDF or CSV export of it, or the files inside it, instead`
          : `${path}: holds ${SECRET_WORDS[verdict.pattern]} (${verdict.where}). Mask it — ****, <redacted> — or attach the list of accounts without their secrets, and say where the real file is kept`,
      );
      continue;
    }
    files.push({
      path,
      filename,
      caption: args.captions[i] ?? filename,
      size: bytes.length,
      sha256: sha256(bytes),
      contentType: contentTypeOf(filename),
    });
  }
  return { files, problems };
}

/** One file: asked for in the project, `PUT` to the store, completed. The id on failure too, to delete it. */
async function upload(
  io: AttachIo,
  c: AttachCredential,
  slug: string,
  file: Local,
  created: string[],
): Promise<Done | string> {
  const asked = await api(
    io.fetch,
    c,
    'POST',
    `/api/v1/projects/${encodeURIComponent(slug)}/attachments`,
    {
      filename: file.filename,
      content_type: file.contentType,
      size_bytes: file.size,
    },
  );
  if (!asked.ok) return `${file.filename}: ${asked.why}`;
  if (asked.status !== 201 || !isRecord(asked.body))
    return `${file.filename}: ${refusal(asked.status, asked.body)}`;
  const attachment = isRecord(asked.body.attachment) ? asked.body.attachment : undefined;
  const put = isRecord(asked.body.upload) ? asked.body.upload : undefined;
  const id = attachment?.id;
  if (typeof id !== 'string' || typeof put?.url !== 'string' || !isRecord(put.headers)) {
    return `${file.filename}: the board’s answer was not one this understands`;
  }
  created.push(id);

  // The bytes uploaded are the bytes checked: read again, and compared.
  const bytes = readFileSync(file.path);
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256) {
    return `${file.filename}: changed after it was checked; run the command again`;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(put.headers)) {
    if (typeof value === 'string') headers[name] = value;
  }
  let stored: Response;
  try {
    stored = await io.fetch(put.url, {
      method: 'PUT',
      headers,
      body: bytes,
      signal: AbortSignal.timeout(60_000 + Math.ceil(file.size / 262_144) * 1000),
    });
  } catch (cause) {
    return `${file.filename}: the file store did not answer (${cause instanceof Error ? cause.name : 'error'})`;
  }
  // The store's body is never shown: it is not the board's, and may say more than it should.
  await stored.body?.cancel().catch(() => undefined);
  if (!stored.ok) return `${file.filename}: the file store answered ${String(stored.status)}`;

  const done = await api(
    io.fetch,
    c,
    'POST',
    `/api/v1/attachments/${encodeURIComponent(id)}/complete`,
  );
  if (!done.ok) return `${file.filename}: ${done.why}`;
  if (done.status !== 200 || !isRecord(done.body)) {
    const error = isRecord(done.body) && isRecord(done.body.error) ? done.body.error : undefined;
    const details = isRecord(error?.details) ? error.details : undefined;
    if (details?.reason === 'secret_detected') {
      const line = typeof details.line === 'number' ? `, line ${String(details.line)}` : '';
      return `${file.filename}: the board found a secret in it (${String(details.pattern)}${line}) and deleted it. Mask it and attach the masked copy`;
    }
    return `${file.filename}: ${refusal(done.status, done.body)}`;
  }
  return {
    id,
    filename: file.filename,
    caption: file.caption,
    contentType: file.contentType,
    size: file.size,
    inline: done.body.inline === true,
  };
}

/** The ids of the files on the task, read twice at most, or `undefined` when neither read answered. */
async function readBack(
  io: AttachIo,
  c: AttachCredential,
  taskId: string,
): Promise<Set<string> | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const listed = await api(
      io.fetch,
      c,
      'GET',
      `/api/v1/tasks/${encodeURIComponent(taskId)}/attachments`,
    );
    if (
      listed.ok &&
      listed.status === 200 &&
      isRecord(listed.body) &&
      Array.isArray(listed.body.data)
    ) {
      return new Set(
        listed.body.data.flatMap((row) =>
          isRecord(row) && row.task_id === taskId && typeof row.id === 'string' ? [row.id] : [],
        ),
      );
    }
  }
  return undefined;
}

/**
 * Delete what was uploaded, each `DELETE` checked. One the board did not
 * confirm is returned as failed and said loudly; the board's sweep, which
 * takes an upload no task took within a day, is the backstop.
 */
interface CleanUp {
  /** The uploads the board confirmed deleted (204), or already gone (404). */
  readonly deleted: string[];
  /** The ones it did not: said loudly, by id. */
  readonly failed: string[];
}

async function cleanUp(
  io: AttachIo,
  c: AttachCredential,
  ids: readonly string[],
): Promise<CleanUp> {
  const result: CleanUp = { deleted: [], failed: [] };
  for (const id of ids) {
    const gone = await api(io.fetch, c, 'DELETE', `/api/v1/attachments/${encodeURIComponent(id)}`);
    // 404 is gone too: a file the board already removed, as it does a secret.
    if (gone.ok && (gone.status === 204 || gone.status === 404)) result.deleted.push(id);
    else result.failed.push(id);
  }
  return result;
}

/** The `**Attached**` block, one captioned link per file, as the board's own tools write it. */
export function attachedBlock(
  done: readonly Pick<Done, 'id' | 'caption' | 'filename' | 'contentType' | 'inline'>[],
): string {
  const lines = done.map((d) => {
    const image = d.inline && d.contentType.startsWith('image/');
    return `- ${image ? '!' : ''}[${captionText(d.caption, d.filename)}](/api/v1/attachments/${d.id}/content)`;
  });
  return ['**Attached**', '', ...lines].join('\n');
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

export async function attach(argv: readonly string[], io: AttachIo = CONSOLE): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    io.err(`laika attach: ${parsed}\n\n${ATTACH_USAGE}`);
    return 64;
  }
  if (parsed.help) {
    io.out(ATTACH_USAGE);
    return 0;
  }
  const args = parsed;
  const fail = (
    lines: readonly string[],
    left: { readonly cleanup?: CleanUp; readonly comment?: string } = {},
  ): number => {
    const failed = left.cleanup?.failed ?? [];
    // What could not be undone is said loudly, by id: the board's sweep
    // removes an upload no task took within 24 hours, but a person should know.
    const loud = [
      ...(left.comment === undefined
        ? []
        : [
            `COULD NOT REMOVE comment ${left.comment}, which links the files: delete it on the task`,
          ]),
      ...(failed.length === 0
        ? []
        : [
            `COULD NOT DELETE ${String(failed.length)} upload${failed.length === 1 ? '' : 's'} already made (${failed.join(', ')}). ${left.comment === undefined ? 'They are on no task, and' : 'Unlinked ones'} the board's sweep removes them within 24 hours`,
          ]),
    ];
    if (args.json) {
      io.out(
        JSON.stringify({
          ok: false,
          linked: left.comment !== undefined ? 'unknown' : false,
          errors: [...lines, ...loud],
          ...(left.cleanup === undefined
            ? {}
            : { cleaned_up: left.cleanup.deleted, cleanup_failed: failed }),
          ...(left.comment === undefined ? {} : { comment_not_removed: left.comment }),
        }),
      );
    }
    for (const line of [...lines, ...loud]) io.err(`laika attach: ${line}`);
    io.err(
      left.comment === undefined
        ? 'laika attach: nothing was attached.'
        : `laika attach: the task may still show comment ${left.comment}.`,
    );
    return 1;
  };

  // 1. Here, before anything is sent.
  const { files, problems } = checkFiles(args);
  if (problems.length > 0) return fail(problems);

  const chosen = await attachCredential(io.home, io.env, args.harness);
  if ('refused' in chosen) return fail([chosen.refused]);
  const c = chosen;

  // 2. The task, its project and the board's limit.
  const cap = await boardCap(io.fetch, c);
  if (!cap.ok) return fail([`could not read the board's settings: ${cap.why}`]);
  if (cap.maxBytes === null) return fail(['attachments are off on this board']);
  const tooBig = files.filter((f) => f.size > (cap.maxBytes ?? 0));
  if (tooBig.length > 0) {
    return fail(
      tooBig.map(
        (f) =>
          `${f.path}: ${String(f.size)} bytes, over this board's limit of ${String(cap.maxBytes)}`,
      ),
    );
  }

  let task: TaskRef | undefined;
  let slug: string | undefined;
  if (args.ref !== undefined) {
    const found = await findTask(io, c, args.ref);
    if (typeof found === 'string') return fail([found]);
    task = found;
    slug = await projectSlug(io, c, found.projectId);
    if (slug === undefined)
      return fail([`could not find ${found.key}'s project among those this credential can read`]);
  } else {
    slug = args.project;
  }
  if (slug === undefined) return fail(['no project to upload to']);

  // 3. Each file, all or none.
  const created: string[] = [];
  const done: Done[] = [];
  for (const file of files) {
    const result = await upload(io, c, slug, file, created);
    if (typeof result === 'string') {
      return fail([result], { cleanup: await cleanUp(io, c, created) });
    }
    done.push(result);
  }

  const items = done.map((d) => ({
    attachment: d.id,
    caption: captionLine(d.caption, d.filename),
  }));
  const view = (d: Done) => ({
    id: d.id,
    filename: d.filename,
    caption: d.caption,
    content_type: d.contentType,
    size_bytes: d.size,
    url: `${c.url}/api/v1/attachments/${d.id}/content`,
  });

  // 4a. An unlisted finding, logged with its files.
  if (task === undefined) {
    const logged = await mcpTool(io.fetch, c, 'log_unlisted_work', {
      repo: args.unlisted,
      note: args.comment,
      attachments: items,
    });
    const unlisted =
      logged.ok && isRecord(logged.value.unlisted) ? logged.value.unlisted : undefined;
    if (!logged.ok || typeof unlisted?.id !== 'string') {
      return fail(
        [`the board did not log the finding: ${logged.ok ? 'no id in its answer' : logged.why}`],
        { cleanup: await cleanUp(io, c, created) },
      );
    }
    if (args.json) {
      io.out(
        JSON.stringify({
          ok: true,
          unlisted_id: unlisted.id,
          via: c.via,
          attachments: done.map(view),
        }),
      );
    } else {
      io.out(
        `Logged unlisted finding ${unlisted.id} with ${String(done.length)} file${done.length === 1 ? '' : 's'} (${c.via}):`,
      );
      for (const d of done) io.out(`  ${d.id}  ${d.caption}  ${view(d).url}`);
    }
    return 0;
  }

  // 4b. One comment that links them all, then read back.
  const text =
    args.comment?.trim() ??
    `${String(done.length)} file${done.length === 1 ? '' : 's'}, attached with \`laika attach\`.`;
  const posted = await api(
    io.fetch,
    c,
    'POST',
    `/api/v1/tasks/${encodeURIComponent(task.id)}/comments`,
    {
      body_md: `${text}\n\n${attachedBlock(done)}`,
    },
  );
  const comment =
    posted.ok && posted.status === 201 && isRecord(posted.body) ? posted.body : undefined;
  if (typeof comment?.id !== 'string') {
    return fail(
      [
        `the comment was not posted: ${posted.ok ? refusal(posted.status, posted.body) : posted.why}`,
      ],
      { cleanup: await cleanUp(io, c, created) },
    );
  }
  // Read back: the task's files, asked twice at most. A read that fails is
  // not a link that failed — the comment was written — so it is reported as
  // linked but unverified, never undone.
  const onTask = await readBack(io, c, task.id);
  if (onTask === undefined) {
    io.err(
      `laika attach: warning — the comment was posted, but the task's files could not be read back to confirm; check ${task.key} on the board`,
    );
  }
  const missing = onTask === undefined ? [] : done.filter((d) => !onTask.has(d.id));
  if (missing.length > 0) {
    const removed = await api(
      io.fetch,
      c,
      'DELETE',
      `/api/v1/comments/${encodeURIComponent(comment.id)}`,
    );
    const commentGone = removed.ok && (removed.status === 204 || removed.status === 404);
    return fail([`the comment did not link ${missing.map((d) => d.filename).join(', ')}`], {
      cleanup: await cleanUp(io, c, created),
      ...(commentGone ? {} : { comment: comment.id }),
    });
  }

  if (args.json) {
    io.out(
      JSON.stringify({
        ok: true,
        task: task.key,
        task_id: task.id,
        comment_id: comment.id,
        verified: onTask !== undefined,
        via: c.via,
        attachments: done.map(view),
      }),
    );
  } else {
    io.out(
      `Attached ${String(done.length)} file${done.length === 1 ? '' : 's'} to ${task.key} in one comment (${c.via})${onTask === undefined ? ' — linked, unverified' : ''}:`,
    );
    for (const d of done) io.out(`  ${d.id}  ${d.caption}  ${view(d).url}`);
  }
  return 0;
}
