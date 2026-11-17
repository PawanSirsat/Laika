import { useCallback, useState } from 'react';
import { InviteScreen, type InviteSubmit } from './InviteScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { acceptInvite } from '../../api/invites.ts';
import { useInvite } from '../../api/use-invite.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { microsoftErrorWords, SignInError, signInWithMicrosoft } from '../../api/auth.ts';
import { MicrosoftSignInScreen } from './MicrosoftSignInScreen.tsx';
import type { InvitePreview } from '../../api/invites.ts';

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
    signInMethod,
  } = useShell();
  const token = params.get('token') ?? undefined;
  const state = useInvite(token);

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

  /*
   * **On an SSO-only instance an invite is accepted by signing in with
   * Microsoft as the invited address** (LAI-1238). The server spends it on that
   * first sign-in; there is no password to set. Loading and a refused token are
   * the same screen as ever, so only a usable invite takes this branch.
   */
  if (
    signInMethod === 'microsoft' &&
    state.invite !== undefined &&
    !state.loading &&
    !state.refused
  ) {
    return (
      <MicrosoftInvite
        host={host}
        invite={state.invite}
        returned={params.get('error')}
        token={token ?? ''}
      />
    );
  }

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

/** Who invited whom to what, in one sentence, from the invite's own preview. */
function inviteLead(invite: InvitePreview): string {
  const to =
    invite.project_name === null ? invite.org_name : `${invite.project_name} in ${invite.org_name}`;
  return `${invite.inviter_name} invited ${invite.email ?? 'you'} to ${to} as ${invite.org_role}.`;
}

function MicrosoftInvite({
  host,
  invite,
  returned,
  token,
}: {
  readonly host: string;
  readonly invite: InvitePreview;
  readonly returned: string | null;
  readonly token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | undefined>(undefined);

  /*
   * **A link invite cannot be spent here.** It is a bearer token for whoever
   * holds it, and the Microsoft sign-in presents no token — the server spends
   * only an invite addressed to the email Microsoft asserts. Said up front,
   * rather than after a round trip to Microsoft that was always going to fail.
   */
  if (invite.email === null) {
    return (
      <MicrosoftSignInScreen
        host={host}
        title={`Join ${invite.org_name}`}
        lead={inviteLead(invite)}
        error="This Laika signs in with Microsoft, and that needs an invite to your own email address. Ask the person who invited you to invite your work address instead of sending a link."
        action="Back to sign-in"
        toMicrosoft={false}
        onSignIn={() => {
          window.location.assign('/login');
        }}
      />
    );
  }

  const here = `/invite?token=${encodeURIComponent(token)}`;
  const error = startError ?? (returned === null ? undefined : microsoftErrorWords(returned));

  return (
    <MicrosoftSignInScreen
      host={host}
      title={`Join ${invite.org_name}`}
      lead={inviteLead(invite)}
      action="Accept with Microsoft"
      busy={busy}
      error={error}
      onSignIn={() => {
        setBusy(true);
        setStartError(undefined);
        signInWithMicrosoft('/board', here).catch((cause: unknown) => {
          setBusy(false);
          setStartError(
            cause instanceof SignInError ? cause.message : 'Could not reach the instance.',
          );
        });
      }}
      note={`Use the Microsoft account for ${invite.email} — any other account is turned away.`}
    />
  );
}
