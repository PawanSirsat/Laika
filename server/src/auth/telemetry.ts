/**
 * SPEC §13.4: "No telemetry. No analytics. No phone-home. No usage beacons. Not
 * opt-out — **absent**."
 *
 * better-auth ships `@better-auth/telemetry`. It is off by default, and this
 * server also passes `telemetry: { enabled: false }`. Neither is sufficient on
 * its own, because the check inside the library is:
 *
 * ```js
 * (getBooleanEnvVar("BETTER_AUTH_TELEMETRY", false) || telemetryEnabled) && ...
 * ```
 *
 * An **OR**. The environment variable turns telemetry on *even when the option
 * says false* — so on any host where `BETTER_AUTH_TELEMETRY=1` happens to be set,
 * a base image, a CI runner, a developer's shell, Laika would phone home while
 * its own configuration insisted it does not.
 *
 * Deleting the variables before better-auth initialises closes that path. It is
 * the difference between "opt-out" and "absent", which §13.4 treats as the whole
 * point. See LAI-101 for whether this deserves a broader outbound-network guard.
 */

export const TELEMETRY_ENV_VARS = [
  'BETTER_AUTH_TELEMETRY',
  'BETTER_AUTH_TELEMETRY_DEBUG',
  'BETTER_AUTH_TELEMETRY_ENDPOINT',
] as const;

/**
 * Remove every telemetry switch from the environment. Returns the names that
 * were actually present, so a boot log can say so out loud rather than fixing it
 * silently.
 */
export function scrubTelemetryEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];

  for (const name of TELEMETRY_ENV_VARS) {
    if (env[name] !== undefined) {
      removed.push(name);
      delete env[name];
    }
  }

  return removed;
}
