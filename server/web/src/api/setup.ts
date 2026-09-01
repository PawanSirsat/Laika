import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * First-run setup (SPEC §6.4, LAI-009).
 *
 * The wire body is **snake_case and strict** — an unrecognised key is
 * `unprocessable`, not ignored — so the mapping from the form's camelCase lives
 * here rather than being spread across the screen.
 */

/**
 * What `GET /setup/status` reports about the running instance (§6.4, LAI-206).
 *
 * **Named `SetupSystemStatus`, not `SystemStatus`**, because
 * `routes/screens/SystemStatus.tsx` is the component that draws it and one name
 * for the wire shape and the thing that renders it would make every import site
 * pick which one it meant.
 */
export interface SetupSystemStatus {
  /** Engine and journal mode, e.g. `SQLite · WAL`. */
  readonly database: string;
  readonly migrations_applied: number;
  readonly smtp_configured: boolean;
}

export interface SetupStatus {
  readonly setup_required: boolean;
  /**
   * **Declared because it is served; rendered by LAI-158.**
   *
   * LAI-206 added it to the response and no client type mirrored it, so the two
   * could drift with nothing going red — LAI-160 is what noticed, by pairing
   * this type for the first time. Declaring it is the repo's answer to a served
   * field whose screen is not built yet (`Task.blocks`, `Task.sprint_id`), and
   * it is a better one than a `clientOmits` entry: the omission was never a
   * decision, it was an oversight, and an exemption would have recorded it as
   * the former.
   */
  readonly system: SetupSystemStatus;
}

export interface SetupInput {
  readonly orgName: string;
  readonly ownerName: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  /** Optional. Omitted entirely when blank — the schema rejects an empty string. */
  readonly projectName?: string;
}

export interface SetupResult {
  readonly org_id: string;
  readonly owner_id: string;
  /** `null` when no first project was asked for. */
  readonly project_id: string | null;
}

/** One field-level complaint from a `422`. */
export interface FieldIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export function getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return request<SetupStatus>('/setup/status', signal === undefined ? {} : { signal });
}

/**
 * Complete setup.
 *
 * **The response sets the session cookie**, so there is no separate sign-in
 * afterwards — submit, then navigate.
 */
export function completeSetup(input: SetupInput): Promise<SetupResult> {
  return request<SetupResult>('/setup', {
    method: 'POST',
    body: {
      org_name: input.orgName,
      owner_name: input.ownerName,
      owner_email: input.ownerEmail,
      owner_password: input.ownerPassword,
      // Sent only when non-empty: the schema rejects unknown *and* empty values,
      // and `project_prefix` is deliberately not sent at all — the server derives
      // it from the name, and the form does not offer an override.
      ...(input.projectName !== undefined && input.projectName.trim() !== ''
        ? { project_name: input.projectName.trim() }
        : {}),
    },
  });
}

/**
 * Pull the per-field complaints out of a `422`.
 *
 * Returns them keyed by the form field they belong to, so the screen can put
 * each message under its own input instead of dumping one banner that says
 * "invalid" and leaves the reader hunting.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'unprocessable') return {};

  const details = error.details as { issues?: readonly FieldIssue[] } | null;
  const issues = details?.issues ?? [];

  const out: Record<string, string> = {};
  for (const issue of issues) {
    // First wins: a field with two complaints shows the first, and showing all
    // of them stacked under one input is noise, not help.
    out[issue.path] ??= issue.message;
  }
  return out;
}
