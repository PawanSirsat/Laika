import { useEffect, useState } from 'react';
import {
  channelLine,
  getTeamsSettings,
  postOutcomeWords,
  postTone,
  scheduleLine,
  setTeamsPosting,
  teamsRefusal,
  type TeamsSettings,
  whenLabel,
} from '../../../api/teams.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { spaceSettingsHref } from '../../space-settings-url.ts';
import { OrgAccordion } from './OrgAccordion.tsx';

export interface TeamsPostingSectionProps {
  readonly onNavigate: (to: string) => void;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly settings: TeamsSettings };

/**
 * Teams posting on Organisation → Integrations (D-154, LAI-1314): the
 * organisation's *Teams posting on* switch, when the scheduled posts go, and
 * every space that has a channel. Drawn only for a holder of
 * `org.teams.configure` — owners and admins by default.
 *
 * **Off is how it ships.** Turning it on is this one switch; a space's
 * channel is set on that space's settings, and listed here once it is.
 */
export function TeamsPostingSection({ onNavigate }: TeamsPostingSectionProps) {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    getTeamsSettings(controller.signal)
      .then((settings) => {
        setRead({ kind: 'ready', settings });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const turn = (on: boolean): void => {
    setBusy(true);
    setError(undefined);
    setTeamsPosting(on)
      .then((settings) => {
        setRead({ kind: 'ready', settings });
      })
      .catch((cause: unknown) => {
        setError(teamsRefusal(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const on = read.kind === 'ready' && read.settings.posting_enabled;

  return (
    // Folded to one row that says its state (LAI-1318).
    <OrgAccordion
      name="teams"
      id="org-teams"
      title="Microsoft Teams"
      className="org-teams"
      section="teams"
      description="Stand-ups, the nightly digest and notices, posted to each space’s channel."
      meta={
        read.kind === 'ready' ? (
          <span className="org-status-badge" data-tone={on ? 'on' : 'off'} data-posting={on}>
            {on ? 'posting on' : 'off'}
          </span>
        ) : undefined
      }
    >
      <p className="org-note org-teams-lead">
        Each space’s stand-ups, nightly digest and notices, posted to that space’s own Power
        Automate flow in Teams. While posting is off nothing is sent, and every post that would have
        gone is listed on the space as held back.
      </p>

      {read.kind === 'loading' && (
        <LoadingState shape="row" count={3} label="Loading Teams posting" />
      )}
      {read.kind === 'error' && (
        <ApiErrorState
          error={read.error}
          resource="Teams posting"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {read.kind === 'ready' && (
        <dl className="org-facts">
          <div className="org-fact" data-fact="teams-posting">
            <dt id="org-teams-label">Teams posting</dt>
            <dd>
              <Switch
                checked={on}
                labelledBy="org-teams-label"
                describedBy="org-teams-note"
                disabled={busy}
                onChange={turn}
              >
                {on ? 'On' : 'Off'}
              </Switch>
              <span className="org-fact-note" id="org-teams-note">
                {on
                  ? 'On: every space with a channel gets its stand-ups, digest and notices.'
                  : 'Off: nothing is posted to Teams. A test post from a space still goes.'}
                {read.settings.updated_by !== null && read.settings.updated_at !== null && (
                  <>
                    {' '}
                    Turned {on ? 'on' : 'off'} by {read.settings.updated_by.name},{' '}
                    {whenLabel(read.settings.updated_at)}.
                  </>
                )}
              </span>
              {error !== undefined && (
                <span className="org-fact-error" role="alert">
                  {error}
                </span>
              )}
            </dd>
          </div>
          <div className="org-fact" data-fact="teams-schedule">
            <dt>When</dt>
            <dd>
              <span>{scheduleLine(read.settings.schedule)}</span>
              <span className="org-fact-note">
                Notices — handed over, into and back from review, done, blocked, unblocked, a
                person’s comment — go within a minute.
              </span>
            </dd>
          </div>
          <div className="org-fact" data-fact="teams-channels">
            <dt>Channels</dt>
            <dd>
              {read.settings.channels.length === 0 ? (
                <span className="org-fact-note">
                  No space has a channel yet. Set one on a space’s settings, under General.
                </span>
              ) : (
                <ul className="org-teams-channels" aria-label="Spaces with a Teams channel">
                  {read.settings.channels.map((channel) => {
                    const href = spaceSettingsHref(channel.project_slug);
                    return (
                      <li key={channel.project_id} className="org-teams-channel">
                        <a
                          className="org-teams-space"
                          href={href}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                              return;
                            }
                            event.preventDefault();
                            onNavigate(href);
                          }}
                        >
                          {channel.project_name}
                        </a>
                        <code className="org-teams-host">{channelLine(channel)}</code>
                        {channel.last_post !== null && (
                          <span className="org-teams-last" data-tone={postTone(channel.last_post)}>
                            {postOutcomeWords(channel.last_post)} ·{' '}
                            {whenLabel(channel.last_post.created_at)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      )}
    </OrgAccordion>
  );
}
