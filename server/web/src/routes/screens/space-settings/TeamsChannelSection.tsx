import { useEffect, useState } from 'react';
import {
  channelLine,
  clearProjectTeamsChannel,
  getProjectTeams,
  postKindWords,
  postOutcomeWords,
  postTone,
  type ProjectTeams,
  sendTeamsTestPost,
  setProjectTeamsChannel,
  teamsRefusal,
  type TeamsPost,
  whenLabel,
} from '../../../api/teams.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';

export interface TeamsChannelSectionProps {
  readonly slug: string;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly teams: ProjectTeams };

/**
 * The space's Teams channel on Settings → General (D-154, LAI-1314), for a
 * holder of `org.teams.configure` — owners and admins by default.
 *
 * **The address goes in and never comes back.** The field is always empty;
 * once saved, the card names the flow's host and the address's last four
 * characters, and replacing it is pasting a new one. *Send test post* goes
 * whether the organisation's posting is on or off — it is how an owner knows
 * the flow accepts posts before turning posting on. Below, the newest posts
 * to this space and what came of each, the held-back ones included.
 */
export function TeamsChannelSection({ slug }: TeamsChannelSectionProps) {
  const confirm = useConfirm();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tested, setTested] = useState<TeamsPost | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    getProjectTeams(slug, controller.signal)
      .then((teams) => {
        setRead({ kind: 'ready', teams });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const reload = (): void => {
    getProjectTeams(slug)
      .then((teams) => {
        setRead({ kind: 'ready', teams });
      })
      .catch(() => {
        // The card keeps what it showed; the action's own answer was said.
      });
  };

  const save = (): void => {
    setBusy('save');
    setError(undefined);
    setTested(undefined);
    setProjectTeamsChannel(slug, address)
      .then((teams) => {
        setRead({ kind: 'ready', teams });
        setAddress('');
      })
      .catch((cause: unknown) => {
        setError(teamsRefusal(cause));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const test = (): void => {
    setBusy('test');
    setError(undefined);
    setTested(undefined);
    sendTeamsTestPost(slug)
      .then((post) => {
        setTested(post);
        reload();
      })
      .catch((cause: unknown) => {
        setError(teamsRefusal(cause));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const clear = (): void => {
    void confirm({
      title: 'Remove this space’s Teams channel?',
      body: 'Nothing more is posted for this space until a new address is saved. The flow in Power Automate is not touched.',
      confirmLabel: 'Remove channel',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy('clear');
      setError(undefined);
      setTested(undefined);
      clearProjectTeamsChannel(slug)
        .then(() => {
          reload();
        })
        .catch((cause: unknown) => {
          setError(teamsRefusal(cause));
        })
        .finally(() => {
          setBusy(null);
        });
    });
  };

  const channel = read.kind === 'ready' ? read.teams.channel : null;

  return (
    <section className="ss-card ss-teams" aria-labelledby="ss-teams-title" data-teams-section>
      <header className="ss-card-head">
        <h2 id="ss-teams-title">Microsoft Teams</h2>
        <p>Where this space’s stand-ups, nightly digest and notices are posted.</p>
      </header>
      <div className="ss-teams-body">
        {read.kind === 'loading' && (
          <LoadingState shape="row" count={3} label="Loading the Teams channel" />
        )}
        {read.kind === 'error' && (
          <ApiErrorState
            error={read.error}
            resource="this space’s Teams channel"
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {read.kind === 'ready' && (
          <>
            {!read.teams.posting_enabled && (
              <p className="ss-notice" data-teams-off>
                Teams posting is off for the organisation, so nothing is posted; what would have
                gone is listed below as held back. An owner or admin turns it on under Organisation
                → Integrations.
              </p>
            )}

            <p className="ss-teams-channel" data-teams-channel={channel === null ? 'none' : 'set'}>
              {channel === null ? (
                'No channel: nothing is posted for this space.'
              ) : (
                <>
                  <span className="ss-teams-label">Posting to</span>{' '}
                  <code className="ss-teams-host">{channelLine(channel)}</code>
                  <span className="ss-teams-set">
                    {channel.set_by === null ? 'Set' : `Set by ${channel.set_by.name}`},{' '}
                    {whenLabel(channel.set_at)}
                  </span>
                </>
              )}
            </p>

            <form
              className="ss-teams-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (address.trim() !== '' && busy === null) save();
              }}
            >
              <TextInput
                label={channel === null ? 'Power Automate webhook URL' : 'Replace the webhook URL'}
                type="url"
                appearance="code"
                value={address}
                onChange={setAddress}
                autoComplete="off"
                placeholder="https://…powerplatform.com/powerautomate/…"
                help="The HTTP POST URL from the flow’s trigger. Laika keeps it encrypted and never shows it again."
              />
              <div className="ss-teams-actions">
                <Button
                  type="submit"
                  variant="primary"
                  busy={busy === 'save'}
                  disabled={address.trim() === '' || (busy !== null && busy !== 'save')}
                >
                  Save address
                </Button>
                <Button
                  variant="secondary"
                  busy={busy === 'test'}
                  disabled={channel === null || (busy !== null && busy !== 'test')}
                  disabledReason={channel === null ? 'Save an address first' : undefined}
                  onClick={test}
                >
                  Send test post
                </Button>
                {channel !== null && (
                  <Button
                    variant="danger"
                    busy={busy === 'clear'}
                    disabled={busy !== null && busy !== 'clear'}
                    onClick={clear}
                  >
                    Remove channel
                  </Button>
                )}
              </div>
            </form>

            {tested !== undefined && (
              <p
                className="ss-teams-tested"
                role="status"
                data-teams-tested
                data-tone={postTone(tested)}
              >
                Test post: {postOutcomeWords(tested)}.
              </p>
            )}
            {error !== undefined && (
              <p className="ss-field-error" role="alert" data-error="teams">
                {error}
              </p>
            )}

            <div className="ss-teams-recent">
              <h3 className="ss-teams-recent-head">Recent posts</h3>
              {read.teams.recent.length === 0 ? (
                <p className="ss-help">None yet.</p>
              ) : (
                <ul className="ss-teams-posts" aria-label="Recent Teams posts">
                  {read.teams.recent.map((post) => (
                    <li key={post.id} className="ss-teams-post" data-tone={postTone(post)}>
                      <span className="ss-teams-post-kind">{postKindWords(post)}</span>
                      <span className="ss-teams-post-title">{post.title}</span>
                      <span className="ss-teams-post-outcome">
                        {postOutcomeWords(post)} · {whenLabel(post.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
