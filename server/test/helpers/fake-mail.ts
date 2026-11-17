import {
  type MailMessage,
  type MailTransport,
  type SendOutcome,
  type SmtpConfig,
} from '../../src/services/email-transport.ts';

/**
 * A mail transport that sends nothing and remembers everything (D-153,
 * LAI-1312) — the `fake-clan.ts` shape for email. Every test that sends hands
 * the app or the job one of these, so **no test needs a real key and none can
 * reach a mail server**.
 *
 * Outcomes are scripted: each send takes the next one from `script`, and once
 * that is empty every send is `sent`.
 */
export interface FakeMail {
  transport: MailTransport;
  /** Every send, in order, with the config it was given. */
  sent: { config: SmtpConfig; message: MailMessage }[];
  /** What the next sends answer, first to last. */
  script: SendOutcome[];
}

export function fakeMail(script: SendOutcome[] = []): FakeMail {
  const fake: FakeMail = {
    sent: [],
    script: [...script],
    transport: {
      send: (config, message) => {
        fake.sent.push({ config, message });
        return Promise.resolve(fake.script.shift() ?? { kind: 'sent' });
      },
    },
  };
  return fake;
}

/** The key the tests save. Long enough that its tail is unmistakable. */
export const FAKE_SMTP_KEY = 'xsmtpsib-test-key-0000000000-KEY9';

/** A complete settings body, as the Email card sends it. */
export const SMTP_SETTINGS = {
  host: 'smtp-relay.brevo.com',
  port: 587,
  username: '9a1b2c@smtp-brevo.com',
  password: FAKE_SMTP_KEY,
  from_address: 'ksage@kvelld.com',
  from_name: 'Ksage',
} as const;
