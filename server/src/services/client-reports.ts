import { and, eq } from 'drizzle-orm';
import { agentClientSlug, cleanClientName } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { LAST_USED_THROTTLE_MS } from '../auth/tokens.ts';
import { type Db } from '../db/client.ts';
import { presenceEnabled } from '../db/orgs.ts';
import { agentClientReports, tokens } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { registeredAgent } from './claims.ts';

/**
 * What an agent's client says it is (SPEC §4.81, LAI-1056; plan LAI-1042
 * §E.7): its CLI's version and capabilities, and the client an MCP
 * `initialize` on its token named.
 *
 * **Self-reported, from the agent's own credential, and never an
 * authorisation input** — the trust of a `User-Agent` header, as a token's
 * `last_client` is (§4.9). It decides a status word and nothing else: no
 * `can()` call, fence or claim reads it.
 *
 * **The org's presence setting** (§4.2) is kept: while presence is off, a
 * report keeps what the client is, and `reported_at` stays null, so it says
 * nothing about when anybody was working.
 */

/**
 * The capabilities a CLI may report — a closed vocabulary, so a report is
 * never free text shown back to anybody. Grows with the CLI, by name.
 */
export const CLIENT_CAPABILITIES = [
  'device_pairing',
  'tool_setup_exchange',
  'client_report',
  'session_hooks',
  'claims',
  'checkpoints',
  'project_check',
  'update',
  'doctor',
] as const;
export type ClientCapability = (typeof CLIENT_CAPABILITIES)[number];

/** At most this many capabilities in one report. */
export const MAX_CAPABILITIES = 32;

export interface ClientReportInput {
  cliVersion: string;
  cliCommit?: string | undefined;
  protocol: number;
  capabilities: readonly ClientCapability[];
  harnessVersion?: string | undefined;
  /** The harness the CLI says it runs as (D-125): a generic MCP client's only name. */
  harness?: string | undefined;
}

export interface ClientReportView {
  agent_id: string;
  source: 'cli';
  cli_version: string | null;
  cli_commit: string | null;
  protocol: number | null;
  capabilities: string[];
  harness_version: string | null;
  harness: string | null;
  /** Null while the org has presence off (§4.2). */
  reported_at: number | null;
  self_reported: true;
}

/**
 * `POST /agents/me/client-report`: a registered agent's own token says which
 * CLI it runs. `403 not_an_agent` for anything else — a personal token, or a
 * session, has no agent to report about.
 */
export function reportClient(
  db: Db,
  actor: ResolvedActor,
  input: ClientReportInput,
  now: number = Date.now(),
): ClientReportView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = registeredAgent(actor);
  const tokenId = actor.token?.id;
  if (agent === null || tokenId === undefined) {
    throw new ApiError('forbidden', 'Only a registered agent’s token reports its client', {
      reason: 'not_an_agent',
    });
  }

  const capabilities = [...new Set(input.capabilities)].sort();
  const values = {
    tokenId,
    cliVersion: input.cliVersion,
    cliCommit: input.cliCommit ?? null,
    protocol: input.protocol,
    capabilitiesJson: JSON.stringify(capabilities),
    harnessVersion: input.harnessVersion ?? null,
    harness: input.harness ?? null,
    reportedAt: presenceEnabled(db) ? now : null,
  };
  db.insert(agentClientReports)
    .values({ agentId: agent.id, source: 'cli', ...values })
    .onConflictDoUpdate({
      target: [agentClientReports.agentId, agentClientReports.source],
      set: values,
    })
    .run();

  return {
    agent_id: agent.id,
    source: 'cli',
    cli_version: values.cliVersion,
    cli_commit: values.cliCommit,
    protocol: values.protocol,
    capabilities,
    harness_version: values.harnessVersion,
    harness: values.harness,
    reported_at: values.reportedAt,
    self_reported: true,
  };
}

/**
 * Keep what an MCP `initialize` on a **registered agent's** token said
 * (§4.81): the client's name, cleaned, and the slug that name alone gives.
 *
 * Unlike `recordMcpUse`, the slug is never the agent's harness: that is what
 * the owner said the tool is, and this is what the client said it is — the
 * two agreeing is the evidence (§E.3). The token's name is no fallback either,
 * since the owner named it. Written only when something changed or the last
 * stamp is older than the presence throttle, so an `initialize` per request
 * is one write a minute at most.
 *
 * Bookkeeping on the credential just presented, like `recordMcpUse`, so it
 * asks `can()` nothing and decides nothing. Never fails the call: a read-only
 * database skips the write.
 */
export function recordMcpClientReport(
  db: Db,
  tokenId: string,
  now: number,
  clientName: unknown,
  clientVersion: unknown,
): boolean {
  if (clientName === undefined) return false;
  const token = db
    .select({ agentId: tokens.agentId })
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .get();
  if (token?.agentId == null) return false;
  const agentId = token.agentId;

  const name = cleanClientName(clientName);
  const slug = name === null ? null : agentClientSlug(name, null);
  const version = cleanClientName(clientVersion);
  const reportedAt = presenceEnabled(db) ? now : null;

  const existing = db
    .select()
    .from(agentClientReports)
    .where(
      and(eq(agentClientReports.agentId, agentId), eq(agentClientReports.source, 'mcp_initialize')),
    )
    .get();
  const unchanged =
    existing?.tokenId === tokenId &&
    existing.clientName === name &&
    existing.clientVersion === version &&
    // With presence off, a row still carrying a time from when it was on is
    // rewritten without it (PR #211 review, B1): never left showing a time.
    (reportedAt === null
      ? existing.reportedAt === null
      : existing.reportedAt !== null && now - existing.reportedAt < LAST_USED_THROTTLE_MS);
  if (unchanged) return false;

  const values = {
    tokenId,
    clientName: name,
    clientSlug: slug,
    clientVersion: version,
    reportedAt,
  };
  try {
    db.insert(agentClientReports)
      .values({ agentId, source: 'mcp_initialize', ...values })
      .onConflictDoUpdate({
        target: [agentClientReports.agentId, agentClientReports.source],
        set: values,
      })
      .run();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_READONLY')) return false;
    throw err;
  }
  return true;
}
