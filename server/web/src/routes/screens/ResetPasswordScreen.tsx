import { useState } from 'react';
import { AuthCard } from '../../components/auth/AuthCard.tsx';
import { AuthAlert, AuthSummary } from '../../components/auth/AuthSummary.tsx';
import { BrandLockup } from '../../components/brand/BrandLockup.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import {
  useFocusOnServerAnswer,
  useValidatedForm,
} from '../../components/forms/use-validated-form.ts';
import {
  PASSWORD_RULE,
  password as validatePassword,
  passwordsMatch,
} from '../../components/forms/validation.ts';
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
  /** A failure the reader can retry from the form (throttled, unreachable). */
  readonly serverError?: string | undefined;
  /** The server refused the password itself — shown under the field (LAI-1203). */
  readonly passwordError?: string | undefined;
  readonly onSubmit?: ((password: string) => void) | undefined;
  readonly onSignIn?: (() => void) | undefined;
}

/**
 * Set a new password from a reset link (D-104 item 4, LAI-988) — the public
 * page an admin's link opens, beside sign-in and invites.
 *
 * Layout, validation and states only, like `LoginScreen`: no network, so
 * every state is reachable without a server. The password rule is setup's
 * (`validation.ts`), the one the server enforces on this endpoint too, and it
 * is said before anyone types (LAI-1203).
 */
export function ResetPasswordScreen({
  host,
  missingToken = false,
  refused,
  done,
  submitting = false,
  serverError,
  passwordError,
  onSubmit,
  onSignIn,
}: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const form = useValidatedForm();
  useFocusOnServerAnswer(form.focusFirstInvalid, {
    serverError,
    fieldErrors: passwordError === undefined ? {} : { password: passwordError },
  });

  if (missingToken || refused !== undefined) {
    const copy =
      refused === undefined
        ? {
            title: 'No reset link here',
            body: 'A reset link carries a token. Ask whoever sent it for the full link.',
          }
        : RESET_REFUSAL_COPY[refused];
    return (
      <AuthCard tone="warn" data-reset-state={refused ?? 'missing'}>
        <BrandLockup size="md" className="auth-brand" />
        <header className="auth-head">
          <span className="auth-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <rect
                x="4"
                y="11"
                width="16"
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <h1 className="auth-title">{copy.title}</h1>
          <p className="auth-host">{host}</p>
        </header>
        <p className="auth-lede">{copy.body}</p>
        <Button variant="secondary" fullWidth onClick={onSignIn}>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  if (done !== undefined) {
    return (
      <AuthCard data-reset-state="done">
        <BrandLockup size="md" className="auth-brand" />
        <header className="auth-head">
          <span className="auth-glyph auth-glyph-ok" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path
                d="m5 12.5 4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="auth-title">Your password is set</h1>
          <p className="auth-host">{host}</p>
        </header>
        {/* What happens next, in the order it happens: sign in here, and any
            other device asks again. */}
        <p className="auth-lede" role="status">
          Sign in with your new password next.{' '}
          {done.sessionsEnded > 0
            ? `You were signed out of ${String(done.sessionsEnded)} other session${done.sessionsEnded === 1 ? '' : 's'}, so those devices will ask for it too.`
            : 'Any other device you use will ask for it too.'}
        </p>
        <Button fullWidth onClick={onSignIn}>
          Sign in
        </Button>
      </AuthCard>
    );
  }

  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const valid = passwordCheck.ok && matchCheck.ok;

  return (
    <AuthCard data-reset-state="form">
      <form
        ref={form.formRef}
        noValidate
        aria-labelledby="reset-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting || !form.attempt(valid)) return;
          onSubmit?.(password);
        }}
      >
        <BrandLockup size="md" className="auth-brand" />
        <header className="auth-head">
          <h1 className="auth-title" id="reset-title">
            Choose a new password
          </h1>
          <p className="auth-host">{host}</p>
        </header>
        <p className="auth-lede">
          This link works once. Setting a password signs you out everywhere else.
        </p>

        <AuthSummary>
          {serverError !== undefined && <AuthAlert>{serverError}</AuthAlert>}
        </AuthSummary>

        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          onBlur={() => {
            form.blur('password', password);
          }}
          autoComplete="new-password"
          autoFocus
          help={PASSWORD_RULE}
          showStrength
          required
          disabled={submitting}
          error={form.shown('password', passwordCheck) ?? passwordError}
        />
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          onBlur={() => {
            form.blur('confirm', confirm);
          }}
          autoComplete="new-password"
          required
          disabled={submitting}
          {...(confirm !== '' && matchCheck.ok ? { help: 'Matches' } : {})}
          error={form.shown('confirm', matchCheck)}
        />

        <Button type="submit" fullWidth busy={submitting}>
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}
