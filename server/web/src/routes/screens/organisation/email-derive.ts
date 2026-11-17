import type {
  EmailDispatch,
  EmailLastTest,
  EmailSettings,
  EmailSettingsInput,
  EmailTestResult,
} from '../../../api/email.ts';

/**
 * What the Email card on Organisation › Integrations shows, worked out away
 * from React (D-153, LAI-1312) — the `hr-derive.ts` shape.
 *
 * The card's job is the owner's three steps: paste the key, *Send test
 * email*, flip *Email on*. Everything here is in service of saying where in
 * those three steps the organisation is.
 */

/** The form as typed: strings, so a half-typed port is still what was typed. */
export interface EmailForm {
  readonly host: string;
  readonly port: string;
  readonly username: string;
  /** The key. Empty means "keep the stored one" once one is stored. */
  readonly password: string;
  readonly from_address: string;
  readonly from_name: string;
}

export type EmailField = keyof EmailForm;

/** The saved settings, or the defaults for anything not saved yet. */
export function emailFormFrom(settings: EmailSettings): EmailForm {
  const d = settings.defaults;
  return {
    host: settings.host ?? d.host,
    port: String(settings.port ?? d.port),
    username: settings.username ?? '',
    password: '',
    from_address: settings.from_address ?? d.from_address,
    from_name: settings.from_name ?? d.from_name,
  };
}

/** The saved settings a form is checked against. */
export type EmailSaved = Pick<
  EmailSettings,
  'host' | 'port' | 'username' | 'key_last4' | 'configured'
>;

/** Whether a key is stored, which an empty key field then keeps. */
export function keyIsStored(saved: EmailSaved): boolean {
  return saved.key_last4 !== null || saved.configured;
}

/**
 * Whether the form points the stored key somewhere new: a different host, port
 * or login. The server refuses that without the key (`key_required`), so the
 * stored key is only ever sent where it was given for.
 */
export function movesTheKey(form: EmailForm, saved: EmailSaved): boolean {
  return (
    form.host.trim() !== (saved.host ?? '') ||
    form.port.trim() !== String(saved.port ?? '') ||
    form.username.trim() !== (saved.username ?? '')
  );
}

/** What would be refused, by field — the server's rules, said before a round trip. */
export function emailFormErrors(
  form: EmailForm,
  saved: EmailSaved,
): Partial<Record<EmailField, string>> {
  const errors: Partial<Record<EmailField, string>> = {};
  const keyStored = keyIsStored(saved);
  if (!/^[A-Za-z0-9.:-]+$/.test(form.host.trim()) || form.host.trim().startsWith('-')) {
    errors.host = 'A host name, such as smtp-relay.brevo.com';
  }
  const port = Number(form.port.trim());
  if (!/^\d+$/.test(form.port.trim()) || port < 1 || port > 65535) {
    errors.port = 'A port from 1 to 65535 — Brevo uses 587';
  }
  if (form.username.trim() === '') errors.username = 'The SMTP login Brevo shows';
  if (form.password.trim() === '') {
    if (!keyStored) errors.password = 'Paste the SMTP key';
    else if (movesTheKey(form, saved)) {
      errors.password = 'Paste the key again to change the host, port or login';
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.from_address.trim())) {
    errors.from_address = 'An address the relay will send as';
  }
  if (form.from_name.trim() === '') errors.from_name = 'The name people see the mail from';
  return errors;
}

/** The body `PUT /org/email` takes. An empty key is left out, so the stored one stays. */
export function emailFormInput(form: EmailForm): EmailSettingsInput {
  const base = {
    host: form.host.trim(),
    port: Number(form.port.trim()),
    username: form.username.trim(),
    from_address: form.from_address.trim(),
    from_name: form.from_name.trim(),
  };
  const key = form.password.trim();
  return key === '' ? base : { ...base, password: key };
}

/** The card's badge: on, ready to turn on, or not set up. */
export function emailBadge(settings: Pick<EmailSettings, 'enabled' | 'configured'>): {
  tone: 'on' | 'off';
  label: string;
} {
  if (settings.enabled) return { tone: 'on', label: 'on' };
  return { tone: 'off', label: settings.configured ? 'off · ready' : 'not set up' };
}

/** What a failure code means, in words; the code itself is shown beside it. */
export function failureMeaning(code: string | null): string {
  if (code === null) return 'The server did not say why.';
  if (code === '535' || code === 'EAUTH') return 'The server refused the login or the key.';
  if (code === '550' || code === '553' || code === '554') {
    return 'The server refused the sender or the address — check the From address is a verified sender.';
  }
  if (code === 'ETIMEDOUT') return 'The server did not answer in time.';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'Laika could not reach the server — check the host and port.';
  }
  if (code === 'ETLS') return 'The secure connection could not be set up — check the port.';
  return 'The message was not sent.';
}

/** The line under *Send test email*, from the answer or the last one stored. */
export function testLine(result: EmailTestResult | EmailLastTest): string {
  if (result.ok) return `Sent to ${result.to ?? 'you'}. Check that inbox — and its spam folder.`;
  const code = result.code === null ? '' : ` (${result.code})`;
  return `Not sent${code}. ${failureMeaning(result.code)}`;
}

/** The step the owner is on, said plainly. */
export function nextStep(settings: EmailSettings): string {
  if (!settings.configured)
    return 'Paste the SMTP key and save. Nothing is sent until Email is on.';
  if (settings.enabled) return 'Email is on: invites and reset links are also mailed.';
  if (settings.last_test?.ok !== true) {
    return 'Send a test email, then turn Email on. Nothing is sent until you do.';
  }
  return 'The test went through. Turn Email on when you are ready; nothing is sent until then.';
}

/**
 * What an invite or a reset link says about its email, or null when there is
 * nothing to say — the switch off is the normal state, and a link invite has
 * nobody to mail, so neither earns a line.
 */
export function dispatchLine(email: EmailDispatch, address: string | null): string | null {
  if (email.queued) return address === null ? 'Also emailed.' : `Also emailed to ${address}.`;
  switch (email.reason) {
    case 'email_not_configured':
      return 'Not emailed: email is on, but SMTP is not set up.';
    case 'no_public_url':
      return 'Not emailed: the server has no public address (LAIKA_PUBLIC_URL) to build the link from.';
    default:
      return null;
  }
}

/** Nothing queued and nothing to say: what an answer without `email` reads as. */
const NOT_SENT: EmailDispatch = { queued: false, reason: null };

/**
 * An invite's or a reset link's `email`, read so that an answer from a server
 * before D-153 — a deploy in flight, the web app and the API a release apart —
 * reads as not sent rather than breaking the dialog.
 */
export function dispatchOf(answer: { readonly email?: EmailDispatch }): EmailDispatch {
  return answer.email ?? NOT_SENT;
}

/** Whether the organisation's email is on, for the same reason as `dispatchOf`. */
export function emailOn(org: { readonly email?: { readonly enabled: boolean } }): boolean {
  return org.email?.enabled === true;
}
