import type { Launcher } from '../../src/api/capacity.ts';

/**
 * A launcher that never reported, exactly as the server serves one (§4.83,
 * `NEVER_REPORTED` in `server/src/services/agent-capacity.ts`): `off`, and
 * every other field `null`. The default every agent and device fixture
 * carries, so a test that is not about presence never reads `on`.
 */
export const NEVER_REPORTED: Launcher = {
  state: 'off',
  reported_at: null,
  started_at: null,
  running: null,
  max_concurrent: null,
  auto_pickup: null,
  cli_version: null,
};

/** An enabled launcher reporting at `reportedAt`, in the word the test gives it. */
export function reported(state: Launcher['state'], reportedAt: number | null): Launcher {
  return {
    state,
    reported_at: reportedAt,
    started_at: reportedAt === null ? null : reportedAt - 3_600_000,
    running: 0,
    max_concurrent: 1,
    auto_pickup: { work_requests: true, handoffs: true },
    cli_version: '0.4.2',
  };
}
