import { useEffect, useState } from 'react';
import {
  type EmailInboundRow,
  type EmailInboundSettings,
  getEmailInboundSettings,
  inboundFieldErrors,
  inboundRefusal,
  makeEmailInboundToken,
  saveEmailInboundSettings,
} from '../../../api/email-inbound.ts';
import type { OrgEmailInbound } from '../../../api/org.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Checkbox } from '../../../components/forms/Checkbox.tsx';
import { PasswordInput } from '../../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SaveStatus, useSaveStatus } from '../../../components/SaveStatus.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { taskHref } from '../../task-href.ts';
import {
  attachmentsLabel,
  inboundBadge,
  inboundDirty,
  type InboundField,
  type InboundForm,
  inboundFormErrors,
  inboundFormFrom,
  inboundFormInput,
  outcomeTone,
  outcomeWords,
  senderLabel,
  switchBlocker,
  switchLine,
} from './email-inbound-derive.ts';

export interface EmailInboundSectionProps {
  /** Told when the switch or the domain changes, so `OrgView.email_inbound` follows. */
  readonly onChanged: (inbound: OrgEmailInbound) => void;
  readonly onNavigate: (to: string) => void;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly settings: EmailInboundSettings };

type Busy = 'switch' | 'token' | 'remove-key';

/**
 * Email to tasks (D-155, LAI-1315), a card on Organisation › Integrations for
 * a holder of `org.email.configure`: the receiving domain, the checks a mail
 * must pass, the Brevo webhook's token and address, the *Email to tasks on*
 * switch, and the last twenty mails with what came of each.
 *
 * **It ships off, and turning it on is the owner's three steps**: save the
 * receiving domain, make the token and paste it into Brevo, flip the switch.
 * The switch cannot be turned on before the first two — the server refuses
 * it too.
 *
 * **Both secrets are write-only.** The API key is in this component's state
 * from the moment it is typed until the save that sends it, then cleared
 * whatever the answer. The webhook token is shown once, from the answer that
 * made it, and is gone when the card is; afterwards only `…last4`.
 *
 * **No mail's subject or text is drawn** — the server never sends them — and
 * everything a sender wrote (their From address, the receiving server's
 * verdicts) is React text.
 */
export function EmailInboundSection({ onChanged, onNavigate }: EmailInboundSectionProps) {
  const confirm = useConfirm();
  const status = useSaveStatus();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<InboundForm | undefined>(undefined);
  /** Save was pressed: the client's own checks show from then on. */
  const [touched, setTouched] = useState(false);
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [switchError, setSwitchError] = useState<string | undefined>(undefined);
  /** The token just made — shown this once. */
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    getEmailInboundSettings(controller.signal)
      .then((settings) => {
        if (controller.signal.aborted) return;
        setRead({ kind: 'ready', settings });
        setForm(inboundFormFrom(settings));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const settings = read.kind === 'ready' ? read.settings : undefined;

  const adopt = (answer: EmailInboundSettings): void => {
    setRead({ kind: 'ready', settings: answer });
    onChanged({ enabled: answer.enabled, domain: answer.domain });
  };

  const flip = (on: boolean): void => {
    setBusy('switch');
    setSwitchError(undefined);
    saveEmailInboundSettings({ enabled: on })
      .then(adopt)
      .catch((cause: unknown) => {
        setSwitchError(inboundRefusal(cause));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const save = (): void => {
    if (settings === undefined || form === undefined) return;
    if (Object.keys(inboundFormErrors(form, settings.example_domain)).length > 0) {
      setTouched(true);
      return;
    }
    const input = inboundFormInput(form, settings);
    if (Object.keys(input).length === 0) return;
    status
      .run(async () => {
        setRefused({});
        setError(undefined);
        try {
          const answer = await saveEmailInboundSettings(input);
          adopt(answer);
          setForm(inboundFormFrom(answer));
          setTouched(false);
        } catch (cause: unknown) {
          const byField = inboundFieldErrors(cause);
          setRefused(byField);
          if (Object.keys(byField).length === 0) setError(inboundRefusal(cause));
          throw cause;
        } finally {
          // The key goes either way: a refused one is typed again, never shown again.
          setForm((current) => (current === undefined ? current : { ...current, api_key: '' }));
        }
      })
      .catch(() => {
        // Said under the field it names, or below Save, and by the status.
      });
  };

  const makeToken = (): void => {
    if (settings === undefined) return;
    const go = (): void => {
      setBusy('token');
      setError(undefined);
      setToken(undefined);
      makeEmailInboundToken()
        .then((answer) => {
          setToken(answer.token);
          adopt(answer.settings);
        })
        .catch((cause: unknown) => {
          setError(inboundRefusal(cause));
        })
        .finally(() => {
          setBusy(undefined);
        });
    };
    if (settings.token_last4 === null) {
      go();
      return;
    }
    void confirm({
      title: 'Make a new webhook token?',
      body: 'The current token stops working at once: Brevo’s deliveries are refused until the new one is pasted into its inbound webhook.',
      confirmLabel: 'Make a new token',
      danger: true,
    }).then((yes) => {
      if (yes) go();
    });
  };

  const removeKey = (): void => {
    void confirm({
      title: 'Remove the Brevo API key?',
      body: 'Mail still becomes tasks, but its attachments are not fetched until a key is saved again.',
      confirmLabel: 'Remove key',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy('remove-key');
      setError(undefined);
      saveEmailInboundSettings({ api_key: null })
        .then(adopt)
        .catch((cause: unknown) => {
          setError(inboundRefusal(cause));
        })
        .finally(() => {
          setBusy(undefined);
        });
    });
  };

  const badge = settings === undefined ? undefined : inboundBadge(settings);

  return (
    <section
      className="org-card org-inbound"
      aria-labelledby="org-inbound"
      data-section="email-inbound"
    >
      <header className="org-card-head">
        <h2 id="org-inbound">Email to tasks</h2>
        {settings !== undefined && badge !== undefined && (
          <span
            className="org-status-badge"
            data-tone={badge.tone}
            data-inbound-enabled={settings.enabled}
          >
            {badge.label}
          </span>
        )}
      </header>

      <p className="org-note org-inbound-lead">
        Mail to a space’s own address becomes a task there, written as the member who sent it, and a
        reply in the thread becomes a comment. Mail Laika cannot trust is recorded below and never
        answered.
      </p>

      {read.kind === 'loading' && (
        <LoadingState shape="row" count={3} label="Loading Email to tasks" />
      )}
      {read.kind === 'error' && (
        <ApiErrorState
          error={read.error}
          resource="the Email to tasks settings"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {settings !== undefined && form !== undefined && (
        <Ready
          settings={settings}
          form={form}
          errors={touched ? inboundFormErrors(form, settings.example_domain) : {}}
          refused={refused}
          busy={busy}
          saving={status.state.kind === 'saving'}
          error={error}
          switchError={switchError}
          token={token}
          statusSlot={
            <SaveStatus className="org-inbound-status" state={status.state} onRetry={save} />
          }
          onEdit={(patch) => {
            setForm({ ...form, ...patch });
            setRefused((current) => {
              const keys = Object.keys(patch).filter((k) => k in current);
              if (keys.length === 0) return current;
              const next = { ...current };
              for (const k of keys) delete next[k];
              return next;
            });
            // *Saved* was about the values before this edit.
            status.reset();
          }}
          onFlip={flip}
          onSave={save}
          onMakeToken={makeToken}
          onRemoveKey={removeKey}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}

interface ReadyProps {
  readonly settings: EmailInboundSettings;
  readonly form: InboundForm;
  readonly errors: Partial<Record<InboundField, string>>;
  readonly refused: Readonly<Record<string, string>>;
  readonly busy: Busy | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
  readonly switchError: string | undefined;
  readonly token: string | undefined;
  readonly statusSlot: React.ReactNode;
  readonly onEdit: (patch: Partial<InboundForm>) => void;
  readonly onFlip: (on: boolean) => void;
  readonly onSave: () => void;
  readonly onMakeToken: () => void;
  readonly onRemoveKey: () => void;
  readonly onNavigate: (to: string) => void;
}

/** The card once the settings are read. */
function Ready({
  settings,
  form,
  errors,
  refused,
  busy,
  saving,
  error,
  switchError,
  token,
  statusSlot,
  onEdit,
  onFlip,
  onSave,
  onMakeToken,
  onRemoveKey,
  onNavigate,
}: ReadyProps) {
  const blocker = switchBlocker(settings);
  const problem = (field: InboundField): string | undefined => refused[field] ?? errors[field];
  const dirty = inboundDirty(form, settings);
  const working = busy !== undefined || saving;

  return (
    <>
      <div className="org-inbound-switch">
        <Switch
          checked={settings.enabled}
          disabled={working || (!settings.enabled && blocker !== null)}
          describedBy="org-inbound-step"
          onChange={onFlip}
        >
          Email to tasks on
        </Switch>
        <span className="org-fact-note" id="org-inbound-step" data-inbound-step>
          {switchLine(settings)}
        </span>
        {(switchError ?? refused.enabled) !== undefined && (
          <span className="org-fact-error" role="alert" data-error="switch">
            {switchError ?? refused.enabled}
          </span>
        )}
      </div>

      <form
        className="org-inbound-form"
        aria-label="Receiving settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !working) onSave();
        }}
      >
        <TextInput
          label="Receiving domain"
          value={form.domain}
          onChange={(domain) => {
            onEdit({ domain });
          }}
          autoComplete="off"
          appearance="code"
          placeholder={settings.example_domain}
          help="The subdomain whose MX records point at Brevo. Each space gets an address on it."
          error={problem('domain')}
        />
        <Checkbox
          label="Require authenticated senders"
          checked={form.require_authenticated}
          // Turning it off is an owner's decision (M2); anyone may turn it on.
          disabled={form.require_authenticated && !settings.can_allow_unauthenticated}
          onChange={(on) => {
            onEdit({ require_authenticated: on });
          }}
          help={
            settings.can_allow_unauthenticated
              ? 'Drop mail unless the receiving server shows a DMARC, DKIM or SPF pass for the sender’s own domain. That proves the domain, not the person: anyone who can send as that domain can be written as any member there.'
              : 'Drop mail unless the receiving server shows a DMARC, DKIM or SPF pass for the sender’s own domain. Only an owner can turn this off.'
          }
        />
        <TextInput
          label="Receiving server (Authentication-Results)"
          value={form.authserv_id}
          onChange={(authserv_id) => {
            onEdit({ authserv_id });
          }}
          autoComplete="off"
          appearance="code"
          optional
          help={
            settings.authserv_seen.length > 0
              ? `Only this server’s verdicts count; without it every mail is dropped. Seen in recent mail: ${settings.authserv_seen.join(', ')}.`
              : 'Only this server’s verdicts count; without it every mail is dropped. Send one mail to a space while the switch is off, and the server it names shows here.'
          }
          error={problem('authserv_id')}
        />
        <PasswordInput
          label={
            settings.api_key_last4 === null
              ? 'Brevo API key'
              : 'Brevo API key — leave empty to keep the saved one'
          }
          value={form.api_key}
          onChange={(api_key) => {
            onEdit({ api_key });
          }}
          autoComplete="new-password"
          // Said before Save, not after (LAI-1315 review): with no
          // `LAIKA_SECRET` the server cannot encrypt a key, so it would refuse.
          disabled={!settings.can_store_secrets}
          help={
            !settings.can_store_secrets
              ? 'This server has no LAIKA_SECRET, so it cannot store a key. Set it and restart Laika, then paste the key here.'
              : settings.api_key_last4 === null
                ? 'For fetching attachments. Laika keeps it encrypted and shows only its last four.'
                : `The saved key ends …${settings.api_key_last4}. It is used only to fetch attachments.`
          }
          error={problem('api_key')}
        />
        <span className="org-inbound-actions">
          <Button
            type="submit"
            busy={saving}
            disabled={!dirty || (busy !== undefined && !saving)}
            data-inbound-save
          >
            Save
          </Button>
          {settings.api_key_last4 !== null && (
            <Button
              variant="secondary"
              busy={busy === 'remove-key'}
              disabled={working && busy !== 'remove-key'}
              onClick={onRemoveKey}
            >
              Remove key
            </Button>
          )}
          {statusSlot}
        </span>
        {error !== undefined && (
          <p className="org-fact-error" role="alert" data-error="inbound">
            {error}
          </p>
        )}
      </form>

      <dl className="org-facts org-inbound-facts">
        <div className="org-fact" data-fact="inbound-webhook">
          <dt>Webhook URL</dt>
          <dd>
            {settings.webhook_url === null ? (
              <span className="org-fact-note" data-inbound-warning="public-url">
                This server has no public address (LAIKA_PUBLIC_URL), so there is no webhook URL to
                give Brevo yet.
              </span>
            ) : (
              <span className="org-inbound-copy">
                <code className="org-inbound-code" data-inbound-url>
                  {settings.webhook_url}
                </code>
                <CopyButton text={settings.webhook_url} what="the webhook URL" />
              </span>
            )}
          </dd>
        </div>
        <div className="org-fact" data-fact="inbound-token">
          <dt>Webhook token</dt>
          <dd>
            {token !== undefined ? (
              <span className="org-inbound-reveal" data-inbound-token="new">
                <span className="org-inbound-copy">
                  <code className="org-inbound-code org-inbound-secret">{token}</code>
                  <CopyButton text={token} what="the webhook token" />
                </span>
                <span className="org-fact-note">
                  Paste this into Brevo’s inbound webhook as its bearer token. It is not shown
                  again.
                </span>
              </span>
            ) : (
              <span
                className="org-fact-note"
                data-inbound-token={settings.token_last4 === null ? 'none' : 'set'}
              >
                {settings.token_last4 === null
                  ? 'None yet. Brevo’s deliveries are refused until there is one.'
                  : `Ends …${settings.token_last4}. Only Brevo’s webhook should have it.`}
              </span>
            )}
            <span className="org-inbound-actions">
              <Button
                variant="secondary"
                size="sm"
                busy={busy === 'token'}
                disabled={working && busy !== 'token'}
                onClick={onMakeToken}
                data-inbound-make-token
              >
                {settings.token_last4 === null ? 'Make token' : 'Make a new token'}
              </Button>
            </span>
          </dd>
        </div>
        <div className="org-fact" data-fact="inbound-own">
          <dt>Never from</dt>
          <dd>
            <span className="org-fact-note">
              Mail from <code className="org-inbound-code">{settings.own_address}</code>, this
              board’s own sender, is always dropped, so Laika never answers itself.
            </span>
          </dd>
        </div>
      </dl>

      {settings.updated_by !== null && settings.updated_at !== null && (
        <p className="org-fact-note org-inbound-updated">
          Last changed by {settings.updated_by.name},{' '}
          {timeLabel(settings.updated_at, Date.now()).text}.
        </p>
      )}

      <RecentMail rows={settings.recent} onNavigate={onNavigate} />
    </>
  );
}

/** The last twenty mails: when, what came of it, who, where, and the server's verdicts. */
function RecentMail({
  rows,
  onNavigate,
}: {
  readonly rows: readonly EmailInboundRow[];
  readonly onNavigate: (to: string) => void;
}) {
  const now = Date.now();
  return (
    <div className="org-inbound-recent">
      <h3 className="org-inbound-recent-head">Recent mail</h3>
      {rows.length === 0 ? (
        <p className="org-fact-note">No mail has arrived yet.</p>
      ) : (
        <ul className="org-inbound-rows" aria-label="Recent inbound mail">
          {rows.map((row) => {
            const when = timeLabel(row.received_at, now);
            const attachments = attachmentsLabel(row.attachment_count);
            const href =
              row.task_key === null
                ? undefined
                : taskHref({ key: row.task_key }, row.project?.slug);
            return (
              <li
                key={row.id}
                className="org-inbound-row"
                data-outcome={row.outcome}
                data-tone={outcomeTone(row)}
              >
                <time className="org-inbound-when" dateTime={when.iso} title={when.full}>
                  {when.text}
                </time>
                <span className="org-inbound-outcome">{outcomeWords(row)}</span>
                {href !== undefined && row.task_key !== null && (
                  <a
                    className="org-inbound-task"
                    href={href}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onNavigate(href);
                    }}
                  >
                    {row.task_key}
                  </a>
                )}
                <span className="org-inbound-meta">
                  <span className="org-inbound-from">{senderLabel(row)}</span>
                  {row.project !== null && (
                    <span className="org-inbound-space">{row.project.name}</span>
                  )}
                  {row.auth === null && row.authserv_ids.length > 0 && (
                    <code className="org-inbound-code org-inbound-auth" data-inbound-seen>
                      named {row.authserv_ids.join(', ')}
                    </code>
                  )}
                  {row.auth !== null && (
                    <code className="org-inbound-code org-inbound-auth">{row.auth}</code>
                  )}
                  {attachments !== null && <span>{attachments}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
