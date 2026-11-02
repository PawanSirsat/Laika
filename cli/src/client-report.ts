import { type Answer, postJson } from './device.ts';

/**
 * The client report (server SPEC §4.81): what this helper is, sent with a
 * tool's own token to `POST /api/v1/agents/me/client-report`, so the board's
 * Devices tab can say whether that tool's helper is up to date. Evidence for a
 * status word on the board, never a permission.
 *
 * Sent by `laika tool add` once a tool is set up (LAI-1060), and by
 * `laika update` once the checkout has moved (LAI-1068) — there with the
 * **new** checkout's own `laika version --json`, because the process running
 * the update is still the old one.
 */

/** Closed: the board refuses a capability it does not know (§4.81). */
const BASE_CAPABILITIES = [
  'device_pairing',
  'tool_setup_exchange',
  'client_report',
  'doctor',
  'update',
  // `laika project check` (LAI-1066) records with the tool's credential.
  'project_check',
] as const;

/** What the report says the helper is. */
export interface Helper {
  readonly version: string;
  readonly commit: string | null;
  readonly protocol: number;
}

/** The body, with anything the board would refuse as malformed left out or named `unknown`. */
export function reportBody(helper: Helper, hooksOn: boolean): Record<string, unknown> {
  return {
    cli_version: /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(helper.version) ? helper.version : 'unknown',
    ...(helper.commit !== null && /^[0-9a-f]{7,40}$/.test(helper.commit)
      ? { cli_commit: helper.commit }
      : {}),
    protocol: helper.protocol,
    capabilities: [
      ...BASE_CAPABILITIES,
      ...(hooksOn ? (['session_hooks', 'claims', 'checkpoints'] as const) : []),
    ],
  };
}

export function sendClientReport(
  io: { readonly fetch: typeof fetch },
  board: string,
  token: string,
  helper: Helper,
  hooksOn: boolean,
): Promise<Answer> {
  return postJson(io, `${board}/api/v1/agents/me/client-report`, reportBody(helper, hooksOn), {
    Authorization: `Bearer ${token}`,
  });
}

/** `200`, or what went wrong in a few words — never anything from the request. */
export function reportOutcome(answer: Answer): string {
  if (answer.kind === 'json' && answer.status === 200) return 'sent';
  return answer.kind === 'unreachable' ? 'unreachable' : String(answer.status);
}
