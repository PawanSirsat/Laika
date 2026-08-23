import { describe, expect, it } from 'vitest';
import { scrubTelemetryEnv, TELEMETRY_ENV_VARS } from '../../src/auth/telemetry.ts';

/**
 * SPEC §13.4 — "No telemetry... Not opt-out — **absent**."
 *
 * These test the scrub, not better-auth's behaviour, and on purpose: the library
 * disables telemetry under `NODE_ENV=test` regardless, so any test asserting "no
 * beacon fired" would pass whether or not the guard existed. What is worth
 * pinning is that the env switch cannot survive to be read.
 */
describe('telemetry env scrubbing', () => {
  it('removes every better-auth telemetry switch', () => {
    const env: NodeJS.ProcessEnv = {
      BETTER_AUTH_TELEMETRY: '1',
      BETTER_AUTH_TELEMETRY_DEBUG: '1',
      BETTER_AUTH_TELEMETRY_ENDPOINT: 'https://example.invalid/collect',
      UNRELATED: 'keep me',
    };

    const removed = scrubTelemetryEnv(env);

    expect(removed.sort()).toEqual([...TELEMETRY_ENV_VARS].sort());
    for (const name of TELEMETRY_ENV_VARS) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env.UNRELATED).toBe('keep me');
  });

  it('reports nothing when the environment was already clean', () => {
    expect(scrubTelemetryEnv({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('covers the exact variables better-auth reads', () => {
    // If the library adds another switch, this list has to grow with it. Pinned
    // here so the omission is visible rather than silent.
    expect([...TELEMETRY_ENV_VARS]).toEqual([
      'BETTER_AUTH_TELEMETRY',
      'BETTER_AUTH_TELEMETRY_DEBUG',
      'BETTER_AUTH_TELEMETRY_ENDPOINT',
    ]);
  });
});
