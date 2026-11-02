import { type Answer, postJson } from './device.ts';

/**
 * The client report (server SPEC §4.81): what this helper is, sent with a
 * tool's own token to `POST /api/v1/agents/me/client-report`, so the board's
 * Devices tab can say whether that tool's helper is up to date. Evidence for a
 * status word on the board, never a permission.
 *
 * Sent by `laika tool add` once a tool is set up (LAI-1060), naming the tool
 * (LAI-1088), and by `laika update` once the checkout has moved (LAI-1068) or
 * when it is already the board's commit (LAI-1085) — there with the
 * checkout's own `laika version --json`, because the process running the
 * update may be an older one.
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

/**
 * The tool the report is for, as the board names it (D-125 item 4, LAI-1088).
 * A generic harness — Omnigent, Hermes — reads **Ready** only when its own
 * credential's report says which tool it is: its workers' requests name their
 * own harness, so the board cannot tell from them. A slug the board would
 * refuse, or `other`, is left out.
 */
const REPORTED_HARNESS = /^[a-z][a-z0-9-]{1,31}$/;

/** The body, with anything the board would refuse as malformed left out or named `unknown`. */
export function reportBody(
  helper: Helper,
  hooksOn: boolean,
  harness?: string,
): Record<string, unknown> {
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
    ...(harness !== undefined && harness !== 'other' && REPORTED_HARNESS.test(harness)
      ? { harness }
      : {}),
  };
}

/** `harness` is the credential's tool (`ADAPTERS[h].agentHarness`), when the caller knows it. */
export function sendClientReport(
  io: { readonly fetch: typeof fetch },
  board: string,
  token: string,
  helper: Helper,
  hooksOn: boolean,
  harness?: string,
): Promise<Answer> {
  return postJson(
    io,
    `${board}/api/v1/agents/me/client-report`,
    reportBody(helper, hooksOn, harness),
    { Authorization: `Bearer ${token}` },
  );
}

/** `200`, or what went wrong in a few words — never anything from the request. */
export function reportOutcome(answer: Answer): string {
  if (answer.kind === 'json' && answer.status === 200) return 'sent';
  return answer.kind === 'unreachable' ? 'unreachable' : String(answer.status);
}
