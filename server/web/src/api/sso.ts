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
  } | null;
}

/** The Microsoft half, when SSO is on — derived, so it cannot drift from the above. */
export type SsoMicrosoft = NonNullable<SsoSettings['microsoft']>;
/** One directory sync's outcome. */
export type SsoDirectoryRun = NonNullable<SsoMicrosoft['directory_sync']['last_run']>;

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
  // Before `token_`: `token_unreachable` is the network, not a refusal (LAI-1317).
  if (code.endsWith('_unreachable')) return 'Microsoft could not be reached. It will try again.';
  if (code.startsWith('token_')) {
    return `Microsoft refused the app’s sign-in (${code}). Check the client secret has not expired.`;
  }
  return `The directory could not be read (${code}).`;
}
