import { useEffect, useState } from 'react';
import {
  clearEmailSettings,
  type EmailSettings,
  type EmailTestResult,
  getEmailSettings,
  saveEmailSettings,
  sendTestEmail,
} from '../../../api/email.ts';
import { type OrgEmail, updateOrg } from '../../../api/org.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { PasswordInput } from '../../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { Switch } from '../../../components/Switch.tsx';
import {
  emailBadge,
  type EmailForm,
  emailFormErrors,
  emailFormFrom,
  emailFormInput,
  keyIsStored,
  nextStep,
  testLine,
} from './email-derive.ts';
import { OrgAccordion } from './OrgAccordion.tsx';

export interface EmailSectionProps {
  /** Told when the switch or the configuration changes, so `OrgView.email` follows. */
  readonly onChanged: (email: OrgEmail) => void;
}

type Busy = 'save' | 'test' | 'switch' | 'clear';

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The organisation's outbound email (D-153, LAI-1312), a card on Organisation
 * › Integrations for an owner or admin: the SMTP settings, *Send test email*,
 * and the *Email on* switch.
 *
 * **It ships off, and turning it on is the owner's three steps**: paste the
 * key and save, send a test, flip the switch. The card says which step the
 * organisation is on, and the switch cannot be turned on before a key is
 * saved — the server refuses it too.
 *
 * **The key is write-only.** It is in this component's state from the moment
 * it is typed until the save that sends it, then cleared whatever the answer;
 * never pre-filled (`new-password` keeps the browser's saved Laika password
 * out), and the server never answers it — the card shows `key_last4`.
 */
export function EmailSection({ onChanged }: EmailSectionProps) {
  const confirm = useConfirm();
  const [settings, setSettings] = useState<EmailSettings | undefined>(undefined);
  const [readFailed, setReadFailed] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<EmailForm | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tested, setTested] = useState<EmailTestResult | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    getEmailSettings(controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setSettings(answer);
        setForm(emailFormFrom(answer));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setReadFailed(messageOf(cause, 'The email settings could not be read.'));
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (settings === undefined || form === undefined) {
    if (readFailed === undefined) return null;
    return (
      <section className="org-card org-email" aria-labelledby="org-email" data-section="email">
        <header className="org-card-head">
          <h2 id="org-email">Email</h2>
        </header>
        <p className="org-fact-error" role="alert">
          {readFailed}
        </p>
      </section>
    );
  }

  const keyStored = keyIsStored(settings);
  const errors = emailFormErrors(form, settings);
  const invalid = Object.keys(errors).length > 0;
  const badge = emailBadge(settings);
  const shown = (field: keyof EmailForm): string | undefined =>
    touched ? errors[field] : undefined;

  const adopt = (answer: EmailSettings): void => {
    setSettings(answer);
    onChanged({ enabled: answer.enabled, configured: answer.configured });
  };

  const set = (field: keyof EmailForm) => (value: string) => {
    setForm({ ...form, [field]: value });
  };

  const save = (): void => {
    setTouched(true);
    if (invalid) return;
    setBusy('save');
    setError(undefined);
    saveEmailSettings(emailFormInput(form))
      .then((answer) => {
        adopt(answer);
        setForm(emailFormFrom(answer));
        setTouched(false);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause, 'The settings could not be saved.'));
        // The key goes either way: a refused one is typed again, never shown again.
        setForm((current) => (current === undefined ? current : { ...current, password: '' }));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const test = (): void => {
    setBusy('test');
    setError(undefined);
    sendTestEmail()
      .then((result) => {
        setTested(result);
        return getEmailSettings().then(adopt);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause, 'The test email could not be sent.'));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const flip = (on: boolean): void => {
    setBusy('switch');
    setError(undefined);
    updateOrg({ email_enabled: on })
      .then(() => getEmailSettings())
      .then(adopt)
      .catch((cause: unknown) => {
        setError(messageOf(cause, 'Email could not be switched.'));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const clear = (): void => {
    void confirm({
      title: 'Clear the email settings?',
      body: 'The key and the settings are forgotten and Email is turned off. Nothing is mailed until they are saved again.',
      confirmLabel: 'Clear settings',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy('clear');
      setError(undefined);
      clearEmailSettings()
        .then(() => getEmailSettings())
        .then((answer) => {
          adopt(answer);
          setForm(emailFormFrom(answer));
          setTested(undefined);
        })
        .catch((cause: unknown) => {
          setError(messageOf(cause, 'The settings could not be cleared.'));
        })
        .finally(() => {
          setBusy(undefined);
        });
    });
  };

  const lastTest = tested ?? settings.last_test;
  const counts = settings.last_7_days;
  const recent = [
    counts.sent > 0 ? `${String(counts.sent)} sent` : null,
    counts.queued + counts.sending > 0 ? `${String(counts.queued + counts.sending)} waiting` : null,
    counts.failed > 0 ? `${String(counts.failed)} failed` : null,
    // May have arrived: a timeout once the session was underway (§4.93).
    counts.unconfirmed > 0 ? `${String(counts.unconfirmed)} unconfirmed` : null,
    // Off, not configured, nobody to send to: each with its reason in the outbox.
    counts.suppressed > 0 ? `${String(counts.suppressed)} not sent` : null,
  ].filter((part): part is string => part !== null);

  return (
    // Folded to one row that says its state (LAI-1345).
    <OrgAccordion
      name="email"
      id="org-email"
      title="Email"
      className="org-email"
      section="email"
      description="Invite and password-reset links, sent through your SMTP relay."
      meta={
        <span
          className="org-status-badge"
          data-tone={badge.tone}
          data-email-enabled={settings.enabled}
          data-configured={settings.configured}
        >
          {badge.label}
        </span>
      }
    >
      <p className="org-note org-email-lead">
        Laika can email invite links and password-reset links through your SMTP relay. Every link is
        still shown to copy, whether email is on or off.
      </p>

      <div className="org-email-switch">
        <Switch
          checked={settings.enabled}
          disabled={busy !== undefined || (!settings.enabled && !settings.configured)}
          describedBy="org-email-step"
          onChange={flip}
        >
          Email on
        </Switch>
        <span className="org-fact-note" id="org-email-step" data-email-step>
          {nextStep(settings)}
        </span>
      </div>

      {settings.public_url === null && (
        <p className="org-fact-note org-email-warning" data-email-warning="public-url">
          This server has no public address (LAIKA_PUBLIC_URL), so a link cannot be mailed: invites
          and reset links stay copy-only until it is set.
        </p>
      )}

      <form
        className="org-email-form"
        aria-label="SMTP settings"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextInput
          label="SMTP host"
          value={form.host}
          onChange={set('host')}
          autoComplete="off"
          appearance="code"
          error={shown('host')}
          required
        />
        <TextInput
          label="Port"
          value={form.port}
          onChange={set('port')}
          autoComplete="off"
          width="short"
          help="587 uses STARTTLS, which Laika requires; 465 is TLS from the start."
          error={shown('port')}
          required
        />
        <TextInput
          label="Login"
          value={form.username}
          onChange={set('username')}
          autoComplete="off"
          help="The SMTP login on Brevo’s SMTP & API page — not your Brevo account address."
          error={shown('username')}
          required
        />
        <PasswordInput
          label={keyStored ? 'SMTP key — leave empty to keep the saved one' : 'SMTP key'}
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          help={
            settings.key_last4 === null
              ? 'A key made for Laika alone. Laika keeps it encrypted and shows only its last four.'
              : `The saved key ends ···${settings.key_last4}, and is only sent to the host it was saved with — a new host, port or login needs it pasted again.`
          }
          error={shown('password')}
          required={!keyStored}
        />
        <TextInput
          label="From address"
          type="email"
          value={form.from_address}
          onChange={set('from_address')}
          autoComplete="off"
          help="A sender your relay has verified, or mail is refused."
          error={shown('from_address')}
          required
        />
        <TextInput
          label="From name"
          value={form.from_name}
          onChange={set('from_name')}
          autoComplete="off"
          help="What people see the mail from, and what the mail calls this board."
          error={shown('from_name')}
          required
        />
        <span className="org-break-actions">
          <Button
            type="submit"
            busy={busy === 'save'}
            disabled={busy !== undefined && busy !== 'save'}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            busy={busy === 'test'}
            disabled={!settings.configured || (busy !== undefined && busy !== 'test')}
            disabledReason={settings.configured ? undefined : 'Save the settings and the key first'}
            onClick={test}
            data-email-test
          >
            Send test email
          </Button>
          {(settings.configured || settings.host !== null) && (
            <Button variant="danger" disabled={busy !== undefined} onClick={clear}>
              Clear
            </Button>
          )}
        </span>
      </form>

      {lastTest !== null && (
        <p
          className="org-fact-note org-email-test"
          role="status"
          data-email-test-result={lastTest.ok ? 'sent' : 'failed'}
        >
          {testLine(lastTest)}
          {typeof tested?.message === 'string' && (
            <span className="org-email-server">The server said: {tested.message}</span>
          )}
        </p>
      )}

      {recent.length > 0 && (
        <p className="org-fact-note" data-email-recent>
          Last 7 days: {recent.join(' · ')}.
        </p>
      )}

      {error !== undefined && (
        <p className="org-fact-error" role="alert">
          {error}
        </p>
      )}
    </OrgAccordion>
  );
}
