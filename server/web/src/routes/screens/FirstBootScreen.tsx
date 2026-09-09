import { useState } from 'react';
import { Brand } from '../../components/Brand.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { SystemStatus } from './SystemStatus.tsx';
import type { SetupSystemStatus } from '../../api/setup.ts';
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
  /**
   * What the instance reports about itself (§6.4), or `undefined` until the
   * status response lands. Threaded from `AppShell`, which already reads it.
   */
  readonly system?: SetupSystemStatus | undefined;
  readonly host: string;
  /** Laika's version, from `/health`. Absent until it answers. */
  readonly version?: string | undefined;
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
 * First run (LAI-021 AC5, laid out to design `6a` in LAI-075).
 *
 * Two columns: an inverted rail that explains what is about to happen, and the
 * form. Runs once — `POST /setup` is disabled after an org exists (SPEC §3) —
 * which is why the copy says so plainly. Wired in LAI-106.
 *
 * **Still no presence toggle** (LAI-106, and LAI-075 excludes it again).
 * `trackPresence` has no server field; `POST /setup` rejects unknown keys
 * (§6.3), so sending it would fail the whole submission, and showing the
 * checkbox without sending it would be a control that silently does nothing —
 * the exact failure strict validation exists to prevent. → LAI-207.
 *
 * **The status panel is back, carrying only what is true.** It reports the
 * database, which needs no endpoint: migrations run before the port is bound,
 * so a process serving this page has already run them. Migration counts and
 * SMTP state stay absent until LAI-206 gives them a source; the prototype's
 * `migrations 41/41` and `SMTP not configured` are fixtures.
 *
 * **Step 3 does not say "invite people".** The design's third step is *"Invite
 * people and set their roles from Org settings"*, and there is no invites API
 * (LAI-071) and no Org settings screen — it would instruct a new self-hoster to
 * do something impossible on the very first screen they see. Replaced with a
 * step that is true today; the original belongs here once LAI-071 lands.
 *
 * The closing line still says new people arrive by invite, because that is
 * D-004 describing how the instance works, not an instruction to go and do it.
 */
export function FirstBootScreen({
  host,
  version,
  system,
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

  const nameCheck = required(ownerName, 'Full name');
  const emailCheck = validateEmail(ownerEmail);
  const passwordCheck = validatePassword(password);
  const matchCheck = passwordsMatch(password, confirm);
  const orgCheck = required(orgName, 'Org name');
  const valid = nameCheck.ok && emailCheck.ok && passwordCheck.ok && matchCheck.ok && orgCheck.ok;

  return (
    <div className="boot">
      <aside className="boot-rail">
        <div className="boot-rail-brand">
          <Brand />
          {version !== undefined && <span className="boot-version">v{version}</span>}
        </div>

        <div className="boot-rail-lede">
          <h1 className="boot-headline">This instance has no owner yet.</h1>
          <p className="boot-sub">
            You&rsquo;re the first person here. Create the owner account and name the org —
            everything else can wait until you&rsquo;re inside.
          </p>
        </div>

        <ol className="boot-steps">
          <li>
            <span className="boot-step-n" aria-hidden="true">
              1
            </span>
            <span>Owner account and org name — this page.</span>
          </li>
          <li>
            <span className="boot-step-n" aria-hidden="true">
              2
            </span>
            <span>Add an AI provider key when you want agents to run. Skippable.</span>
          </li>
          <li>
            <span className="boot-step-n" aria-hidden="true">
              3
            </span>
            {/* Not "invite people from Org settings": there is no invites API
                (LAI-071) and no Org settings screen, so that step would ask a
                new self-hoster to do something impossible. */}
            <span>Create your first project and start tracking work.</span>
          </li>
        </ol>

        {/* The shell adds no header here (`ownsChrome`), so the theme control
            lives in the rail — LAI-062 AC3 still holds: someone setting an
            instance up at night must be able to stop being dazzled. */}
        <ThemeToggle />

        <SystemStatus system={system} />
      </aside>

      <form
        className="boot-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) {
            onSubmit?.({ ownerName, ownerEmail, password, orgName, projectName });
          }
        }}
      >
        <p className="boot-eyebrow">
          <span className="boot-eyebrow-label">FIRST BOOT</span>
          <span className="boot-host">{host}</span>
        </p>

        {serverError !== undefined && (
          <p className="auth-alert" role="alert">
            {serverError}
          </p>
        )}

        <fieldset className="boot-group">
          <legend className="boot-group-title">
            <span>Owner account</span>
            <span className="boot-rule" aria-hidden="true" />
            <span className="boot-chip">FULL CONTROL</span>
          </legend>

          <div className="boot-grid">
            <TextInput
              label="Full name"
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
              help="Used for sign-in and agent attribution."
              error={touched && !emailCheck.ok ? emailCheck.message : fieldErrors.owner_email}
            />
            <PasswordInput
              label="Password"
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
              {...(confirm !== '' && matchCheck.ok ? { help: 'Matches' } : {})}
              error={touched && !matchCheck.ok ? matchCheck.message : undefined}
            />
          </div>
        </fieldset>

        <fieldset className="boot-group">
          <legend className="boot-group-title">
            <span>Organisation</span>
            <span className="boot-rule" aria-hidden="true" />
          </legend>

          <div className="boot-grid">
            <TextInput
              label="Org name"
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
              help="Optional. Private by default — you can add more later."
              error={fieldErrors.project_name}
            />
          </div>
        </fieldset>

        <footer className="boot-footer">
          <Button type="submit" busy={submitting} busyLabel="Creating instance…">
            Create instance
          </Button>
          <p className="boot-footnote">
            Takes about two seconds. This page never appears again — after this, new people arrive
            by invite.
          </p>
        </footer>
      </form>
    </div>
  );
}
