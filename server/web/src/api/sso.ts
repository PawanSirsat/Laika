import { request } from './client.ts';
import type { SignInMethod } from './setup.ts';

/**
 * How this instance signs people in (LAI-1239), for Organisation → Security.
 * Mirrors the server's `SsoSettingsView` (`services/sso-settings.ts`).
 */
export interface SsoSettings {
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
        /** A code when it failed; never a token or Microsoft's own text. */
        readonly error: string | null;
      } | null;
    };
    /** Teams meetings through Graph (LAI-1311); the Sign-in card's block is LAI-1313. */
    readonly meetings_sync: {
      readonly enabled: boolean;
      readonly every_minutes: number;
      /** The Graph application permissions the Entra app needs, admin-consented. */
      readonly permissions: readonly string[];
      readonly last_run: {
        readonly at: number;
        readonly ok: boolean;
        readonly meetings: number;
        /** A code when it failed or was incomplete; never a token or Microsoft's own text. */
        readonly error: string | null;
      } | null;
    };
  } | null;
}

/** The Microsoft half, when SSO is on — derived, so it cannot drift from the above. */
export type SsoMicrosoft = NonNullable<SsoSettings['microsoft']>;
/** One directory sync's outcome. */
export type SsoDirectoryRun = NonNullable<SsoMicrosoft['directory_sync']['last_run']>;

/** One meetings sync's outcome (LAI-1311). */
export type SsoMeetingsRun = NonNullable<SsoMicrosoft['meetings_sync']['last_run']>;

export function getSsoSettings(signal?: AbortSignal): Promise<SsoSettings> {
  return request<SsoSettings>('/org/sso', signal === undefined ? {} : { signal });
}

/** Run the directory sync now; answers the settings with the new last run. */
export function syncDirectoryNow(): Promise<SsoSettings> {
  return request<SsoSettings>('/org/sso/directory-sync', { method: 'POST', body: {} });
}

/** The words for a directory sync's failure code — what to do, not just what broke. */
export function directoryErrorWords(code: string): string {
  if (code === 'graph_forbidden_grant_user_read_all') {
    return 'Microsoft refused to list the directory. In Entra, give the app Microsoft Graph’s User.Read.All application permission and grant admin consent.';
  }
  if (code.startsWith('token_')) {
    return `Microsoft refused the app’s sign-in (${code}). Check the client secret has not expired.`;
  }
  if (code.endsWith('_unreachable')) return 'Microsoft could not be reached. It will try again.';
  return `The directory could not be read (${code}).`;
}

/** Run the meetings sync now (LAI-1311); answers the settings with the new last run. */
export function syncMeetingsNow(): Promise<SsoSettings> {
  return request<SsoSettings>('/org/sso/meetings-sync', { method: 'POST', body: {} });
}

/**
 * The Graph permission each `graph_forbidden_grant_*` code names, as Entra
 * spells it, and what Laika could not do without it — the codes
 * `services/meetings-sync.ts` records (`FORBIDDEN`).
 */
const MEETINGS_GRANTS: Readonly<Record<string, readonly [permission: string, refused: string]>> = {
  graph_forbidden_grant_calendars_read: ['Calendars.Read', 'read people’s calendars'],
  graph_forbidden_grant_user_read_all: ['User.Read.All', 'look up who organised each meeting'],
  graph_forbidden_grant_onlinemeetings_read_all: [
    'OnlineMeetings.Read.All',
    'open the Teams meetings',
  ],
  graph_forbidden_grant_onlinemeetingartifact_read_all: [
    'OnlineMeetingArtifact.Read.All',
    'read who attended',
  ],
  graph_forbidden_grant_onlinemeetingtranscript_read_all: [
    'OnlineMeetingTranscript.Read.All',
    'see which meetings have a transcript',
  ],
};

/**
 * The words for a meetings sync's failure code (LAI-1313) — what to do in
 * Entra or Teams, in the directory sync's manner. The three Teams grants are
 * refused too when the app is missing from a Teams application access
 * policy, even with consent given, so those say to check both.
 */
export function meetingsErrorWords(code: string): string {
  const grant = MEETINGS_GRANTS[code];
  if (grant !== undefined) {
    const [permission, refused] = grant;
    const policy = permission.startsWith('OnlineMeeting')
      ? ' If it is already granted, check the app is in a Teams application access policy.'
      : '';
    return `Microsoft refused to let Laika ${refused}. In Entra, give the app Microsoft Graph’s ${permission} application permission and grant admin consent.${policy}`;
  }
  if (code.startsWith('graph_forbidden_grant_')) {
    return `Microsoft refused a permission the app does not have (${code}). Check the permissions below are all granted, with admin consent.`;
  }
  if (code.startsWith('token_')) {
    return `Microsoft refused the app’s sign-in (${code}). Check the client secret has not expired.`;
  }
  if (code.endsWith('_throttled')) return 'Microsoft asked Laika to slow down. It will try again.';
  if (code.endsWith('_unreachable') || code.endsWith('_timeout')) {
    return 'Microsoft could not be reached. It will try again.';
  }
  return `The meetings could not be read (${code}).`;
}

/** *1 meeting*, *12 meetings*. */
export function meetingsCount(n: number): string {
  return `${String(n)} ${n === 1 ? 'meeting' : 'meetings'}`;
}
