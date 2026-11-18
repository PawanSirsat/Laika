import { request } from './client.ts';

/**
 * The organisation's outbound email (§6.4, D-153, LAI-1312): the Email card on
 * Organisation › Integrations, for an owner or admin (`org.settings.edit`).
 *
 * **The key is write-only.** It goes up in `saveEmailSettings` and never comes
 * back: the card shows `key_last4`, which the server stored when the key was
 * set, and nothing on the server decrypts the key to build an answer.
 *
 * **The switch ships off.** Turning email on is `updateOrg({ email_enabled })`
 * — the same `PATCH /org` every org setting uses — and the server refuses it
 * with `email_not_configured` until a key is saved.
 */

/** Why a message was not sent (§4.93). */
export type EmailSuppressedReason =
  'email_off' | 'email_not_configured' | 'no_address' | 'no_public_url' | 'too_old';

/** What the card is pre-filled with before anything is saved (D-153). */
export interface EmailDefaults {
  readonly host: string;
  readonly port: number;
  readonly from_address: string;
  readonly from_name: string;
}

/** The last *Send test email*. */
export interface EmailLastTest {
  readonly at: number;
  readonly ok: boolean;
  readonly to: string | null;
  /** The SMTP reply code (`535`) or the transport's (`ETIMEDOUT`); null when sent. */
  readonly code: string | null;
}

/** The outbox over the last seven days, by state. */
export interface EmailCounts {
  readonly queued: number;
  readonly sending: number;
  readonly sent: number;
  readonly failed: number;
  readonly unconfirmed: number;
  readonly suppressed: number;
}

export interface EmailSettings {
  /** The *Email on* switch. */
  readonly enabled: boolean;
  /** Settings saved and a key stored — what the switch needs. */
  readonly configured: boolean;
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly from_address: string | null;
  readonly from_name: string | null;
  /** The key's last four characters. Never the key. */
  readonly key_last4: string | null;
  readonly defaults: EmailDefaults;
  /** `LAIKA_PUBLIC_URL`; null means links cannot be mailed (`no_public_url`). */
  readonly public_url: string | null;
  readonly last_test: EmailLastTest | null;
  readonly last_7_days: EmailCounts;
}

export interface EmailSettingsInput {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  /** Absent keeps the stored key. */
  readonly password?: string;
  readonly from_address: string;
  readonly from_name: string;
}

/** `POST /org/email/test`: `200` either way — the answer is the result. */
export interface EmailTestResult {
  readonly ok: boolean;
  readonly to: string;
  readonly code: string | null;
  readonly message: string | null;
  readonly at: number;
}

/** What an invite or a reset link says about its email (§6.4). */
export interface EmailDispatch {
  /** True when a message is queued, being sent or sent. */
  readonly queued: boolean;
  readonly reason: EmailSuppressedReason | null;
}

export function getEmailSettings(signal?: AbortSignal): Promise<EmailSettings> {
  return request<EmailSettings>('/org/email', signal === undefined ? {} : { signal });
}

export function saveEmailSettings(input: EmailSettingsInput): Promise<EmailSettings> {
  return request<EmailSettings>('/org/email', { method: 'PUT', body: input });
}

export function clearEmailSettings(): Promise<void> {
  return request<void>('/org/email', { method: 'DELETE' });
}

export function sendTestEmail(): Promise<EmailTestResult> {
  return request<EmailTestResult>('/org/email/test', { method: 'POST' });
}

/** A person's own email switches (§4.97, LAI-1313): both on until they change them. */
export interface EmailPrefs {
  /** Mail at once when assigned a task or @mentioned. */
  readonly instant: boolean;
  /** One mail a morning with everything else on the tasks they watch. */
  readonly digest: boolean;
}

export function getEmailPrefs(signal?: AbortSignal): Promise<EmailPrefs> {
  return request<EmailPrefs>('/me/email-prefs', signal === undefined ? {} : { signal });
}

/** Either or both; the server keeps what is not given. */
export function saveEmailPrefs(patch: Partial<EmailPrefs>): Promise<EmailPrefs> {
  return request<EmailPrefs>('/me/email-prefs', { method: 'PUT', body: patch });
}
