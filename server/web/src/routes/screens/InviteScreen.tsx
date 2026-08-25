import { useState } from 'react';
import { Button } from '../../components/forms/Button.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import {
  email as validateEmail,
  password as validatePassword,
  passwordsMatch,
  required,
} from '../../components/forms/validation.ts';
import { INVITE_REFUSED_REASON } from '../../api/invites.ts';
import { ORG_ROLE_PERMITS, PROJECT_ROLE_PERMITS, orgRoleLabel } from './invite-roles.ts';
import { avatarColor } from '../../theme/avatar-color.ts';
import { initials } from '../../theme/initials.ts';
import { useTheme } from '../../theme/use-theme.ts';
import type { InvitePreview } from '../../api/invites.ts';
import './auth.css';

export interface InviteSubmit {
  readonly name: string;
  readonly password: string;
  /** Supplied only for a link invite, which is bound to no address. */
  readonly email?: string;
}

export interface InviteScreenProps {
  readonly host: string;
  /** The invite as the server describes it. `undefined` while it is being read. */
  readonly invite: InvitePreview | undefined;
  /**
   * Set when the token was refused.
   *
   * Deliberately a boolean rather than a reason: the server answers one status
   * for unknown, expired and already-spent, so there is no reason to carry.
   */
  readonly refused?: boolean;
  readonly loading?: boolean;
  readonly onSubmit?: ((values: InviteSubmit) => void) | undefined;
  readonly onRequestNew?: (() => void) | undefined;
  readonly submitting?: boolean;
  readonly serverError?: string | undefined;
}

/** `expires in 6 days`, or `expires today` inside the last day. */
export function expiresIn(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';

  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${String(days)} ${days === 1 ? 'day' : 'days'}`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `expires in ${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  return 'expires within the hour';
}

/**
 * Accept an invite (design `5a`, LAI-077).
 *
 * The screen's whole job is to make one thing unambiguous: **the role was chosen
 * by whoever invited you, and you cannot change it here.** Everything else is in
 * service of that — the role card is above the fields, not below them, and the
 * submit button names the org and the role rather than saying "Accept".
 */
export function InviteScreen({
  host,
  invite,
  refused = false,
  loading = false,
  onSubmit,
  onRequestNew,
  submitting = false,
  serverError,
}: InviteScreenProps) {
  const [name, setName] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const { theme } = useTheme();

  if (refused) {
    return (
      <div className="auth">
        <div className="auth-card auth-card-invite">
          <p className="auth-kicker auth-kicker-warn">INVITE REFUSED</p>
          <header className="auth-head">
            <span className="auth-expired-glyph" aria-hidden="true">
              {/* The design's clock, drawn rather than imported: there is no
                  icon set in this app and a task may not add one. */}
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M12 7v5l3 2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h1 className="auth-title">This invite cannot be used</h1>
            <p className="auth-host">{host}</p>
          </header>

          {/*
            The design says "This invite has expired" and names the inviter. We
            cannot: the server answers one status for unknown, expired and
            already-used **on purpose**, so that posting guesses cannot confirm a
            token exists. It also means there is no invite to read an inviter or
            an expiry window from. Saying "expired" here would be a guess with
            two-in-three odds, and the one thing worse than a vague message is a
            confident wrong one.
          */}
          <p className="auth-note auth-refused-note">
            The link is {INVITE_REFUSED_REASON}. Ask whoever invited you for a new one — your
            pre-assigned role is kept.
          </p>

          <Button variant="secondary" fullWidth onClick={onRequestNew}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  if (loading || invite === undefined) {
    return (
      <div className="auth">
        <div className="auth-card auth-card-invite">
          <p className="auth-kicker">ACCEPT INVITE</p>
          <p className="auth-note" role="status">
            Checking your invite…
          </p>
        </div>
      </div>
    );
  }

  // A link invite is bound to no address, so the invitee supplies one. An email
  // invite is bound to exactly one and the server refuses a mismatch, so the
  // field is shown locked rather than hidden — the reader needs to see which
  // address they are about to own.
  const isLinkInvite = invite.email === null;

  const nameCheck = required(name, 'Your name');
  const emailCheck = isLinkInvite ? validateEmail(linkEmail) : { ok: true as const };
  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const valid = nameCheck.ok && emailCheck.ok && passwordCheck.ok && matchCheck.ok;

  const roleLabel = orgRoleLabel(invite.org_role);
  const ink = avatarColor(invite.inviter_name, theme);

  return (
    <div className="auth">
      <form
        className="auth-card auth-card-invite"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!valid) return;
          onSubmit?.({
            name,
            password,
            ...(isLinkInvite ? { email: linkEmail } : {}),
          });
        }}
      >
        <p className="auth-kicker">ACCEPT INVITE</p>

        <div className="auth-inviter">
          <span
            className="auth-inviter-avatar"
            style={{ background: ink.background, color: ink.foreground }}
            aria-hidden="true"
          >
            {initials(invite.inviter_name)}
          </span>
          <span className="auth-inviter-who">
            <span className="auth-inviter-line">
              {invite.inviter_name} invited you to <b>{invite.org_name}</b>
            </span>
            <span className="auth-inviter-meta">
              {expiresIn(invite.expires_at, Date.now())}
              {/* One project, because the preview carries at most one. The
                  mockup's "2 projects shared with you" is a fixture. */}
              {invite.project_name !== null && ` · ${invite.project_name}`}
            </span>
          </span>
        </div>

        <header className="auth-head">
          <h1 className="auth-title">Set up your account</h1>
          <p className="auth-host">{host}</p>
        </header>

        <div className="auth-role">
          <div className="auth-role-top">
            <span className="auth-role-label">YOUR ROLE</span>
            <span className="auth-role-chip">PRE-ASSIGNED</span>
          </div>
          <p className="auth-role-name">{roleLabel}</p>
          <p className="auth-role-permits">{ORG_ROLE_PERMITS[invite.org_role]}</p>

          {invite.project_role !== null && invite.project_name !== null && (
            <p className="auth-role-permits">
              In <b>{invite.project_name}</b> you are a {invite.project_role}:{' '}
              {PROJECT_ROLE_PERMITS[invite.project_role]}
            </p>
          )}

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
          label="Full name"
          value={name}
          onChange={setName}
          autoComplete="name"
          required
          disabled={submitting}
          error={touched && !nameCheck.ok ? nameCheck.message : undefined}
        />

        {isLinkInvite ? (
          <TextInput
            label="Email"
            type="email"
            value={linkEmail}
            onChange={setLinkEmail}
            autoComplete="email"
            required
            disabled={submitting}
            help="This link is not tied to an address, so choose the one you will sign in with."
            error={touched && !emailCheck.ok ? emailCheck.message : undefined}
          />
        ) : (
          <div className="auth-locked">
            <TextInput
              label="Email"
              type="email"
              value={invite.email ?? ''}
              onChange={() => undefined}
              readOnly
              help="The invite is bound to this address, so it cannot be changed here."
            />
            <span className="auth-locked-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
                <rect
                  x="4"
                  y="10"
                  width="16"
                  height="10"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </div>
        )}

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

        <Button
          type="submit"
          fullWidth
          busy={submitting}
          busyLabel="Creating your account…"
          variant="invite"
        >
          {`Join ${invite.org_name} as ${roleLabel}`}
        </Button>

        {/* D-007's consequence, said before they agree to it rather than after. */}
        <p className="auth-fineprint">
          By joining you agree that agent activity under your account is attributed to you in the
          audit log.
        </p>
      </form>
    </div>
  );
}
