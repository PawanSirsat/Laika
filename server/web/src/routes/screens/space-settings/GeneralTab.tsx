import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../../api/projects.ts';
import { settingsFieldErrors, updateSpace } from '../../../api/space-settings.ts';
import { Button } from '../../../components/forms/Button.tsx';
import { focusFirstInvalid } from '../../../components/forms/field-model.ts';
import { Textarea } from '../../../components/forms/Textarea.tsx';
import { TextInput } from '../../../components/forms/TextInput.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { SaveStatus, useSaveStatus } from '../../../components/SaveStatus.tsx';
import { SPACE_COLORS, spaceColor, spaceColorVar } from '../../../theme/space-color.ts';
import {
  colorLabel,
  draftOf,
  generalIssues,
  generalPatch,
  isDirty,
  keyChange,
  nextTaskKey,
  repoFromPaste,
  type GeneralDraft,
} from './space-settings-model.ts';
import { onRadioGroupKeyDown, radioTabIndex } from './radio-keys.ts';

export interface GeneralTabProps {
  readonly project: Project;
  /** The space's task counts, from the list; `undefined` until read. */
  readonly counts: Readonly<Record<string, number>> | undefined;
  readonly mayEdit: boolean;
  readonly onSaved: (project: Project) => void;
  /**
   * Whether the form holds changes not yet saved, so the screen can ask before
   * a tab switch throws them away (B11). Told `false` when the tab goes.
   */
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

/**
 * Name, key, description, colour and repository (D-103 items 3 and 4).
 *
 * **A form with Save, not instant saves**: a key change re-keys every new
 * task, and a half-typed name should not land on everybody's sidebar. The
 * server's refusal goes under the field it names — a `422` from validation,
 * a `409` for a prefix another space holds or held.
 *
 * Beside Save, *Saving… / Saved / Couldn't save — Retry* (`SaveStatus`,
 * LAI-1129), *Saved* only on the server's answer. **Unsaved changes are
 * guarded** (B11): the screen asks before another tab replaces this one, and
 * the browser warns before the page is reloaded or left.
 *
 * **Checked as typed** (LAI-1211): each field is held to the server's own rule
 * (`generalIssues`) from the moment it is left, and Save waits until nothing
 * is wrong, saying why. A key change says what it does before it is saved; a
 * pasted repository link offers its `owner/name` in one click. The bar holding
 * Save stays in view while there is something to save.
 */
export function GeneralTab({ project, counts, mayEdit, onSaved, onDirtyChange }: GeneralTabProps) {
  const [draft, setDraft] = useState<GeneralDraft>(() => draftOf(project));
  const status = useSaveStatus();
  const saving = status.state.kind === 'saving';
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  /** Fields left at least once: their problems show from then on, as typed. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const sectionRef = useRef<HTMLElement | null>(null);
  /**
   * Bumped when a refusal — the server's, or the client's own check on Save —
   * has marked its field. The focus moves in an effect, **after** React has
   * committed the mark: a `requestAnimationFrame` from the handler could run
   * before the commit and find nothing marked yet.
   */
  const [focusInvalid, setFocusInvalid] = useState(0);
  useEffect(() => {
    if (focusInvalid > 0) focusFirstInvalid(sectionRef.current);
  }, [focusInvalid]);

  // A save, or another tab's change, gives a new project: start from it.
  useEffect(() => {
    setDraft(draftOf(project));
  }, [project]);

  const dirty = mayEdit && isDirty(project, draft);
  const issues = mayEdit ? generalIssues(draft) : {};
  const issueCount = Object.keys(issues).length;
  /** The server's refusal for a field, else the rule it breaks once it has been left. */
  const problem = (field: string): string | undefined =>
    errors[field] ?? (touched.has(field) ? issues[field] : undefined);
  const leave = (field: string) => (): void => {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  };
  const change = keyChange(project, draft.prefix, counts);
  const pastedRepo = repoFromPaste(draft.repo);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  // Reloading or leaving the page with changes unsaved gets the browser's own warning.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
  const next = nextTaskKey(mayEdit ? draft.prefix : project.prefix, counts);

  const set = (patch: Partial<GeneralDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setFailure(undefined);
    // A server refusal was about the value before this edit.
    setErrors((current) => {
      const keys = Object.keys(patch).filter((k) => k in current);
      if (keys.length === 0) return current;
      const next = { ...current };
      for (const k of keys) delete next[k];
      return next;
    });
    // *Saved* was about the values before this edit.
    status.reset();
  };

  // The whole save — its answer handled too — is what Retry runs again.
  const save = (): void => {
    if (issueCount > 0) {
      setTouched(new Set(Object.keys(issues)));
      setFocusInvalid((n) => n + 1);
      return;
    }
    const patch = generalPatch(project, draft);
    status
      .run(() => {
        setErrors({});
        setFailure(undefined);
        return updateSpace(project.slug, patch).then(onSaved, (cause: unknown) => {
          const byField = settingsFieldErrors(cause);
          setErrors(byField);
          // Once the refusal has marked its field, take the focus there (LAI-1204):
          // the Save button that was pressed sits below the problem, out of sight.
          setFocusInvalid((n) => n + 1);
          if (Object.keys(byField).length === 0) {
            setFailure(cause instanceof Error ? cause.message : 'The change was not saved');
          }
          throw cause;
        });
      })
      .catch(() => {
        // Said under the field it names, or above Save, and by the status.
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
            required
            value={draft.name}
            error={problem('name')}
            onBlur={leave('name')}
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
            required
            value={draft.prefix}
            error={problem('prefix')}
            onBlur={leave('prefix')}
            onChange={(prefix) => {
              set({ prefix: prefix.toUpperCase() });
            }}
            after={
              <>
                <KeyNotes next={next} former={project.former_prefixes} />
                {change !== undefined && <KeyChangeNote change={change} />}
              </>
            }
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
            error={errors.description ?? issues.description}
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
            <div className="ss-swatch-pick">
              <div
                className="ss-swatches"
                role="radiogroup"
                aria-labelledby="ss-colour-label"
                onKeyDown={onRadioGroupKeyDown}
              >
                {SPACE_COLORS.map((colour, index) => {
                  const on = (draft.color ?? spaceColor(project)) === colour;
                  return (
                    <button
                      key={colour}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={colorLabel(colour)}
                      title={colorLabel(colour)}
                      tabIndex={radioTabIndex(on, index, true)}
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
              <span className="ss-swatch-name" aria-hidden="true" data-colour-name>
                {colorLabel(draft.color ?? spaceColor(project))}
              </span>
            </div>
          ) : (
            <p className="ss-value">
              <span
                className="ss-swatch ss-swatch-static"
                style={{ background: spaceColorVar(spaceColor(project)) }}
                aria-hidden="true"
              />{' '}
              {colorLabel(spaceColor(project))}
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
            error={problem('repo') ?? (pastedRepo !== undefined ? issues.repo : undefined)}
            onBlur={leave('repo')}
            onChange={(repo) => {
              set({ repo });
            }}
            after={
              pastedRepo !== undefined && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-action="use-repo"
                  onClick={() => {
                    set({ repo: pastedRepo });
                  }}
                >
                  {`Use ${pastedRepo}`}
                </Button>
              )
            }
          />
        ) : (
          <Row label="Repository" help={REPO_HELP}>
            <p className="ss-value ss-mono">{project.repo ?? 'None'}</p>
          </Row>
        )}
      </div>

      {mayEdit && (
        <footer
          className={dirty ? 'ss-card-foot ss-save-bar ss-save-bar-on' : 'ss-card-foot ss-save-bar'}
          data-save-bar
        >
          {dirty && (
            <p className="ss-unsaved" data-unsaved>
              {issueCount > 0
                ? `Fix ${issueCount === 1 ? 'the field' : `${String(issueCount)} fields`} marked above to save`
                : 'Unsaved changes'}
            </p>
          )}
          <SaveStatus className="ss-save-status" state={status.state} onRetry={status.retry} />
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
              setTouched(new Set());
              status.reset();
            }}
          >
            Discard
          </Button>
          <Button disabled={!dirty} busy={saving} onClick={save} data-action="save-general">
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
const REPO_HELP =
  'owner/name, as git reports it — not a link. Commits and pull requests that mention a task key link to it.';

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
 * What saving a new key does, said before it is saved (LAI-1211): the next
 * task's key, that existing tasks keep theirs, and that the old key keeps
 * opening them — the server keeps every former prefix resolving.
 */
function KeyChangeNote({ change }: { readonly change: NonNullable<ReturnType<typeof keyChange>> }) {
  const n = change.existing;
  const kept =
    n === 0
      ? 'There are no tasks yet, so nothing else changes.'
      : n === undefined
        ? `Existing tasks keep their ${change.from}- keys, and those keys keep opening them.`
        : n === 1
          ? `The existing task keeps its ${change.from}- key, and ${change.from}-1 keeps opening it.`
          : `The ${String(n)} existing tasks keep their ${change.from}- keys, and ${change.from}-1 keeps opening ${change.from}-1.`;
  return (
    <div className="ss-key-change" role="note" data-key-change>
      <Icon name="alert" size="small" />
      <p>
        <strong>
          {change.next === undefined
            ? `New tasks will start ${change.to}-.`
            : `New tasks will be ${change.next} onwards.`}
        </strong>{' '}
        {kept}
      </p>
    </div>
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
