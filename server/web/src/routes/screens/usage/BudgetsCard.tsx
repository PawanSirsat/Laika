import { useEffect, useState } from 'react';
import {
  getProjectBudgets,
  setProjectBudget,
  setSprintBudget,
  type Budget,
  type ProjectBudgets,
} from '../../../api/budgets.ts';
import { everyPage } from '../../../api/every-page.ts';
import { listSprints, type Sprint } from '../../../api/sprints.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { BudgetEditor, BudgetMeter } from './BudgetMeter.tsx';

/**
 * Budgets on the Usage page (LAI-773): each space's monthly budget and its
 * sprints', then the open tasks at 80% of theirs or more — a lead's frozen
 * forecast p80 unless one was set. **Soft**: crossing 80% or 100% raises an
 * alert once and nothing is ever refused.
 *
 * In a space a lead may set the month's budget and a sprint's — when the
 * server says so (`can_set`), never by trying and showing a refusal. Across
 * all spaces the budgets are read-only, and the card says where to set them.
 */
export function BudgetsCard({
  budgets,
  space,
  onChanged,
}: {
  readonly budgets: readonly Budget[];
  /** The space read, or `null` for the whole organisation. */
  readonly space: { readonly slug: string; readonly name: string } | null;
  /** The figures moved: read the page again. */
  readonly onChanged: () => void;
}) {
  const [own, setOwn] = useState<ProjectBudgets | undefined>(undefined);
  const [sprints, setSprints] = useState<readonly Sprint[]>([]);
  const [adding, setAdding] = useState<string>('');
  const [asked, setAsked] = useState(0);

  const slug = space?.slug;
  useEffect(() => {
    setOwn(undefined);
    if (slug === undefined) return;
    const controller = new AbortController();
    getProjectBudgets(slug, controller.signal)
      .then((answer) => {
        if (controller.signal.aborted) return;
        setOwn(answer);
        if (!answer.can_set) return;
        // Every page: a sprint left off the first would be one a lead
        // could not budget (LAI-703).
        everyPage((cursor) =>
          listSprints(
            slug,
            cursor === undefined ? { limit: 100 } : { limit: 100, cursor },
            controller.signal,
          ),
        )
          .then(({ items }) => {
            if (!controller.signal.aborted) {
              setSprints(items.filter((s) => s.status !== 'completed'));
            }
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [slug, asked]);

  const changed = (): void => {
    setAsked((n) => n + 1);
    onChanged();
  };

  const canSet = own?.can_set === true;
  const monthly = budgets.filter((b) => b.scope === 'project');
  const ofSprints = budgets.filter((b) => b.scope === 'sprint');
  const ofTasks = budgets.filter((b) => b.scope === 'task');
  const unbudgeted = sprints.filter((s) => !ofSprints.some((b) => b.id === s.id));

  return (
    <section
      className="prof-card usage-card usage-budgets"
      data-section="budgets"
      aria-labelledby="usage-budgets-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-budgets-title">
          Budgets
        </h3>
        <span className="prof-card-caption">soft · alerts at 80% and 100%, nothing blocked</span>
      </header>

      {space !== null && (
        <div className="usage-budget-group" data-group="month">
          <h4 className="usage-person-h">This month in {space.name}</h4>
          {monthly[0] !== undefined ? (
            <BudgetMeter budget={monthly[0]} name="Monthly budget">
              {canSet && (
                <BudgetEditor
                  current={monthly[0].tokens}
                  label={`Monthly token budget for ${space.name}`}
                  onSave={(tokens) => setProjectBudget(space.slug, tokens).then(changed)}
                />
              )}
            </BudgetMeter>
          ) : (
            <>
              <p className="prof-empty">No monthly budget.</p>
              {canSet && (
                <BudgetEditor
                  current={undefined}
                  label={`Monthly token budget for ${space.name}`}
                  onSave={(tokens) => setProjectBudget(space.slug, tokens).then(changed)}
                />
              )}
            </>
          )}
        </div>
      )}

      {space === null && monthly.length > 0 && (
        <div className="usage-budget-group" data-group="month">
          <h4 className="usage-person-h">This month</h4>
          {monthly.map((b) => (
            <BudgetMeter key={b.id} budget={b} name={b.project.name} />
          ))}
        </div>
      )}

      {(ofSprints.length > 0 || (canSet && unbudgeted.length > 0)) && (
        <div className="usage-budget-group" data-group="sprints">
          <h4 className="usage-person-h">Sprints</h4>
          {ofSprints.map((b) => (
            <BudgetMeter
              key={b.id}
              budget={b}
              name={space === null ? `${b.label} · ${b.project.name}` : b.label}
            >
              {canSet && (
                <BudgetEditor
                  current={b.tokens}
                  label={`Token budget for ${b.label}`}
                  onSave={(tokens) => setSprintBudget(b.id, tokens).then(changed)}
                />
              )}
            </BudgetMeter>
          ))}
          {canSet && unbudgeted.length > 0 && (
            <div className="usage-budget-add">
              <Dropdown
                aria-label="Sprint to budget"
                value={adding}
                placeholder="Budget a sprint…"
                options={unbudgeted.map((s) => ({ value: s.id, label: s.name }))}
                onChange={setAdding}
              />
              {adding !== '' && (
                <BudgetEditor
                  current={undefined}
                  label="Token budget for the sprint"
                  onSave={(tokens) =>
                    setSprintBudget(adding, tokens).then(() => {
                      setAdding('');
                      changed();
                    })
                  }
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="usage-budget-group" data-group="tasks">
        <h4 className="usage-person-h">Tasks at 80% or more</h4>
        {ofTasks.length === 0 ? (
          <p className="prof-empty">
            None. A task’s budget is its forecast’s p80, frozen at claim, unless a lead sets one on
            the task.
          </p>
        ) : (
          ofTasks.map((b) => (
            <BudgetMeter
              key={b.id}
              budget={b}
              name={
                <>
                  <span className="usage-task-key">{b.label}</span> {b.title}
                </>
              }
            />
          ))
        )}
      </div>

      {space === null && (
        <p className="usage-budget-note">Choose a space to set its monthly and sprint budgets.</p>
      )}
    </section>
  );
}
