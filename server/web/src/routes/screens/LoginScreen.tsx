import { useState } from 'react';
import { Brand } from '../../components/Brand.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { Checkbox } from '../../components/forms/Checkbox.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import { email as validateEmail, required } from '../../components/forms/validation.ts';
import './auth.css';

export interface LoginSubmit {
  readonly email: string;
  readonly password: string;
  readonly keepSignedIn: boolean;
}

export interface LoginScreenProps {
  /**
   * The instance this form signs into, always visible (LAI-021 AC3). A prop,
   * never a constant — the prototype's `laika.kvelld.internal` is a fixture.
   */
  readonly host: string;
  readonly onSubmit?: ((values: LoginSubmit) => void) | undefined;
  readonly submitting?: boolean;
  /**
   * The server rejected these credentials.
   *
   * A **boolean**, not a counter. It used to be
   * `{ attemptsLeft, lockoutMinutes }`, rendering *"3 attempts left before a
   * 15-minute lockout"* — the prototype's line. Nothing ever passed it, and
   * nothing could have: **this instance has no lockout.** Eight consecutive
   * failed sign-ins return eight identical `401`s with no counter, no
   * `Retry-After`, and no ban. `attemptsLeft` was even `number | undefined`, so
   * the one caller who ever tried would have rendered *"undefined attempts
   * left"*. LAI-219 asks for real brute-force protection; until it exists there
   * is no number to show, and inventing one tells the reader they are safer
   * than they are.
   */
  readonly rejected?: boolean;
  /** Anything else the server said — unreachable instance, rate limit. */
  readonly serverError?: string | undefined;
}

/**
 * Sign in (LAI-021 AC3). Layout, validation and states only — **no network**.
 *
 * **No "Forgot?" link and no "Email me a sign-in link".** Both appear in the
 * prototype; neither is specified and both need SMTP (SPEC §14 q11,
 * `docs/design/README.md`). Shipping either would promise a flow that does not
 * exist.
 */
export function LoginScreen({
  host,
  onSubmit,
  submitting = false,
  rejected = false,
  serverError,
}: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailCheck = validateEmail(email);
  const passwordCheck = required(password, 'Password');
  const valid = emailCheck.ok && passwordCheck.ok;

  return (
    <div className="auth auth-signin">
      <p className="auth-eyebrow">SIGN IN</p>
      <form
        className="auth-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) onSubmit?.({ email, password, keepSignedIn });
        }}
      >
        <Brand variant="tile" />

        <header className="auth-head">
          <h1 className="auth-title">Sign in to your instance</h1>
          {/*
            Always visible, with a padlock: on self-hosted software people run
            several instances, and which one this form signs into is not
            otherwise apparent. The host is real — `laika.kvelld.internal` is a
            fixture.
          */}
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
        </header>

        {rejected && (
          <p className="auth-rejected" role="alert">
            <span className="auth-rejected-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16.75" r="1.15" fill="currentColor" />
              </svg>
            </span>
            {/* Never "no account with that email": the same sentence for a wrong
                password and an address that does not exist is what stops this
                form being used to find out which addresses do. The server
                answers identically for both — verified, not assumed. */}
            <span>Email or password is wrong.</span>
          </p>
        )}

        {serverError !== undefined && (
          <p className="auth-alert" role="alert">
            {serverError}
          </p>
        )}

        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          required
          disabled={submitting}
          error={touched && !emailCheck.ok ? emailCheck.message : undefined}
          invalid={rejected}
        />

        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          disabled={submitting}
          error={touched && !passwordCheck.ok ? passwordCheck.message : undefined}
        />

        <Checkbox
          label="Keep me signed in on this device"
          checked={keepSignedIn}
          onChange={setKeepSignedIn}
          disabled={submitting}
        />

        <Button type="submit" fullWidth busy={submitting} busyLabel="Signing in…">
          Sign in
        </Button>

        {/*
          No "Forgot?", no OR divider, no "Email me a sign-in link". All three
          are prominent in the mockup and none is buildable: there is no
          password-reset endpoint (SPEC §6.4) and magic-link auth is neither
          specified nor possible without SMTP (§14 q11). Their absence will read
          as an omission; it is not.
        */}

        <p className="auth-note">
          No account? Only an Owner or Admin can invite you. Ask them for a link.
        </p>
      </form>
    </div>
  );
}
