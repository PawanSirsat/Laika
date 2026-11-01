import { type DeveloperAccessMode } from '../env.ts';

/**
 * What `GET /api/v1/developer/compatibility` answers (LAI-1043, the LAI-1042
 * plan §E.6): which build this board is, which helper protocol it speaks, and
 * which Developer access features are switched on.
 *
 * **Public, and built only from deployment settings.** Nothing here comes from
 * the database or from the caller, so an anonymous request and a signed-in one
 * get the same body, and nothing in it can be a secret: the server version, a
 * commit id, a mode name, a repository URL `readEnv` has already refused to
 * accept with credentials in it, and constants.
 */

/**
 * The helper protocol (`cli/src/protocol.ts` mirrors it). A number, not a
 * semver: it moves only when the board and a helper must agree on something new
 * — a request body, a command — and an old helper can then be told exactly which
 * feature it is missing.
 *
 * Protocol 1 is today's `laika`: `agent login`, hooks, `connect`, and the
 * checkpoint helper. No feature behind protocol 2 exists yet, so `current` is 1.
 */
export const PROTOCOL = { current: 1, minClient: 1 } as const;

/**
 * The features the V3 onboarding adds, each `false` until its slice lands
 * (plan §J). **A closed set**: the test asserts the keys by name, so a feature
 * cannot be added here without that test, and a client can treat an unknown
 * key as absent.
 */
export const FEATURE_NAMES = [
  'device_pairing',
  'tool_setup_exchange',
  'client_reports',
  'project_setups',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/** The protocol a helper needs for each feature once that feature is on. */
const MIN_PROTOCOL_FOR: Readonly<Record<FeatureName, number>> = {
  device_pairing: 2,
  tool_setup_exchange: 2,
  client_reports: 2,
  project_setups: 2,
};

/** One line per protocol, newest last: what a helper gains by updating to it. */
const WHATS_NEW: readonly { protocol: number; summary: string }[] = [
  {
    protocol: 1,
    summary: 'laika agent login, session hooks, laika connect and checkpoints.',
  },
];

export interface CompatibilityInput {
  version: string;
  buildCommit: string | null;
  developerAccess: DeveloperAccessMode;
  cliSourceUrl: string;
}

export interface CompatibilityBody {
  server: { version: string; build_commit: string | null };
  protocol: { current: number; min_client: number };
  features: { developer_access: DeveloperAccessMode } & Record<FeatureName, boolean>;
  cli: {
    min_protocol_for: Record<FeatureName, number>;
    source: { type: 'git'; url: string; commit: string | null; path: 'cli' };
  };
  release_notes: {
    ref: string | null;
    whats_new: { protocol: number; summary: string }[];
  };
}

export function compatibility(input: CompatibilityInput): CompatibilityBody {
  const features = Object.fromEntries(FEATURE_NAMES.map((name) => [name, false])) as Record<
    FeatureName,
    boolean
  >;

  return {
    server: { version: input.version, build_commit: input.buildCommit },
    protocol: { current: PROTOCOL.current, min_client: PROTOCOL.minClient },
    features: { developer_access: input.developerAccess, ...features },
    cli: {
      min_protocol_for: { ...MIN_PROTOCOL_FOR },
      // The helper ships from the board's own commit: the image does not carry
      // `cli/`, so a developer clones the repository at this commit (plan §A9).
      source: { type: 'git', url: input.cliSourceUrl, commit: input.buildCommit, path: 'cli' },
    },
    release_notes: {
      // The git ref whose history is this build's release notes; `null` when
      // the build does not know its commit.
      ref: input.buildCommit,
      whats_new: WHATS_NEW.map((entry) => ({ ...entry })),
    },
  };
}
