import './auth.css';

export interface SystemStatusProps {
  /**
   * Migrations applied / total. **Both optional together** — `GET /setup/status`
   * returns only `setup_required`, so until LAI-206 lands there is no migration
   * state to report and the line is absent. The prototype's `41/41` is a
   * fixture; a hardcoded count would be wrong the moment a migration is added.
   */
  readonly migrationsApplied?: number | undefined;
  readonly migrationsTotal?: number | undefined;
  /** Absent until an endpoint reports it — nothing does today. */
  readonly smtpConfigured?: boolean | undefined;
}

/**
 * First-boot system status (LAI-021 AC6, LAI-075 AC4).
 *
 * **SQLite, never Postgres.** The prototype shows `postgres 16 · connected`;
 * `docs/design/README.md` lists that as an artifact to be reproduced under no
 * circumstances, and D-001 makes SQLite the only database in v1. A status panel
 * naming the wrong engine is worse than none — it is confidently wrong about
 * the one thing it exists to report.
 *
 * **Why the database line needs no endpoint.** `index.ts` opens the database and
 * runs migrations *before* it binds the port, so a process that is serving this
 * page has already done both. The line reports something the page's own
 * existence proves, which is why it is the one line that is always shown.
 *
 * Every other line waits for real data and is simply absent without it. A status
 * panel is the last place to guess: it is read precisely when someone is trying
 * to find out whether something is wrong.
 */
export function SystemStatus({
  migrationsApplied,
  migrationsTotal,
  smtpConfigured,
}: SystemStatusProps) {
  const hasMigrations = migrationsApplied !== undefined && migrationsTotal !== undefined;
  const migrationsDone = hasMigrations && migrationsApplied === migrationsTotal;

  return (
    <section className="status" aria-labelledby="status-heading">
      <h2 className="visually-hidden" id="status-heading">
        System status
      </h2>
      <dl className="status-list">
        <div className="status-row">
          <dt className="visually-hidden">Database</dt>
          <dd>
            <span className="status-dot status-ok" aria-hidden="true" />
            sqlite · wal
          </dd>
        </div>

        {hasMigrations && (
          <div className="status-row">
            <dt className="visually-hidden">Migrations</dt>
            <dd>
              <span
                className={migrationsDone ? 'status-dot status-ok' : 'status-dot status-warn'}
                aria-hidden="true"
              />
              migrations {migrationsApplied}/{migrationsTotal} applied
            </dd>
          </div>
        )}

        {smtpConfigured !== undefined && (
          <div className="status-row">
            <dt className="visually-hidden">SMTP</dt>
            <dd>
              <span
                className={smtpConfigured ? 'status-dot status-ok' : 'status-dot status-warn'}
                aria-hidden="true"
              />
              SMTP {smtpConfigured ? 'configured' : 'not configured'}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
