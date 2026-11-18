import { createHash } from 'node:crypto';

/**
 * Reading one inbound mail as Brevo's inbound parsing posts it (D-155,
 * LAI-1315) — pure functions, no database, so every rule a forged or looping
 * mail is judged by can be tested on its own.
 *
 * Brevo posts `{ items: [...] }`; each item is one mail with `MessageId`,
 * `InReplyTo`, `From`, `To`, `Cc`, `Recipients` (the envelope's `RCPT TO`),
 * `Subject`, `RawTextBody`, `ExtractedMarkdownMessage` (the text without its
 * signature), `Spam.Score`, `Attachments` (a `DownloadToken` each, never the
 * bytes) and `Headers` (a header seen once is a string, one seen more than
 * once an array). Everything here reads those fields **defensively**: the body
 * is whatever arrived with the right bearer token, and a field of the wrong
 * shape is treated as absent rather than trusted.
 *
 * **Nothing here decides who may do what.** It answers what the mail says —
 * who it claims to be from, which address it went to, whether the receiving
 * server vouched for the sender — and `email-inbound.ts` decides.
 */

/** One mailbox, as Brevo gives it: `{ Name, Address }`. */
export interface InboundMailbox {
  name: string | null;
  address: string;
}

/** One announced attachment. */
export interface InboundAttachment {
  filename: string;
  contentType: string;
  /** Brevo's estimate. */
  sizeBytes: number;
  downloadToken: string;
}

/** One inbound mail, normalised. */
export interface InboundMail {
  /** `Message-ID` without angle brackets, or a digest of the mail when it had none. */
  messageId: string;
  /** The ids this mail answers: `In-Reply-To` and `References`, without angle brackets. */
  replyTo: string[];
  /** The From address, lower case; null when it had none we can read. */
  from: string | null;
  /** Everyone it went to: the envelope, To and Cc, lower case, without repeats. */
  recipients: string[];
  subject: string;
  /** Brevo's extracted text, else the plain text with quoted history trimmed. */
  text: string;
  spamScore: number | null;
  attachments: InboundAttachment[];
  headers: InboundHeaders;
}

/** Header values by lower-case name, in the order the mail carried them. */
export type InboundHeaders = ReadonlyMap<string, readonly string[]>;

/** The longest text a task description or a comment takes from a mail. */
export const INBOUND_TEXT_MAX = 50_000;

/** The longest task title (`POST /tasks`' rule). */
export const INBOUND_TITLE_MAX = 300;

/** What a task is called when its mail had no subject. */
export const NO_SUBJECT = '(no subject)';

/** At most this many attachments are taken from one mail. */
export const INBOUND_ATTACHMENTS_MAX = 20;

/** The longest stored `message_id`; a longer one is stored as its digest. */
const MESSAGE_ID_MAX = 512;

/** A space address's token: twelve characters of lower-case base32. */
export const ADDRESS_TOKEN = /^[a-z2-7]{12}$/;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Line breaks and runs of space folded to one space; control characters gone. */
export function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A plain `local@domain`, lower case — or null for anything else. */
export function plainAddress(value: unknown): string | null {
  const raw = str(value)?.trim().toLowerCase() ?? '';
  if (raw.length === 0 || raw.length > 320) return null;
  return /^[^\s@<>()",;:\\]+@[a-z0-9.-]+\.[a-z0-9-]+$/.test(raw) ? raw : null;
}

/** The domain of a plain address. */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

function mailbox(value: unknown): InboundMailbox | null {
  const box = record(value);
  if (box === null) return null;
  const address = plainAddress(box.Address);
  if (address === null) return null;
  return { name: str(box.Name), address };
}

function mailboxes(value: unknown): InboundMailbox[] {
  if (!Array.isArray(value)) return [];
  return value.map(mailbox).filter((m): m is InboundMailbox => m !== null);
}

/**
 * Brevo's `Headers` as a map of lower-case name to values. Brevo sends an
 * object (a header seen more than once is an array); a list of `Name: value`
 * lines is read too, so a change of shape degrades to fewer headers rather
 * than to a crash.
 */
export function readHeaders(value: unknown): InboundHeaders {
  const out = new Map<string, string[]>();
  const add = (name: string, raw: unknown): void => {
    const key = name.trim().toLowerCase();
    if (key === '') return;
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is string => typeof v === 'string',
    );
    if (values.length === 0) return;
    out.set(key, [...(out.get(key) ?? []), ...values.map(oneLine)]);
  };
  const object = record(value);
  if (object !== null) {
    for (const [name, raw] of Object.entries(object)) add(name, raw);
  } else if (Array.isArray(value)) {
    for (const line of value) {
      if (typeof line !== 'string') continue;
      const colon = line.indexOf(':');
      if (colon > 0) add(line.slice(0, colon), line.slice(colon + 1));
    }
  }
  return out;
}

/** Every `<id>` in a header such as `References`, without the brackets. */
export function messageIdsIn(value: string): string[] {
  const ids = [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1] ?? '');
  if (ids.length > 0) return ids.filter((id) => id !== '');
  // A bare id, as Brevo's `InReplyTo` may be.
  const bare = value.trim();
  return bare !== '' && !/\s/.test(bare) ? [bare] : [];
}

/** A `Message-ID` as stored: no brackets, and a digest when it is too long to index. */
export function storedMessageId(value: string): string {
  const id = value.trim().replace(/^<|>$/g, '');
  if (id.length <= MESSAGE_ID_MAX) return id;
  return `sha256:${createHash('sha256').update(id).digest('hex')}`;
}

/**
 * A mail's quoted history trimmed off its plain text: from the first
 * `On … wrote:` line, `-----Original Message-----` or `From:` block, and every
 * line quoted with `>`. Used only when Brevo's own extraction is absent.
 */
export function trimQuoted(text: string): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bare = line.trim();
    if (/^On\b.{0,200}\bwrote:$/i.test(bare)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(bare)) break;
    if (/^_{5,}$/.test(bare)) break;
    if (bare.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/** The text of a string capped at `max` code points. */
export function capText(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : points.slice(0, max).join('');
}

/**
 * One Brevo item as an {@link InboundMail}, or null when it is not an object.
 * A mail with no `Message-ID` is given a digest of what it says, so a
 * redelivery of it is still recognised as the same mail.
 */
export function readInboundMail(item: unknown): InboundMail | null {
  const raw = record(item);
  if (raw === null) return null;

  const headers = readHeaders(raw.Headers);
  const subject = capText(oneLine(str(raw.Subject) ?? ''), INBOUND_TITLE_MAX * 4);
  const extracted = str(raw.ExtractedMarkdownMessage)?.trim() ?? '';
  const plain = str(raw.RawTextBody) ?? '';
  const text = capText(extracted !== '' ? extracted : trimQuoted(plain), INBOUND_TEXT_MAX);
  const from = mailbox(raw.From)?.address ?? null;

  const declared = str(raw.MessageId)?.trim() ?? '';
  const messageId =
    declared !== ''
      ? storedMessageId(declared)
      : `digest:${createHash('sha256')
          .update(JSON.stringify([from, subject, str(raw.SentAtDate), plain, extracted]))
          .digest('hex')}`;

  const replyTo = [
    ...messageIdsIn(str(raw.InReplyTo) ?? ''),
    ...(headers.get('in-reply-to') ?? []).flatMap(messageIdsIn),
    ...(headers.get('references') ?? []).flatMap(messageIdsIn),
  ].map(storedMessageId);

  const recipients = [...mailboxes(raw.Recipients), ...mailboxes(raw.To), ...mailboxes(raw.Cc)].map(
    (m) => m.address,
  );

  const spam = record(raw.Spam)?.Score;

  const attachments = (Array.isArray(raw.Attachments) ? raw.Attachments : [])
    .map((a): InboundAttachment | null => {
      const one = record(a);
      const token = str(one?.DownloadToken)?.trim() ?? '';
      if (one === null || token === '' || token.length > 2048) return null;
      const name = capText(oneLine(str(one.Name) ?? ''), 255);
      const type = oneLine(str(one.ContentType) ?? '').toLowerCase();
      const size = typeof one.ContentLength === 'number' ? one.ContentLength : 0;
      return {
        filename: name === '' ? 'attachment' : name,
        contentType:
          /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) && type.length <= 127
            ? type
            : 'application/octet-stream',
        sizeBytes: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
        downloadToken: token,
      };
    })
    .filter((a): a is InboundAttachment => a !== null)
    .slice(0, INBOUND_ATTACHMENTS_MAX);

  return {
    messageId,
    replyTo: [...new Set(replyTo)],
    from,
    recipients: [...new Set(recipients)],
    subject,
    text,
    spamScore: typeof spam === 'number' && Number.isFinite(spam) ? spam : null,
    attachments,
    headers,
  };
}

/** The title a new task takes from its mail's subject. */
export function taskTitle(subject: string): string {
  const title = capText(oneLine(subject), INBOUND_TITLE_MAX);
  return title === '' ? NO_SUBJECT : title;
}

/**
 * The space address's token in a recipient at `domain` —
 * `rmb-ab3de7fgh2jk@tasks.kvelld.com` gives `ab3de7fgh2jk` — or null. Only the
 * token is read: the part before it is the space's slug when the address was
 * made, there for a person and nothing else.
 */
export function addressToken(recipient: string, domain: string): string | null {
  if (domainOf(recipient) !== domain.toLowerCase()) return null;
  const local = recipient.slice(0, recipient.lastIndexOf('@'));
  const token = /-([a-z2-7]{12})$/.exec(local)?.[1];
  return token ?? null;
}

/** The task key a subject names in brackets — `Re: [RMB-42] Login` gives `RMB-42`. */
export function subjectKey(subject: string): string | null {
  return /\[([A-Za-z][A-Za-z0-9]*-\d+)\]/.exec(subject)?.[1] ?? null;
}

/**
 * Whether a mail was sent by a machine answering another mail: an
 * auto-reply, a bounce, a vacation notice, list mail. Answering one of these
 * with a task is how a loop starts, so they are dropped (`auto_reply`).
 */
export function isAutomatic(headers: InboundHeaders): boolean {
  const first = (name: string): string =>
    (headers.get(name)?.[0] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const submitted = first('auto-submitted');
  if (submitted !== '' && submitted !== 'no') return true;
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(first('precedence'))) return true;
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) return true;
  // A bounce has an empty envelope sender.
  return headers.get('return-path')?.some((v) => v.trim() === '<>') ?? false;
}

/** One method's result in an `Authentication-Results` header. */
export interface AuthCheck {
  method: string;
  result: string;
  /** `header.from`, `header.d`, `smtp.mailfrom` … lower case. */
  props: ReadonlyMap<string, string>;
}

/** One `Authentication-Results` header: who wrote it, and what it found. */
export interface AuthHeader {
  authservId: string;
  results: AuthCheck[];
}

/** RFC 8601 comments removed: `(2048-bit key)` and the like, nested or not. */
function withoutComments(value: string): string {
  let out = value;
  for (let i = 0; i < 8 && /\([^()]*\)/.test(out); i += 1) out = out.replace(/\([^()]*\)/g, ' ');
  return out;
}

/** One `Authentication-Results` value, or null when it names no server. */
export function parseAuthenticationResults(value: string): AuthHeader | null {
  const parts = withoutComments(value).split(';');
  const authservId = (parts[0] ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (authservId === '') return null;
  const results: AuthCheck[] = [];
  for (const part of parts.slice(1)) {
    const tokens = part
      .trim()
      .split(/\s+/)
      .filter((t) => t !== '');
    const head = /^([a-z0-9_-]+)=([a-z0-9_-]+)$/i.exec(tokens[0] ?? '');
    if (head === null) continue;
    const props = new Map<string, string>();
    for (const token of tokens.slice(1)) {
      const prop = /^([a-z0-9_-]+\.[a-z0-9_-]+)=(.+)$/i.exec(token);
      if (prop?.[1] !== undefined && prop[2] !== undefined) {
        props.set(prop[1].toLowerCase(), prop[2].replace(/^"|"$/g, '').toLowerCase());
      }
    }
    results.push({
      method: (head[1] ?? '').toLowerCase(),
      result: (head[2] ?? '').toLowerCase(),
      props,
    });
  }
  return { authservId, results };
}

/**
 * Relaxed alignment (DMARC, RFC 7489 §3.1): the domain a check passed for is
 * the From domain, or one is a subdomain of the other. A single label (`com`)
 * aligns with nothing.
 */
export function aligned(checked: string, from: string): boolean {
  const a = checked.toLowerCase().replace(/\.$/, '');
  const b = from.toLowerCase().replace(/\.$/, '');
  if (!a.includes('.') || !b.includes('.')) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** The domain an SPF or DKIM property names: `x@kvelld.com` and `@kvelld.com` give `kvelld.com`. */
function propDomain(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return value.includes('@') ? domainOf(value) : value;
}

/** What the receiving server vouched for, and the line `email_inbound.auth` keeps. */
export interface AuthVerdict {
  /** An aligned DMARC, DKIM or SPF pass from a header Laika believes. */
  pass: boolean;
  /** `mx.example dmarc=pass dkim=pass spf=pass`, from the headers believed; null when none. */
  summary: string | null;
}

/**
 * Whether the receiving server vouched for the From address (D-155).
 *
 * **Which headers are believed.** A sender can write any
 * `Authentication-Results` header into a mail; only the one the receiving
 * server added is evidence. With `authservId` set, only headers that server
 * wrote count. Without it, only the **topmost** counts — a receiving server
 * adds its header above everything already in the mail, so a forged one
 * sits below it.
 *
 * **What passes.** `dmarc=pass` for the From domain; else `dkim=pass` for a
 * signing domain aligned with it; else `spf=pass` for an aligned envelope
 * sender. Any of the three proves the From domain sent it.
 */
export function authVerdict(
  headers: InboundHeaders,
  fromAddress: string,
  authservId: string | null,
): AuthVerdict {
  const parsed = (headers.get('authentication-results') ?? [])
    .map(parseAuthenticationResults)
    .filter((h): h is AuthHeader => h !== null);
  const believed =
    authservId === null
      ? parsed.slice(0, 1)
      : parsed.filter((h) => h.authservId === authservId.toLowerCase());

  const fromDomain = domainOf(fromAddress);
  const pass = believed.some((h) =>
    h.results.some((r) => {
      if (r.result !== 'pass') return false;
      if (r.method === 'dmarc') return r.props.get('header.from') === fromDomain;
      if (r.method === 'dkim') {
        const d = propDomain(r.props.get('header.d') ?? r.props.get('header.i'));
        return d !== null && aligned(d, fromDomain);
      }
      if (r.method === 'spf') {
        const mailFrom = propDomain(r.props.get('smtp.mailfrom') ?? r.props.get('smtp.helo'));
        return mailFrom !== null && aligned(mailFrom, fromDomain);
      }
      return false;
    }),
  );

  const words = believed.flatMap((h) => [
    h.authservId,
    ...h.results
      .filter((r) => ['dmarc', 'dkim', 'spf'].includes(r.method))
      .map((r) => `${r.method}=${r.result}`),
  ]);
  const summary = words
    .join(' ')
    .replace(/[^a-z0-9.=_ -]/g, '')
    .slice(0, 300);
  return { pass, summary: summary === '' ? null : summary };
}

/** The authserv-ids a mail carried, topmost first — what the card shows to choose from. */
export function authservIds(headers: InboundHeaders): string[] {
  return (headers.get('authentication-results') ?? [])
    .map(parseAuthenticationResults)
    .filter((h): h is AuthHeader => h !== null)
    .map((h) => h.authservId);
}
