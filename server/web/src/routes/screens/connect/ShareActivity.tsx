import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { ApiError } from '../../../api/errors.ts';
import {
  deleteOwnLocalActivity,
  getActivitySharing,
  getOwnLocalActivity,
  LOCAL_ACTIVITY_SCOPES,
  otelEnvBlock,
  setActivitySharing,
  type ActivitySharing,
  type LocalActivityScope,
  type OwnLocalActivity,
} from '../../../api/local-activity.ts';
import { dayLabel, HeldDays } from './HeldDays.tsx';

/** The collector's command (LAI-752): it checks sharing first, then installs. */
export const ACTIVITY_COMMAND = 'laika activity on';

const SCOPES: Readonly<Record<LocalActivityScope, { label: string; hint: string }>> = {
  'agent-repos': {
    label: 'Every repo where I use an agent',
    hint: 'Any repository on this machine where you run a connected agent. Nothing scans your disk.',
  },
  'laika-repos': {
    label: 'Only repos set up for Laika',
    hint: 'Only repositories carrying the project block from “Share with your project”.',
  },
};

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly sharing: ActivitySharing;
      readonly held: OwnLocalActivity;
    };

function said(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

/**
 * Connect's *Share local activity* (D-079, LAI-751): the signed-in
 * developer's own consent to send daily counts from their machine, and a look
 * at what the server holds for them.
 *
 * Everything here is the developer's alone: the switch, the scope and the
 * delete are web-session-only on the server, so no agent can do any of them
 * for its person. With the organisation's switch off there is nothing to turn
 * on, and this says so instead of offering a control that would do nothing.
 */
export function ShareActivity({
  canManageOrg,
  origin = window.location.origin,
}: {
  readonly canManageOrg: boolean;
  /** This board's address, for the OpenTelemetry block (LAI-773). */
  readonly origin?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deleted, setDeleted] = useState(false);
  const commandRef = useRef<HTMLPreElement | null>(null);
  const otelRef = useRef<HTMLPreElement | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    Promise.all([getActivitySharing(signal), getOwnLocalActivity(signal)])
      .then(([sharing, held]) => {
        setState({ kind: 'ready', sharing, held });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setState({
          kind: 'error',
          message: said(cause, 'Your sharing setting could not be read.'),
        });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div className="conn-extra share-activity" data-extra="activity" aria-busy="true">
        <Spinner size="sm" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="conn-extra share-activity" data-extra="activity">
        <p className="conn-note conn-note-warn" role="alert">
          {state.message}
        </p>
      </div>
    );
  }

  const { sharing, held } = state;

  const change = (next: { enabled?: boolean; scope?: LocalActivityScope }): void => {
    setBusy(true);
    setError(undefined);
    setActivitySharing(next)
      .then((answer) => {
        setState({ kind: 'ready', sharing: answer, held });
      })
      .catch((cause: unknown) => {
        setError(said(cause, 'That change did not go through.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const erase = (): void => {
    if (
      !window.confirm(
        'Delete every daily count and commit key the board holds for you? Your profile’s ' +
          'activity loses its GitHub and Local history. This cannot be undone. Sharing stays as ' +
          'it is.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    deleteOwnLocalActivity()
      .then(() => getOwnLocalActivity())
      .then((answer) => {
        setDeleted(true);
        setState({ kind: 'ready', sharing, held: answer });
      })
      .catch((cause: unknown) => {
        setError(said(cause, 'The history was not deleted.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="conn-extra share-activity" data-extra="activity">
      <p className="conn-body">
        Your own machine can send daily counts to your profile’s <strong>Activity</strong> — so the
        board shows the work that happens before a task moves — and your agents’ token counts to{' '}
        <strong>Usage</strong>. Owners and admins see them on your profile; they never feed a rating
        or a score.
      </p>

      <div className="share-lists">
        <div>
          <h3 className="share-h">What is sent, per day</h3>
          <ul className="share-list" data-list="sent">
            <li>How many prompts you sent, per agent</li>
            <li>How many agent sessions you started</li>
            <li>How many of your commits are not on any remote yet</li>
            <li>A one-way key for each commit already pushed, so it counts once</li>
            <li>
              Your agents’ token counts per agent and model — input, output and cache — from their
              own session files (Claude Code, Codex, Gemini CLI), and the Laika task they were spent
              on, by its key alone: the task your agent marked, or the one your branch is named for
            </li>
          </ul>
          <p className="conn-note">
            Commits count from the day you turn sharing on, and merge commits never count.
          </p>
        </div>
        <div>
          <h3 className="share-h">Never sent</h3>
          <ul className="share-list" data-list="never">
            <li>Prompt text, or anything an agent wrote</li>
            <li>File names, repository names or paths</li>
            <li>Remote URLs, branch names or session ids</li>
            <li>Commit messages, author emails or commit ids</li>
          </ul>
        </div>
      </div>

      {!sharing.org_enabled ? (
        <p className="conn-note conn-note-warn" data-state="org-off">
          <strong>Developer insights are off for this organisation</strong>, so there is nothing to
          turn on yet.{' '}
          {canManageOrg ? (
            <>
              You can turn them on in <a href="/organisation?tab=overview">Organisation</a>.
            </>
          ) : (
            'An owner or admin can turn them on.'
          )}
        </p>
      ) : (
        <>
          <div className="share-row">
            <Switch
              checked={sharing.enabled}
              describedBy="share-switch-note"
              disabled={busy}
              onChange={(enabled) => {
                change({ enabled });
              }}
            >
              Share my local activity
            </Switch>
            {busy && <Spinner size="sm" />}
          </div>
          <p className="conn-note" id="share-switch-note">
            {sharing.enabled
              ? 'On. Turning it off stops every machine of yours at once; what is already held stays until you delete it.'
              : 'Off. Nothing leaves your machine until you turn this on.'}
          </p>

          <fieldset className="share-scope" disabled={busy}>
            <legend className="share-h">Count work in</legend>
            {LOCAL_ACTIVITY_SCOPES.map((scope) => (
              <label key={scope} className="share-scope-option">
                <input
                  type="radio"
                  name="share-scope"
                  value={scope}
                  checked={sharing.scope === scope}
                  onChange={() => {
                    change({ scope });
                  }}
                />
                <span>
                  <span className="share-scope-label">{SCOPES[scope].label}</span>
                  <span className="conn-note">{SCOPES[scope].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="conn-block">
            <div className="conn-block-bar">
              <span className="conn-block-label" id="share-command-label">
                Then, on each machine — carries no token
              </span>
              <CopyButton text={ACTIVITY_COMMAND} selects={commandRef} what="the command" />
            </div>
            <pre
              className="conn-pre"
              ref={commandRef}
              tabIndex={0}
              aria-labelledby="share-command-label"
            >
              {ACTIVITY_COMMAND}
            </pre>
          </div>

          {/* LAI-773: the OpenTelemetry fallback. Metrics only, with this
              board's address and no token; `laika activity on` writes it (LAI-867). */}
          <section className="share-otel" aria-labelledby="share-otel-title" data-block="otel">
            <h3 className="share-h" id="share-otel-title">
              OpenTelemetry (optional)
            </h3>
            <p className="conn-note">
              <code>laika activity on</code>, above, also has Claude Code send its own token metrics
              here, from every Claude Code on the laptop — started from the Dock or by Omnigent
              included — with no shell line. They fill in what its session files miss — titles,
              classifiers, compaction — matched session by session, so nothing counts twice.{' '}
              <strong>Metrics only</strong>: Laika refuses logs and traces, which can carry prompt
              text. The token is never written: a helper reads it from <code>~/.laika/env</code>{' '}
              each time. <code>laika activity status</code> says whether they reach this board.
            </p>
            <div className="conn-block">
              <div className="conn-block-bar">
                <span className="conn-block-label" id="share-otel-label">
                  What it writes to ~/.claude/settings.json — no token
                </span>
                <CopyButton
                  text={otelEnvBlock(origin)}
                  selects={otelRef}
                  what="the OpenTelemetry settings"
                />
              </div>
              <pre
                className="conn-pre"
                ref={otelRef}
                tabIndex={0}
                aria-labelledby="share-otel-label"
                data-otel
              >
                {otelEnvBlock(origin)}
              </pre>
            </div>
          </section>
        </>
      )}

      <section className="share-held" aria-labelledby="share-held-title">
        <h3 className="share-h" id="share-held-title">
          What the board holds for you · last 14 days
        </h3>
        {held.days.length === 0 ? (
          <p className="conn-note" data-state="nothing-held">
            {deleted ? 'Deleted. ' : ''}Nothing held for you in these 14 days
            {held.oldest_day === null ? ', and nothing older.' : '.'}
          </p>
        ) : (
          <HeldDays held={held} />
        )}
        {held.oldest_day !== null && (
          <p className="conn-note">
            Held since {dayLabel(held.oldest_day)} · from{' '}
            {held.collectors === 1 ? 'one machine' : `${String(held.collectors)} machines`} in these
            days · kept 400 days, then deleted.
          </p>
        )}
        {held.oldest_day !== null && (
          <button
            type="button"
            className="conn-outline share-delete"
            disabled={busy}
            onClick={erase}
          >
            Delete my local-activity history
          </button>
        )}
      </section>

      {error !== undefined && (
        <p className="conn-note conn-note-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
