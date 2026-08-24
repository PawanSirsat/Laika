import './auth.css';

export interface SystemStatusProps {
  /**
   * Migrations applied / total. Props, not constants — the prototype's
   * "41/41" is a fixture, and a hardcoded count would be wrong the moment a
   * migration is added.
   */
  readonly migrationsApplied: number;
  readonly migrationsTotal: number;
  readonly smtpConfigured: boolean;
}

/**
 * First-boot system status (LAI-021 AC6).
 *
 * **SQLite, never Postgres.** The prototype shows `postgres 16 · connected`;
 * `docs/design/README.md` lists that as an artifact to be reproduced under no
 * circumstances, and D-001 makes SQLite the only database in v1. A status panel
 * naming the wrong engine is worse than none — it is confidently wrong about
 * the one thing it exists to report.
 */
export function SystemStatus({
  migrationsApplied,
  migrationsTotal,
  smtpConfigured,
}: SystemStatusProps) {
  const migrationsDone = migrationsApplied === migrationsTotal;

  return (
    <section className="status" aria-labelledby="status-heading">
      <h2 className="status-heading" id="status-heading">
        System
      </h2>
      <dl className="status-list">
        <div className="status-row">
          <dt>Database</dt>
          <dd>
            <span className="status-dot status-ok" aria-hidden="true" />
            SQLite · WAL
          </dd>
        </div>
        <div className="status-row">
          <dt>Migrations</dt>
          <dd>
            <span
              className={migrationsDone ? 'status-dot status-ok' : 'status-dot status-warn'}
              aria-hidden="true"
            />
            {migrationsApplied}/{migrationsTotal} applied
          </dd>
        </div>
        <div className="status-row">
          <dt>SMTP</dt>
          <dd>
            <span
              className={smtpConfigured ? 'status-dot status-ok' : 'status-dot status-warn'}
              aria-hidden="true"
            />
            {smtpConfigured ? 'configured' : 'not configured'}
          </dd>
        </div>
      </dl>
      {!smtpConfigured && (
        <p className="auth-note">
          Without SMTP you can still invite people — you copy the link and send it yourself.
        </p>
      )}
    </section>
  );
}
