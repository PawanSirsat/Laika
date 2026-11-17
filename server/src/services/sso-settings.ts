import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { signInMethod, type MicrosoftSso, type SignInMethod } from '../auth/sso.ts';
import { type Db } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import {
  type DirectoryDeps,
  DirectoryError,
  lastDirectoryRun,
  runDirectorySync,
} from './microsoft-directory.ts';
import { GraphError } from './microsoft-graph.ts';
import {
  lastMeetingsRun,
  MEETINGS_GRAPH_PERMISSIONS,
  MEETINGS_SYNC_EVERY_MINUTES,
  type MeetingsDeps,
  runMeetingsSync,
} from './meetings-sync.ts';

/** How often the scheduled directory sync runs (`jobs/scheduler.ts`). */
export const DIRECTORY_SYNC_EVERY_MINUTES = 15;

/**
 * `GET /api/v1/org/sso` (LAI-1239): how this instance signs people in, for
 * Organisation → Security.
 *
 * **Read only, on purpose.** SSO is configured by environment (LAI-1238) so
 * that an SSO-only instance with a broken identity provider can be recovered
 * by unsetting variables — a switch on this page would sit behind the very
 * sign-in that broke. So the page says what is set and what to register in
 * Entra, and its one action is *Sync now*.
 *
 * The client id and tenant id are not secrets (both appear in every Microsoft
 * sign-in URL); the client secret is never in this body, not even masked.
 */
export interface SsoSettingsView {
  readonly sign_in: SignInMethod;
  readonly microsoft: {
    readonly tenant_id: string;
    readonly client_id: string;
    /** What the Entra app must list as a Web redirect URI. */
    readonly redirect_uri: string;
    readonly directory_sync: {
      readonly enabled: boolean;
      readonly every_minutes: number;
      readonly last_run: {
        readonly at: number;
        readonly ok: boolean;
        readonly added: number;
        readonly existing: number;
        readonly error: string | null;
      } | null;
    };
    /** Teams meetings through Graph (LAI-1311), for the Meetings page. */
    readonly meetings_sync: {
      readonly enabled: boolean;
      readonly every_minutes: number;
      /** The Graph application permissions the Entra app needs, admin-consented. */
      readonly permissions: readonly string[];
      readonly last_run: {
        readonly at: number;
        readonly ok: boolean;
        readonly meetings: number;
        readonly error: string | null;
      } | null;
    };
  } | null;
}

export function getSsoSettings(
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  publicUrl: string,
): SsoSettingsView {
  // Org settings: the owner, and Admins while the matrix grants it (§3.1).
  assertCan(actor, 'org.settings.edit');
  if (sso === null) return { sign_in: signInMethod(sso), microsoft: null };
  return {
    sign_in: signInMethod(sso),
    microsoft: {
      tenant_id: sso.tenantId,
      client_id: sso.clientId,
      redirect_uri: `${publicUrl.replace(/\/+$/, '')}/api/v1/auth/callback/microsoft`,
      directory_sync: {
        enabled: sso.directorySync,
        every_minutes: DIRECTORY_SYNC_EVERY_MINUTES,
        last_run: lastDirectoryRun(),
      },
      meetings_sync: {
        enabled: sso.meetingsSync,
        every_minutes: MEETINGS_SYNC_EVERY_MINUTES,
        permissions: [...MEETINGS_GRAPH_PERMISSIONS],
        last_run: lastMeetingsRun(),
      },
    },
  };
}

/** `POST /api/v1/org/sso/directory-sync`: run the directory sync now. */
export async function syncDirectoryNow(
  db: Db,
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  publicUrl: string,
  deps: DirectoryDeps = {},
): Promise<SsoSettingsView> {
  assertCan(actor, 'org.settings.edit');
  if (sso?.directorySync !== true) {
    throw new ApiError(
      'conflict',
      'Directory sync is off. Set LAIKA_MICROSOFT_DIRECTORY_SYNC=true and restart to turn it on.',
    );
  }
  try {
    await runDirectorySync(db, sso, deps);
  } catch (err) {
    // The run is recorded either way; the page shows the code. Anything but a
    // directory failure is a bug and is left to the error handler.
    if (!(err instanceof DirectoryError)) throw err;
  }
  return getSsoSettings(actor, sso, publicUrl);
}

/** `POST /api/v1/org/sso/meetings-sync`: run the meetings sync now (LAI-1311). */
export async function syncMeetingsNow(
  db: Db,
  actor: ResolvedActor,
  sso: MicrosoftSso | null,
  publicUrl: string,
  deps: MeetingsDeps = {},
): Promise<SsoSettingsView> {
  assertCan(actor, 'org.settings.edit');
  if (sso?.meetingsSync !== true) {
    throw new ApiError(
      'conflict',
      'Meetings sync is off. Set LAIKA_MICROSOFT_MEETINGS_SYNC=true and restart to turn it on.',
      { reason: 'meetings_sync_off' },
    );
  }
  try {
    await runMeetingsSync(db, sso, deps);
  } catch (err) {
    // Recorded either way; the page shows the code. Anything but a Graph
    // failure is a bug and is left to the error handler.
    if (!(err instanceof GraphError)) throw err;
  }
  return getSsoSettings(actor, sso, publicUrl);
}
