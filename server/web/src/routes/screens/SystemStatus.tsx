import type { SetupSystemStatus } from '../../api/setup.ts';
import './auth.css';

export interface SystemStatusProps {
  /**
   * What the instance says about itself, from `GET /setup/status` (§6.4).
   *
   * `undefined` until it arrives, and the panel renders **nothing** then. It
   * used to draw a hardcoded `sqlite · wal` on the grounds that a process
   * serving this page has already opened the database — true, and it still does
   * not tell you the journal mode. **A panel read precisely when somebody is
   * checking whether something is wrong is the last place to state a fact from
   * the page's own existence rather than from the instance.**
   */
  readonly system?: SetupSystemStatus | undefined;
}

/**
 * First-boot system status (LAI-021 AC6, LAI-075 AC4, rendered by LAI-158).
 *
 * **SQLite, never Postgres.** The prototype shows `postgres 16 · connected`;
 * `docs/design/README.md` lists that as an artifact to reproduce under no
 * circumstances, and D-001 makes SQLite the only database in v1. This no longer
 * has to be enforced by the component: the string comes from the live
 * connection's PRAGMAs, so it says what the instance *is*.
 *
 * **No total on the migrations line, deliberately** (LAI-158). §6.4 carries
 * `migrations_applied` alone, and the reason is checkable: `index.ts` runs
 * `runMigrations` before `serve()`, and the migrator throws rather than
 * continuing — **a server that can answer this request has applied all of
 * them**, so the denominator would always equal the numerator. `18/18` that can
 * never read anything else is decoration with a chance of being wrong, which is
 * the failure LAI-106 AC5 named. `migrationsTotal` is gone rather than passed
 * the same number twice to make the slash appear.
 */
export function SystemStatus({ system }: SystemStatusProps) {
  if (system === undefined) return null;

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
            {system.database}
          </dd>
        </div>

        <div className="status-row">
          <dt className="visually-hidden">Migrations</dt>
          <dd>
            <span className="status-dot status-ok" aria-hidden="true" />
            migrations {system.migrations_applied} applied
          </dd>
        </div>

        <div className="status-row">
          <dt className="visually-hidden">SMTP</dt>
          <dd>
            <span
              className={system.smtp_configured ? 'status-dot status-ok' : 'status-dot status-warn'}
              aria-hidden="true"
            />
            {system.smtp_configured ? 'smtp configured' : 'smtp not configured'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
