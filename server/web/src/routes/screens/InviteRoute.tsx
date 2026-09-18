import { useCallback, useState } from 'react';
import { InviteScreen, type InviteSubmit } from './InviteScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { acceptInvite } from '../../api/invites.ts';
import { useInvite } from '../../api/use-invite.ts';
import { ApiError } from '../../api/errors.ts';

/**
 * Accepting an invite (LAI-250), lifted out of `AppShell`.
 *
 * The response carries the session cookie, so `retry()` is what turns this tab
 * from anonymous into authenticated — not a second sign-in round trip.
 *
 * `useInvite` lives here rather than in the shell because **only this route
 * has a token to read**. In `AppShell` it was called on every render of every
 * screen, guarded by a conditional token, which is the shape that made the
 * shell's hook list unreadable.
 */
export function InviteRoute() {
  const {
    host,
    route: { params, navigate },
    retry,
  } = useShell();
  const token = params.get('token') ?? undefined;
  const state = useInvite(token);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = useCallback(
    async (values: InviteSubmit) => {
      if (token === undefined) return;

      setSubmitting(true);
      setError(undefined);

      try {
        await acceptInvite({
          token,
          name: values.name,
          password: values.password,
          ...(values.email === undefined ? {} : { email: values.email }),
        });
        retry();
        navigate('/board');
      } catch (cause) {
        // `403` is the token being refused between the preview and the submit —
        // it expired while the form was open, or someone else spent a link
        // invite first. The server's own wording is used rather than a reworded
        // one, because it is the only party that knows which.
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not create your account. The instance may be unreachable.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, retry, navigate],
  );

  return (
    <InviteScreen
      host={host}
      invite={state.invite}
      loading={state.loading}
      refused={state.refused}
      onSubmit={(values) => {
        void submit(values);
      }}
      onRequestNew={() => {
        navigate('/login');
      }}
      submitting={submitting}
      serverError={error}
    />
  );
}
