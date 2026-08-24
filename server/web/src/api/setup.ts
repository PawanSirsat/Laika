import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * First-run setup (SPEC §6.4, LAI-009).
 *
 * The wire body is **snake_case and strict** — an unrecognised key is
 * `unprocessable`, not ignored — so the mapping from the form's camelCase lives
 * here rather than being spread across the screen.
 */

export interface SetupStatus {
  readonly setup_required: boolean;
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
