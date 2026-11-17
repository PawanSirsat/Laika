import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  directoryErrorWords,
  getSsoSettings,
  meetingsCount,
  meetingsErrorWords,
  syncDirectoryNow,
  syncMeetingsNow,
  type SsoMicrosoft,
  type SsoSettings,
} from '../../../api/sso.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';

/**
 * **Sign-in**, at the top of Organisation → Security (LAI-1239): how this
 * instance signs people in, and the Microsoft directory sync.
 *
 * Read only, apart from *Sync now*, on purpose: SSO is set by environment so
 * that a broken identity provider is recovered by unsetting variables, never
 * by a switch that sits behind the sign-in that broke. So each fact says where
 * it is set, and the one thing an owner has to copy into Entra — the redirect
 * URI — has a copy button.
 */
export function SsoSection() {
  const [view, setView] = useState<SsoSettings | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const now = Date.now();

  useEffect(() => {
    const controller = new AbortController();
    getSsoSettings(controller.signal)
      .then(setView)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not read the sign-in settings.',
        );
      });
    return () => {
      controller.abort();
    };
  }, []);

  const head = (chip: string, on: boolean) => (
    <header className="org-card-head">
      <h2 id="org-sso">Sign-in</h2>
      <span className="org-count" data-configured={on}>
        {chip}
      </span>
    </header>
  );

  if (view === undefined) {
    return (
      <section className="org-card org-sso" aria-labelledby="org-sso" data-section="sso">
        {head(error === undefined ? 'reading…' : 'unavailable', false)}
        {error !== undefined && <p className="org-note">{error}</p>}
      </section>
    );
  }

  const ms = view.microsoft;
  if (ms === null) {
    return (
      <section
        className="org-card org-sso"
        aria-labelledby="org-sso"
        data-section="sso"
        data-sso="email"
      >
        {head('email and password', false)}
        <p className="org-note org-sso-lead">
          People sign in with their email and a password. To use Microsoft work accounts instead,
          set
          <code> LAIKA_MICROSOFT_CLIENT_ID</code>, <code>LAIKA_MICROSOFT_CLIENT_SECRET</code> and
          <code> LAIKA_MICROSOFT_TENANT_ID</code> on the server and restart — passwords then stop
          working, and everyone signs in with Microsoft.
        </p>
      </section>
    );
  }

  const sync = ms.directory_sync;
  const run = sync.last_run;

  return (
    <section
      className="org-card org-sso"
      aria-labelledby="org-sso"
      data-section="sso"
      data-sso="microsoft"
    >
      {head('Microsoft only', true)}
      <p className="org-note org-sso-lead">
        Everyone signs in with their Microsoft work account; there are no Laika passwords. This is
        set on the server, not here — unset the <code>LAIKA_MICROSOFT_*</code> variables and restart
        to bring passwords back.
      </p>

      <dl className="org-sso-facts">
        <div className="org-sso-fact">
          <dt>Directory (tenant)</dt>
          <dd>
            <code>{ms.tenant_id}</code>
          </dd>
        </div>
        <div className="org-sso-fact">
          <dt>App (client) ID</dt>
          <dd>
            <code>{ms.client_id}</code>
          </dd>
        </div>
        <div className="org-sso-fact">
          <dt>Redirect URI</dt>
          <dd className="org-sso-copy">
            <code data-sso-redirect>{ms.redirect_uri}</code>
            <CopyButton text={ms.redirect_uri} label="Copy redirect URI" />
          </dd>
        </div>
      </dl>
      <p className="org-note org-sso-hint">
        Register the redirect URI in Entra as a <strong>Web</strong> platform redirect, exactly as
        shown.
      </p>

      <div className="org-sso-sync" data-directory-sync={sync.enabled ? 'on' : 'off'}>
        <h3 className="org-sso-sub">Directory sync</h3>
        {sync.enabled ? (
          <>
            <p className="org-note org-sso-lead">
              Every enabled member of the Microsoft directory joins Laika as a Member, every{' '}
              {String(sync.every_minutes)} minutes. Guests and disabled accounts are left out, and
              nobody already here is changed.
            </p>
            {run === null ? (
              <p className="org-sso-run" data-sync-run="none">
                Not run since the server started.
              </p>
            ) : run.ok ? (
              <p className="org-sso-run" data-sync-run="ok">
                Last synced {timeLabel(run.at, now).text}: {String(run.added)} added,{' '}
                {String(run.existing)} already here.
              </p>
            ) : (
              <p className="org-sso-run org-sso-run-failed" data-sync-run="failed" role="alert">
                Last sync failed {timeLabel(run.at, now).text}.{' '}
                {directoryErrorWords(run.error ?? '')}
              </p>
            )}
            <span className="org-break-actions">
              <Button
                variant="secondary"
                busy={syncing}
                onClick={() => {
                  setSyncing(true);
                  syncDirectoryNow()
                    .then(setView)
                    .catch((cause: unknown) => {
                      setError(cause instanceof ApiError ? cause.message : 'Could not sync now.');
                    })
                    .finally(() => {
                      setSyncing(false);
                    });
                }}
              >
                Sync now
              </Button>
            </span>
            {error !== undefined && <p className="org-note">{error}</p>}
          </>
        ) : (
          <p className="org-note org-sso-lead">
            Off. Set <code>LAIKA_MICROSOFT_DIRECTORY_SYNC=true</code> and restart to add every
            enabled member of the directory automatically — the app then needs Microsoft Graph’s{' '}
            <code>User.Read.All</code> application permission, with admin consent.
          </p>
        )}
      </div>

      <MeetingsSync
        sync={ms.meetings_sync}
        now={now}
        onSynced={(next) => {
          setView(next);
        }}
      />
    </section>
  );
}

interface MeetingsSyncProps {
  readonly sync: SsoMicrosoft['meetings_sync'];
  readonly now: number;
  readonly onSynced: (view: SsoSettings) => void;
}

/**
 * The card's **Meetings sync** block (LAI-1313): Teams meetings read through
 * Graph (LAI-1311) — on or off, how the last run went and what to fix if it
 * did not, the Graph permissions the Entra app needs (the server's list, so
 * this never drifts from what the sync asks for), and *Sync now*.
 *
 * *Sync now* ends in a toast: the server answers `200` with the run recorded
 * even when Graph refused, so the toast reads the run it answers with, not
 * the status — a refused grant is a persistent error toast with the fix.
 */
function MeetingsSync({ sync, now, onSynced }: MeetingsSyncProps) {
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const run = sync.last_run;

  const syncNow = (): void => {
    setSyncing(true);
    syncMeetingsNow()
      .then((next) => {
        onSynced(next);
        const ran = next.microsoft?.meetings_sync.last_run ?? null;
        if (ran?.ok === true) {
          toast.show({ text: `Meetings synced — ${meetingsCount(ran.meetings)}`, tone: 'success' });
          return;
        }
        toast.show({
          text: 'Meetings sync failed',
          tone: 'error',
          detail: meetingsErrorWords(ran?.error ?? 'sync_failed'),
        });
      })
      .catch((cause: unknown) => {
        toast.show({
          text: 'Couldn’t sync meetings',
          tone: 'error',
          detail: cause instanceof ApiError ? cause.message : undefined,
        });
      })
      .finally(() => {
        setSyncing(false);
      });
  };

  const permissions = (
    <ul className="org-sso-perms" data-meetings-permissions>
      {sync.permissions.map((permission) => (
        <li key={permission}>
          <code>{permission}</code>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="org-sso-sync" data-meetings-sync={sync.enabled ? 'on' : 'off'}>
      <h3 className="org-sso-sub">Meetings sync</h3>
      {sync.enabled ? (
        <>
          <p className="org-note org-sso-lead">
            Every {String(sync.every_minutes)} minutes, Laika reads the Teams meetings in each
            person’s calendar from two weeks back to one ahead: who joined, for how long, and
            whether there is a transcript. Each person sees only the meetings they were in, and a
            transcript is read from Teams when opened — never stored.
          </p>
          {run === null ? (
            <p className="org-sso-run" data-meetings-run="none">
              Not run since the server started.
            </p>
          ) : run.ok ? (
            <p className="org-sso-run" data-meetings-run="ok">
              Last synced {timeLabel(run.at, now).text}: {meetingsCount(run.meetings)}.
            </p>
          ) : (
            <p className="org-sso-run org-sso-run-failed" data-meetings-run="failed" role="alert">
              {run.meetings > 0
                ? `Last sync ${timeLabel(run.at, now).text} read ${meetingsCount(run.meetings)} but was incomplete.`
                : `Last sync failed ${timeLabel(run.at, now).text}.`}{' '}
              {meetingsErrorWords(run.error ?? 'sync_failed')}
            </p>
          )}
          <p className="org-note org-sso-hint">
            The app needs these Microsoft Graph application permissions, with admin consent, and a
            Teams application access policy that includes it:
          </p>
          {permissions}
          <span className="org-break-actions">
            <Button variant="secondary" busy={syncing} onClick={syncNow}>
              Sync now
            </Button>
          </span>
        </>
      ) : (
        <>
          <p className="org-note org-sso-lead">
            Off. Set <code>LAIKA_MICROSOFT_MEETINGS_SYNC=true</code> and restart to bring everyone’s
            Teams meetings into Laika — who joined, and their transcripts — and to add them to My
            day in a click. The app then needs these Microsoft Graph application permissions, with
            admin consent, and a Teams application access policy that includes it:
          </p>
          {permissions}
        </>
      )}
    </div>
  );
}
