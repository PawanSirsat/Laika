import { useState } from 'react';
import { AuthCard } from '../../components/auth/AuthCard.tsx';
import { AlertGlyph, AuthAlert, AuthSummary } from '../../components/auth/AuthSummary.tsx';
import { BrandLockup } from '../../components/brand/BrandLockup.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { Checkbox } from '../../components/forms/Checkbox.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import {
  useFocusOnServerAnswer,
  useValidatedForm,
} from '../../components/forms/use-validated-form.ts';
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
   * `attemptsLeft` was `number | undefined`, so the one caller who ever tried
   * would have rendered *"undefined attempts left"*.
   *
   * **There is no per-account lockout, and no attempts counter on the wire.**
   * What does exist is better-auth's own limiter: three rapid failures, then
   * `429` for ten seconds. It is **on in production only** — off in development
   * and test (LAI-096's measured table) — and it is keyed on the caller, not on
   * the account, so it slows one address and does nothing about a slow attempt
   * spread across many. Our own limiter never fires here: it allows 600/min
   * refilling continuously, and had 595 tokens left on the request that was
   * rejected.
   *
   * So there is still no number for this screen to show. LAI-219 asks for real
   * per-account protection; until then, inventing a count tells the reader they
   * are safer than they are.
   */
  readonly rejected?: boolean;
  /** Anything else the server said — unreachable instance, rate limit. */
  readonly serverError?: string | undefined;
}

/**
 * Sign in (LAI-021 AC3). Layout, validation and states only — **no network**.
 *
 * One lockup, one heading, one primary action (LAI-1203): the "SIGN IN"
 * eyebrow above the card said the heading twice and is gone.
 *
 * **No "Forgot?" link and no "Email me a sign-in link".** Both appear in the
 * prototype; neither is specified and both need SMTP (SPEC §14 q11,
 * `docs/design/README.md`). Shipping either would promise a flow that does not
 * exist. A reset link is something an admin issues (D-104), which is what the
 * closing note says.
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
  // Ticked by default (LAI-811). Unticked, better-auth issues a fixed 24-hour
  // session that is never renewed, and a cookie with no `Max-Age` that iOS
  // Safari drops whenever it suspends the tab. Untick it on a shared machine.
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const form = useValidatedForm();
  useFocusOnServerAnswer(form.focusFirstInvalid, { rejected, serverError });

  const emailCheck = validateEmail(email);
  const passwordCheck = required(password, 'Password');
  const valid = emailCheck.ok && passwordCheck.ok;

  return (
    <div className="auth-signin">
      <AuthCard data-auth-state={rejected ? 'rejected' : 'form'}>
        <form
          ref={form.formRef}
          noValidate
          aria-labelledby="signin-title"
          onSubmit={(e) => {
            e.preventDefault();
            if (submitting) return;
            if (form.attempt(valid)) onSubmit?.({ email, password, keepSignedIn });
          }}
        >
          <BrandLockup size="lg" className="auth-brand" />

          <header className="auth-head">
            <h1 className="auth-title" id="signin-title">
              Sign in to your instance
            </h1>
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

          <AuthSummary>
            {rejected && (
              <p className="auth-rejected">
                <AlertGlyph />
                {/* Never "no account with that email": the same sentence for a
                    wrong password and an address that does not exist is what
                    stops this form being used to find out which addresses do.
                    The server answers identically for both — verified, not
                    assumed. */}
                <span>Email or password is wrong.</span>
              </p>
            )}
            {serverError !== undefined && <AuthAlert>{serverError}</AuthAlert>}
          </AuthSummary>

          <TextInput
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            onBlur={() => {
              form.blur('email', email);
            }}
            autoComplete="username"
            required
            disabled={submitting}
            error={form.shown('email', emailCheck)}
            invalid={rejected}
          />

          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            onBlur={() => {
              form.blur('password', password);
            }}
            autoComplete="current-password"
            required
            disabled={submitting}
            error={form.shown('password', passwordCheck)}
          />

          <Checkbox
            label="Keep me signed in on this device"
            checked={keepSignedIn}
            onChange={setKeepSignedIn}
            disabled={submitting}
          />

          <Button type="submit" fullWidth busy={submitting}>
            Sign in
          </Button>

          {/*
            No "Forgot?", no OR divider, no "Email me a sign-in link". All three
            are prominent in the mockup and none is buildable: magic-link auth
            is neither specified nor possible without SMTP (§14 q11), and a
            reset link is issued by an admin, not requested here (D-104).
          */}
          <p className="auth-note">
            No account, or locked out? Only an Owner or Admin can invite you or send you a reset
            link. Ask them.
          </p>
        </form>
      </AuthCard>
    </div>
  );
}
