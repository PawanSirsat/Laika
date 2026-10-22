import { useEffect, useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { settingsFieldErrors, updateSpace } from '../../../api/space-settings.ts';
import { SPACE_COLORS, spaceColor, spaceColorVar } from '../../../theme/space-color.ts';
import {
  draftOf,
  generalPatch,
  isDirty,
  nextTaskKey,
  type GeneralDraft,
} from './space-settings-model.ts';

export interface GeneralTabProps {
  readonly project: Project;
  /** The space's task counts, from the list; `undefined` until read. */
  readonly counts: Readonly<Record<string, number>> | undefined;
  readonly mayEdit: boolean;
  readonly onSaved: (project: Project) => void;
}

/**
 * Name, key, description, colour and repository (D-103 items 3 and 4).
 *
 * **A form with Save, not instant saves**: a key change re-keys every new
 * task, and a half-typed name should not land on everybody's sidebar. The
 * server's refusal goes under the field it names — a `422` from validation,
 * a `409` for a prefix another space holds or held.
 */
export function GeneralTab({ project, counts, mayEdit, onSaved }: GeneralTabProps) {
  const [draft, setDraft] = useState<GeneralDraft>(() => draftOf(project));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // A save, or another tab's change, gives a new project: start from it.
  useEffect(() => {
    setDraft(draftOf(project));
  }, [project]);

  const dirty = isDirty(project, draft);
  const next = nextTaskKey(mayEdit ? draft.prefix : project.prefix, counts);

  const set = (patch: Partial<GeneralDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setFailure(undefined);
  };

  const save = (): void => {
    setSaving(true);
    setErrors({});
    setFailure(undefined);
    updateSpace(project.slug, generalPatch(project, draft))
      .then(onSaved)
      .catch((cause: unknown) => {
        const byField = settingsFieldErrors(cause);
        setErrors(byField);
        if (Object.keys(byField).length === 0) {
          setFailure(cause instanceof Error ? cause.message : 'The change was not saved');
        }
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <section className="ss-card" aria-labelledby="ss-general-title">
      <header className="ss-card-head">
        <h2 id="ss-general-title">General</h2>
        <p>How this space appears across Laika.</p>
      </header>

      <div className="ss-rows">
        <Row label="Name" htmlFor="ss-name">
          {mayEdit ? (
            <Input
              id="ss-name"
              value={draft.name}
              error={errors.name}
              onChange={(name) => {
                set({ name });
              }}
            />
          ) : (
            <p className="ss-value">{project.name}</p>
          )}
        </Row>

        <Row
          label="Key"
          htmlFor="ss-prefix"
          help="Prefix for task numbers. Existing tasks keep their numbers. Old keys keep working."
        >
          {mayEdit ? (
            <Input
              id="ss-prefix"
              className="ss-input-key"
              value={draft.prefix}
              error={errors.prefix}
              onChange={(prefix) => {
                set({ prefix: prefix.toUpperCase() });
              }}
            />
          ) : (
            <p className="ss-value ss-mono">{project.prefix}</p>
          )}
          {next !== undefined && (
            <p className="ss-next" data-next-key>
              Next task: {next}
            </p>
          )}
          {project.former_prefixes.length > 0 && (
            <p className="ss-next">Also answers to: {project.former_prefixes.join(', ')}</p>
          )}
        </Row>

        <Row
          label="Description"
          htmlFor="ss-description"
          help="Shown on the space card and at the top of the board."
        >
          {mayEdit ? (
            <>
              <textarea
                id="ss-description"
                className="ss-textarea"
                rows={3}
                value={draft.description}
                aria-invalid={errors.description !== undefined}
                aria-describedby={
                  errors.description === undefined ? undefined : 'ss-description-error'
                }
                onChange={(event) => {
                  set({ description: event.target.value });
                }}
              />
              {errors.description !== undefined && (
                <p className="ss-field-error" id="ss-description-error" role="alert">
                  {errors.description}
                </p>
              )}
            </>
          ) : (
            <p className="ss-value">{project.description ?? 'No description yet.'}</p>
          )}
        </Row>

        <Row label="Colour" id="ss-colour-label">
          {mayEdit ? (
            <div className="ss-swatches" role="radiogroup" aria-labelledby="ss-colour-label">
              {SPACE_COLORS.map((colour) => {
                const on = (draft.color ?? spaceColor(project)) === colour;
                return (
                  <button
                    key={colour}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={colour}
                    title={colour}
                    data-swatch={colour}
                    className={on ? 'ss-swatch ss-swatch-on' : 'ss-swatch'}
                    style={{ background: spaceColorVar(colour) }}
                    onClick={() => {
                      set({ color: colour });
                    }}
                  >
                    {on && <span aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="ss-value">
              <span
                className="ss-swatch ss-swatch-static"
                style={{ background: spaceColorVar(spaceColor(project)) }}
                aria-hidden="true"
              />{' '}
              {spaceColor(project)}
            </p>
          )}
          {errors.color !== undefined && (
            <p className="ss-field-error" role="alert">
              {errors.color}
            </p>
          )}
        </Row>

        <Row
          label="Repository"
          htmlFor="ss-repo"
          help="Commits and pull requests that mention a task key link to it."
        >
          {mayEdit ? (
            <Input
              id="ss-repo"
              className="ss-mono"
              value={draft.repo}
              placeholder="owner/name"
              error={errors.repo}
              onChange={(repo) => {
                set({ repo });
              }}
            />
          ) : (
            <p className="ss-value ss-mono">{project.repo ?? 'None'}</p>
          )}
        </Row>
      </div>

      {mayEdit && (
        <footer className="ss-card-foot">
          {failure !== undefined && (
            <p className="ss-field-error ss-foot-error" role="alert">
              {failure}
            </p>
          )}
          <button
            type="button"
            className="ss-btn"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(draftOf(project));
              setErrors({});
              setFailure(undefined);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="ss-btn ss-btn-primary"
            disabled={!dirty || saving}
            aria-busy={saving}
            onClick={save}
          >
            Save changes
          </button>
        </footer>
      )}
    </section>
  );
}

function Row({
  label,
  htmlFor,
  id,
  help,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly id?: string;
  readonly help?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="ss-row">
      <div className="ss-row-label">
        {htmlFor === undefined ? (
          <span className="ss-label" id={id}>
            {label}
          </span>
        ) : (
          <label className="ss-label" htmlFor={htmlFor} id={id}>
            {label}
          </label>
        )}
        {help !== undefined && <p className="ss-help">{help}</p>}
      </div>
      <div className="ss-row-field">{children}</div>
    </div>
  );
}

function Input({
  id,
  value,
  onChange,
  error,
  className,
  placeholder,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly className?: string;
  readonly placeholder?: string;
}) {
  return (
    <>
      <input
        id={id}
        type="text"
        className={className === undefined ? 'ss-input' : `ss-input ${className}`}
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error !== undefined && (
        <p className="ss-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
