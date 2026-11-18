import type {
  EmailInboundReason,
  EmailInboundRow,
  EmailInboundSettings,
  EmailInboundSettingsInput,
} from '../../../api/email-inbound.ts';

/**
 * What the *Email to tasks* card on Organisation › Integrations shows, worked
 * out away from React (D-155, LAI-1315) — the `email-derive.ts` shape.
 *
 * The card's job is the owner's three steps: save the receiving domain, make
 * the webhook token and paste it into Brevo, flip *Email to tasks on*. The
 * switch cannot be turned on before the first two — the server refuses it
 * with `inbound_not_configured` too.
 */

/** The form as typed. The key is empty unless one is being sent. */
export interface InboundForm {
  readonly domain: string;
  readonly require_authenticated: boolean;
  readonly authserv_id: string;
  /** Empty keeps the stored key. */
  readonly api_key: string;
}

export type InboundField = 'domain' | 'authserv_id' | 'api_key';

/** The saved settings, as the form starts from them. */
export function inboundFormFrom(settings: EmailInboundSettings): InboundForm {
  return {
    domain: settings.domain ?? '',
    require_authenticated: settings.require_authenticated,
    authserv_id: settings.authserv_id ?? '',
    api_key: '',
  };
}

/** The server's host-name rule (`HOST_NAME` in `services/email-inbound.ts`). */
const HOST_NAME =
  /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** The domain as the server stores it: trimmed, lower case, no trailing dot. */
function domainOf(typed: string): string {
  return typed.trim().toLowerCase().replace(/\.$/, '');
}

/** What would be refused, by field — the server's rules, said before a round trip. */
export function inboundFormErrors(
  form: InboundForm,
  exampleDomain: string,
): Partial<Record<InboundField, string>> {
  const errors: Partial<Record<InboundField, string>> = {};
  const domain = domainOf(form.domain);
  if (domain !== '' && !HOST_NAME.test(domain)) {
    errors.domain = `A host name, such as ${exampleDomain}`;
  }
  const authserv = form.authserv_id.trim().toLowerCase();
  if (authserv !== '' && !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(authserv)) {
    errors.authserv_id = 'A server name, such as mx.example.com';
  }
  const key = form.api_key.trim();
  if (key !== '' && !/^\S{8,512}$/.test(key)) {
    errors.api_key = 'A Brevo API key: at least 8 characters, with no spaces';
  }
  return errors;
}

/**
 * The body `PUT /org/email-inbound` takes: **only what changed**, so a save
 * never touches a field the owner did not. An emptied domain or server is
 * `null` (cleared); an empty key is left out, so the stored one stays.
 */
export function inboundFormInput(
  form: InboundForm,
  saved: EmailInboundSettings,
): EmailInboundSettingsInput {
  const domain = domainOf(form.domain);
  const authserv = form.authserv_id.trim().toLowerCase();
  const key = form.api_key.trim();
  return {
    ...(domain === (saved.domain ?? '') ? {} : { domain: domain === '' ? null : domain }),
    ...(form.require_authenticated === saved.require_authenticated
      ? {}
      : { require_authenticated: form.require_authenticated }),
    ...(authserv === (saved.authserv_id ?? '')
      ? {}
      : { authserv_id: authserv === '' ? null : authserv }),
    ...(key === '' ? {} : { api_key: key }),
  };
}

/** Whether Save has anything to send. */
export function inboundDirty(form: InboundForm, saved: EmailInboundSettings): boolean {
  return Object.keys(inboundFormInput(form, saved)).length > 0;
}

/**
 * Why the switch cannot be turned on yet, or null when it can. Only ever
 * about turning it **on**: one already on can always be turned off.
 */
export function switchBlocker(
  settings: Pick<
    EmailInboundSettings,
    'domain' | 'token_last4' | 'can_change' | 'require_authenticated' | 'authserv_id'
  >,
): string | null {
  // Turning it on accepts D-155's residual risk: an owner's call (M2).
  if (!settings.can_change) return 'Only an owner can turn this on.';
  const domain = settings.domain !== null;
  const token = settings.token_last4 !== null;
  if (!domain && !token) return 'Save a receiving domain and make a webhook token first.';
  if (!domain) return 'Save a receiving domain first.';
  if (!token) return 'Make a webhook token first.';
  // With no server named nothing is believed, so every mail would be dropped (M1).
  if (settings.require_authenticated && settings.authserv_id === null) {
    return 'Name the receiving server first, from a real delivery.';
  }
  return null;
}

/** The card's badge: on, ready to turn on, or not set up. */
export function inboundBadge(
  settings: Pick<
    EmailInboundSettings,
    'enabled' | 'domain' | 'token_last4' | 'can_change' | 'require_authenticated' | 'authserv_id'
  >,
): {
  readonly tone: 'on' | 'off';
  readonly label: string;
} {
  if (settings.enabled) return { tone: 'on', label: 'on' };
  return { tone: 'off', label: switchBlocker(settings) === null ? 'off · ready' : 'not set up' };
}

/** The line beside the switch: what to do next, or what being on means. */
export function switchLine(
  settings: Pick<
    EmailInboundSettings,
    'enabled' | 'domain' | 'token_last4' | 'can_change' | 'require_authenticated' | 'authserv_id'
  >,
): string {
  if (settings.enabled) {
    return 'On: mail to a space’s address becomes a task, and a reply becomes a comment.';
  }
  return (
    switchBlocker(settings) ??
    'Ready. Paste the token into Brevo, then turn it on. Until then every mail is recorded and dropped.'
  );
}

/** Why a mail was dropped, in plain words. */
export const REASON_WORDS: Readonly<Record<EmailInboundReason, string>> = {
  switch_off: 'Email to tasks was off',
  unknown_address: 'Not a space’s address',
  own_sender: 'Sent by this board',
  auto_reply: 'An auto-reply, bounce or list mail',
  spam: 'Marked as spam',
  unauthenticated: 'The sender could not be authenticated',
  unknown_sender: 'No one here has that address',
  not_allowed: 'The sender may not write in that space',
  empty: 'Nothing to write',
  refused: 'The space refused it',
  failed_repeatedly: 'It failed three times, and was not tried again',
};

/** What came of one mail: `Task created`, `Comment added`, or why it was dropped. */
export function outcomeWords(row: Pick<EmailInboundRow, 'outcome' | 'reason'>): string {
  if (row.outcome === 'task_created') return 'Task created';
  if (row.outcome === 'comment_added') return 'Comment added';
  // A fault, not a decision: Brevo delivers it again, three times at most.
  if (row.outcome === 'failed') return 'Failed — Brevo will deliver it again';
  return row.reason === null ? 'Dropped' : `Dropped: ${REASON_WORDS[row.reason]}`;
}

/** The tone a mail's outcome is drawn in. */
export function outcomeTone(row: Pick<EmailInboundRow, 'outcome'>): 'on' | 'off' {
  return row.outcome === 'dropped' || row.outcome === 'failed' ? 'off' : 'on';
}

/** Who sent it: the person it was matched to, else the From address as given. */
export function senderLabel(row: Pick<EmailInboundRow, 'sender' | 'from_address'>): string {
  return row.sender?.name ?? row.from_address ?? 'No sender';
}

/** `2 attachments`, or null for none. */
export function attachmentsLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 attachment' : `${String(count)} attachments`;
}
