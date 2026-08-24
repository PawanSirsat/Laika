import { useState } from 'react';
import type { Sprint, SprintInput } from '../../../api/sprints.ts';
import {
  MIN_SPRINT_DAYS,
  sprintDays,
  toFormValues,
  toSprintInput,
  validateSprintForm,
  type FormErrors,
  type SprintFormValues,
} from './sprint-derive.ts';

const BLANK: SprintFormValues = { name: '', goal: '', startsOn: '', endsOn: '' };

export interface SprintFormProps {
  /** Absent for a new sprint; present when editing an existing one. */
  readonly sprint?: Sprint;
  readonly busy: boolean;
  readonly onSubmit: (input: SprintInput) => Promise<boolean>;
  readonly onCancel: () => void;
}

/**
 * Create or edit one sprint (LAI-083).
 *
 * ## The end date is the last day, and the label says so
 *
 * §4.15 makes `ends_on` inclusive: a sprint ending on the 14th includes the
 * 14th. Every date UI in the world is ambiguous about this, so the field is
 * labelled **"Last day"** rather than "End date", and the live duration under
 * the fields counts inclusively. A reader who picks the 1st and the 14th sees
 * "14 days", which is the only way to be sure the two of us agree.
 *
 * ## What it validates, and what it does not
 *
 * A name, two parseable dates, and the two-day minimum the `CHECK` constraint
 * imposes. **Not overlap** — that depends on sprints this form cannot see, the
 * server owns it, and its `409` names the sprint that collides. Reimplementing
 * it here would produce a second opinion that is wrong whenever two people plan
 * at once, which is the case the server takes a write lock for.
 */
export function SprintForm({ sprint, busy, onSubmit, onCancel }: SprintFormProps) {
  const [values, setValues] = useState<SprintFormValues>(() =>
    sprint === undefined ? BLANK : toFormValues(sprint),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);

  const set = (key: keyof SprintFormValues, value: string): void => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (touched) setErrors(validateSprintForm(next));
  };

  const days =
    values.startsOn !== '' && values.endsOn !== '' && Object.keys(errors).length === 0
      ? durationLabel(values)
      : undefined;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setTouched(true);

    const found = validateSprintForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input = toSprintInput(values);
    if (input === null) return;

    void onSubmit(input).then((ok) => {
      if (ok && sprint === undefined) setValues(BLANK);
    });
  };

  return (
    <form className="sprint-form" onSubmit={submit} noValidate>
      <h2 className="sprint-form-title">{sprint === undefined ? 'New sprint' : 'Edit sprint'}</h2>

      <label className="sprint-field">
        <span className="sprint-label">Name</span>
        <input
          className="sprint-input"
          value={values.name}
          maxLength={120}
          onChange={(e) => {
            set('name', e.target.value);
          }}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : 'sprint-name-error'}
        />
        {errors.name !== undefined && (
          <span className="sprint-error" id="sprint-name-error">
            {errors.name}
          </span>
        )}
      </label>

      <label className="sprint-field">
        <span className="sprint-label">
          Goal <span className="sprint-optional">optional</span>
        </span>
        <textarea
          className="sprint-input sprint-textarea"
          value={values.goal}
          maxLength={500}
          rows={2}
          onChange={(e) => {
            set('goal', e.target.value);
          }}
        />
        {errors.goal !== undefined && <span className="sprint-error">{errors.goal}</span>}
      </label>

      <div className="sprint-dates">
        <label className="sprint-field">
          <span className="sprint-label">First day</span>
          <input
            className="sprint-input"
            type="date"
            value={values.startsOn}
            onChange={(e) => {
              set('startsOn', e.target.value);
            }}
            aria-invalid={errors.startsOn !== undefined}
          />
          {errors.startsOn !== undefined && <span className="sprint-error">{errors.startsOn}</span>}
        </label>

        <label className="sprint-field">
          {/* "Last day", not "Ends on": §4.15's end is inclusive and this is the
              one place a reader can be told so before they get it wrong. */}
          <span className="sprint-label">Last day</span>
          <input
            className="sprint-input"
            type="date"
            value={values.endsOn}
            min={values.startsOn === '' ? undefined : values.startsOn}
            onChange={(e) => {
              set('endsOn', e.target.value);
            }}
            aria-invalid={errors.endsOn !== undefined}
          />
          {errors.endsOn !== undefined && <span className="sprint-error">{errors.endsOn}</span>}
        </label>
      </div>

      <p className="sprint-hint">
        {days ??
          `The last day is included. The shortest sprint is ${String(MIN_SPRINT_DAYS)} days.`}
      </p>

      <div className="sprint-form-actions">
        <button type="submit" className="sprint-button sprint-button-primary" disabled={busy}>
          {busy ? 'Saving…' : sprint === undefined ? 'Create sprint' : 'Save changes'}
        </button>
        <button type="button" className="sprint-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "14 days, 1 Aug to 14 Aug inclusive" — counted the way the server counts. */
function durationLabel(values: SprintFormValues): string | undefined {
  const input = toSprintInput(values);
  if (input === null) return undefined;

  const days = sprintDays(input.starts_on, input.ends_on);
  return `${String(days)} days, last day included.`;
}
