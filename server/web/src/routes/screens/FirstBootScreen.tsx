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
import './auth.css';

export interface FirstBootSubmit {
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly password: string;
  readonly orgName: string;
  readonly projectName: string;
}

export interface FirstBootScreenProps {
  readonly host: string;
  readonly onSubmit?: ((values: FirstBootSubmit) => void) | undefined;
  readonly submitting?: boolean;
  readonly serverError?: string | undefined;
  /**
   * Per-field complaints from a `422`, keyed by the server's field name
   * (`org_name`, `owner_email`, …). Shown under the matching input rather than
   * as one banner — a form that says "invalid" and leaves you hunting is a form
   * that gets abandoned.
   */
  readonly fieldErrors?: Readonly<Record<string, string>> | undefined;
}

/**
 * First run (LAI-021 AC5). Owner account, org, optional first project, presence
 * opt-in, and the system panel.
 *
 * Runs once — `POST /setup` is disabled after an org exists (SPEC §3) — which is
 * why the copy says so plainly. Wired in LAI-106.
 *
 * **No presence toggle and no system panel**, both deliberately (LAI-106):
 *
 * - `trackPresence` had no server field. `POST /setup` rejects unknown keys
 *   (§6.3), so sending it would have failed the whole submission, and *not*
 *   sending it while still showing the checkbox would have been a control that
 *   silently does nothing — the exact failure strict validation exists to
 *   prevent. → LAI-207.
 * - `SystemStatus` needs migration and SMTP state, and `GET /setup/status`
 *   returns only `setup_required`. Hardcoded numbers on a status panel are
 *   worse than no panel, so the panel waits for real data. → LAI-206. The
 *   component itself is unchanged and still tested.
 */
export function FirstBootScreen({
  host,
  onSubmit,
  submitting = false,
  serverError,
  fieldErrors = {},
}: FirstBootScreenProps) {
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [orgName, setOrgName] = useState('');
  const [projectName, setProjectName] = useState('');
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
            onSubmit?.({ ownerName, ownerEmail, password, orgName, projectName });
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
            error={touched && !nameCheck.ok ? nameCheck.message : fieldErrors.owner_name}
          />
          <TextInput
            label="Email"
            type="email"
            value={ownerEmail}
            onChange={setOwnerEmail}
            autoComplete="username"
            required
            disabled={submitting}
            error={touched && !emailCheck.ok ? emailCheck.message : fieldErrors.owner_email}
          />
          <PasswordInput
            label="Choose a password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
            required
            disabled={submitting}
            error={
              touched && !passwordCheck.ok ? passwordCheck.message : fieldErrors.owner_password
            }
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
            error={touched && !orgCheck.ok ? orgCheck.message : fieldErrors.org_name}
          />
          <TextInput
            label="First project"
            value={projectName}
            onChange={setProjectName}
            disabled={submitting}
            help="Optional. You can create projects once you are inside. Its key is derived from the name."
            error={fieldErrors.project_name}
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
    </div>
  );
}
