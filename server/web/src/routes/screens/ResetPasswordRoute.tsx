import { useCallback, useEffect, useState } from 'react';
import { ResetPasswordScreen } from './ResetPasswordScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { useToast } from '../../components/toast/ToastProvider.tsx';
import { detailOf } from '../../components/toast/action-model.ts';
import { consumeResetLink, resetRefusal, RESET_REFUSAL_COPY } from '../../api/password-resets.ts';

type Refused = Exclude<ReturnType<typeof resetRefusal>, 'throttled' | undefined>;

/**
 * `/reset-password?token=…` (D-104 item 4, LAI-988): the container for
 * `ResetPasswordScreen`, as `InviteRoute` is for the invite.
 *
 * **The token is read from the address and posted in a body, once.** It is
 * never logged, stored, or put anywhere else: the server built the link so no
 * access log line holds it, and this page keeps that. It is taken out of the
 * address the moment it is read — `replaceState`, so neither the bar nor
 * Back holds it — and dropped from state once the link is spent: a set
 * password, or a refusal no retry can change.
 */
export function ResetPasswordRoute() {
  const {
    host,
    route: { params, setParams, navigate },
  } = useShell();
  const toast = useToast();
  const [token, setToken] = useState(() => params.get('token') ?? '');
  const [missingToken] = useState(() => token === '');

  useEffect(() => {
    if (!params.has('token')) return;
    const next = new URLSearchParams(params);
    next.delete('token');
    setParams(next);
  }, [params, setParams]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<Refused | undefined>(undefined);
  const [done, setDone] = useState<{ sessionsEnded: number } | undefined>(undefined);

  const submit = useCallback(
    async (password: string) => {
      setSubmitting(true);
      setError(undefined);
      setPasswordError(undefined);
      try {
        const view = await consumeResetLink(token, password);
        setToken('');
        setDone({ sessionsEnded: view.sessions_ended });
        // The page stays, with its *Sign in* button; the toast says the
        // action landed in the app's one voice (LAI-1310).
        toast.show({ text: 'Password reset — sign in', tone: 'success' });
      } catch (cause) {
        const why = resetRefusal(cause);
        if (why === 'throttled') {
          setError(RESET_REFUSAL_COPY.throttled.body);
          toast.show({
            text: 'Couldn’t reset password',
            tone: 'error',
            detail: RESET_REFUSAL_COPY.throttled.body,
          });
        } else if (why !== undefined) {
          setToken('');
          setRefused(why);
        } else if (fieldErrors(cause).new_password !== undefined) {
          // The server refused the password itself (§6.3 `422`, field
          // `new_password`): it belongs under the field, not in a banner.
          setPasswordError(fieldErrors(cause).new_password);
        } else {
          const said =
            cause instanceof ApiError
              ? cause.message
              : 'Could not set your password. The instance may be unreachable.';
          // Kept in the summary, where focus goes, and said as a toast
          // too (LAI-1310). A refused link is the page's own state, above,
          // and a refused password stays on its field.
          setError(said);
          toast.show({
            text: 'Couldn’t reset password',
            tone: 'error',
            detail: detailOf(cause) ?? said,
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [token, toast],
  );

  return (
    <ResetPasswordScreen
      host={host}
      missingToken={missingToken}
      refused={refused}
      done={done}
      submitting={submitting}
      serverError={error}
      passwordError={passwordError}
      onSubmit={(password) => {
        void submit(password);
      }}
      onSignIn={() => {
        navigate('/login');
      }}
    />
  );
}
