export interface SprintShare {
  /** The sprint's key in the project's order — `S2`. */
  readonly sprintKey: string;
  readonly name: string;
  /** Tasks in that sprint, and in the space, from the one set the board holds. */
  readonly inSprint: number;
  readonly total: number;
  /** The set hit its page cap, so `total` is what was loaded, not the space. */
  readonly partial: boolean;
}

export interface SprintScopeProps {
  /** Absent while the sprint list or the task set is still in flight. */
  readonly share: SprintShare | undefined;
  readonly onShowAll: () => void;
}

/**
 * *"S2 · Sprint 14 — Receipts · 8 of 22 tasks · Show all sprints"* (LAI-1198).
 *
 * The board opens on the active sprint (LAI-713) and keeps doing so; what was
 * missing was saying so. Drawn at the end of the active-filter row, which the
 * sprint's own chip already opens, so it costs no line of its own — and *Show
 * all sprints* is one click, the same `?sprint=all` the Filter's *Any* writes.
 *
 * Before the numbers exist it draws its box and no words — never a zero.
 */
export function SprintScope({ share, onShowAll }: SprintScopeProps) {
  return (
    <span className="bt-scope" data-sprint-scope="" aria-busy={share === undefined || undefined}>
      {share !== undefined && (
        <span className="bt-scope-text">
          {share.sprintKey !== '' && <span className="sprint-key">{share.sprintKey}</span>}
          <span className="bt-scope-name">{share.name}</span>
          <span aria-hidden="true">·</span>
          <span className="bt-scope-count">
            {share.inSprint} of {share.total}
            {share.partial ? '+' : ''} {share.total === 1 ? 'task' : 'tasks'}
            {share.partial ? ' loaded' : ''}
          </span>
        </span>
      )}
      <button type="button" className="bt-scope-all" onClick={onShowAll}>
        Show all sprints
      </button>
    </span>
  );
}
