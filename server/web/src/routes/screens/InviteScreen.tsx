import { useState } from 'react';
import { Button } from '../../components/forms/Button.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import {
  password as validatePassword,
  passwordsMatch,
  required,
} from '../../components/forms/validation.ts';
import './auth.css';

/** Org roles an invite can carry, and what each one permits. */
export type InviteRole = 'admin' | 'member' | 'viewer';

/**
 * What the role actually allows, in the invitee's terms.
 *
 * LAI-021 AC4 asks for "the pre-assigned role **and what it permits**" — a bare
 * badge saying "MEMBER" tells someone nothing about what they are accepting.
 * Wording follows the prototype's own role descriptions.
 */
const ROLE_PERMITS: Readonly<Record<InviteRole, string>> = {
  admin: 'Manage members, invites and provider keys, and everything a Member can do.',
  member: 'Create and move tasks, comment, and start agent sessions that report presence.',
  viewer: 'Read tasks, activity and capacity. No changes, and tokens are read-only.',
};

export interface InviteSubmit {
  readonly name: string;
  readonly password: string;
}

export interface InviteScreenProps {
  readonly host: string;
  readonly inviterName: string;
  readonly orgName: string;
  /** Locked: the invite is bound to this address. */
  readonly email: string;
  readonly role: InviteRole;
  readonly expiresIn: string;
  readonly expired?: boolean;
  readonly onSubmit?: ((values: InviteSubmit) => void) | undefined;
  readonly onRequestNew?: (() => void) | undefined;
  readonly submitting?: boolean;
  readonly serverError?: string | undefined;
}

export function InviteScreen({
  host,
  inviterName,
  orgName,
  email,
  role,
  expiresIn,
  expired = false,
  onSubmit,
  onRequestNew,
  submitting = false,
  serverError,
}: InviteScreenProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const nameCheck = required(name, 'Your name');
  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const valid = nameCheck.ok && passwordCheck.ok && matchCheck.ok;

  if (expired) {
    return (
      <div className="auth">
        <div className="auth-card">
          <header className="auth-head">
            <h1 className="auth-title">This invite has expired</h1>
            <p className="auth-host">{host}</p>
          </header>
          <p className="auth-note">
            Invites last 7 days. Ask {inviterName} to send a new one — your pre-assigned role is
            kept.
          </p>
          <Button variant="secondary" fullWidth onClick={onRequestNew}>
            Request a new invite
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form
        className="auth-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) onSubmit?.({ name, password });
        }}
      >
        <header className="auth-head">
          <h1 className="auth-title">
            {inviterName} invited you to {orgName}
          </h1>
          <p className="auth-host">
            {host} · expires in {expiresIn}
          </p>
        </header>

        <div className="auth-role">
          <p className="auth-role-head">
            Your role: <span className="auth-role-badge">{role}</span>
          </p>
          <p className="auth-role-permits">{ROLE_PERMITS[role]}</p>
          <p className="auth-note">
            Your role is already set by the person who invited you. Only an Owner can change it
            later.
          </p>
        </div>

        {serverError !== undefined && (
          <p className="auth-alert" role="alert">
            {serverError}
          </p>
        )}

        <TextInput
          label="Your name"
          value={name}
          onChange={setName}
          autoComplete="name"
          required
          disabled={submitting}
          error={touched && !nameCheck.ok ? nameCheck.message : undefined}
        />

        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={() => undefined}
          readOnly
          help="The invite is bound to this address, so it cannot be changed here."
        />

        <PasswordInput
          label="Choose a password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          required
          disabled={submitting}
          error={touched && !passwordCheck.ok ? passwordCheck.message : undefined}
        />

        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
          disabled={submitting}
          error={touched && !matchCheck.ok ? matchCheck.message : undefined}
        />

        <Button type="submit" fullWidth busy={submitting} busyLabel="Creating your account…">
          Accept invite
        </Button>
      </form>
    </div>
  );
}
