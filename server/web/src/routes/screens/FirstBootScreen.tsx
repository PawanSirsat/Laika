import { useState } from 'react';
import { Button } from '../../components/forms/Button.tsx';
import { Checkbox } from '../../components/forms/Checkbox.tsx';
import { PasswordInput } from '../../components/forms/PasswordInput.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import { SystemStatus } from './SystemStatus.tsx';
import {
  email as validateEmail,
  password as validatePassword,
  passwordsMatch,
  required,
} from '../../components/forms/validation.ts';
import './auth.css';

export interface FirstBootSubmit {
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly password: string;
  readonly orgName: string;
  readonly projectName: string;
  readonly trackPresence: boolean;
}

export interface FirstBootScreenProps {
  readonly host: string;
  readonly migrationsApplied: number;
  readonly migrationsTotal: number;
  readonly smtpConfigured: boolean;
  readonly onSubmit?: ((values: FirstBootSubmit) => void) | undefined;
  readonly submitting?: boolean;
  readonly serverError?: string | undefined;
}

/**
 * First run (LAI-021 AC5). Owner account, org, optional first project, presence
 * opt-in, and the system panel.
 *
 * Runs once — `POST /setup` is disabled after an org exists (SPEC §3) — which is
 * why the copy says so plainly. Wiring is LAI-009.
 */
export function FirstBootScreen({
  host,
  migrationsApplied,
  migrationsTotal,
  smtpConfigured,
  onSubmit,
  submitting = false,
  serverError,
}: FirstBootScreenProps) {
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [orgName, setOrgName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [trackPresence, setTrackPresence] = useState(true);
  const [touched, setTouched] = useState(false);

  const nameCheck = required(ownerName, 'Your name');
  const emailCheck = validateEmail(ownerEmail);
  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const orgCheck = required(orgName, 'Organisation name');
  const valid = nameCheck.ok && emailCheck.ok && passwordCheck.ok && matchCheck.ok && orgCheck.ok;

  return (
    <div className="auth auth-wide">
      <form
        className="auth-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) {
            onSubmit?.({
              ownerName,
              ownerEmail,
              password,
              orgName,
              projectName,
              trackPresence,
            });
          }
        }}
      >
        <header className="auth-head">
          <h1 className="auth-title">This instance has no owner yet</h1>
          <p className="auth-host">{host}</p>
          <p className="auth-note">
            You&rsquo;re the first person here. Create the owner account and name the org —
            everything else can wait until you&rsquo;re inside.
          </p>
        </header>

        {serverError !== undefined && (
          <p className="auth-alert" role="alert">
            {serverError}
          </p>
        )}

        <fieldset className="auth-group">
          <legend className="auth-group-title">Owner account</legend>

          <TextInput
            label="Your name"
            value={ownerName}
            onChange={setOwnerName}
            autoComplete="name"
            required
            disabled={submitting}
            error={touched && !nameCheck.ok ? nameCheck.message : undefined}
          />
          <TextInput
            label="Email"
            type="email"
            value={ownerEmail}
            onChange={setOwnerEmail}
            autoComplete="username"
            required
            disabled={submitting}
            error={touched && !emailCheck.ok ? emailCheck.message : undefined}
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
        </fieldset>

        <fieldset className="auth-group">
          <legend className="auth-group-title">Organisation</legend>

          <TextInput
            label="Organisation name"
            value={orgName}
            onChange={setOrgName}
            required
            disabled={submitting}
            error={touched && !orgCheck.ok ? orgCheck.message : undefined}
          />
          <TextInput
            label="First project"
            value={projectName}
            onChange={setProjectName}
            disabled={submitting}
            help="Optional. You can create projects once you are inside."
          />
          <Checkbox
            label="Track presence"
            checked={trackPresence}
            onChange={setTrackPresence}
            disabled={submitting}
            help="Record which repo and task each person is working in. Powers the capacity view."
          />
        </fieldset>

        <Button type="submit" fullWidth busy={submitting} busyLabel="Creating instance…">
          Create instance
        </Button>

        <p className="auth-note">
          Takes about two seconds. This page never appears again — after this, new people arrive by
          invite.
        </p>
      </form>

      <aside className="auth-side">
        <SystemStatus
          migrationsApplied={migrationsApplied}
          migrationsTotal={migrationsTotal}
          smtpConfigured={smtpConfigured}
        />
      </aside>
    </div>
  );
}
