import type Database from 'better-sqlite3';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { deviceLabelKey } from '../db/device-label.ts';
import { type OrgRole } from '../db/enums.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  activity,
  agentCheckpointConsents,
  agents,
  devices,
  projectRepoSetups,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, type OrgAction } from '../policy/can.ts';
import { visibleProjectIds } from './activity.ts';
import { agentView, revokeAgentRow, type AgentRow, type AgentView } from './agents.ts';
import { readLogged } from './analytics-views.ts';
import {
  cancelPairingsOfDevice,
  pendingPairingsOf,
  type DevicePairingView,
} from './device-pairing.ts';
import { devicesOf, type DeviceView } from './devices.ts';
import { NOTICE_SUBJECT_MAX, writeNotice } from './notices.ts';
import { projectSetupsOf, type ProjectSetupView } from './project-setups.ts';
import { tokensOf, type TokenView } from './tokens.ts';
import { type AgentVerificationView, verificationOf } from './tool-setup.ts';

/**
 * A member's whole developer setup, read by an owner or admin, and their
 * revoke of one of its tools or devices (SPEC §6.4, D-132, D-133, LAI-1137).
 *
 * ## The read
 *
 * `GET /people/:id/developer-setup` is `developer_setup.read_any` — *See and
 * manage anyone's developer setup*, session only, never yourself — and every
 * read is a look the member sees (D-102 rule 3, kind `developer_setup`,
 * deduped by D-135). It is assembled from the readers the member's own
 * Developer access uses, parameterised by owner: `devicesOf`,
 * `verificationOf`, `pendingPairingsOf`, `projectSetupsOf` and `tokensOf`.
 * **Their own-only routes are unchanged**: `/devices`, `/agents` and the rest
 * still answer `404` for another owner's row (D-132 item 4).
 *
 * **What it never carries.** No secret is served anywhere here: a token goes
 * through `tokenView`, which has no secret or hash, and a pairing request
 * through the pairing view, which has no code, code hash, nonce or key
 * (D-132 item 2, D-124). **A space the reader cannot open is counted, never
 * named** (D-132 item 5): its repository setups, the tool grants and token
 * pins that name it are dropped from the lists and only their number is
 * served — even its id is a name for this purpose.
 *
 * ## The revokes
 *
 * `agent.revoke_any` and `device.revoke_any`: the same grant, session only,
 * not yourself, and **an admin may not act on the owner's setup** — `can()`
 * holds that on the target's role, and this module only says why. The effect
 * is D-114 item 2's revoke, unchanged (`revokeAgentRow`), with the member
 * told by one notice (D-134). No new activity verb: each token revoked writes
 * the `token.revoked` it always does, naming the revoker as actor.
 */

/** §11.4's window for the setup's recent activity. */
export const SETUP_ACTIVITY_DAYS = 30;
const DAY_MS = 86_400_000;

interface PersonRef {
  id: string;
  name: string;
}

/** A token as the setup serves it: pins to spaces the reader cannot open are counted, not listed. */
export interface SetupTokenView extends TokenView {
  project_ids_hidden: number;
}

/** A tool (registered agent) as the setup serves it. */
export interface SetupToolView extends Omit<AgentView, 'tokens'> {
  device_id: string | null;
  /** Grants to spaces the reader cannot open, counted. */
  grants_hidden: number;
  tokens: SetupTokenView[];
  checks: AgentVerificationView['checks'];
  client_report: AgentVerificationView['client_report'];
  /** Whether hooks may save without asking (D-115 item 2). */
  checkpoint_consent: boolean;
  /** Who revoked it, when that was not the member; null otherwise. */
  revoked_by: PersonRef | null;
}

/** A device as the setup serves it: its tools by id — they are in `tools`. */
export interface SetupDeviceView extends Omit<DeviceView, 'agents'> {
  agent_ids: string[];
  revoked_by: PersonRef | null;
}

export type SetupActivityKind =
  | 'paired'
  | 'tool_added'
  | 'tool_revoked'
  | 'device_unpaired'
  | 'token_revoked'
  | 'project_check_failed';

export interface SetupActivityView {
  at: number;
  kind: SetupActivityKind;
  /** The device, tool, token or repository's name as it is now. */
  subject: string;
  /** Who did it, when the board knows; null for the member's own device or check. */
  by: PersonRef | null;
}

export interface DeveloperSetupView {
  /** The board's clock, so "seen 15 minutes ago" is measured by one clock. */
  now: number;
  user: { id: string; name: string; org_role: OrgRole; is_active: boolean };
  /** Whether the reader may revoke here — false for an admin on the owner (D-133). */
  can_revoke: boolean;
  summary: {
    devices_active: number;
    devices_revoked: number;
    tools_active: number;
    tools_revoked: number;
    repositories: number;
    repositories_hidden: number;
    tokens_active: number;
    tokens_inactive: number;
    pending_pairing: number;
    last_seen_at: number | null;
  };
  devices: SetupDeviceView[];
  tools: SetupToolView[];
  pending_pairing: DevicePairingView[];
  repositories: ProjectSetupView[];
  tokens: { personal: SetupTokenView[]; tool_credentials: SetupTokenView[] };
  activity: SetupActivityView[];
}

interface Subject {
  id: string;
  name: string;
  orgRole: OrgRole;
  isActive: boolean;
}

function loadSubject(db: Db, userId: string): Subject {
  const row = db
    .select({ id: users.id, name: users.name, orgRole: users.orgRole, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (row === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return { id: row.id, name: row.name, orgRole: row.orgRole, isActive: row.isActive === 1 };
}

/**
 * The person a request names, after the reader is asked about them, in the
 * order that discloses nothing:
 *
 * 1. **yourself** is `422 use_developer_access` — your own setup is on
 *    Developer access, where nothing is logged as a look;
 * 2. **the grant**, asked before the person is looked up, so a caller without
 *    it gets the same `403` for an id that exists and one that does not;
 * 3. **an unknown id** is `404`;
 * 4. for a revoke, **the owner's setup** is `403 not_for_owner` to an admin.
 */
function requireSubject(db: Db, actor: ResolvedActor, action: OrgAction, userId: string): Subject {
  if (userId === actor.userId) {
    throw new ApiError('unprocessable', 'Your own setup is on Developer access', {
      reason: 'use_developer_access',
    });
  }
  // The grant alone, for any non-owner target: the target's role is not yet known.
  const probe = { targetUserId: userId, targetOrgRole: 'member' as const };
  if (!can(actor, action, probe)) assertCan(actor, action, probe);

  const subject = loadSubject(db, userId);

  const resource = { targetUserId: subject.id, targetOrgRole: subject.orgRole };
  if (!can(actor, action, resource)) {
    if (subject.orgRole === 'owner') {
      throw new ApiError('forbidden', "An admin cannot change the owner's setup", {
        action,
        reason: 'not_for_owner',
      });
    }
    assertCan(actor, action, resource);
  }
  return subject;
}

// ------------------------------------------------------------------- the read

/** `GET /people/:id/developer-setup`: the member's setup, and one logged look. */
export function getDeveloperSetup(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): DeveloperSetupView {
  const subject = requireSubject(db, actor, 'developer_setup.read_any', userId);
  return readLogged(
    db,
    actor,
    subject.id,
    'developer_setup',
    () => buildView(db, actor, subject, now),
    () => null,
    now,
  );
}

export interface OwnSetupActivityView {
  now: number;
  data: SetupActivityView[];
}

/**
 * `GET /me/developer-setup/activity`: the caller's own last
 * {@link SETUP_ACTIVITY_DAYS} days of setup activity, the same items
 * `activity[]` lists for an admin, built by the same reader (D-139,
 * LAI-1151). `developer_setup.read_own`, session only. **No look is
 * written**: it is your own (D-102 rule 3).
 */
export function getOwnSetupActivity(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): OwnSetupActivityView {
  assertCan(actor, 'developer_setup.read_own');
  const subject = loadSubject(db, actor.userId);
  return { now, data: buildView(db, actor, subject, now).activity };
}

function buildView(
  db: Db,
  actor: ResolvedActor,
  subject: Subject,
  now: number,
): DeveloperSetupView {
  const readable = new Set(visibleProjectIds(db, actor));
  const names = personNames(db);
  const ref = (id: string | null): PersonRef | null => {
    if (id === null) return null;
    return { id, name: names.get(id) ?? '' };
  };

  const agentRows = db
    .select()
    .from(agents)
    .where(eq(agents.ownerUserId, subject.id))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  const consent = consentsOf(
    db,
    agentRows.map((a) => a.id),
  );
  const tools = agentRows.map((row) =>
    toolView(db, row, readable, consent.has(row.id), ref(row.revokedByUserId), now),
  );

  const deviceRows = new Map(
    db
      .select({ id: devices.id, revokedByUserId: devices.revokedByUserId })
      .from(devices)
      .where(eq(devices.ownerUserId, subject.id))
      .all()
      .map((r) => [r.id, r.revokedByUserId]),
  );
  const deviceList: SetupDeviceView[] = devicesOf(db, subject.id).map(
    ({ agents: linked, ...device }) => ({
      ...device,
      agent_ids: linked.map((a) => a.id),
      revoked_by: ref(deviceRows.get(device.id) ?? null),
    }),
  );

  const repositories = projectSetupsOf(db, subject.id, [...readable]);
  const tokens = tokensOf(db, subject.id).map((t) => redactToken(t, readable));
  const pending = pendingPairingsOf(db, subject.id, now);

  const live = (t: TokenView) =>
    t.revoked_at === null && (t.expires_at === null || t.expires_at > now);
  const seen = [
    ...deviceList.map((d) => d.last_seen_at),
    ...tools.map((t) => t.last_seen_at),
    ...tokens.map((t) => t.last_used_at),
  ].filter((at): at is number => at !== null);

  return {
    now,
    user: {
      id: subject.id,
      name: subject.name,
      org_role: subject.orgRole,
      is_active: subject.isActive,
    },
    can_revoke: can(actor, 'agent.revoke_any', {
      targetUserId: subject.id,
      targetOrgRole: subject.orgRole,
    }),
    summary: {
      devices_active: deviceList.filter((d) => d.status === 'active').length,
      devices_revoked: deviceList.filter((d) => d.status === 'revoked').length,
      tools_active: tools.filter((t) => t.status === 'active').length,
      tools_revoked: tools.filter((t) => t.status === 'revoked').length,
      repositories: repositories.visible.length,
      repositories_hidden: repositories.hidden,
      tokens_active: tokens.filter(live).length,
      tokens_inactive: tokens.filter((t) => !live(t)).length,
      pending_pairing: pending.length,
      last_seen_at: seen.length === 0 ? null : Math.max(...seen),
    },
    devices: deviceList,
    tools,
    pending_pairing: pending,
    repositories: repositories.visible,
    tokens: {
      personal: tokens.filter((t) => t.kind === 'personal'),
      tool_credentials: tokens.filter((t) => t.kind === 'agent'),
    },
    activity: recentActivity(db, subject, deviceList, tools, tokens, readable, ref, now),
  };
}

function toolView(
  db: Db,
  row: AgentRow,
  readable: ReadonlySet<string>,
  consent: boolean,
  revokedBy: PersonRef | null,
  now: number,
): SetupToolView {
  const view = agentView(db, row, now);
  const checks = verificationOf(db, row, now);
  const grants = view.grants.filter((g) => readable.has(g.project_id));
  return {
    ...view,
    grants,
    grants_hidden: view.grants.length - grants.length,
    tokens: view.tokens.map((t) => redactToken(t, readable)),
    device_id: row.deviceId,
    checks: checks.checks,
    client_report: checks.client_report,
    checkpoint_consent: consent,
    revoked_by: revokedBy,
  };
}

/** A token's pins to spaces the reader cannot open, dropped and counted. */
function redactToken(token: TokenView, readable: ReadonlySet<string>): SetupTokenView {
  if (token.project_ids === null) return { ...token, project_ids_hidden: 0 };
  const shown = token.project_ids.filter((id) => readable.has(id));
  return {
    ...token,
    project_ids: shown,
    project_ids_hidden: token.project_ids.length - shown.length,
  };
}

function consentsOf(db: Db, agentIds: readonly string[]): Set<string> {
  if (agentIds.length === 0) return new Set();
  return new Set(
    db
      .select({ agentId: agentCheckpointConsents.agentId })
      .from(agentCheckpointConsents)
      .where(
        and(
          inArray(agentCheckpointConsents.agentId, [...agentIds]),
          isNull(agentCheckpointConsents.withdrawnAt),
        ),
      )
      .all()
      .map((r) => r.agentId),
  );
}

function personNames(db: Db): Map<string, string> {
  return new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .all()
      .map((r) => [r.id, r.name]),
  );
}

/**
 * The last {@link SETUP_ACTIVITY_DAYS} days, newest first, derived from the
 * timestamps the setup's own rows carry — no log of its own. A repository
 * check is listed only for a space the reader can open, as the repositories
 * list is.
 */
function recentActivity(
  db: Db,
  subject: Subject,
  deviceList: readonly SetupDeviceView[],
  tools: readonly SetupToolView[],
  tokens: readonly SetupTokenView[],
  readable: ReadonlySet<string>,
  ref: (id: string | null) => PersonRef | null,
  now: number,
): SetupActivityView[] {
  const since = now - SETUP_ACTIVITY_DAYS * DAY_MS;
  const within = (at: number | null): at is number => at !== null && at >= since && at <= now;
  const member = ref(subject.id);
  const out: SetupActivityView[] = [];

  for (const d of deviceList) {
    if (within(d.paired_at)) {
      out.push({ at: d.paired_at, kind: 'paired', subject: d.display_name, by: member });
    }
    if (d.status === 'revoked' && within(d.revoked_at)) {
      out.push({
        at: d.revoked_at,
        kind: 'device_unpaired',
        subject: d.display_name,
        by: d.revoked_by ?? null,
      });
    }
  }
  for (const t of tools) {
    if (within(t.created_at)) {
      out.push({ at: t.created_at, kind: 'tool_added', subject: t.display_name, by: member });
    }
    if (t.status === 'revoked' && within(t.revoked_at)) {
      out.push({
        at: t.revoked_at,
        kind: 'tool_revoked',
        subject: t.display_name,
        by: t.revoked_by ?? member,
      });
    }
  }

  // A token's revoker is its `token.revoked` row's actor (§4.8): the one
  // place the board records it.
  const revokedIds = new Set(tokens.filter((t) => within(t.revoked_at)).map((t) => t.id));
  const revokers = new Map<string, string | null>();
  if (revokedIds.size > 0) {
    for (const row of db
      .select({ actorId: activity.actorId, payloadJson: activity.payloadJson })
      .from(activity)
      .where(and(eq(activity.type, 'token.revoked'), gte(activity.createdAt, since)))
      .all()) {
      const tokenId = tokenIdOf(row.payloadJson);
      if (tokenId !== null && revokedIds.has(tokenId)) revokers.set(tokenId, row.actorId);
    }
  }
  for (const t of tokens) {
    if (!within(t.revoked_at)) continue;
    out.push({
      at: t.revoked_at,
      kind: 'token_revoked',
      subject: t.name,
      by: ref(revokers.get(t.id) ?? null),
    });
  }

  for (const row of db
    .select({
      projectId: projectRepoSetups.projectId,
      repoLabel: projectRepoSetups.repoLabel,
      checkedAt: projectRepoSetups.checkedAt,
      blockFound: projectRepoSetups.blockFound,
      projectMatch: projectRepoSetups.projectMatch,
      prefixMatch: projectRepoSetups.prefixMatch,
    })
    .from(projectRepoSetups)
    .where(
      and(
        eq(projectRepoSetups.ownerUserId, subject.id),
        eq(projectRepoSetups.source, 'local_check'),
        or(
          eq(projectRepoSetups.blockFound, false),
          eq(projectRepoSetups.projectMatch, false),
          eq(projectRepoSetups.prefixMatch, false),
        ),
      ),
    )
    .all()) {
    if (!readable.has(row.projectId) || !within(row.checkedAt)) continue;
    out.push({
      at: row.checkedAt,
      kind: 'project_check_failed',
      subject: row.repoLabel ?? 'Repository',
      by: null,
    });
  }

  return out.sort((a, b) => b.at - a.at);
}

function tokenIdOf(payloadJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed === 'object' && parsed !== null && 'token_id' in parsed) {
      const id = parsed.token_id;
      return typeof id === 'string' ? id : null;
    }
  } catch {
    // A malformed payload names no token.
  }
  return null;
}

// ---------------------------------------------------------------- the revokes

/**
 * `POST /people/:id/agents/:agentId/revoke`: revoke one of the member's tools
 * (D-133). Exactly the owner's own revoke — its tokens refused from the next
 * request, its sessions ended, its offers closed — plus `revoked_by` and one
 * `tool_revoked` notice. Idempotent: an agent already revoked changes nothing
 * and tells nobody. Another person's agent under this member's id is the same
 * `404` as none.
 */
export function revokeMemberAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  userId: string,
  agentId: string,
  now: number = Date.now(),
): SetupToolView {
  const subject = requireSubject(db, actor, 'agent.revoke_any', userId);
  const row = immediateTransaction(sqlite, () => {
    const agent = db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerUserId, subject.id)))
      .get();
    if (agent === undefined) throw ApiError.agentNotFound();
    if (agent.status === 'revoked') return agent;

    revokeAgentRow(db, actor, agent, now);
    writeNotice(db, {
      userId: subject.id,
      actorUserId: actor.userId,
      kind: 'tool_revoked',
      subject: agent.displayName.slice(0, NOTICE_SUBJECT_MAX),
      now,
    });
    return db.select().from(agents).where(eq(agents.id, agent.id)).get() ?? agent;
  });

  const readable = new Set(visibleProjectIds(db, actor));
  const names = personNames(db);
  const revokedBy =
    row.revokedByUserId === null
      ? null
      : { id: row.revokedByUserId, name: names.get(row.revokedByUserId) ?? '' };
  return toolView(db, row, readable, consentsOf(db, [row.id]).has(row.id), revokedBy, now);
}

export interface UnpairedDeviceView {
  device: SetupDeviceView;
  /** The tools this unpair revoked; empty when the device was already unpaired. */
  revoked_agent_ids: string[];
}

/**
 * `POST /people/:id/devices/:deviceId/revoke`: unpair one of the member's
 * devices (D-133), in one write transaction:
 *
 * - the device becomes `revoked`, its key no proof of anything;
 * - **every active tool on it** is revoked as `revokeMemberAgent` revokes one
 *   — linked by `device_id`, and an unlinked one by its label, as the
 *   owner's own device revoke reads a device;
 * - its live pairing requests are cancelled;
 * - one `device_unpaired` notice, not one per tool.
 *
 * Idempotent: a device already revoked changes nothing and tells nobody.
 */
export function revokeMemberDevice(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  userId: string,
  deviceId: string,
  now: number = Date.now(),
): UnpairedDeviceView {
  const subject = requireSubject(db, actor, 'device.revoke_any', userId);
  const revoked = immediateTransaction(sqlite, () => {
    const device = db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, subject.id)))
      .get();
    if (device === undefined) throw ApiError.notFound('No such device');
    if (device.status === 'revoked') return [];

    db.update(devices)
      .set({ status: 'revoked', revokedAt: now, revokedByUserId: actor.userId })
      .where(eq(devices.id, device.id))
      .run();

    const onDevice = db
      .select()
      .from(agents)
      .where(and(eq(agents.ownerUserId, subject.id), eq(agents.status, 'active')))
      .all()
      .filter(
        (agent) =>
          agent.deviceId === device.id ||
          (agent.deviceId === null && deviceLabelKey(agent.deviceLabel) === device.labelKey),
      );
    for (const agent of onDevice) revokeAgentRow(db, actor, agent, now);
    cancelPairingsOfDevice(db, device.id, now);

    writeNotice(db, {
      userId: subject.id,
      actorUserId: actor.userId,
      kind: 'device_unpaired',
      subject: device.displayName.slice(0, NOTICE_SUBJECT_MAX),
      now,
    });
    return onDevice.map((agent) => agent.id);
  });

  const names = personNames(db);
  const view = devicesOf(db, subject.id).find((d) => d.id === deviceId);
  if (view === undefined) throw ApiError.notFound('No such device');
  const { agents: linked, ...rest } = view;
  const by = db
    .select({ revokedByUserId: devices.revokedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .get()?.revokedByUserId;
  return {
    device: {
      ...rest,
      agent_ids: linked.map((a) => a.id),
      revoked_by: by == null ? null : { id: by, name: names.get(by) ?? '' },
    },
    revoked_agent_ids: revoked,
  };
}
