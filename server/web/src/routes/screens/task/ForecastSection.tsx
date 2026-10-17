import { useEffect, useState } from 'react';
import {
  accuracyLine,
  buildLabel,
  claimNote,
  forecastRange,
  getEstimateAccuracy,
  getTaskEstimate,
  levelsLabel,
  scopeGrewNote,
  setTaskSize,
  SIZE_LEVELS,
  splitNote,
  tokenAccuracyLine,
  tokenRange,
  tokensWaitNote,
  type EstimateAccuracy,
  type SizeLevel,
  type TaskEstimate,
} from '../../../api/estimates.ts';
import { compactTokens, exactTokens } from '../../../api/usage.ts';
import { ApiError } from '../../../api/errors.ts';
import { type Task } from '../../../api/tasks.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { SizeChip } from '../../../components/SizeChip.tsx';
import './forecast.css';

export interface ForecastSectionProps {
  readonly slug: string;
  readonly task: Task;
  /** May set the size: anyone who may edit the task (D-085 item 4). */
  readonly mayEdit: boolean;
  /** Re-read when this changes — the task's `updated_at`, kept current by the stream. */
  readonly refreshKey: number;
  /** Who set a size, by name — provenance, as the reporter is. */
  readonly nameOf: (userId: string) => string;
  /** Open another task: the similar ones are links. */
  readonly onOpen: (taskId: string) => void;
  /** After a size is set or cleared: the board refetches the task. */
  readonly onChanged: () => void;
}

/** The override control's value for "no person's size": Laika's own. */
const COMPUTED = 'computed';

/** Factors smaller than this are rounding; the *why* lists what moved the size. */
const SHOWN = 0.05;

/** `2.0 h`, or a dash for nothing — review wait and rework are often nothing. */
function spent(ms: number): string {
  return ms <= 0 ? '—' : buildLabel(ms);
}

/**
 * The task panel's Forecast section (D-085, LAI-771), under Acceptance: what
 * Laika computed the size to be and why, the build-time range, the forecast
 * frozen when work started against what actually happened, a control to set
 * the size by hand, and how good this project's forecasts have been.
 *
 * The headline — size and range — is the task's own (`TaskView.size`), so it
 * draws at once; the *why*, the actuals and the accuracy are one read each,
 * again whenever `refreshKey` changes. Drawn only once the task has a size.
 *
 * **Phase 2 (LAI-772)**: build tokens forecast beside the hours and frozen at
 * claim with them, the tokens spent beside that, what the claimant said at
 * claim, "scope grew after start", and the split suggestion for an XL task.
 *
 * **Never a figure about a person.** The person who set a size is named as
 * the reporter is; nothing here measures anyone.
 */
export function ForecastSection({
  slug,
  task,
  mayEdit,
  refreshKey,
  nameOf,
  onOpen,
  onChanged,
}: ForecastSectionProps) {
  const [estimate, setEstimate] = useState<TaskEstimate | undefined>(undefined);
  const [accuracy, setAccuracy] = useState<EstimateAccuracy | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const size = task.size ?? null;
  const sized = size !== null;

  useEffect(() => {
    if (!sized) return undefined;
    const controller = new AbortController();
    setFailed(false);
    getTaskEstimate(task.id, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setEstimate(answer);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [task.id, refreshKey, sized]);

  useEffect(() => {
    if (!sized) return undefined;
    const controller = new AbortController();
    getEstimateAccuracy(slug, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setAccuracy(answer);
      })
      // The figure is the section's footnote: without it the rest still reads.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [slug, sized]);

  if (size === null) return null;

  const range = forecastRange(size);
  const override = estimate?.override ?? null;
  const chosen = saving ?? (size.overridden ? size.level : COMPUTED);
  const waitFor = accuracy?.forecasts_after ?? 10;

  const pick = (value: string) => {
    if (value === chosen) return;
    const next = value === COMPUTED ? null : (value as SizeLevel);
    setSaving(value);
    setSaveError(undefined);
    setTaskSize(task.id, next)
      .then(() => {
        onChanged();
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof ApiError ? err.message : 'The size was not saved. Try again.');
      })
      .finally(() => {
        setSaving(undefined);
      });
  };

  const atStart = estimate?.at_start ?? null;
  const actual = estimate?.actual;
  const tokens = estimate?.tokens;
  const tokensSpent = estimate?.actual_tokens ?? null;
  const atStartTokens =
    atStart === null ? null : tokenRange({ p50: atStart.tokens_p50, p80: atStart.tokens_p80 });
  const notes =
    estimate === undefined
      ? []
      : [
          { key: 'scope', text: scopeGrewNote(estimate.scope_grew) },
          { key: 'split', text: splitNote(estimate.split) },
          { key: 'claim', text: claimNote(estimate.claim_estimate) },
        ].filter((n): n is { key: string; text: string } => n.text !== null);
  const why = estimate?.why ?? null;
  const factors = (why?.factors ?? []).filter(
    (f) => Math.abs(f.levels) >= SHOWN || f.key === 'words' || f.key === 'priority',
  );

  return (
    <section className="panel-section fc" aria-label="Forecast" data-section="forecast">
      <h3 className="panel-section-title">Forecast</h3>

      <div className="fc-head">
        <span className="fc-size">
          <SizeChip size={size} />
        </span>
        <span className="fc-size-note">
          {size.overridden
            ? `Set by ${override === null ? 'a person' : nameOf(override.set_by)} · Laika computed ${size.computed}`
            : 'Computed by Laika from this task and the project’s finished work'}
        </span>
        {mayEdit && (
          <span className="fc-override">
            <span className="fc-override-label" id={`fc-size-${task.id}`}>
              Size
            </span>
            <Dropdown
              className="fc-override-select"
              aria-labelledby={`fc-size-${task.id}`}
              value={chosen}
              disabled={saving !== undefined}
              searchable={false}
              title="Set the size by hand, or go back to Laika’s"
              options={[
                { value: COMPUTED, label: `Laika’s (${size.computed})`, pinned: true },
                ...SIZE_LEVELS.map((level) => ({ value: level, label: level })),
              ]}
              onChange={pick}
            />
          </span>
        )}
      </div>
      {saveError !== undefined && (
        <p className="panel-alert" role="alert">
          {saveError}
        </p>
      )}

      <dl className="fc-figures">
        <div className="fc-figure">
          <dt>Build time</dt>
          <dd className="fc-range">{range ?? 'Early'}</dd>
        </div>
        <div className="fc-figure">
          <dt>At start</dt>
          <dd className="fc-at-start">
            {atStart === null
              ? 'Not started'
              : `${atStart.level} · ${forecastRange({ ...size, build_p50_ms: atStart.build_p50_ms, build_p80_ms: atStart.build_p80_ms }) ?? 'early'}${atStartTokens === null ? '' : ` · ${atStartTokens} tokens`}`}
          </dd>
        </div>
        <div className="fc-figure">
          <dt>Tokens</dt>
          <dd
            className="fc-tokens"
            title="Build tokens: input, output and cache writes up to the first finish"
          >
            {tokens === undefined ? '—' : (tokenRange(tokens) ?? 'Early')}
          </dd>
        </div>
        <div className="fc-figure">
          <dt>Actual build</dt>
          <dd className="fc-actual">
            {actual?.build_ms == null ? '—' : buildLabel(actual.build_ms)}
          </dd>
        </div>
        <div className="fc-figure">
          <dt>Actual tokens</dt>
          <dd
            className="fc-actual-tokens"
            title={
              tokensSpent === null
                ? 'None tied to this task yet'
                : `At least ${exactTokens(tokensSpent.build)} on the build, ${exactTokens(tokensSpent.rework)} after it`
            }
          >
            {tokensSpent === null
              ? '—'
              : `${compactTokens(tokensSpent.build)}${actual?.first_finish_at == null ? ' so far' : ''}`}
          </dd>
        </div>
        <div className="fc-figure">
          <dt>Review wait</dt>
          <dd className="fc-review-wait">
            {actual === undefined ? '—' : spent(actual.review_wait_ms)}
          </dd>
        </div>
        <div className="fc-figure">
          <dt>Rework</dt>
          <dd className="fc-rework">{actual === undefined ? '—' : spent(actual.rework_ms)}</dd>
        </div>
      </dl>

      {range === null && (
        <p className="panel-muted fc-early">
          Early: hours after {waitFor} finished tasks in this project. The size is from the text
          alone until then.
        </p>
      )}
      {tokens !== undefined && range !== null && tokensWaitNote(tokens) !== null && (
        <p className="panel-muted fc-tokens-early">{tokensWaitNote(tokens)}</p>
      )}
      {notes.length > 0 && (
        <ul className="fc-notes">
          {notes.map((n) => (
            <li key={n.key} className={`fc-note fc-note-${n.key}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}

      {failed ? (
        <p className="panel-alert" role="alert">
          Could not load why this task is this size.
        </p>
      ) : why === null ? null : (
        <div className="fc-why">
          <p className="fc-why-title">
            Why {size.computed}
            <span className="fc-why-typical">
              {' '}
              · a typical task here has {why.typical.words} words
              {why.typical.build_ms === null
                ? ''
                : ` and takes ${buildLabel(why.typical.build_ms)}`}
            </span>
          </p>
          <ul className="fc-factors">
            {factors.map((f, i) => (
              <li key={`${f.key}-${String(i)}`} className="fc-factor" data-factor={f.key}>
                <span
                  className={
                    f.levels > 0
                      ? 'fc-levels fc-up'
                      : f.levels < 0
                        ? 'fc-levels fc-down'
                        : 'fc-levels'
                  }
                >
                  {levelsLabel(f.levels)}
                </span>
                <span className="fc-label">{f.label}</span>
              </li>
            ))}
          </ul>
          {why.similar.length > 0 && (
            <p className="fc-similar">
              <span className="fc-similar-lead">Like</span>
              {why.similar.map((s) => (
                <span key={s.task_id} className="fc-similar-item">
                  <button
                    type="button"
                    className="fc-similar-link"
                    title={s.title}
                    onClick={() => {
                      onOpen(s.task_id);
                    }}
                  >
                    {s.key}
                  </button>
                  <span className="fc-similar-time">{buildLabel(s.build_ms)}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {accuracy !== undefined && (
        <>
          <p className="fc-accuracy">This project: {accuracyLine(accuracy)}</p>
          <p className="fc-accuracy-tokens">{tokenAccuracyLine(accuracy)}</p>
        </>
      )}
    </section>
  );
}
