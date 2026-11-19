import { formatBytes } from '../../../api/attachment-upload.ts';
import type { Attachment } from '../../../api/attachments.ts';
import { HIDDEN_AGENT, roundAgentName, type Round } from '../../../api/review.ts';
import {
  attachmentIdOf,
  attachmentUrl,
  boardOrigin,
  fileKind,
  type FileKind,
} from './editor/attach.ts';

/**
 * An agent's outputs, as data (D-162, LAI-1352): which files a round, a
 * comment or an unlisted finding shows a person, what each is called and
 * drawn as, and how the viewer opens it.
 *
 * **Nothing new is stored.** The server writes an agent's outputs into the
 * text they belong to (LAI-1302): a round's `summary_md`, a comment's body, a
 * finding's note — `![caption](url)` for an image a browser may show and
 * `[caption](url)` for anything else, the caption's `\`, `[` and `]`
 * escaped. So the caption is the link's text, and a round's outputs are the
 * files its summary links. The task's file list (`GET /tasks/:id/attachments`)
 * adds what a link cannot say: the name, the type, whether it is shown inline.
 */

/** One captioned link to one of this board's files. */
export interface OutputRef {
  readonly id: string;
  /** The link's text, unescaped: the caption a person reads. */
  readonly caption: string;
  /** Written as an image, `![…]` — the server does so only for one a browser may show. */
  readonly image: boolean;
}

/** `[text](url)` or `![text](url)`, an optional title after the URL. */
const LINK = /(!?)\[((?:\\.|[^\\\]\n])*)\]\(\s*([^\s()<>]+)(?:\s+"[^"\n]*")?\s*\)/g;

/**
 * Every link in `markdown` to one of this board's files, in order and once
 * each: the first link to a file names it. Any other link is not an output.
 */
export function outputRefs(
  markdown: string | null | undefined,
  origin: string | undefined = boardOrigin(),
): OutputRef[] {
  if (markdown === null || markdown === undefined || markdown === '') return [];
  const seen = new Set<string>();
  const refs: OutputRef[] = [];
  for (const match of markdown.matchAll(LINK)) {
    const id = attachmentIdOf(match[3], origin);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    refs.push({
      id,
      caption: (match[2] ?? '').replace(/\\(.)/g, '$1').trim(),
      image: match[1] === '!',
    });
  }
  return refs;
}

/**
 * Each round's own outputs, by round number: the files its summary links
 * that no earlier round's did — the round the server's `get_task_context`
 * gives a file (`describeTaskFiles`: the first round whose summary links it).
 */
export function roundOutputs(
  rounds: readonly Pick<Round, 'number' | 'summary_md'>[],
  origin: string | undefined = boardOrigin(),
): ReadonlyMap<number, readonly OutputRef[]> {
  const taken = new Set<string>();
  const byRound = new Map<number, OutputRef[]>();
  for (const round of [...rounds].sort((a, b) => a.number - b.number)) {
    const own = outputRefs(round.summary_md, origin).filter((ref) => !taken.has(ref.id));
    for (const ref of own) taken.add(ref.id);
    byRound.set(round.number, own);
  }
  return byRound;
}

/** What an output is, as its fold line counts it. */
export type OutputKind = 'screenshot' | 'recording' | 'sheet' | 'report' | 'file';

/** How the viewer shows it: in the page, or as a card to download. */
export type OutputShow = 'image' | 'video' | 'pdf' | 'card';

/** One output, ready to draw: in a strip, a row and the viewer. */
export interface OutputItem {
  readonly id: string;
  /** `/api/v1/attachments/<id>/content`: opens it, and the server decides who may. */
  readonly url: string;
  /** The caption, or the file's name when it has none. */
  readonly caption: string;
  /** The file's own name, when the board said it. */
  readonly filename: string | null;
  readonly kind: OutputKind;
  /** The glyph a tile without a picture wears. */
  readonly glyph: FileKind;
  readonly show: OutputShow;
  /** *1.2 MB*, when the board said it. */
  readonly size: string | null;
  /** *by Ada’s Claude Code · Belka*, or null where nobody is named. */
  readonly by: string | null;
}

/** A run's or a test's report: what an agent produces besides sheets and documents. */
const REPORT_EXTENSIONS = new Set(['html', 'htm', 'log', 'json', 'xml', 'txt', 'md']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The fields of a file an output reads. */
export type OutputFile = Pick<
  Attachment,
  'id' | 'filename' | 'content_type' | 'size_bytes' | 'inline' | 'url'
>;

/**
 * One output from its link and, when the board listed it, its file.
 *
 * Shown in the page only when the server said so (`inline`, from the file's
 * first bytes): an image, an mp4 or webm recording, a PDF. A link with no
 * file behind it — an unlisted finding's, which no list serves — is shown
 * only when it was written as an image; anything else is a card, because a
 * file the server would not show inline is served as a download.
 */
export function outputItem(
  ref: OutputRef,
  file: OutputFile | undefined,
  by: string | null,
): OutputItem {
  const type = (file?.content_type ?? '').toLowerCase();
  const inline = file?.inline ?? false;
  const name = file?.filename ?? null;
  const show: OutputShow =
    ref.image || (inline && type.startsWith('image/'))
      ? 'image'
      : inline && VIDEO_TYPES.has(type)
        ? 'video'
        : inline && type === 'application/pdf'
          ? 'pdf'
          : 'card';
  const glyph: FileKind = show === 'image' ? 'image' : fileKind(name ?? ref.caption, type);
  const kind: OutputKind =
    show === 'image'
      ? 'screenshot'
      : show === 'video'
        ? 'recording'
        : glyph === 'sheet'
          ? 'sheet'
          : glyph === 'pdf' || glyph === 'doc' || REPORT_EXTENSIONS.has(extensionOf(name ?? ''))
            ? 'report'
            : 'file';
  return {
    id: ref.id,
    url: file?.url ?? attachmentUrl(ref.id),
    caption: ref.caption === '' ? (name ?? 'Attached file') : ref.caption,
    filename: name,
    kind,
    glyph,
    show,
    size: file === undefined ? null : formatBytes(file.size_bytes),
    by,
  };
}

/**
 * The outputs `refs` name, in order. With the task's files read (`files`), a
 * link to a file no longer there — removed since — is left out; without them
 * (not read yet, or the read failed) every link is kept as written.
 */
export function outputItems(
  refs: readonly OutputRef[],
  files: readonly OutputFile[] | undefined,
  by: string | null,
): OutputItem[] {
  if (files === undefined) return refs.map((ref) => outputItem(ref, undefined, by));
  const byId = new Map(files.map((file) => [file.id, file]));
  return refs.flatMap((ref) => {
    const file = byId.get(ref.id);
    return file === undefined ? [] : [outputItem(ref, file, by)];
  });
}

const KIND_ORDER: readonly OutputKind[] = ['screenshot', 'recording', 'sheet', 'report', 'file'];

const KIND_WORDS: Readonly<Record<OutputKind, readonly [string, string]>> = {
  screenshot: ['screenshot', 'screenshots'],
  recording: ['recording', 'recordings'],
  sheet: ['sheet', 'sheets'],
  report: ['report', 'reports'],
  file: ['file', 'files'],
};

/** *4 screenshots · 1 sheet · 1 report*: each kind there is, in a fixed order. */
export function outputKinds(items: readonly Pick<OutputItem, 'kind'>[]): string {
  return KIND_ORDER.flatMap((kind) => {
    const count = items.filter((item) => item.kind === kind).length;
    if (count === 0) return [];
    const [one, many] = KIND_WORDS[kind];
    return [`${String(count)} ${count === 1 ? one : many}`];
  }).join(' · ');
}

/** The folded line: *Outputs · 6 — 4 screenshots · 1 sheet · 1 report*. */
export function outputsFoldLabel(items: readonly Pick<OutputItem, 'kind'>[]): string {
  return `Outputs · ${String(items.length)} — ${outputKinds(items)}`;
}

/**
 * Who a file came from, as the viewer says it (D-162: the owner is the
 * uploader, the agent is named beside them): *by Ada’s Claude Code · Belka*,
 * *by Ada’s agent* for one the reader may not see, *by Ada* for a person.
 */
export function outputBy(owner: string, agent: string | null): string {
  if (agent === null) return `by ${owner}`;
  if (agent === HIDDEN_AGENT) return `by ${owner}’s agent`;
  return `by ${owner}’s ${agent}`;
}

/** A round's outputs came from whoever finished it, through the agent that did. */
export function roundBy(
  round: Pick<Round, 'finished_by' | 'agent' | 'by_registered_agent' | 'client_name'>,
  nameOf: (userId: string) => string,
): string {
  return outputBy(nameOf(round.finished_by), roundAgentName(round));
}

/** The line the server writes above a finding's files (`attachToUnlisted`). */
const ATTACHED = '**Attached**';

/**
 * A finding's note and the files attached under it (D-162 item 8): the
 * server appends them as a block — a blank line, `**Attached**`, a blank
 * line, one link per line — so the note reads as it was written, and the
 * files go in a strip.
 */
export function splitAttached(
  note: string,
  origin: string | undefined = boardOrigin(),
): { readonly text: string; readonly refs: readonly OutputRef[] } {
  const at = note.lastIndexOf(`\n\n${ATTACHED}\n`);
  if (at === -1) return { text: note, refs: [] };
  const refs = outputRefs(note.slice(at), origin);
  return refs.length === 0 ? { text: note, refs } : { text: note.slice(0, at).trimEnd(), refs };
}

/** The Attachments section's groups, in the order it draws them. */
export type AttachmentGroup = 'outputs' | 'comments' | 'other';

export const ATTACHMENT_GROUP_TITLES: Readonly<Record<AttachmentGroup, string>> = {
  outputs: 'Outputs',
  comments: 'In comments',
  other: 'Other',
};

/**
 * The task's files by where they came from: an agent's **outputs** (a
 * round's summary links them), files **in comments**, and the **other** —
 * the description's, or attached in the section. Each group keeps the
 * server's order; an empty group is left out.
 */
export function groupAttachments<T extends Pick<Attachment, 'id' | 'comment_id'>>(
  files: readonly T[],
  outputIds: ReadonlySet<string>,
): { readonly group: AttachmentGroup; readonly files: readonly T[] }[] {
  const groupOf = (file: T): AttachmentGroup =>
    outputIds.has(file.id) ? 'outputs' : file.comment_id !== null ? 'comments' : 'other';
  return (['outputs', 'comments', 'other'] as const)
    .map((group) => ({ group, files: files.filter((file) => groupOf(file) === group) }))
    .filter((entry) => entry.files.length > 0);
}
