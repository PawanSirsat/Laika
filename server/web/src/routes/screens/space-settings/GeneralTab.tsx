import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { settingsFieldErrors, updateSpace } from '../../../api/space-settings.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { focusFirstInvalid } from '../../../components/forms/field-model.ts';
import { Textarea } from '../../../components/forms/Textarea.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
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
  const sectionRef = useRef<HTMLElement | null>(null);

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
        // Once the refusal has marked its field, take the focus there (LAI-1204):
        // the Save button that was pressed sits below the problem, out of sight.
        requestAnimationFrame(() => {
          focusFirstInvalid(sectionRef.current);
        });
        if (Object.keys(byField).length === 0) {
          setFailure(cause instanceof Error ? cause.message : 'The change was not saved');
        }
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <section className="ss-card" aria-labelledby="ss-general-title" ref={sectionRef}>
      <header className="ss-card-head">
        <h2 id="ss-general-title">General</h2>
        <p>How this space appears across Laika.</p>
      </header>

      <div className="ss-rows">
        {mayEdit ? (
          <TextInput
            layout="row"
            id="ss-name"
            label="Name"
            value={draft.name}
            error={errors.name}
            onChange={(name) => {
              set({ name });
            }}
          />
        ) : (
          <Row label="Name">
            <p className="ss-value">{project.name}</p>
          </Row>
        )}

        {mayEdit ? (
          <TextInput
            layout="row"
            id="ss-prefix"
            label="Key"
            help={KEY_HELP}
            appearance="code"
            width="short"
            value={draft.prefix}
            error={errors.prefix}
            onChange={(prefix) => {
              set({ prefix: prefix.toUpperCase() });
            }}
            after={<KeyNotes next={next} former={project.former_prefixes} />}
          />
        ) : (
          <Row label="Key" help={KEY_HELP}>
            <p className="ss-value ss-mono">{project.prefix}</p>
            <KeyNotes next={next} former={project.former_prefixes} />
          </Row>
        )}

        {mayEdit ? (
          <Textarea
            layout="row"
            id="ss-description"
            label="Description"
            help={DESCRIPTION_HELP}
            rows={3}
            value={draft.description}
            error={errors.description}
            onChange={(description) => {
              set({ description });
            }}
          />
        ) : (
          <Row label="Description" help={DESCRIPTION_HELP}>
            <p className="ss-value">{project.description ?? 'No description yet.'}</p>
          </Row>
        )}

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
                    {on && <Icon name="check" size="small" />}
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

        {mayEdit ? (
          <TextInput
            layout="row"
            id="ss-repo"
            label="Repository"
            help={REPO_HELP}
            appearance="code"
            value={draft.repo}
            placeholder="owner/name"
            error={errors.repo}
            onChange={(repo) => {
              set({ repo });
            }}
          />
        ) : (
          <Row label="Repository" help={REPO_HELP}>
            <p className="ss-value ss-mono">{project.repo ?? 'None'}</p>
          </Row>
        )}
      </div>

      {mayEdit && (
        <footer className="ss-card-foot">
          {failure !== undefined && (
            <p className="ss-field-error ss-foot-error" role="alert">
              {failure}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(draftOf(project));
              setErrors({});
              setFailure(undefined);
            }}
          >
            Discard
          </Button>
          <Button disabled={!dirty} busy={saving} onClick={save}>
            Save changes
          </Button>
        </footer>
      )}
    </section>
  );
}

const KEY_HELP =
  'Prefix for task numbers. Existing tasks keep their numbers. Old keys keep working.';
const DESCRIPTION_HELP = 'Shown on the space card and at the top of the board.';
const REPO_HELP = 'Commits and pull requests that mention a task key link to it.';

/** What the key will make next, and the old keys that still lead here. */
function KeyNotes({
  next,
  former,
}: {
  readonly next: string | undefined;
  readonly former: readonly string[];
}) {
  return (
    <>
      {next !== undefined && (
        <p className="ss-next" data-next-key>
          Next task: {next}
        </p>
      )}
      {former.length > 0 && <p className="ss-next">Also answers to: {former.join(', ')}</p>}
    </>
  );
}

/**
 * A read-only row, or one whose control is not a single labelled field (the
 * colour radiogroup). An editable field is a `Field` in its `row` layout,
 * which draws the same grid with the label wired to the control.
 */
function Row({
  label,
  id,
  help,
  children,
}: {
  readonly label: string;
  readonly id?: string;
  readonly help?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="ss-row">
      <div className="ss-row-label">
        <span className="ss-label" id={id}>
          {label}
        </span>
        {help !== undefined && <p className="ss-help">{help}</p>}
      </div>
      <div className="ss-row-field">{children}</div>
    </div>
  );
}
