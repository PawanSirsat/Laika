import type { Deliverable } from '../../../api/tasks.ts';
import { progressLine, STATE_WORDS } from '../task/delivers-derive.ts';
import '../task/delivers.css';

export interface ReviewShipsProps {
  /** The task's Ships list as the queue carries it; absent on an older server. */
  readonly items: readonly Deliverable[] | undefined;
}

/**
 * The *Ships* checklist in the Review dialog (D-146 item 3, LAI-1169), read
 * only: each deliverable with the mark the task panel draws for its state
 * (`dl-mark-*`) and the panel's progress line, so a reviewer sees what the
 * agent said it built before accepting. Nothing when the task has none
 * (D-032): a list is never invented here.
 */
export function ReviewShips({ items }: ReviewShipsProps) {
  if (items === undefined || items.length === 0) return null;
  return (
    <section className="rd-ships" aria-labelledby="rd-ships-title" data-section="ships">
      <h3 className="rd-section-title" id="rd-ships-title">
        Ships
        <span className="rd-ships-line">{progressLine(items, 'review')}</span>
      </h3>
      <ul className="rd-ships-list">
        {items.map((item) => (
          <li key={item.id} className="rd-ships-row" data-state={item.state}>
            <span className={`dl-mark dl-mark-${item.state}`} aria-hidden="true" />
            <span className="rd-ships-text">
              <span className="rd-ships-title">{item.title}</span>
              {item.detail !== null && item.detail !== '' && (
                <span className="rd-ships-detail">{item.detail}</span>
              )}
            </span>
            <span className="visually-hidden">{STATE_WORDS[item.state]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
