import { useCallback, useState } from 'react';
import { LoginScreen, type LoginSubmit } from './LoginScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { isCredentialRejection, SignInError } from '../../api/auth.ts';

/**
 * The sign-in flow (LAI-250), lifted out of `AppShell`.
 *
 * **Beside `LoginScreen`, not inside it.** That screen's docblock says
 * *"Layout, validation and states only — no network"*, and that is a deliberate
 * property rather than an accident of where the code grew: it is what lets
 * every state be checked without a server. This container is the other half.
 */
export function LoginRoute() {
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
