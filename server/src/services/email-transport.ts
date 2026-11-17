import nodemailer from 'nodemailer';

/**
 * How a message leaves Laika (D-153, LAI-1312): SMTP through `nodemailer`,
 * behind a seam every test replaces.
 *
 * ## Nothing here opens a socket in a test
 *
 * `MailTransport` is the seam and `smtpTransport()` the only implementation
 * that talks to anything. The app, the scheduler and the test-send route are
 * each handed a transport; the tests hand them a recorder, so no test needs a
 * real key and none can send real mail (KSage's rule, kept).
 *
 * ## Four outcomes, not success and failure
 *
 * The retry decision is not *did it work* but *could a retry send it twice*,
 * and a bare error collapses the two cases that differ on exactly that:
 *
 * - `sent` — the server accepted it.
 * - `refused` — the server answered and said no. A 5xx is permanent; a 4xx is
 *   "not now", and nothing was delivered, so a retry duplicates nothing.
 * - `unreachable` — nothing left this process that could have been delivered:
 *   DNS, a refused connection, a connect, greeting or TLS-upgrade timeout.
 *   Safe to retry.
 * - `indeterminate` — it may have arrived. A timeout once the session was
 *   underway, a connection dropped mid-exchange. **Never retried**: an email
 *   sent twice cannot be unsent, and one that never arrived is a row an admin
 *   can read and act on.
 */

/** What a sender needs to reach the server. `password` is the Brevo key. */
export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

/** One message, composed and addressed. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Stable across every attempt at this message, and put on the wire as a
   * header so a receiver that de-duplicates can (KSage's `idempotency-key`).
   */
  idempotencyKey: string;
}

export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'refused'; permanent: boolean; code: string; detail: string }
  | { kind: 'unreachable'; code: string; detail: string }
  | { kind: 'indeterminate'; code: string; detail: string };

export interface MailTransport {
  send: (config: SmtpConfig, message: MailMessage) => Promise<SendOutcome>;
}

/**
 * How long to wait, in milliseconds. Connect and greeting are short — a host
 * that does not answer in ten seconds is not going to — and the socket timeout
 * covers the whole exchange, so one slow message cannot outlive a scheduler
 * tick by much.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
  dnsTimeout: 10_000,
} as const;

/** Implicit TLS on 465; STARTTLS, required, everywhere else (587 is Brevo's). */
export function tlsFor(port: number): { secure: boolean; requireTLS: boolean } {
  return port === 465 ? { secure: true, requireTLS: false } : { secure: false, requireTLS: true };
}

/**
 * A transport that sends nothing: every message is refused, permanently, as
 * `ENOTRANSPORT`. What `createApp` and the scheduler use when nobody handed
 * them one — so a test that forgot its recorder fails loudly instead of
 * reaching a mail server.
 */
export const noTransport: MailTransport = {
  send: () =>
    Promise.resolve({
      kind: 'refused',
      permanent: true,
      code: 'ENOTRANSPORT',
      detail: 'This server was started without a mail transport',
    }),
};

/** The SMTP transport. One connection per message: Laika sends a few a day. */
export function smtpTransport(): MailTransport {
  return {
    send: async (config, message) => {
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        ...tlsFor(config.port),
        auth: { user: config.username, pass: config.password },
        ...SMTP_TIMEOUTS,
      });
      try {
        await transporter.sendMail({
          from: { name: config.fromName, address: config.fromAddress },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: { 'X-Laika-Idempotency-Key': message.idempotencyKey },
        });
        return { kind: 'sent' };
      } catch (err) {
        return classifySmtpError(err, config.password);
      } finally {
        transporter.close();
      }
    },
  };
}

/** The shape of a `nodemailer` error this reads. Every field is optional. */
interface SmtpErrorLike {
  code?: unknown;
  originalCode?: unknown;
  responseCode?: unknown;
  timeoutType?: unknown;
  message?: unknown;
}

/** Timeouts that end before anything could have been delivered. */
const SETUP_TIMEOUTS: ReadonlySet<string> = new Set([
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
]);

/** Socket errors that mean the connection was never made. */
const NEVER_CONNECTED: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Refused by configuration, before any message: a retry cannot change the answer. */
const CONFIG_REFUSALS: ReadonlySet<string> = new Set([
  'EAUTH',
  'ENOAUTH',
  'ECONFIG',
  'EENVELOPE',
  'EMESSAGE',
  'EREQUIRETLS',
]);

/**
 * A `nodemailer` failure → one of the four outcomes (see the module note).
 *
 * Pure, so every branch is tested with a fabricated error and no socket.
 * `nodemailer` reports **every** timeout as `ETIMEDOUT` and says which one in
 * `timeoutType`; only the three setup timeouts end before the message could
 * have been accepted. Its `command` is not used: a socket timeout during
 * `DATA` is reported with `command: 'CONN'`, so it cannot tell the phases apart.
 *
 * `secret` is removed from the detail wherever it appears — a server echoing a
 * credential back into its reply should not land it in a database row.
 */
export function classifySmtpError(err: unknown, secret = ''): SendOutcome {
  const e: SmtpErrorLike = typeof err === 'object' && err !== null ? err : {};
  const code = typeof e.code === 'string' ? e.code : 'EUNKNOWN';
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null;
  const detail = shortDetail(e.message, secret);

  if (responseCode !== null) {
    return {
      kind: 'refused',
      permanent: responseCode >= 500,
      code: String(responseCode),
      detail,
    };
  }

  if (code === 'ETIMEDOUT') {
    const type = typeof e.timeoutType === 'string' ? e.timeoutType : '';
    return SETUP_TIMEOUTS.has(type)
      ? { kind: 'unreachable', code, detail }
      : { kind: 'indeterminate', code, detail };
  }

  const original = typeof e.originalCode === 'string' ? e.originalCode : '';
  if (code === 'EDNS' || code === 'ETLS' || NEVER_CONNECTED.has(original)) {
    return { kind: 'unreachable', code: original === '' ? code : original, detail };
  }

  if (CONFIG_REFUSALS.has(code)) return { kind: 'refused', permanent: true, code, detail };

  return { kind: 'indeterminate', code, detail };
}

/** At most 200 characters of the first line, with any secret masked. */
export function shortDetail(message: unknown, secret = ''): string {
  const text = typeof message === 'string' ? message : '';
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const masked = secret.length >= 4 ? firstLine.split(secret).join('***') : firstLine;
  return masked.slice(0, 200);
}

/** `<code>: <detail>`, sized for `email_outbox.last_error`. */
export function errorLine(code: string, detail: string): string {
  return `${code}: ${detail}`.slice(0, 300);
}
