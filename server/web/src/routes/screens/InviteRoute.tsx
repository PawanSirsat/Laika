import { useCallback, useState } from 'react';
import { InviteScreen, type InviteSubmit } from './InviteScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { acceptInvite } from '../../api/invites.ts';
import { useInvite } from '../../api/use-invite.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { useToast } from '../../components/toast/ToastProvider.tsx';
import { detailOf } from '../../components/toast/action-model.ts';

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
  const toast = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});

  const submit = useCallback(
    async (values: InviteSubmit) => {
      if (token === undefined) return;

      setSubmitting(true);
      setError(undefined);
      setFields({});

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
        // A `422` names its fields (§6.3): each complaint goes under the
        // field it is about, and the summary says only that some need fixing.
        const named = fieldErrors(cause);
        if (Object.keys(named).length > 0) {
          setFields(named);
          setError('Some details need fixing before your account can be created.');
          return;
        }
        // `403` is the token being refused between the preview and the submit —
        // it expired while the form was open, or someone else spent a link
        // invite first. The server's own wording is used rather than a reworded
        // one, because it is the only party that knows which.
        const said =
          cause instanceof ApiError
            ? cause.message
            : 'Could not create your account. The instance may be unreachable.';
        // The summary keeps it beside the form, where focus goes; the toast
        // is the app's one place an action's failure is always said
        // (LAI-1310). A field refusal, above, stays on its field alone.
        setError(said);
        toast.show({
          text: 'Couldn’t create your account',
          tone: 'error',
          detail: detailOf(cause) ?? said,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [token, retry, navigate, toast],
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
      fieldErrors={fields}
    />
  );
}
