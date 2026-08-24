import { useState } from 'react';
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
  /** Rejected credentials, from the server. Wiring is LAI-007. */
  readonly failure?: { readonly attemptsLeft: number | undefined; readonly lockoutMinutes: number };
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
  failure,
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
    <div className="auth">
      <form
        className="auth-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) onSubmit?.({ email, password, keepSignedIn });
        }}
      >
        <header className="auth-head">
          <h1 className="auth-title">Sign in to your instance</h1>
          {/* Always visible: on a self-hosted tool, which instance you are
              signing into is not obvious from the page. */}
          <p className="auth-host">{host}</p>
        </header>

        {failure !== undefined && (
          <p className="auth-alert" role="alert">
            Email or password is wrong. {failure.attemptsLeft} attempt
            {failure.attemptsLeft === 1 ? '' : 's'} left before a {failure.lockoutMinutes}-minute
            lockout.
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

        <p className="auth-note">
          No account? Only an Owner or Admin can invite you. Ask them for a link.
        </p>
      </form>
    </div>
  );
}
