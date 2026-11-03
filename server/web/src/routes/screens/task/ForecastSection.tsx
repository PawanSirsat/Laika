import { useEffect, useState } from 'react';
import {
  accuracySentence,
  buildLabel,
  claimSentence,
  comparison,
  effortWord,
  getEstimateAccuracy,
  getTaskEstimate,
  getTaskSimilar,
  isRough,
  scopeGrewNote,
  setTaskSize,
  SIZE_LEVELS,
  splitNote,
  timelineLine,
  timeRange,
  tokenAccuracySentence,
  tokenHint,
  tokenLine,
  typicalSentence,
  whyRows,
  type EstimateAccuracy,
  type SizeLevel,
  type TaskEstimate,
  type TaskSimilar,
} from '../../../api/estimates.ts';
import { ApiError } from '../../../api/errors.ts';
import { type TaskSummary } from '../../../api/tasks.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { similarRows } from './rail-derive.ts';
import '../../../components/size-chip.css';
import './forecast.css';

export interface ForecastSectionProps {
  readonly slug: string;
  readonly task: TaskSummary;
  /** May change the effort: anyone who may edit the task (D-085 item 4). */
  readonly mayEdit: boolean;
  /** Re-read when this changes — the task's `updated_at`, kept current by the stream. */
  readonly refreshKey: number;
  /** Who set an effort, by name — provenance, as the reporter is. */
  readonly nameOf: (userId: string) => string;
  /** Open another task: the similar ones are links. */
  readonly onOpen: (taskId: string) => void;
  /** After an effort is set or cleared: the board refetches the task. */
  readonly onChanged: () => void;
  /**
   * The rail's Estimate card (LAI-1122): label-and-value rows — *Effort*,
   * *Similar* with each task's time and why it was sent back, *Actual* — in
   * place of the main column's section. Every control and hook stays.
   */
  readonly compact?: boolean;
}

/** The Change control's value for "no person's effort": Laika's own. */
const COMPUTED = 'computed';

/** `' · '` between the parts of a line, which a screen reader need not say. */
function Sep() {
  return (
    <span className="fc-sep" aria-hidden="true">
      {' · '}
    </span>
  );
}

/**
 * The task panel's Effort section (D-085, LAI-771; plain words since
 * LAI-785), under Acceptance. What a person needs is one or two lines:
 *
 * - **the headline** — the effort in words and the time as one plain range,
 *   *Large · about 1 to 2.5 h*, with *rough estimate* when this project's
 *   estimates have been few or far off; or, without the history for hours,
 *   the effort and what the time waits for, once;
 * - **once it has finished**, one line against the estimate frozen when work
 *   started, with a verdict — *Estimated at start 20–45 min · took 1.5 h ·
 *   well over*, judged on the figures printed — and where the time went,
 *   when more than the build happened;
 * - **the token estimate**, one line, only when there is one.
 *
 * Everything else — *Why Large?* in sentences with arrows, the similar
 * finished tasks as links, what was said at claim, and how good estimates
 * here have been — is folded into one disclosure. **Nothing empty is
 * drawn**: no `—`, no *Early*, no tile waiting for a figure.
 *
 * The headline is the task's own (`TaskView.size`), so it draws at once; the
 * rest is one read each, again whenever `refreshKey` changes. Drawn only once
 * the task has an effort. The API keeps calling it `size`.
 *
 * **Never a figure about a person.** The person who set an effort is named as
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
  compact = false,
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

  // The similar tasks' send-back reasons (LAI-1122), read apart: without
  // them the estimate's own list of similar tasks still stands.
  const [similar, setSimilar] = useState<{ taskId: string; view: TaskSimilar } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!sized || !compact) return undefined;
    const controller = new AbortController();
    getTaskSimilar(task.id, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setSimilar({ taskId: task.id, view: answer });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [task.id, refreshKey, sized, compact]);

  useEffect(() => {
    if (!sized) return undefined;
    const controller = new AbortController();
    getEstimateAccuracy(slug, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setAccuracy(answer);
      })
      // The figure is the disclosure's footnote: without it the rest still reads.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [slug, sized]);

  if (size === null) return null;

  const time = timeRange(size.build_p50_ms, size.build_p80_ms);
  const override = estimate?.override ?? null;
  const chosen = saving ?? (size.overridden ? size.level : COMPUTED);
  const waitFor = accuracy?.forecasts_after ?? 10;
  // How far the project has got, only while it is still short of the mark.
  const soFar =
    accuracy !== undefined && accuracy.finished < accuracy.forecasts_after
      ? ` (${String(accuracy.finished)} so far)`
      : '';
  const rough = time !== null && accuracy !== undefined && isRough(accuracy);

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
        setSaveError(
          err instanceof ApiError ? err.message : 'The effort was not saved. Try again.',
        );
      })
      .finally(() => {
        setSaving(undefined);
      });
  };

  const actual = estimate?.actual;
  // The line and its verdict from one rounding, so they cannot disagree.
  const compared = actual === undefined ? null : comparison(estimate?.at_start ?? null, actual);
  const timeline = actual === undefined ? null : timelineLine(actual);
  const tokens = estimate === undefined ? null : tokenLine(estimate);
  const notes =
    estimate === undefined
      ? []
      : [
          { key: 'scope', text: scopeGrewNote(estimate.scope_grew) },
          { key: 'split', text: splitNote(estimate.split) },
        ].filter((n): n is { key: string; text: string } => n.text !== null);
  const why = estimate?.why ?? null;
  const rows = why === null ? [] : whyRows(why);
  const claim = estimate === undefined ? null : claimSentence(estimate.claim_estimate);
  const told = accuracy === undefined ? null : accuracySentence(accuracy);
  // Tokens, inside the disclosure: their record when there is an estimate to
  // judge, else the one hint about what an estimate waits for.
  const tokenRecord =
    tokens === null || accuracy === undefined ? null : tokenAccuracySentence(accuracy);
  const hint = estimate === undefined || tokens !== null ? null : tokenHint(estimate.tokens);

  const headline = (
    <>
      <div className="fc-headline">
        <p className="fc-head-text">
          {/* The design's level, as the card's chip draws it (LAI-1122); the
              word beside it is what a screen reader says. */}
          {compact && (
            <span className={`size-chip size-chip-${size.level} fc-level`} aria-hidden="true">
              {size.level}
            </span>
          )}
          <strong className={`fc-effort fc-effort-${size.level}`} data-level={size.level}>
            {effortWord(size.level)}
          </strong>
          {time !== null && (
            <>
              <Sep />
              <span className="fc-time">{time}</span>
            </>
          )}
          {rough && (
            <>
              <Sep />
              <span
                className="fc-rough"
                title="Few estimates here have been checked, or they have often been far off. More under Why."
              >
                rough estimate
              </span>
            </>
          )}
        </p>
        {mayEdit && (
          <span className="fc-change-wrap" data-editable="effort">
            <Dropdown
              className="fc-change"
              variant="bare"
              display="Change"
              aria-label="Change effort"
              title="Set the effort by hand, or go back to Laika’s"
              value={chosen}
              disabled={saving !== undefined}
              searchable={false}
              options={[
                {
                  value: COMPUTED,
                  label: `Automatic (${effortWord(size.computed)})`,
                  pinned: true,
                },
                ...SIZE_LEVELS.map((level) => ({ value: level, label: effortWord(level) })),
              ]}
              onChange={pick}
            />
          </span>
        )}
      </div>
    </>
  );
  const extras = (
    <>
      {time === null && (
        <p className="panel-muted fc-wait">
          Time estimate after {waitFor} finished tasks{soFar}
        </p>
      )}
      {size.overridden && (
        <p className="panel-muted fc-set">
          Set by {override === null ? 'a person' : nameOf(override.set_by)}
          <Sep />
          Laika’s estimate: {effortWord(size.computed)}
        </p>
      )}
      {saveError !== undefined && (
        <p className="panel-alert" role="alert">
          {saveError}
        </p>
      )}
    </>
  );
  const actualLines = (
    <>
      {compared !== null && (
        <p className="fc-compare" data-verdict={compared.verdict ?? undefined}>
          {compared.text}
        </p>
      )}
      {timeline !== null && <p className="fc-timeline">{timeline}</p>}
    </>
  );
  const tokenAndNotes = (
    <>
      {tokens !== null && <p className="fc-tokens">{tokens}</p>}
      {notes.length > 0 && (
        <ul className="fc-notes">
          {notes.map((n) => (
            <li key={n.key} className={`fc-note fc-note-${n.key}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const whyFold = (
    <>
      {failed ? (
        <p className="panel-alert" role="alert">
          Could not load why Laika estimated this.
        </p>
      ) : why === null ? null : (
        <details className="fc-why">
          <summary>
            {size.overridden
              ? `Why Laika estimated ${effortWord(size.computed)}`
              : `Why ${effortWord(size.computed)}?`}
          </summary>
          {rows.length > 0 && (
            <ul className="fc-factors">
              {rows.map((r, i) => (
                <li
                  key={`${r.key}-${String(i)}`}
                  className="fc-factor"
                  data-factor={r.key}
                  data-arrow={r.arrow}
                >
                  {/* The sentence says which way; the arrow only repeats it. */}
                  <span
                    className={
                      r.arrow === '↑'
                        ? 'fc-arrow fc-up'
                        : r.arrow === '↓'
                          ? 'fc-arrow fc-down'
                          : 'fc-arrow'
                    }
                    aria-hidden="true"
                  >
                    {r.arrow}
                  </span>
                  <span className="fc-label">{r.text}</span>
                </li>
              ))}
            </ul>
          )}
          {why.similar.length > 0 && (
            <p className="fc-similar">
              <span className="fc-similar-lead">Similar finished tasks:</span>
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
          <p className="fc-typical">{typicalSentence(why)}</p>
          {claim !== null && <p className="fc-claim">{claim}</p>}
          {told !== null && <p className="fc-accuracy">{told}</p>}
          {tokenRecord !== null && <p className="fc-accuracy-tokens">{tokenRecord}</p>}
          {hint !== null && <p className="fc-token-hint">{hint}</p>}
        </details>
      )}
    </>
  );

  if (!compact) {
    return (
      <section className="panel-section fc" aria-label="Effort" data-section="effort">
        <h3 className="panel-section-title">Effort</h3>
        {headline}
        {extras}
        {actualLines}
        {tokenAndNotes}
        {whyFold}
      </section>
    );
  }

  /*
   * **The rail's rows** (LAI-1122): *Effort* — the level, the headline, Change,
   * what the time waits for, who set it, the token line and the notes, and
   * *Why …?* folded under it; *Similar* — each finished task as a link with
   * how long it took and, folded, why it was sent back; *Actual* — the
   * comparison with its verdict and where the time went, or how long it has
   * run so far.
   */
  const similarList =
    why === null
      ? []
      : similarRows(why.similar, similar?.taskId === task.id ? similar.view.similar : undefined);
  const runningMs =
    actual?.build_ms == null && task.started_at !== null && task.status === 'in_progress'
      ? Date.now() - task.started_at
      : null;
  return (
    <section className="panel-section fc fc-compact" aria-label="Effort" data-section="effort">
      <div className="est-row">
        <h3 className="panel-section-title est-label">Effort</h3>
        <div className="est-value">
          {headline}
          {extras}
          {tokenAndNotes}
          {whyFold}
        </div>
      </div>
      {similarList.length > 0 && (
        <div className="est-row est-similar-row">
          <p className="est-label">Similar</p>
          <ul className="est-value est-similar">
            {similarList.map((s) => (
              <li key={s.task_id} className="est-similar-item">
                <span className="est-similar-line">
                  <button
                    type="button"
                    className="est-similar-link"
                    title={s.title}
                    onClick={() => {
                      onOpen(s.task_id);
                    }}
                  >
                    {s.key}
                  </button>
                  <span className="est-similar-title">{s.title}</span>
                </span>
                {s.took !== null && <span className="est-similar-time">{s.took}</span>}
                {s.sentBack.length > 0 && (
                  <details className="est-sent-back">
                    <summary>
                      Sent back
                      {s.sentBack.length > 1 ? ` ${String(s.sentBack.length)} times` : ''}
                    </summary>
                    <ul className="est-sent-back-list">
                      {s.sentBack.map((b, i) => (
                        <li
                          key={`${String(b.round)}-${String(i)}`}
                          className="est-sent-back-reason"
                        >
                          sent back{b.round === null ? '' : ` in round ${String(b.round)}`}:{' '}
                          {b.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(compared !== null || timeline !== null || runningMs !== null) && (
        <div className="est-row est-actual-row">
          <p className="est-label">Actual</p>
          <div className="est-value">
            {runningMs !== null && compared === null && (
              <p className="fc-so-far">{buildLabel(runningMs)} so far</p>
            )}
            {actualLines}
          </div>
        </div>
      )}
    </section>
  );
}
