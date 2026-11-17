import type { ReactNode } from 'react';
import { AuthCard } from '../../components/auth/AuthCard.tsx';
import { AuthAlert, AuthSummary } from '../../components/auth/AuthSummary.tsx';
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
  /** The closing line under the button. */
  readonly note?: ReactNode;
}

/**
 * **Sign in with Microsoft** (LAI-1238) — what the sign-in, invite and
 * first-boot screens draw on an SSO-only instance. Layout and states only,
 * no network, like `LoginScreen`: the route beside it owns the redirect.
 *
 * One lockup, one heading, one action. **No email or password field**: the
 * instance has no password to check, and a field that cannot work is a door
 * drawn on a wall.
 *
 * The mark is a four-square glyph in the text colour, not Microsoft's
 * four-colour logo: the theme owns every colour on the page, and the words
 * *Sign in with Microsoft* already say whose door it is.
 */
export function MicrosoftSignInScreen({
  host,
  title,
  lead,
  action = 'Sign in with Microsoft',
  onSignIn,
  busy = false,
  error,
  note,
}: MicrosoftSignInScreenProps) {
  return (
    <div className="auth-signin">
      <AuthCard data-auth-state={error === undefined ? 'sso' : 'sso-error'}>
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

          <AuthSummary>{error !== undefined && <AuthAlert>{error}</AuthAlert>}</AuthSummary>

          <span className="auth-sso-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <rect x="1" y="1" width="8.5" height="8.5" />
              <rect x="10.5" y="1" width="8.5" height="8.5" />
              <rect x="1" y="10.5" width="8.5" height="8.5" />
              <rect x="10.5" y="10.5" width="8.5" height="8.5" />
            </svg>
          </span>

          <Button
            type="button"
            fullWidth
            busy={busy}
            onClick={() => {
              if (!busy) onSignIn?.();
            }}
          >
            {action}
          </Button>

          {note !== undefined && <p className="auth-note">{note}</p>}
        </div>
      </AuthCard>
    </div>
  );
}
