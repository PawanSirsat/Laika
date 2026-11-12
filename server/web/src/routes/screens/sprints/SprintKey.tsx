import './sprint-key.css';

/**
 * A sprint's short key, `S2`, as Sprints and the Timeline print it (LAI-1195).
 *
 * The visual audit read "S2" beside a size chip "S" as the same thing. The
 * key now carries a flag and an outline the size chip never has, and a
 * screen reader hears "Sprint 2" rather than "S 2". The visible text stays
 * `S2`, the label every other screen uses for the same sprint.
 */
export function SprintKey({
  index,
  className,
}: {
  /** 1-based position in the project's sprints. */
  readonly index: number;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={className === undefined ? 'sprint-key' : `sprint-key ${className}`}
      aria-label={`Sprint ${String(index)}`}
      role="img"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
        <path
          d="M3.5 14V2.5M3.5 2.5h8l-2 3 2 3h-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {`S${String(index)}`}
    </span>
  );
}
