import { useEffect, useMemo, useState } from 'react';
import {
  calendarRefusal,
  calendarSyncErrorWords,
  disconnectCalendarSource,
  getCalendarSource,
  refusedField,
  saveCalendarSource,
  syncCalendarSource,
  testCalendarSource,
  type CalendarRuleKind,
  type CalendarSource,
} from '../../../api/calendar.ts';
import type { Project } from '../../../api/projects.ts';
import { startTicker, timeLabel } from '../../../api/time-label.ts';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { Dropdown, type DropdownOption } from '../../../components/Dropdown.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { IconButton } from '../../../components/forms/IconButton.tsx';
import { PasswordInput } from '../../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { Switch } from '../../../components/Switch.tsx';
import {
  blankRule,
  countsLine,
  formChanged,
  formOf,
  GRANT_STEP,
  hasProblems,
  inputOf,
  MAX_RULES,
  problemsOf,
  rolesLine,
  statusWord,
  switchInput,
  testVerdict,
  type CalendarForm,
  type RuleRow,
} from './calendar-derive.ts';

export interface CalendarSourceSectionProps {
  /** The spaces a rule may send a meeting to: the reader's, not archived. */
  readonly spaces: readonly Project[];
}

/** Which control is waiting on the server, so only that one spins. */
type Busy = 'save' | 'switch' | 'test' | 'sync' | 'disconnect';

const MINUTE = 60_000;

const RULE_KINDS: readonly DropdownOption<CalendarRuleKind>[] = [
  { value: 'title', label: 'Title contains' },
  { value: 'channel', label: 'Teams channel is' },
];

/**
 * The organisation's Outlook calendar (D-157, LAI-1316), a card on
 * Organisation → Integrations after the HR system: an owner or admin saves
 * the Microsoft Entra app's tenant, client id and secret, tests whether
 * Microsoft grants it `Calendars.Read`, says which meetings go to which
 * space, and turns the switch on. Shown only to a holder of
 * `org.calendar.configure`.
 *
 * Modelled on `HrSourceSection`, and as strict about its secret: **the client
 * secret is typed once and the page keeps none of it** past the save that
 * sends it — cleared on every outcome, never pre-filled (`new-password`), and
 * the server answers only its last four characters.
 *
 * **The switch saves the moment it is flipped**, with everything else as
 * saved, as Developer insights' does: an owner who turns it on is not left
 * with a page that looks on and a server that is off.
 */
export function CalendarSourceSection({ spaces }: CalendarSourceSectionProps) {
  const confirm = useConfirm();
  const [view, setView] = useState<CalendarSource | undefined>(undefined);
  const [readFailed, setReadFailed] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<CalendarForm | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldError, setFieldError] = useState<{ field: string; words: string } | undefined>(
    undefined,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    getCalendarSource(controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setView(answer);
        setForm(formOf(answer));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setReadFailed(calendarRefusal(cause));
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

  const problems = useMemo(
    () => (form === undefined || view === undefined ? undefined : problemsOf(form, view)),
    [form, view],
  );

  if (view === undefined || form === undefined || problems === undefined) {
    if (readFailed === undefined) return null;
    return (
      <section className="org-card org-cal" aria-labelledby="org-cal" data-section="calendar">
        <header className="org-card-head">
          <h2 id="org-cal">Outlook calendar</h2>
        </header>
        <p className="org-fact-error" role="alert">
          The calendar connection could not be read. {readFailed}
        </p>
      </section>
    );
  }

  const changed = formChanged(form, view);
  const shown = checked ? problems : undefined;

  /** Each call takes the control it names, and answers the view it changed. */
  const run = (
    which: Busy,
    call: () => Promise<CalendarSource>,
  ): Promise<CalendarSource | undefined> => {
    setBusy(which);
    setError(undefined);
    setFieldError(undefined);
    return call()
      .then((answer) => {
        setView(answer);
        setNow(Date.now());
        return answer;
      })
      .catch((cause: unknown) => {
        const words = calendarRefusal(cause);
        const field = refusedField(cause);
        if (field === undefined) setError(words);
        else setFieldError({ field, words });
        return undefined;
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const set = (patch: Partial<CalendarForm>): void => {
    setForm((current) => (current === undefined ? current : { ...current, ...patch }));
    setFieldError(undefined);
  };

  const setRule = (at: number, patch: Partial<RuleRow>): void => {
    set({ rules: form.rules.map((r, i) => (i === at ? { ...r, ...patch } : r)) });
  };

  const save = (): void => {
    setChecked(true);
    if (hasProblems(problems)) return;
    const sent = inputOf(form, view.enabled);
    // Gone from the form whatever the answer: kept nowhere, shown never again.
    // The form's own checks rest until the next Save, so a refusal is the
    // server's words alone, not a blank secret's.
    set({ secret: '' });
    setChecked(false);
    void run('save', () => saveCalendarSource(sent)).then((answer) => {
      if (answer !== undefined) setForm(formOf(answer));
    });
  };

  const flip = (on: boolean): void => {
    void run('switch', () => saveCalendarSource(switchInput(view, on)));
  };

  const disconnect = (): void => {
    void confirm({
      title: 'Disconnect Outlook?',
      body: 'Laika forgets the tenant, client ID and secret, and stops reading calendars. Meetings already logged stay on people’s days as their time.',
      confirmLabel: 'Disconnect',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy('disconnect');
      setError(undefined);
      disconnectCalendarSource()
        .then(() => getCalendarSource())
        .then((answer) => {
          setView(answer);
          setForm(formOf(answer));
          setChecked(false);
        })
        .catch((cause: unknown) => {
          setError(calendarRefusal(cause));
        })
        .finally(() => {
          setBusy(undefined);
        });
    });
  };

  const ago = (at: number): string => timeLabel(at, now).text;
  const errorFor = (field: string): string | undefined =>
    fieldError?.field === field ? fieldError.words : undefined;
  const spaceOptions: DropdownOption[] = spaces.map((p) => ({
    value: p.slug,
    label: p.name,
    keywords: p.slug,
  }));
  const test = view.last_test;

  return (
    <section
      className="org-card org-cal"
      aria-labelledby="org-cal"
      data-section="calendar"
      data-calendar-status={statusWord(view)}
    >
      <header className="org-card-head">
        <h2 id="org-cal">Outlook calendar</h2>
        <span className="org-count" data-configured={view.configured}>
          {statusWord(view)}
        </span>
      </header>

      <p className="org-note org-hr-lead" data-calendar-lead>
        Every {String(view.sync_every_minutes)} minutes, the meetings each person accepted or
        organised in Outlook are logged on their My day as confirmed time, as meetings — yesterday,
        today and tomorrow. Laika keeps the subject and the times only, never join links, the
        meeting’s text or who else was invited; a private meeting is logged as “Busy”. Tentative,
        declined, cancelled, free and all-day ones are left out. Anyone can change or delete their
        own, and once they do, later syncs leave it alone.
      </p>

      <div className="org-hr-body">
        <span className="org-cal-switch" data-calendar-switch>
          <span className="org-cal-switch-label" id="org-cal-switch-label">
            Log meetings automatically
          </span>
          <Switch
            checked={view.enabled}
            labelledBy="org-cal-switch-label"
            describedBy="org-cal-switch-note"
            disabled={!view.configured || busy !== undefined}
            onChange={flip}
          >
            {view.enabled ? 'On' : 'Off'}
          </Switch>
          <span className="org-fact-note" id="org-cal-switch-note">
            {view.configured
              ? view.enabled
                ? 'On: meetings are logged at every sync.'
                : 'Off: nothing is read or logged. Test the connection first, then turn it on.'
              : 'Save the app’s tenant, client ID and secret first.'}
          </span>
        </span>

        <form
          className="org-hr-form org-cal-form"
          aria-label="Outlook calendar settings"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextInput
            label="Directory (tenant) ID"
            value={form.tenantId}
            onChange={(value) => {
              set({ tenantId: value });
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            appearance="code"
            error={shown?.tenantId ?? errorFor('tenant_id')}
            help="From the app registration’s overview in Microsoft Entra."
            required
          />
          <TextInput
            label="Application (client) ID"
            value={form.clientId}
            onChange={(value) => {
              set({ clientId: value });
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            appearance="code"
            error={shown?.clientId ?? errorFor('client_id')}
            required
          />
          <PasswordInput
            label="Client secret"
            value={form.secret}
            onChange={(value) => {
              set({ secret: value });
            }}
            autoComplete="new-password"
            error={shown?.secret ?? errorFor('client_secret')}
            help={
              view.secret_last4 === null
                ? 'The secret’s value from Certificates & secrets. Laika keeps it encrypted and shows only its last four.'
                : `Saved, ending ···${view.secret_last4}. Leave blank to keep it; paste a new one to replace it.`
            }
            required={view.secret_last4 === null}
          />

          <fieldset className="org-cal-rules" data-calendar-rules>
            <legend className="org-cal-rules-head">Spaces by meeting</legend>
            <span className="org-fact-note">
              A meeting whose title or Teams channel matches a rule goes on that space; the first
              match wins. One that matches none is logged on no space.
            </span>
            {form.rules.length > 0 && (
              <ul className="org-cal-rule-list">
                {form.rules.map((rule, i) => {
                  const problem = shown?.rules[i];
                  const textLabel =
                    rule.kind === 'title'
                      ? `Words in the title, rule ${String(i + 1)}`
                      : `Channel name, rule ${String(i + 1)}`;
                  return (
                    <li
                      // Rows have no id of their own; each is edited in place.
                      key={i}
                      className="org-cal-rule"
                      data-calendar-rule={i}
                      data-invalid={problem === undefined ? undefined : ''}
                    >
                      <Dropdown<CalendarRuleKind>
                        className="org-cal-rule-kind"
                        aria-label={`Match, rule ${String(i + 1)}`}
                        value={rule.kind}
                        options={RULE_KINDS}
                        disabled={busy !== undefined}
                        onChange={(kind) => {
                          setRule(i, { kind });
                        }}
                      />
                      <input
                        className="input org-cal-rule-text"
                        type="text"
                        value={rule.text}
                        aria-label={textLabel}
                        aria-invalid={problem === undefined ? undefined : true}
                        placeholder={rule.kind === 'title' ? 'standup' : 'General'}
                        autoComplete="off"
                        disabled={busy !== undefined}
                        onChange={(event) => {
                          setRule(i, { text: event.target.value });
                        }}
                      />
                      <Dropdown
                        className="org-cal-rule-space"
                        aria-label={`Space, rule ${String(i + 1)}`}
                        noun="spaces"
                        value={rule.project}
                        placeholder="Pick a space"
                        options={spaceOptions}
                        disabled={busy !== undefined}
                        onChange={(project) => {
                          setRule(i, { project });
                        }}
                      />
                      <span className="org-cal-rule-remove">
                        <IconButton
                          icon="trash"
                          label={`Remove rule ${String(i + 1)}`}
                          variant="ghost"
                          size="sm"
                          disabled={busy !== undefined}
                          onClick={() => {
                            set({ rules: form.rules.filter((_, j) => j !== i) });
                          }}
                        />
                      </span>
                      {problem !== undefined && (
                        <span className="org-fact-error org-cal-rule-problem">{problem}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {errorFor('rules') !== undefined && (
              <span className="org-fact-error" role="alert">
                {errorFor('rules')}
              </span>
            )}
            <span className="org-break-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="plus"
                disabled={busy !== undefined || form.rules.length >= MAX_RULES}
                onClick={() => {
                  set({ rules: [...form.rules, blankRule()] });
                }}
              >
                Add a rule
              </Button>
            </span>
          </fieldset>

          <span className="org-break-actions">
            <Button type="submit" busy={busy === 'save'} disabled={!changed || busy !== undefined}>
              Save
            </Button>
            {changed && (
              <Button
                variant="secondary"
                disabled={busy !== undefined}
                onClick={() => {
                  setForm(formOf(view));
                  setChecked(false);
                  setFieldError(undefined);
                }}
              >
                Discard changes
              </Button>
            )}
          </span>
        </form>

        {view.configured && (
          <div className="org-cal-check" data-calendar-test>
            <span className="org-cal-check-head">Connection</span>
            {test === null ? (
              <span className="org-fact-note">
                Not tested yet. A test asks Microsoft for a token with the saved details and reads
                which permissions it carries — it reads no calendar, and works with the switch off.
              </span>
            ) : (
              <>
                <span
                  className="org-cal-verdict"
                  data-calendar-granted={test.calendars_read}
                  data-tone={test.calendars_read ? undefined : 'warning'}
                >
                  {testVerdict(test)} Tested {ago(test.at)}.
                </span>
                <span className="org-fact-note org-cal-roles" data-calendar-roles>
                  Permissions on the token: {rolesLine(test)}.
                </span>
                {!test.calendars_read && (
                  <span className="org-fact-note org-hr-warning" data-calendar-grant>
                    {GRANT_STEP}
                  </span>
                )}
              </>
            )}
            {changed && (
              <span className="org-fact-note">
                A test uses the saved details — save your changes first.
              </span>
            )}
            <span className="org-break-actions">
              <Button
                variant="secondary"
                busy={busy === 'test'}
                disabled={busy !== undefined}
                onClick={() => {
                  void run('test', testCalendarSource);
                }}
              >
                Test connection
              </Button>
            </span>
          </div>
        )}

        {view.configured && (
          <div className="org-cal-check" data-calendar-sync>
            <span className="org-cal-check-head">Sync</span>
            <span className="org-hr-sync" data-calendar-last>
              {view.last_attempt_at === null ? (
                view.enabled ? (
                  'No sync has finished yet.'
                ) : (
                  'No sync yet — the switch is off.'
                )
              ) : view.last_error !== null ? (
                <>
                  <span
                    className="org-hr-sync-error"
                    data-calendar-sync-error={view.last_error.code}
                  >
                    Last sync {ago(view.last_attempt_at)} failed:{' '}
                    {calendarSyncErrorWords(view.last_error)}.
                  </span>
                  {view.last_success_at !== null && view.last_result !== null && (
                    <span className="org-fact-note">
                      Last good sync {ago(view.last_success_at)}: {countsLine(view.last_result)}.
                    </span>
                  )}
                </>
              ) : (
                <span data-calendar-counts>
                  Last sync {ago(view.last_success_at ?? view.last_attempt_at)}
                  {view.last_result === null ? '.' : `: ${countsLine(view.last_result)}.`}
                </span>
              )}
            </span>
            <span className="org-break-actions">
              {view.enabled && (
                <Button
                  variant="secondary"
                  busy={busy === 'sync'}
                  disabled={busy !== undefined}
                  onClick={() => {
                    void run('sync', syncCalendarSource);
                  }}
                >
                  Sync now
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
          </div>
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
