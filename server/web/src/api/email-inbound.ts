import { request } from './client.ts';
import { ApiError } from './errors.ts';
import { fieldErrors } from './setup.ts';

/**
 * Email to tasks (D-155, LAI-1315): the organisation's *Email to tasks* card
 * on Organisation › Integrations, for a holder of `org.email.configure`, and
 * each space's own address on its settings. Mirrors
 * `routes/email-inbound.ts`; the views are declared in
 * `services/email-inbound.ts`, and each one and every named shape inside it
 * is paired in `test/api/view-type-drift.test.ts`.
 *
 * **Two secrets, both write-only.** The Brevo API key goes up in
 * `saveEmailInboundSettings` and never comes back; the webhook token comes
 * back once, in `makeEmailInboundToken`'s answer, and never again. Every
 * other answer names their last four characters.
 *
 * **No mail's subject or text is ever in these views**, so nothing here can
 * draw one.
 */

export type EmailInboundOutcome = 'task_created' | 'comment_added' | 'dropped';

/** Why a mail was dropped (D-155). It is never answered, so this card is the one place it is said. */
export type EmailInboundReason =
  | 'switch_off'
  | 'unknown_address'
  | 'own_sender'
  | 'auto_reply'
  | 'spam'
  | 'unauthenticated'
  | 'unknown_sender'
  | 'not_allowed'
  | 'empty'
  | 'refused';

/** Who someone is, on the card. */
export interface InboundPerson {
  readonly id: string;
  readonly name: string;
}

/** The space a mail went to, on the card. */
export interface InboundProject {
  readonly slug: string;
  readonly name: string;
}

/** One inbound mail as the card lists it — never its subject or text. */
export interface EmailInboundRow {
  readonly id: string;
  readonly received_at: number;
  readonly outcome: EmailInboundOutcome;
  readonly reason: EmailInboundReason | null;
  /** The From address, as the mail gave it. */
  readonly from_address: string | null;
  /** The person it was matched to. */
  readonly sender: InboundPerson | null;
  readonly project: InboundProject | null;
  /** The task it made or commented on, by key. */
  readonly task_key: string | null;
  readonly comment_id: string | null;
  /** The believed server and its verdicts, e.g. `mx.example dmarc=pass`. */
  readonly auth: string | null;
  /** Every server the mail's `Authentication-Results` named, topmost first. */
  readonly authserv_ids: readonly string[];
  readonly attachment_count: number;
}

/** `GET /org/email-inbound`. */
export interface EmailInboundSettings {
  /** The switch. Off, every mail is recorded and dropped `switch_off`. */
  readonly enabled: boolean;
  /** The receiving subdomain, e.g. `tasks.kvelld.com`. */
  readonly domain: string | null;
  /** Drop a mail without a DMARC, DKIM or SPF pass for its From domain. */
  readonly require_authenticated: boolean;
  /** The receiving server whose `Authentication-Results` count; null reads the topmost. */
  readonly authserv_id: string | null;
  /** The webhook token's last four characters; null until one is made. */
  readonly token_last4: string | null;
  /** The Brevo API key's last four characters. Never the key. */
  readonly api_key_last4: string | null;
  /** Where Brevo posts; null without `LAIKA_PUBLIC_URL`. */
  readonly webhook_url: string | null;
  /** The board's own From address: a mail from it is dropped. */
  readonly own_address: string;
  /** Whether this server can store an API key (it has `LAIKA_SECRET`). */
  readonly can_store_secrets: boolean;
  /** Owners only (LAI-1315 review, M2): turning it on, and authentication off. */
  readonly can_switch_on: boolean;
  readonly can_allow_unauthenticated: boolean;
  /** The receiving servers recent mail named, newest first: what to name from. */
  readonly authserv_seen: readonly string[];
  readonly example_domain: string;
  readonly updated_at: number | null;
  readonly updated_by: InboundPerson | null;
  /** The newest inbound mails, newest first, in spaces the caller can open. */
  readonly recent: readonly EmailInboundRow[];
}

/** `PUT /org/email-inbound`: every field optional; one absent is left alone. */
export interface EmailInboundSettingsInput {
  readonly enabled?: boolean;
  /** `null` clears it — and the switch with it. */
  readonly domain?: string | null;
  readonly require_authenticated?: boolean;
  readonly authserv_id?: string | null;
  /** Write-only. Absent keeps the stored key; `null` removes it. */
  readonly api_key?: string | null;
}

/** `POST /org/email-inbound/token`: the new token, said once. */
export interface EmailInboundToken {
  readonly token: string;
  readonly settings: EmailInboundSettings;
}

/** `GET /projects/:slug/email-address`. */
export interface ProjectEmailAddress {
  /** `<slug>-<token>@<domain>`; null until the organisation has a receiving domain. */
  readonly address: string | null;
  /** The organisation's switch: off, mail to the address is recorded and dropped. */
  readonly enabled: boolean;
  /** Whether the reader may replace it (`project.settings.edit`). */
  readonly can_rotate: boolean;
}

export function getEmailInboundSettings(signal?: AbortSignal): Promise<EmailInboundSettings> {
  return request<EmailInboundSettings>(
    '/org/email-inbound',
    signal === undefined ? {} : { signal },
  );
}

export function saveEmailInboundSettings(
  input: EmailInboundSettingsInput,
): Promise<EmailInboundSettings> {
  return request<EmailInboundSettings>('/org/email-inbound', { method: 'PUT', body: input });
}

/** A new webhook token, replacing any before it. It is in this answer and never again. */
export function makeEmailInboundToken(): Promise<EmailInboundToken> {
  return request<EmailInboundToken>('/org/email-inbound/token', { method: 'POST' });
}

export function getProjectEmailAddress(
  slug: string,
  signal?: AbortSignal,
): Promise<ProjectEmailAddress> {
  return request<ProjectEmailAddress>(
    `/projects/${encodeURIComponent(slug)}/email-address`,
    signal === undefined ? {} : { signal },
  );
}

/** A new address for the space; the old one stops at once. */
export function rotateProjectEmailAddress(slug: string): Promise<ProjectEmailAddress> {
  return request<ProjectEmailAddress>(
    `/projects/${encodeURIComponent(slug)}/email-address/rotate`,
    { method: 'POST' },
  );
}

/**
 * A refused save, by field: the service's own refusal names one in
 * `details.field`, and the request's validation lists `issues`.
 */
export function inboundFieldErrors(cause: unknown): Readonly<Record<string, string>> {
  if (!(cause instanceof ApiError) || cause.code !== 'unprocessable') return {};
  const details = cause.details;
  const field =
    typeof details === 'object' && details !== null
      ? (details as { field?: unknown }).field
      : undefined;
  return typeof field === 'string' ? { [field]: cause.message } : fieldErrors(cause);
}

/** Each refusal these endpoints name in `details.reason`, in words an owner can act on. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  inbound_not_configured:
    'Save a receiving domain and make a webhook token before turning Email to tasks on.',
};

/** The words for a refused call: its reason's, else the server's message. */
export function inboundRefusal(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The request did not reach Laika.';
  const details = cause.details;
  const reason =
    typeof details === 'object' && details !== null
      ? (details as { reason?: unknown }).reason
      : undefined;
  if (typeof reason === 'string') {
    const words = REFUSAL_WORDS[reason];
    if (words !== undefined) return words;
  }
  return cause.message;
}

/** Whether a read was refused because the reader may not see it — then nothing is drawn. */
export function isNotForYou(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 403 || cause.status === 404);
}
