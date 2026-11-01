import { useState } from 'react';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import {
  clearGithubWebhookSecret,
  GITHUB_WEBHOOK_PATH,
  rotateGithubWebhookSecret,
  type OrgGithubWebhook,
} from '../../../api/org.ts';

/**
 * The events to tick on GitHub's *Add webhook* page, in its own words — the
 * labels GitHub shows under *Let me select individual events*.
 */
export const GITHUB_EVENTS = [
  'Pushes',
  'Pull requests',
  'Issue comments',
  'Check runs',
  'Check suites',
  'Workflow runs',
] as const;

export interface GithubWebhookSectionProps {
  readonly webhook: OrgGithubWebhook;
  /** Told when the secret is set, rotated or cleared, so the org view re-reads. */
  readonly onChanged: (configured: boolean) => void;
}

/**
 * The GitHub webhook, made usable from the web app (§10.1, LAI-753): what to
 * paste into GitHub, and the secret — set, rotated or cleared here.
 *
 * **The secret is shown once.** The server makes it and answers it to the
 * call that made it, and nothing serves it again; this component keeps it in
 * state until *Done* or until the screen is left, never anywhere else. That is
 * why `CopyButton` matters here more than anywhere: the board is plain HTTP,
 * and a Copy that copied nothing would leave somebody with a secret they can
 * no longer see.
 *
 * GitHub confirms an agent's proof through these deliveries (D-083), so the
 * section says what that buys in one line and what it costs in another:
 * GitHub does not retry a failed delivery.
 */
export function GithubWebhookSection({ webhook, onChanged }: GithubWebhookSectionProps) {
  const confirm = useConfirm();
  const [issued, setIssued] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const payloadUrl = webhook.payload_url ?? `${window.location.origin}${GITHUB_WEBHOOK_PATH}`;

  const rotate = (): void => {
    if (!webhook.configured) {
      rotateNow();
      return;
    }
    void confirm({
      title: 'Rotate the GitHub webhook secret?',
      body: 'The current one stops working at once: every delivery from GitHub is refused until you paste the new secret into the webhook on GitHub.',
      confirmLabel: 'Rotate secret',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (yes) rotateNow();
    });
  };

  const rotateNow = (): void => {
    setBusy(true);
    setError(undefined);
    rotateGithubWebhookSecret()
      .then((answer) => {
        setIssued(answer.secret);
        onChanged(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The secret could not be set.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const clear = (): void => {
    void confirm({
      title: 'Clear the GitHub webhook secret?',
      body: 'Every delivery from GitHub is refused until a new one is set, so nothing confirms an agent’s proof in the meantime.',
      confirmLabel: 'Clear secret',
      danger: true,
    }).then((yes) => {
      if (yes) clearNow();
    });
  };

  const clearNow = (): void => {
    setBusy(true);
    setError(undefined);
    clearGithubWebhookSecret()
      .then(() => {
        setIssued(undefined);
        onChanged(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The secret could not be cleared.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="org-card org-github" aria-labelledby="org-github" data-section="github">
      <header className="org-card-head">
        <h2 id="org-github">GitHub webhook</h2>
        <span className="org-count" data-configured={webhook.configured}>
          {webhook.configured ? 'secret set' : 'not set up'}
        </span>
      </header>

      <p className="org-note org-github-lead">
        GitHub tells Laika about pushes, pull requests and CI, and that is what turns an agent’s
        claimed proof into confirmed or failed on the Review page. Laika never calls GitHub; it only
        reads what GitHub sends here.
      </p>

      <dl className="org-facts org-github-setup">
        <div className="org-fact">
          <dt>Payload URL</dt>
          <dd>
            <span className="org-github-value">
              <code className="org-github-code">{payloadUrl}</code>
              <CopyButton text={payloadUrl} what="the payload URL" />
            </span>
          </dd>
        </div>
        <div className="org-fact">
          <dt>Content type</dt>
          <dd>
            <code className="org-github-code">application/json</code>
          </dd>
        </div>
        <div className="org-fact" data-fact="secret">
          <dt>Secret</dt>
          <dd>
            {issued !== undefined ? (
              <span className="org-github-secret" role="alert">
                <span className="org-github-value">
                  <code className="org-github-code" data-secret>
                    {issued}
                  </code>
                  <CopyButton text={issued} what="the webhook secret" />
                  <button
                    type="button"
                    className="org-github-done"
                    onClick={() => {
                      setIssued(undefined);
                    }}
                  >
                    Done
                  </button>
                </span>
                <span className="org-fact-note">
                  Copy it into GitHub now — it is not shown again. Laika keeps it encrypted and
                  nothing can show it to you later; if it is lost, rotate it.
                </span>
              </span>
            ) : webhook.configured ? (
              <span className="org-fact-note">
                Set, and not shown again. Rotate it to make a new one.
              </span>
            ) : (
              <span className="org-fact-note">
                Not set: every delivery from GitHub is refused until one is.
              </span>
            )}
          </dd>
        </div>
        <div className="org-fact">
          <dt>Events</dt>
          <dd>
            <span>
              <em>Let me select individual events</em>, then tick:
            </span>
            <ul className="org-github-events" aria-label="Events to tick">
              {GITHUB_EVENTS.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      <p className="org-note org-github-retry">
        GitHub does not retry a failed delivery: one sent while Laika restarts — every deploy — is
        lost unless you press <em>Redeliver</em> on the webhook’s <em>Recent Deliveries</em> page.
      </p>

      <div className="org-github-actions">
        <Button variant="secondary" busy={busy} onClick={rotate}>
          {webhook.configured ? 'Rotate secret' : 'Set secret'}
        </Button>
        {webhook.configured && (
          <Button variant="danger" disabled={busy} onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {error !== undefined && (
        <p className="org-fact-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
