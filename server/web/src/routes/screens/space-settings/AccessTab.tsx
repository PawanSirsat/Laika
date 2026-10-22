import { useState } from 'react';
import { Switch } from '../../../components/Switch.tsx';
import type { Project } from '../../../api/projects.ts';
import { updateSpace, type SpaceSettingsPatch } from '../../../api/space-settings.ts';

export interface AccessTabProps {
  readonly project: Project;
  readonly orgName: string | undefined;
  readonly mayEdit: boolean;
  readonly onSaved: (project: Project) => void;
}

/** Which control a save, or its refusal, belongs to. */
type Setting = 'visibility' | 'task_create_min_role' | 'agents_allowed';

/**
 * Who sees the space and how work moves through it (D-103 items 6–9).
 *
 * **Each change saves on its own, at once** — the design says so at the top
 * — and a refusal is said beside the control that was refused, which then
 * shows what the server still holds. *Person sign-off for Done* is not a
 * setting (item 8): it is drawn on and locked, with the reason. *Join without
 * approval* is not drawn at all until LAI-980.
 */
export function AccessTab({ project, orgName, mayEdit, onSaved }: AccessTabProps) {
  const [pending, setPending] = useState<Setting | undefined>(undefined);
  const [failed, setFailed] = useState<{ readonly setting: Setting; readonly message: string }>();
  const [confirmingPublic, setConfirmingPublic] = useState(false);

  const save = (setting: Setting, patch: SpaceSettingsPatch): void => {
    setPending(setting);
    setFailed(undefined);
    updateSpace(project.slug, patch)
      .then(onSaved)
      .catch((cause: unknown) => {
        setFailed({
          setting,
          message: cause instanceof Error ? cause.message : 'The change was not saved',
        });
      })
      .finally(() => {
        setPending(undefined);
      });
  };

  const errorFor = (setting: Setting) =>
    failed?.setting === setting ? (
      <p className="ss-field-error" role="alert" data-error={setting}>
        Not saved: {failed.message}
      </p>
    ) : null;

  const org = orgName ?? 'the organisation';

  return (
    <section className="ss-card" aria-labelledby="ss-access-title">
      <header className="ss-card-head ss-card-head-split">
        <div>
          <h2 id="ss-access-title">Access &amp; rules</h2>
          <p>Who can see this space and how work moves through it.</p>
        </div>
        {mayEdit && <p className="ss-immediate">Changes save immediately</p>}
      </header>

      <div className="ss-rows">
        <div className="ss-row ss-row-stack">
          <div className="ss-row-label">
            <span className="ss-label" id="ss-visibility-label">
              Visibility
            </span>
          </div>
          <div className="ss-row-field">
            <div
              className="ss-choice-cards"
              role="radiogroup"
              aria-labelledby="ss-visibility-label"
            >
              {(
                [
                  ['private', 'Private', 'Only members can see the board.'],
                  ['public', 'Public', `Anyone in ${org} can find it and join.`],
                ] as const
              ).map(([value, title, body]) => {
                const on = project.visibility === value;
                const card = (
                  <>
                    <span className="ss-choice-title">{title}</span>
                    <span className="ss-choice-body">{body}</span>
                  </>
                );
                return mayEdit ? (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-visibility={value}
                    disabled={pending !== undefined}
                    className={on ? 'ss-choice ss-choice-on' : 'ss-choice'}
                    onClick={() => {
                      if (on) return;
                      if (value === 'public') setConfirmingPublic(true);
                      else {
                        setConfirmingPublic(false);
                        save('visibility', { visibility: value });
                      }
                    }}
                  >
                    {card}
                  </button>
                ) : (
                  <div
                    key={value}
                    className={
                      on ? 'ss-choice ss-choice-on ss-choice-static' : 'ss-choice ss-choice-static'
                    }
                    data-visibility={value}
                    aria-current={on ? 'true' : undefined}
                  >
                    {card}
                  </div>
                );
              })}
            </div>
            {confirmingPublic && project.visibility !== 'public' && (
              <div className="ss-confirm" role="alertdialog" aria-label="Make this space public?">
                <p>Everyone in {org} will see this space and its work, and can join it.</p>
                <div className="ss-confirm-actions">
                  <button
                    type="button"
                    className="ss-btn ss-btn-primary"
                    onClick={() => {
                      setConfirmingPublic(false);
                      save('visibility', { visibility: 'public' });
                    }}
                  >
                    Make public
                  </button>
                  <button
                    type="button"
                    className="ss-btn"
                    onClick={() => {
                      setConfirmingPublic(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {errorFor('visibility')}
          </div>
        </div>

        <div className="ss-row">
          <div className="ss-row-label">
            <span className="ss-label" id="ss-create-label">
              Who can create tasks
            </span>
            <p className="ss-help">Viewers can never create tasks.</p>
          </div>
          <div className="ss-row-field ss-row-field-end">
            {mayEdit ? (
              <div className="ss-segmented" role="radiogroup" aria-labelledby="ss-create-label">
                {(
                  [
                    ['member', 'Members'],
                    ['lead', 'Space admins only'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={project.task_create_min_role === value}
                    data-create={value}
                    disabled={pending !== undefined}
                    onClick={() => {
                      if (project.task_create_min_role !== value) {
                        save('task_create_min_role', { task_create_min_role: value });
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="ss-value">
                {project.task_create_min_role === 'lead' ? 'Space admins only' : 'Members'}
              </p>
            )}
            {errorFor('task_create_min_role')}
          </div>
        </div>

        <div className="ss-row">
          <div className="ss-row-label">
            <span className="ss-label" id="ss-agents-label">
              Agent sessions
            </span>
            <p className="ss-help" id="ss-agents-help">
              Agents can open sessions and claim tasks in this space.
            </p>
          </div>
          <div className="ss-row-field ss-row-field-end">
            {mayEdit ? (
              <Switch
                checked={project.agents_allowed}
                labelledBy="ss-agents-label"
                describedBy="ss-agents-help"
                disabled={pending !== undefined}
                className="ss-switch"
                onChange={(on) => {
                  save('agents_allowed', { agents_allowed: on });
                }}
              />
            ) : (
              <p className="ss-value">{project.agents_allowed ? 'On' : 'Off'}</p>
            )}
            {errorFor('agents_allowed')}
          </div>
        </div>

        <div className="ss-row">
          <div className="ss-row-label">
            <span className="ss-label" id="ss-signoff-label">
              Person sign-off for Done
            </span>
            <p className="ss-help" id="ss-signoff-help">
              Agent-claimed proof lands in Review. Only a person can move a task to Done.
            </p>
          </div>
          <div className="ss-row-field ss-row-field-end">
            {/* Locked on, everywhere, for everyone: Laika's rule, not this space's (D-103 item 8). */}
            <Switch
              checked
              disabled
              labelledBy="ss-signoff-label"
              describedBy="ss-signoff-lock"
              className="ss-switch ss-switch-locked"
              onChange={() => {
                // Never: the switch is disabled, and Done is a person's.
              }}
            />
            <p className="ss-lock" id="ss-signoff-lock" title="Laika's rule — not a setting">
              <svg
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Always on — Laika&rsquo;s rule, not a setting
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
