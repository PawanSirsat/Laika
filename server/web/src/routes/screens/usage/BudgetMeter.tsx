import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  budgetBadge,
  budgetLine,
  budgetSource,
  parseTokens,
  type Budget,
} from '../../../api/budgets.ts';
import { compactTokens, exactTokens } from '../../../api/usage.ts';

/**
 * One budget as a bar (LAI-773): spent against the budget, a badge from 80%,
 * and where the figure came from. The bar stops at the budget; the words say
 * how far past it the work went. Shared by the Usage page and the task
 * panel's Tokens section.
 */
export function BudgetMeter({
  budget,
  name,
  children,
}: {
  readonly budget: Budget;
  /** What names it — a task's key and title, a sprint, the month. */
  readonly name: ReactNode;
  /** A lead's editor, under the figure. */
  readonly children?: ReactNode;
}) {
  const badge = budgetBadge(budget);
  const width = Math.max(0, Math.min(1, budget.share)) * 100;
  return (
    <div className="budget" data-state={budget.state} data-scope={budget.scope}>
      <div className="budget-head">
        <span className="budget-name">{name}</span>
        {badge !== null && (
          <span className="budget-badge" data-state={budget.state}>
            {badge}
          </span>
        )}
      </div>
      <span
        className="budget-track"
        role="meter"
        aria-label={`${budgetLine(budget)} of the budget`}
        aria-valuemin={0}
        aria-valuemax={budget.tokens}
        aria-valuenow={Math.min(budget.used, budget.tokens)}
      >
        <span className="budget-bar" style={{ width: `${String(width)}%` }} />
      </span>
      <span
        className="budget-line"
        title={`${exactTokens(budget.used)} of ${exactTokens(budget.tokens)} tokens`}
      >
        {budgetLine(budget)} · {budgetSource(budget)}
      </span>
      {children}
    </div>
  );
}

/**
 * A lead's budget editor: a figure as people type one, Set, and Remove — or,
 * for a task, back to the forecast. **Soft**: it sets what an alert is raised
 * against and refuses nothing to anybody.
 */
export function BudgetEditor({
  current,
  onSave,
  removeLabel = 'Remove',
  label,
}: {
  /** The figure set now, or `undefined` for none. */
  readonly current: number | undefined;
  readonly onSave: (tokens: number | null) => Promise<void>;
  readonly removeLabel?: string;
  /** Names the field for a screen reader. */
  readonly label: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = (tokens: number | null): void => {
    setBusy(true);
    setError(undefined);
    onSave(tokens)
      .then(() => {
        setText('');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'The budget did not save.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const tokens = parseTokens(text);
    if (tokens === undefined) {
      setError('A budget is a number of tokens — 2,500,000 or 2.5M.');
      return;
    }
    run(tokens);
  };

  return (
    <form className="budget-editor" onSubmit={submit}>
      <input
        className="input budget-input"
        value={text}
        aria-label={label}
        placeholder={current === undefined ? 'e.g. 2.5M' : compactTokens(current)}
        inputMode="decimal"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <button type="submit" className="usage-chip" disabled={busy}>
        Set
      </button>
      {current !== undefined && (
        <button
          type="button"
          className="usage-chip"
          disabled={busy}
          onClick={() => {
            run(null);
          }}
        >
          {removeLabel}
        </button>
      )}
      {error !== undefined && (
        <span className="usage-form-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
