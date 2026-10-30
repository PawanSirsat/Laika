import { useId } from 'react';
import { AgentChip } from './AgentChip.tsx';
import {
  HANDOFF_FILTER_WORDS,
  HANDOFF_FILTERS,
  HANDOFF_KIND_WORDS,
  type HandoffFilter,
  type HandoffKind,
} from './agent-states.ts';
import { actionCount, matches, type HandoffItem } from './handoff-inbox.ts';
import './agent.css';

export interface HandoffInboxProps {
  readonly items: readonly HandoffItem[];
  readonly filter: HandoffFilter;
  readonly onFilter: (filter: HandoffFilter) => void;
}

/**
 * Inbox → Hand-offs (LAI-536, proposal §6).
 *
 * A **work request** (someone picked an agent; nothing has been done yet) and
 * a **recovery offer** (an agent stopped mid-task and its saved work is up for
 * taking) are different asks, and each row says which in words and in shape.
 */
export function HandoffInbox({ items, filter, onFilter }: HandoffInboxProps) {
  const listId = useId();
  const shown = items.filter((item) => matches(item, filter));
  return (
    <section className="handoff-inbox" aria-label="Hand-offs" data-handoff-inbox>
      <div className="handoff-filters" role="group" aria-label="Show hand-offs">
        {HANDOFF_FILTERS.map((id) => {
          const count = actionCount(items, id);
          return (
            <button
              key={id}
              type="button"
              className="handoff-filter"
              aria-pressed={id === filter}
              aria-controls={listId}
              data-filter={id}
              onClick={() => {
                onFilter(id);
              }}
            >
              {HANDOFF_FILTER_WORDS[id]}
              {count > 0 && (
                <span className="handoff-filter-count">
                  {count}
                  <span className="visually-hidden"> need your action</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ul id={listId} className="handoff-list">
        {shown.length === 0 && <li className="handoff-empty">Nothing here for this filter</li>}
        {shown.map((item) => (
          <li key={item.id} className="handoff-row" data-kind={item.kind}>
            <span className="handoff-kind">
              <KindShape kind={item.kind} />
              {HANDOFF_KIND_WORDS[item.kind]}
            </span>
            <span className="handoff-task">
              <code>{item.taskKey}</code> {item.taskTitle}
            </span>
            <span className="handoff-route">
              {item.from === null ? (
                <span className="handoff-nobody">
                  {item.kind === 'recovery' ? 'Expired claim' : 'Picked on the task'}
                </span>
              ) : (
                <AgentChip {...item.from} />
              )}
              <span aria-hidden="true">→</span>
              <span className="visually-hidden">to</span>
              {item.to === null ? (
                <span className="handoff-nobody">Any eligible agent</span>
              ) : (
                <AgentChip {...item.to} />
              )}
            </span>
            <span className="handoff-state">
              {item.state} · {item.age}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Each kind's shape, so a kind is told by more than its colour or its word. */
export function KindShape({ kind }: { readonly kind: HandoffKind }) {
  const paths: Record<HandoffKind, readonly string[]> = {
    // An envelope: something asked for.
    work_request: ['M3 6h18v12H3z', 'm3 7 9 6 9-6'],
    // Two arrows: passed across.
    handoff: ['M4 8h14l-3-3', 'M20 16H6l3 3'],
    // Rotate back: picked up again.
    recovery: ['M3 12a9 9 0 1 0 3-6.7', 'M3 3v6h6'],
  };
  return (
    <svg
      className="handoff-kind-icon"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
