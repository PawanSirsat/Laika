import { useCallback, useState } from 'react';
import { ResetPasswordScreen } from './ResetPasswordScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { ApiError } from '../../api/errors.ts';
import { consumeResetLink, resetRefusal, RESET_REFUSAL_COPY } from '../../api/password-resets.ts';

type Refused = Exclude<ReturnType<typeof resetRefusal>, 'throttled' | undefined>;

/**
 * `/reset-password?token=…` (D-104 item 4, LAI-988): the container for
 * `ResetPasswordScreen`, as `InviteRoute` is for the invite.
 *
 * **The token is read from the address and posted in a body, once.** It is
 * never logged, stored, or put anywhere else: the server built the link so no
 * access log line holds it, and this page keeps that.
 */
export function ResetPasswordRoute() {
  const {
    host,
    route: { params, navigate },
  } = useShell();
  const token = params.get('token') ?? '';

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<Refused | undefined>(undefined);
  const [done, setDone] = useState<{ sessionsEnded: number } | undefined>(undefined);

  const submit = useCallback(
    async (password: string) => {
      setSubmitting(true);
      setError(undefined);
      try {
        const view = await consumeResetLink(token, password);
        setDone({ sessionsEnded: view.sessions_ended });
      } catch (cause) {
        const why = resetRefusal(cause);
        if (why === 'throttled') {
          setError(RESET_REFUSAL_COPY.throttled.body);
        } else if (why !== undefined) {
          setRefused(why);
        } else {
          setError(
            cause instanceof ApiError
              ? cause.message
              : 'Could not set your password. The instance may be unreachable.',
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [token],
  );

  return (
    <ResetPasswordScreen
      host={host}
      missingToken={token === ''}
      refused={refused}
      done={done}
      submitting={submitting}
      serverError={error}
      onSubmit={(password) => {
        void submit(password);
      }}
      onSignIn={() => {
        navigate('/login');
      }}
    />
  );
}
