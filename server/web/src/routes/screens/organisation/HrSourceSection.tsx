import { useEffect, useMemo, useState } from 'react';
import {
  connectHr,
  disconnectHr,
  getHrSource,
  hrRefusal,
  mapHrPeople,
  refusedFor,
  syncErrorWords,
  syncHr,
  verifyHr,
  type HrSource,
} from '../../../api/hr.ts';
import { startTicker, timeLabel } from '../../../api/time-label.ts';
import type { OrgUser } from '../../../api/users.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Dropdown, type DropdownOption } from '../../../components/Dropdown.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { PasswordInput } from '../../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import {
  companyAddress,
  connectedLine,
  countsLine,
  heldBy,
  initialChoice,
  isHttpsAddress,
  mappingChanges,
  NOT_ON_LAIKA,
  peopleToReview,
  pruneChoices,
  twoFactorMethodName,
  twoFactorWords,
} from './hr-derive.ts';

export interface HrSourceSectionProps {
  /** Active members, for the picker beside each Clan person an owner maps. */
  readonly members: readonly OrgUser[];
}

/** Which control is waiting on the server, so only that one spins. */
type Busy = 'connect' | 'verify' | 'sync' | 'disconnect' | 'people';

/**
 * How the dedicated Clan account is connected (D-149, CHIEF's final contract):
 * Laika signs in once as it, or an administrator pastes a token Clan made for
 * it. Which one depends on what Clan offers, so the form offers both.
 */
type ConnectWay = 'sign_in' | 'token';

const CONNECT_WAYS: readonly { readonly way: ConnectWay; readonly label: string }[] = [
  { way: 'sign_in', label: 'Sign in with the account' },
  { way: 'token', label: 'Paste a token' },
];

const MINUTE = 60_000;

/** The card head's chip, as the GitHub webhook card's says *secret set*. */
const STATUS_WORDS: Readonly<Record<HrSource['status'], string>> = {
  off: 'not connected',
  pending_2fa: 'waiting for a code',
  connected: 'connected',
};

/**
 * The organisation's HR system (D-149, LAI-1182), a card on Organisation →
 * Integrations beside the GitHub webhook: an owner or admin connects Clan
 * once, sees how syncing is going and what the token can see, runs a sync
 * now, and maps the people Clan's emails did not match. Shown only to a
 * holder of `org.hr.configure`.
 *
 * Modelled on `GithubWebhookSection` — the other secret held for the whole
 * organisation — and stricter about it: **a password or a pasted token is
 * sent once and the page keeps neither.** Not in this component past the call
 * that sends it (cleared on every outcome, so a refused attempt is typed again
 * rather than shown again), never pre-filled (`new-password` keeps the
 * browser's saved Laika password out), and the server never answers either.
 * The password is forgotten after its one sign-in; the token Laika keeps,
 * encrypted, is shown as its last four.
 */
export function HrSourceSection({ members }: HrSourceSectionProps) {
  const confirm = useConfirm();
  const [view, setView] = useState<HrSource | undefined>(undefined);
  const [readFailed, setReadFailed] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [way, setWay] = useState<ConnectWay>('sign_in');
  const [token, setToken] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    getHrSource(controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setView(answer);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setReadFailed(hrRefusal(cause));
      });
    return () => {
      controller.abort();
    };
  }, []);

  // "4 min ago" keeps up with the clock while the page is open.
  useEffect(
    () =>
      startTicker(() => {
        setNow(Date.now());
      }, MINUTE),
    [],
  );

  // A sync, a save or another owner can take a row off the form; a pick left
  // for it would be invisible, so it goes with the row (LAI-1182 review).
  useEffect(() => {
    setChoices((current) => pruneChoices(view?.people ?? [], current));
  }, [view]);

  const review = useMemo(() => peopleToReview(view?.people ?? []), [view]);
  const changes = useMemo(() => mappingChanges(view?.people ?? [], choices), [view, choices]);

  if (view === undefined) {
    if (readFailed === undefined) return null;
    return (
      <section className="org-card org-hr" aria-labelledby="org-hr" data-section="hr">
        <header className="org-card-head">
          <h2 id="org-hr">HR system</h2>
        </header>
        <p className="org-fact-error" role="alert">
          The HR connection could not be read. {readFailed}
        </p>
      </section>
    );
  }

  /** Each call takes the control it names, and answers the view it changed. */
  const run = (which: Busy, call: () => Promise<HrSource>): Promise<HrSource | undefined> => {
    setBusy(which);
    setError(undefined);
    return call()
      .then((answer) => {
        setView(answer);
        setNow(Date.now());
        return answer;
      })
      .catch((cause: unknown) => {
        setError(hrRefusal(cause));
        return undefined;
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const connect = (): void => {
    if (!isHttpsAddress(baseUrl)) {
      setUrlError('Use the https:// address you sign in to Clan at.');
      return;
    }
    setUrlError(undefined);
    const base_url = baseUrl.trim();
    const sent =
      way === 'sign_in'
        ? { base_url, email: email.trim(), password }
        : { base_url, token: token.trim(), ...(expiresOn === '' ? {} : { expires_on: expiresOn }) };
    // Gone from the form whatever the answer: kept nowhere, shown never again.
    setPassword('');
    setToken('');
    void run('connect', () => connectHr(sent)).then((answer) => {
      if (answer === undefined) return;
      setConnecting(false);
      setCode('');
      setMethod(answer.two_factor?.methods[0]);
    });
  };

  const verify = (): void => {
    const chosen = method ?? view.two_factor?.methods[0];
    if (chosen === undefined) return;
    setBusy('verify');
    setError(undefined);
    verifyHr({ method: chosen, code: code.trim() })
      .then((answer) => {
        setView(answer);
        setCode('');
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        setError(hrRefusal(cause));
        // Ten minutes are up: the pending sign-in is gone, so is the code form.
        if (refusedFor(cause, 'two_factor_expired')) {
          setCode('');
          setConnecting(true);
        }
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const syncNow = (): void => {
    void run('sync', syncHr);
  };

  const disconnect = (): void => {
    void confirm({
      title: 'Disconnect Clan?',
      body: 'Laika forgets the sign-in token and stops syncing. Holidays and leave already synced stay as they are; connect again to bring them up to date.',
      confirmLabel: 'Disconnect',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy('disconnect');
      setError(undefined);
      disconnectHr()
        .then(() => getHrSource())
        .then((answer) => {
          setView(answer);
          setChoices({});
        })
        .catch((cause: unknown) => {
          setError(hrRefusal(cause));
        })
        .finally(() => {
          setBusy(undefined);
        });
    });
  };

  const savePeople = (): void => {
    void run('people', () => mapHrPeople(changes)).then((answer) => {
      if (answer !== undefined) setChoices({});
    });
  };

  const ago = (at: number): string => timeLabel(at, now).text;
  const methods = view.two_factor?.methods ?? [];
  const pending = view.status === 'pending_2fa' && !connecting;

  const ready =
    baseUrl.trim() !== '' &&
    (way === 'sign_in' ? email.trim() !== '' && password !== '' : token.trim() !== '');

  const connectForm = (
    <form
      className="org-hr-form"
      aria-label="Connect Clan"
      onSubmit={(event) => {
        event.preventDefault();
        connect();
      }}
    >
      <span className="org-modes org-hr-ways" role="group" aria-label="How to connect">
        {CONNECT_WAYS.map((option) => (
          <button
            key={option.way}
            type="button"
            className="org-mode"
            aria-pressed={option.way === way}
            data-connect-way={option.way}
            disabled={busy !== undefined}
            onClick={() => {
              setWay(option.way);
              setError(undefined);
            }}
          >
            {option.label}
          </button>
        ))}
      </span>
      <TextInput
        label="Clan address"
        type="url"
        value={baseUrl}
        onChange={(value) => {
          setBaseUrl(value);
          setUrlError(undefined);
        }}
        placeholder="https://codesage.clan.biz"
        autoComplete="off"
        error={urlError}
        required
      />
      {way === 'sign_in' ? (
        <>
          <TextInput
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="off"
            required
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            help="Used once to sign in, then forgotten. If Clan asks for a code, that comes next."
            required
          />
        </>
      ) : (
        <>
          <PasswordInput
            label="Token"
            value={token}
            onChange={setToken}
            autoComplete="new-password"
            help="The API token Clan made for that account. Laika keeps it encrypted and shows only its last four."
            required
          />
          <label className="org-hr-expires">
            <span className="field-label">Expires on</span>
            <input
              className="input org-hr-expires-input"
              type="date"
              value={expiresOn}
              onChange={(e) => {
                setExpiresOn(e.target.value);
              }}
            />
            <span className="field-help">Optional. Laika warns 30 days before.</span>
          </label>
        </>
      )}
      <span className="org-fact-note org-hr-dedicated" data-hr-dedicated>
        Use a dedicated, read-only Clan account (for example Forge) — never your own login. Laika
        keeps only a sign-in key, never the password.
      </span>
      <span className="org-break-actions">
        <Button type="submit" busy={busy === 'connect'} disabled={!ready}>
          Connect
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== undefined}
          onClick={() => {
            setConnecting(false);
            setPassword('');
            setToken('');
            setUrlError(undefined);
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </span>
    </form>
  );

  const chosenMethod = method ?? methods[0];

  return (
    <section
      className="org-card org-hr"
      aria-labelledby="org-hr"
      data-section="hr"
      data-hr-status={view.status}
    >
      <header className="org-card-head">
        <h2 id="org-hr">HR system</h2>
        <span className="org-count" data-configured={view.status === 'connected'}>
          {STATUS_WORDS[view.status]}
        </span>
      </header>

      <p className="org-note org-hr-lead" data-hr-lead>
        Holidays and leave from Clan, every {String(view.sync_every_minutes)} minutes. Laika keeps
        the sign-in token, never the password.
      </p>

      <div className="org-hr-body">
        {view.status === 'off' && !connecting && (
          <span className="org-break-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setConnecting(true);
                setError(undefined);
              }}
            >
              Connect Clan
            </Button>
          </span>
        )}

        {pending && methods.length > 0 && (
          <form
            className="org-hr-form"
            aria-label="Clan sign-in code"
            onSubmit={(event) => {
              event.preventDefault();
              verify();
            }}
          >
            <span>Clan asked for a sign-in code.</span>
            {methods.length > 1 && (
              <span className="org-modes" role="group" aria-label="How Clan sends the code">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="org-mode"
                    aria-pressed={m === chosenMethod}
                    disabled={busy !== undefined}
                    onClick={() => {
                      setMethod(m);
                    }}
                  >
                    {twoFactorMethodName(m)}
                  </button>
                ))}
              </span>
            )}
            <TextInput
              label="Code"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
              help={`Enter ${twoFactorWords(chosenMethod ?? '')}. It works for 10 minutes.`}
              required
            />
            <span className="org-break-actions">
              <Button type="submit" busy={busy === 'verify'} disabled={code.trim() === ''}>
                Verify
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== undefined}
                onClick={() => {
                  setConnecting(true);
                  setCode('');
                  setError(undefined);
                }}
              >
                Start again
              </Button>
            </span>
          </form>
        )}

        {pending && methods.length === 0 && (
          <>
            <span className="org-fact-note">
              Clan is waiting for a sign-in code that was asked for earlier. Connect again to get a
              new one.
            </span>
            <span className="org-break-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setConnecting(true);
                  setError(undefined);
                }}
              >
                Connect again
              </Button>
            </span>
          </>
        )}

        {connecting && connectForm}

        {view.status === 'connected' && !connecting && (
          <>
            <span
              className="org-hr-connected"
              data-hr-connected
              data-tone={view.expiring_soon ? 'warning' : undefined}
            >
              {connectedLine(view)}
            </span>
            {view.expiring_soon && (
              <span className="org-fact-note org-hr-warning" data-hr-expiring>
                The token runs out within 30 days. Connect again before then, or syncing stops.
              </span>
            )}
            {/* What the last check found the token can read (LAI-1181). */}
            {!view.sees_everyone && (
              <span className="org-fact-note org-hr-warning" data-hr-warning="sees-everyone">
                This token can only see one person’s leave — it needs an HR or admin role in Clan.
              </span>
            )}
            {!view.sees_departments && (
              <span className="org-fact-note org-hr-warning" data-hr-warning="sees-departments">
                People’s departments are hidden from this token, so holidays meant for some
                departments can’t be matched.
              </span>
            )}
            <span className="org-hr-sync" data-hr-sync>
              {view.last_attempt_at === null ? (
                'No sync has finished yet.'
              ) : view.last_error !== null ? (
                <>
                  <span className="org-hr-sync-error" data-hr-sync-error={view.last_error.code}>
                    Last sync {ago(view.last_attempt_at)} failed: {syncErrorWords(view.last_error)}.
                  </span>
                  {view.last_success_at !== null && view.last_result !== null && (
                    <span className="org-fact-note">
                      Last good sync {ago(view.last_success_at)}: {countsLine(view.last_result)}.
                    </span>
                  )}
                </>
              ) : (
                <span data-hr-counts>
                  Last sync {ago(view.last_success_at ?? view.last_attempt_at)}
                  {view.last_result === null ? '.' : `: ${countsLine(view.last_result)}.`}
                </span>
              )}
            </span>
            {view.base_url !== null && (
              <span className="org-fact-note">Reading from {companyAddress(view.base_url)}.</span>
            )}
            <span className="org-break-actions">
              <Button
                variant="secondary"
                busy={busy === 'sync'}
                disabled={busy !== undefined}
                onClick={syncNow}
              >
                Sync now
              </Button>
              {/* A new token, before this one runs out or after Clan refused it. */}
              {(view.expiring_soon || view.last_error?.code === 'token_rejected') && (
                <Button
                  variant="secondary"
                  disabled={busy !== undefined}
                  onClick={() => {
                    setConnecting(true);
                    setBaseUrl(view.base_url === null ? '' : companyAddress(view.base_url));
                    setEmail(view.account_email ?? '');
                    // The way it was connected: a pasted token carries no email.
                    setWay(view.account_email === null ? 'token' : 'sign_in');
                    setError(undefined);
                  }}
                >
                  Connect again
                </Button>
              )}
              <Button
                variant="danger"
                busy={busy === 'disconnect'}
                disabled={busy !== undefined}
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </span>

            {view.people.length > 0 && (
              <PeopleMap
                view={view}
                review={review}
                members={members}
                choices={choices}
                saving={busy === 'people'}
                blocked={busy !== undefined}
                changed={changes.length > 0}
                onChoose={(externalId, value) => {
                  setChoices((current) => ({ ...current, [externalId]: value }));
                }}
                onSave={savePeople}
              />
            )}
          </>
        )}

        {error !== undefined && (
          <span className="org-fact-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}

interface PeopleMapProps {
  readonly view: HrSource;
  readonly review: HrSource['people'];
  readonly members: readonly OrgUser[];
  readonly choices: Readonly<Record<string, string>>;
  readonly saving: boolean;
  readonly blocked: boolean;
  readonly changed: boolean;
  readonly onChoose: (externalId: string, value: string) => void;
  readonly onSave: () => void;
}

/**
 * Clan's people against Laika's: how many Clan's emails matched, then each
 * one they did not and each an owner already mapped, with a member picker and
 * *Not on Laika*. A member another person holds by an owner's word is offered
 * greyed, with whose they are — the server allows each member once; one held
 * only by an email match can be taken, and the email match gives way.
 */
function PeopleMap({
  view,
  review,
  members,
  choices,
  saving,
  blocked,
  changed,
  onChoose,
  onSave,
}: PeopleMapProps) {
  const matched = view.people.filter((p) => p.user !== null).length;

  return (
    <div className="org-hr-people" data-hr-people>
      <span className="org-hr-people-head" id="org-hr-people-head">
        People: {String(matched)} of {String(view.people.length)} matched
      </span>
      {review.length === 0 ? (
        <span className="org-fact-note">
          Everyone in Clan is matched to a Laika member by email.
        </span>
      ) : (
        <>
          <span className="org-fact-note">
            Matched by email at each sync. Pick the member for anyone it missed, or say they are not
            on Laika; your choice is kept over the email match.
          </span>
          <ul className="org-hr-map" aria-labelledby="org-hr-people-head">
            {review.map((person) => {
              const taken = heldBy(view.people, choices, person.external_id);
              const options: DropdownOption[] = [
                { value: NOT_ON_LAIKA, label: 'Not on Laika', pinned: true },
                ...members.map((m) => {
                  const by = taken.get(m.id);
                  return {
                    value: m.id,
                    label: m.name,
                    keywords: m.email,
                    disabled: by?.locked === true,
                    detail:
                      by === undefined
                        ? undefined
                        : by.locked
                          ? `matched to ${by.name}`
                          : `matched by email to ${by.name}`,
                  };
                }),
              ];
              return (
                <li
                  key={person.external_id}
                  className="org-hr-person"
                  data-hr-person={person.external_id}
                  data-matched-by={person.matched_by}
                >
                  <span className="org-hr-person-name">{person.name}</span>
                  <Dropdown
                    className="org-hr-pick"
                    aria-label={`Laika member for ${person.name}`}
                    noun="members"
                    value={choices[person.external_id] ?? initialChoice(person)}
                    placeholder="Choose a member"
                    options={options}
                    disabled={blocked}
                    onChange={(value) => {
                      onChoose(person.external_id, value);
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <span className="org-break-actions">
            <Button busy={saving} disabled={!changed || blocked} onClick={onSave}>
              Save people
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
