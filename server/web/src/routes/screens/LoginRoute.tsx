import { useCallback, useState } from 'react';
import { LoginScreen, type LoginSubmit } from './LoginScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import {
  isCredentialRejection,
  microsoftErrorWords,
  SignInError,
  signInWithMicrosoft,
} from '../../api/auth.ts';
import { MicrosoftSignInScreen } from './MicrosoftSignInScreen.tsx';

/**
 * The sign-in flow (LAI-250), lifted out of `AppShell`.
 *
 * **Beside `LoginScreen`, not inside it.** That screen's docblock says
 * *"Layout, validation and states only — no network"*, and that is a deliberate
 * property rather than an accident of where the code grew: it is what lets
 * every state be checked without a server. This container is the other half.
 */
export function LoginRoute() {
  const { signInMethod } = useShell();
  // Nothing until the instance says how people sign in (LAI-1238): a password
  // form flashed on an SSO-only instance is a door that cannot open.
  if (signInMethod === undefined) return null;
  return signInMethod === 'microsoft' ? <MicrosoftLoginRoute /> : <PasswordLoginRoute />;
}

/**
 * **Sign in with Microsoft** (LAI-1238). The button sends the browser to
 * Microsoft; Microsoft comes back to `/` signed in, or here with `?error=`,
 * which is said in words — a silent return reads as the button being broken.
 */
function MicrosoftLoginRoute() {
  const { host, route } = useShell();
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const returned = route.params.get('error');
  const error = startError ?? (returned === null ? undefined : microsoftErrorWords(returned));

  return (
    <MicrosoftSignInScreen
      host={host}
      title="Sign in to your instance"
      lead="This Laika signs in with your Microsoft work account."
      busy={busy}
      error={error}
      onSignIn={() => {
        setBusy(true);
        setStartError(undefined);
        signInWithMicrosoft('/', '/login').catch((cause: unknown) => {
          setBusy(false);
          setStartError(
            cause instanceof SignInError ? cause.message : 'Could not reach the instance.',
          );
        });
      }}
      note="No account? Only an Owner or Admin can invite you. Ask them to invite the address you use with Microsoft."
    />
  );
}

function PasswordLoginRoute() {
  const { host, session, signIn } = useShell();
  const [error, setError] = useState<string | undefined>(undefined);
  const [rejected, setRejected] = useState(false);

  const submit = useCallback(
    async (values: LoginSubmit) => {
      setError(undefined);
      setRejected(false);
      try {
        await signIn({
          email: values.email,
          password: values.password,
          rememberMe: values.keepSignedIn,
        });
      } catch (cause) {
        // Two different situations with two different remedies. Rejected
        // credentials are the reader's to fix and get the design's field-level
        // treatment; an unreachable instance is not theirs to fix at all, and
        // showing "email or password is wrong" for it sends someone to reset a
        // password that was never the problem.
        if (isCredentialRejection(cause)) {
          setRejected(true);
        } else if (cause instanceof SignInError) {
          // The server refused for a reason of its own — rate limiting is the
          // one that actually happens. Its message is the only accurate thing
          // available, and it must not be replaced with a guess about the
          // password, which may well be correct (LAI-220).
          setError(cause.message);
        } else {
          setError('Could not reach the instance.');
        }
      }
    },
    [signIn],
  );

  return (
    <LoginScreen
      host={host}
      onSubmit={(values) => {
        void submit(values);
      }}
      submitting={session.status === 'loading'}
      rejected={rejected}
      serverError={error}
    />
  );
}
