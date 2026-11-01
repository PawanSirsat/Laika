import { useState } from 'react';
import { Button } from '../../components/forms/Button.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { password as validatePassword, passwordsMatch } from '../../components/forms/validation.ts';
import { RESET_REFUSAL_COPY, type ResetRefusal } from '../../api/password-resets.ts';
import './auth.css';

export interface ResetPasswordScreenProps {
  readonly host: string;
  /** No token in the link at all — nothing to post. */
  readonly missingToken?: boolean;
  /** The link was refused for good: used, revoked, expired, unknown, or the account is off. */
  readonly refused?: Exclude<ResetRefusal, 'throttled'> | undefined;
  /** Set once the server has taken the new password. */
  readonly done?: { readonly sessionsEnded: number } | undefined;
  readonly submitting?: boolean;
  /** A failure the reader can retry from the form (throttled, unreachable, a refused password). */
  readonly serverError?: string | undefined;
  readonly onSubmit?: ((password: string) => void) | undefined;
  readonly onSignIn?: (() => void) | undefined;
}

/**
 * Set a new password from a reset link (D-104 item 4, LAI-988) — the public
 * page an admin's link opens, beside sign-in and invites.
 *
 * Layout, validation and states only, like `LoginScreen`: no network, so
 * every state is reachable without a server. The password rule is setup's
 * (`validation.ts`), the one the server enforces on this endpoint too.
 */
export function ResetPasswordScreen({
  host,
  missingToken = false,
  refused,
  done,
  submitting = false,
  serverError,
  onSubmit,
  onSignIn,
}: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const signIn = (
    <Button variant="secondary" fullWidth onClick={onSignIn}>
      Go to sign in
    </Button>
  );

  if (missingToken || refused !== undefined) {
    const copy =
      refused === undefined
        ? {
            title: 'No reset link here',
            body: 'A reset link carries a token. Ask whoever sent it for the full link.',
          }
        : RESET_REFUSAL_COPY[refused];
    return (
      <div className="auth">
        <div className="auth-card" data-reset-state={refused ?? 'missing'}>
          <p className="auth-kicker auth-kicker-warn">RESET PASSWORD</p>
          <header className="auth-head">
            <h1 className="auth-title">{copy.title}</h1>
            <p className="auth-host">{host}</p>
          </header>
          <p className="auth-note">{copy.body}</p>
          {signIn}
        </div>
      </div>
    );
  }

  if (done !== undefined) {
    return (
      <div className="auth">
        <div className="auth-card" data-reset-state="done">
          <p className="auth-kicker">RESET PASSWORD</p>
          <header className="auth-head">
            <h1 className="auth-title">Your password is set</h1>
            <p className="auth-host">{host}</p>
          </header>
          <p className="auth-note" role="status">
            Sign in with your new password.{' '}
            {done.sessionsEnded > 0 &&
              `You were signed out of ${String(done.sessionsEnded)} other session${done.sessionsEnded === 1 ? '' : 's'}.`}
          </p>
          <Button fullWidth onClick={onSignIn}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const valid = passwordCheck.ok && matchCheck.ok;

  return (
    <div className="auth">
      <form
        className="auth-card"
        data-reset-state="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!valid || submitting) return;
          onSubmit?.(password);
        }}
      >
        <p className="auth-kicker">RESET PASSWORD</p>
        <header className="auth-head">
          <h1 className="auth-title">Choose a new password</h1>
          <p className="auth-host">{host}</p>
        </header>
        <p className="auth-note">
          This link works once. Setting a password signs you out everywhere else.
        </p>

        {serverError !== undefined && (
          <p className="auth-alert" role="alert">
            {serverError}
          </p>
        )}

        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          required
          disabled={submitting}
          error={touched && !passwordCheck.ok ? passwordCheck.message : undefined}
        />
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
          disabled={submitting}
          error={touched && !matchCheck.ok ? matchCheck.message : undefined}
        />

        <Button type="submit" fullWidth busy={submitting}>
          Set new password
        </Button>
      </form>
    </div>
  );
}
