import type { ReactNode } from 'react';
import { AuthCard } from '../../components/auth/AuthCard.tsx';
import { AuthAlert, AuthSummary } from '../../components/auth/AuthSummary.tsx';
import { MicrosoftMark } from '../../components/auth/MicrosoftMark.tsx';
import { BrandLockup } from '../../components/brand/BrandLockup.tsx';
import { Button } from '../../components/forms/Button.tsx';
import './auth.css';

export interface MicrosoftSignInScreenProps {
  /** The instance this signs into, always visible, as on the password form. */
  readonly host: string;
  readonly title: string;
  /** Under the heading: what this step is for. */
  readonly lead?: ReactNode;
  /** The one action's words. */
  readonly action?: string;
  readonly onSignIn?: (() => void) | undefined;
  /** The browser is on its way to Microsoft. */
  readonly busy?: boolean;
  /** Why the last attempt did not sign anyone in, in words. */
  readonly error?: string | undefined;
  /**
   * Good news to say first — *Laika is set up* after first boot. Shown above
   * the action in the same live region as an error, never beside one.
   */
  readonly notice?: string | undefined;
  /** The closing line under the button. */
  readonly note?: ReactNode;
  /**
   * Whether the action goes to Microsoft — the default. `false` for a screen
   * whose one action is something else (a link invite's *Back to sign-in*):
   * then there is no Microsoft mark and no "you'll come back" line.
   */
  readonly toMicrosoft?: boolean;
}

/**
 * **Sign in with Microsoft** (LAI-1238) — what the sign-in, invite and
 * first-boot screens draw on an SSO-only instance. Layout and states only,
 * no network, like `LoginScreen`: the route beside it owns the redirect.
 *
 * One lockup, one heading, one action, and **one sentence about what happens
 * next** — the click leaves Laika for Microsoft's page, which is the moment
 * someone hesitates if nothing said it would. While the browser is on its way
 * the button keeps its words and shows the spinner (the busy rule, LAI-293),
 * and the line under it says where it is going.
 *
 * **No email or password field**: the instance has no password to check, and
 * a field that cannot work is a door drawn on a wall.
 */
export function MicrosoftSignInScreen({
  host,
  title,
  lead,
  action = 'Sign in with Microsoft',
  onSignIn,
  busy = false,
  error,
  notice,
  note,
  toMicrosoft = true,
}: MicrosoftSignInScreenProps) {
  const state = error !== undefined ? 'sso-error' : notice !== undefined ? 'sso-ready' : 'sso';
  return (
    <div className="auth-signin">
      <AuthCard data-auth-state={state}>
        <div className="auth-form auth-sso" aria-labelledby="sso-title" role="group">
          <BrandLockup size="lg" className="auth-brand" />

          <header className="auth-head">
            <h1 className="auth-title" id="sso-title">
              {title}
            </h1>
            <p className="auth-host">
              <svg
                className="auth-lock"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>{host}</span>
            </p>
            {lead !== undefined && <p className="auth-sso-lead">{lead}</p>}
          </header>

          <AuthSummary>
            {error !== undefined ? (
              <AuthAlert>{error}</AuthAlert>
            ) : (
              notice !== undefined && (
                <p className="auth-sso-notice" data-auth-notice="">
                  {notice}
                </p>
              )
            )}
          </AuthSummary>

          <div className="auth-sso-action">
            <Button
              type="button"
              fullWidth
              busy={busy}
              {...(toMicrosoft ? { leading: <MicrosoftMark /> } : {})}
              onClick={() => {
                if (!busy) onSignIn?.();
              }}
            >
              {action}
            </Button>
            {toMicrosoft && (
              <p className="auth-sso-next" role="status">
                {busy
                  ? 'Opening Microsoft’s sign-in page…'
                  : 'You’ll sign in on Microsoft’s page, then come straight back here.'}
              </p>
            )}
          </div>

          {note !== undefined && <p className="auth-note">{note}</p>}
        </div>
      </AuthCard>
    </div>
  );
}
