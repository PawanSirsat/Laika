import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
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
import type { AgentClient } from '../../../api/agent-clients.ts';
import { compactTokens, exactTokens } from '../../../api/usage.ts';
import { agentLabel } from '../profile/activity-derive.ts';

/** The collector's command (LAI-752): it checks collection is on first, then installs. */
export const ACTIVITY_COMMAND = 'laika activity on';

/**
 * What the organisation collects, in the notice (D-102 amended, LAI-964) —
 * word for word what `laika activity on` / `status` / `sync` print, which
 * `cli/test/activity-command.test.ts` holds.
 */
export const COLLECTED =
  'per-day counts of your prompts, agent sessions and commits, and your agents’ token counts';

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

/** `Thu 15 Oct` — a held day, as a date; `Mon 13 Oct 2025` when not this year (LAI-751). */
function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const label = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return thisYear ? label : `${label} ${String(date.getUTCFullYear())}`;
}

/**
 * Connect's *Share local activity* (D-079, LAI-751): what the developer's
 * machine sends, and a look at what the server holds for them.
 *
 * **Collection is the organisation's** since D-102 (amended, LAI-964): with
 * *Developer insights* on, every connected machine is collected, so there is
 * no switch of the person's here — a plain notice instead, saying what is
 * collected and who can see it, never silence. The scope and the delete stay
 * the developer's, web-session-only on the server, so no agent can do either
 * for its person. With the organisation's switch off nothing is collected, and
 * this says so.
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

  const change = (next: { scope: LocalActivityScope }): void => {
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
          'activity loses its GitHub and Local history. This cannot be undone. Collection carries ' +
          'on while your organisation has Developer insights on.',
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
            Commits count from the day collection starts on your machine, and merge commits never
            count.
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
          <strong>Developer insights are off for this organisation</strong>, so nothing is collected
          from your machine.{' '}
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
          <p className="conn-note share-collects" data-state="org-collects">
            <strong>Your organisation collects your local activity:</strong> {COLLECTED}. Owners and
            admins can see it, and you can see who looked.{' '}
            <a href="#share-held">See what the board holds for you</a>, and your own time on{' '}
            <a href="/my-day">My day</a>.{' '}
            {canManageOrg ? (
              <>
                You can turn Developer insights off in{' '}
                <a href="/organisation?tab=overview">Organisation</a>.
              </>
            ) : (
              'Only an owner or admin can turn it off.'
            )}
          </p>

          <fieldset className="share-scope" disabled={busy}>
            <legend className="share-h">Count work in {busy && <Spinner size="sm" />}</legend>
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

      <section className="share-held" id="share-held" aria-labelledby="share-held-title">
        <h3 className="share-h" id="share-held-title">
          What the board holds for you · last 14 days
        </h3>
        {held.days.length === 0 ? (
          <p className="conn-note" data-state="nothing-held">
            {deleted ? 'Deleted. ' : ''}Nothing held for you in these 14 days
            {held.oldest_day === null ? ', and nothing older.' : '.'}
          </p>
        ) : (
          <table className="share-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Prompts</th>
                <th scope="col">Sessions</th>
                <th scope="col">Not pushed</th>
                <th scope="col">Pushed</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {held.days.map((day) => {
                const prompts = (Object.entries(day.prompts_by_agent) as [AgentClient, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, n]) => `${agentLabel(kind)} ${String(n)}`)
                  .join(', ');
                return (
                  <tr key={day.day}>
                    <th scope="row">{dayLabel(day.day)}</th>
                    <td>{prompts === '' ? '0' : prompts}</td>
                    <td>{day.sessions}</td>
                    <td>{day.commits_local}</td>
                    <td>{day.pushed_commits}</td>
                    <td
                      title={`${exactTokens(day.tokens)} tokens, ${exactTokens(day.cache_read)} cache reads`}
                    >
                      {compactTokens(day.tokens)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
