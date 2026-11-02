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
 * Protocol 1 is `agent login`, hooks, `connect`, and the checkpoint helper.
 * Protocol 2 adds device pairing, the tool setup exchange and client reports
 * (LAI-1050, LAI-1056); this board serves them, so `current` is 2 (LAI-1062).
 * **`minClient` stays 1**: nothing a protocol-1 helper does was taken away, so
 * an old `laika` keeps working and is told only what it is missing.
 */
export const PROTOCOL = { current: 2, minClient: 1 } as const;

/**
 * The features the V3 onboarding adds (plan §J). **A closed set**: the test asserts the keys by name, so a feature
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

/**
 * What each feature is, as routes: `METHOD path`, exactly as the app's route
 * table registers them (LAI-1062). A feature is `true` only when **every** route
 * it names is mounted, so the flag is read off what this build serves rather
 * than written beside it — a route removed, renamed or left unmounted (an app
 * built without a database mounts none of them) turns its feature off.
 *
 * **An empty list is never on.** `project_setups` has no server-side record
 * yet — the web keeps a browser-local one — so there is no route that could
 * make it true, and it stays `false` until one exists and is named here.
 */
export const FEATURE_ROUTES: Readonly<Record<FeatureName, readonly string[]>> = {
  device_pairing: ['POST /api/v1/device-pairing/claim', 'POST /api/v1/device-pairing/:id/complete'],
  tool_setup_exchange: ['POST /api/v1/tool-setup/:id/redeem'],
  client_reports: ['POST /api/v1/agents/me/client-report'],
  project_setups: [],
};

/** Each feature, on exactly when all of its routes are in `served`. */
export function servedFeatures(served: Iterable<string>): Record<FeatureName, boolean> {
  const mounted = new Set(served);
  return Object.fromEntries(
    FEATURE_NAMES.map((name) => {
      const routes = FEATURE_ROUTES[name];
      return [name, routes.length > 0 && routes.every((route) => mounted.has(route))];
    }),
  ) as Record<FeatureName, boolean>;
}

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
  {
    protocol: 2,
    summary: 'laika device pair, laika tool add and client reports.',
  },
];

export interface CompatibilityInput {
  version: string;
  buildCommit: string | null;
  developerAccess: DeveloperAccessMode;
  cliSourceUrl: string;
  /** The app's routes as `METHOD path`; `features` is read off them. */
  servedRoutes: Iterable<string>;
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
  const features = servedFeatures(input.servedRoutes);

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
