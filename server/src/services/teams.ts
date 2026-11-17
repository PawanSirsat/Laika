import { desc, eq, isNull } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  type TeamsPostEvent,
  type TeamsPostKind,
  type TeamsPostOutcome,
  type TeamsPostReason,
} from '../db/enums.ts';
import {
  orgs,
  orgTeamsSettings,
  projects,
  projectTeamsChannels,
  type ProjectTeamsChannel,
  teamsPosts,
  type TeamsPost,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { encryptSecret } from '../secrets.ts';
import { requireReadableProjectBySlug } from './projects.ts';
import { checkTeamsWebhookUrl } from './teams-client.ts';
import {
  buildTestPost,
  DIGEST_HOUR_SAST,
  istInstant,
  sastMidnight,
  STANDUP_RUNS,
} from './teams-compose.ts';
import { ensureTeamsSettings, postAndRecord, type TeamsPostingDeps } from './teams-posting.ts';

/**
 * Teams posting, as an owner or admin configures it (§6.4, D-154, LAI-1314):
 * the organisation's *Teams posting on* switch, and each space's channel —
 * set, cleared and tested.
 *
 * **Every call is `org.teams.configure`** — owners and admins holding *Change
 * organisation settings, Time and breaks*, signed in. A space's own reads and
 * writes also need the space to be one the caller can open, so a space they
 * cannot see answers as one that does not exist.
 *
 * **The address goes in and never comes out.** It is encrypted the moment it
 * arrives; every view shows its host and its last four characters, and
 * nothing decrypts it but the post itself. **No `activity` row**: §4.8 gains
 * no verb for this (CLAUDE.md §4.4), and the settings and channel rows say who
 * changed them last and when.
 */

/** A person a Teams view names. */
export interface TeamsPersonView {
  id: string;
  name: string;
}

/** One post, or one that was held back — never its body, never Teams' answer. */
export interface TeamsPostView {
  id: string;
  kind: TeamsPostKind;
  event: TeamsPostEvent | null;
  /** The message's first line, as composed. */
  title: string;
  outcome: TeamsPostOutcome;
  /** Why it was suppressed or failed; null for one sent or being sent. */
  reason: TeamsPostReason | null;
  /** Teams' status code, when it answered. */
  http_status: number | null;
  created_at: number;
  finished_at: number | null;
}

/** A space's channel: which flow, never its address. */
export interface TeamsChannelView {
  project_id: string;
  project_slug: string;
  project_name: string;
  /** The webhook's host, e.g. `….environment.api.powerplatform.com`. */
  host: string;
  /** The address's last four characters. */
  last4: string;
  set_at: number;
  set_by: TeamsPersonView | null;
  /** The newest post to this space, whatever came of it. */
  last_post: TeamsPostView | null;
}

/** When the scheduled posts go, as the server keeps them. */
export interface TeamsScheduleView {
  /** The stand-up's two runs, `HH:MM` UTC, Monday to Friday (India's weekdays). */
  standup_utc: string[];
  /** The nightly digest, `HH:MM` UTC, every day. */
  digest_utc: string;
}

/** `GET /org/teams`. */
export interface TeamsSettingsView {
  /** Off until an owner or admin turns it on; off, nothing is posted and each post is recorded as suppressed. */
  posting_enabled: boolean;
  updated_at: number | null;
  updated_by: TeamsPersonView | null;
  schedule: TeamsScheduleView;
  /** Every unarchived space with a channel, by name. */
  channels: TeamsChannelView[];
}

/** `GET /projects/:slug/teams`. */
export interface ProjectTeamsView {
  /** The organisation's switch, so a space's card can say posts are being held. */
  posting_enabled: boolean;
  channel: TeamsChannelView | null;
  /** The newest posts to this space, newest first. */
  recent: TeamsPostView[];
}

/** How many posts a space's card lists. */
const RECENT_POSTS = 15;

function postView(row: TeamsPost): TeamsPostView {
  return {
    id: row.id,
    kind: row.kind,
    event: row.event,
    title: row.title,
    outcome: row.outcome,
    reason: row.reason,
    http_status: row.httpStatus,
    created_at: row.createdAt,
    finished_at: row.finishedAt,
  };
}

function personView(db: Db, userId: string | null): TeamsPersonView | null {
  if (userId === null) return null;
  const row = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row ?? null;
}

function recentPosts(db: Db, projectId: string, limit: number): TeamsPost[] {
  return db
    .select()
    .from(teamsPosts)
    .where(eq(teamsPosts.projectId, projectId))
    .orderBy(desc(teamsPosts.createdAt), desc(teamsPosts.id))
    .limit(limit)
    .all();
}

function channelView(
  db: Db,
  project: { id: string; slug: string; name: string },
  channel: ProjectTeamsChannel,
): TeamsChannelView {
  const last = recentPosts(db, project.id, 1)[0];
  return {
    project_id: project.id,
    project_slug: project.slug,
    project_name: project.name,
    host: channel.webhookHost,
    last4: channel.webhookLast4,
    set_at: channel.setAt,
    set_by: personView(db, channel.setBy),
    last_post: last === undefined ? null : postView(last),
  };
}

/** `HH:MM` UTC of an IST wall time — any date will do: India keeps no daylight saving. */
function utcOfIst(hour: number, minute: number): string {
  return new Date(istInstant('2026-01-05', hour, minute)).toISOString().slice(11, 16);
}

function postingEnabled(db: Db): boolean {
  return db.select({ on: orgTeamsSettings.postingEnabled }).from(orgTeamsSettings).get()?.on === 1;
}

function requireOrgId(db: Db): string {
  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) throw new ApiError('conflict', 'This Laika has not been set up yet');
  return org.id;
}

/**
 * `GET /org/teams` — the switch, the schedule, and the channel of every space
 * **the caller can open**: a role granted *Change organisation settings*
 * without *Open every project* is not told a private space's name, nor that
 * it has a channel.
 */
export function getTeamsSettings(db: Db, actor: ResolvedActor): TeamsSettingsView {
  assertCan(actor, 'org.teams.configure');
  const settings = db.select().from(orgTeamsSettings).get();
  const channels = db
    .select({ project: projects, channel: projectTeamsChannels })
    .from(projectTeamsChannels)
    .innerJoin(projects, eq(projects.id, projectTeamsChannels.projectId))
    .where(isNull(projects.archivedAt))
    .orderBy(projects.name)
    .all();
  return {
    posting_enabled: settings?.postingEnabled === 1,
    // A row only the posting job wrote has nobody's change to show.
    updated_at: settings?.updatedBy == null ? null : settings.updatedAt,
    updated_by: personView(db, settings?.updatedBy ?? null),
    schedule: {
      standup_utc: (['morning', 'evening'] as const).map((run) =>
        utcOfIst(STANDUP_RUNS[run].hourIst, STANDUP_RUNS[run].minuteIst),
      ),
      digest_utc: new Date(sastMidnight('2026-01-05') + DIGEST_HOUR_SAST * 60 * 60 * 1000)
        .toISOString()
        .slice(11, 16),
    },
    channels: channels
      .filter(({ project }) =>
        can(withProject(actor, project.id), 'project.read', { projectId: project.id }),
      )
      .map(({ project, channel }) => channelView(db, project, channel)),
  };
}

/** `PUT /org/teams` — turn posting on or off. */
export function setTeamsPosting(
  db: Db,
  actor: ResolvedActor,
  input: { posting_enabled: boolean },
  now: number = Date.now(),
): TeamsSettingsView {
  assertCan(actor, 'org.teams.configure');
  const orgId = requireOrgId(db);
  ensureTeamsSettings(db, orgId, now);
  db.update(orgTeamsSettings)
    .set({ postingEnabled: input.posting_enabled ? 1 : 0, updatedBy: actor.userId, updatedAt: now })
    .where(eq(orgTeamsSettings.orgId, orgId))
    .run();
  return getTeamsSettings(db, actor);
}

/** The space, for an owner or admin who may open it — else the missing slug's 404. */
function requireSpace(db: Db, actor: ResolvedActor, slug: string) {
  assertCan(actor, 'org.teams.configure');
  return requireReadableProjectBySlug(db, actor, slug);
}

function channelOf(db: Db, projectId: string): ProjectTeamsChannel | undefined {
  return db
    .select()
    .from(projectTeamsChannels)
    .where(eq(projectTeamsChannels.projectId, projectId))
    .get();
}

/** `GET /projects/:slug/teams` — the channel, if any, and the newest posts. */
export function getProjectTeams(db: Db, actor: ResolvedActor, slug: string): ProjectTeamsView {
  const project = requireSpace(db, actor, slug);
  const channel = channelOf(db, project.id);
  return {
    posting_enabled: postingEnabled(db),
    channel: channel === undefined ? null : channelView(db, project, channel),
    recent: recentPosts(db, project.id, RECENT_POSTS).map(postView),
  };
}

/**
 * `PUT /projects/:slug/teams` — set or replace the space's webhook address.
 * Checked (`checkTeamsWebhookUrl`), encrypted, and never answered: the view
 * carries its host and last four characters. How CHIEF brings KSage's
 * existing flows over is this, once per space.
 */
export function setProjectTeamsChannel(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: { webhook_url: string },
  serverSecret: string,
  now: number = Date.now(),
): ProjectTeamsView {
  const project = requireSpace(db, actor, slug);
  // Never encrypt under no key: a value nothing can read back is worse than a refusal.
  if (serverSecret === '') throw new ApiError('internal', 'LAIKA_SECRET is not configured');
  const address = checkTeamsWebhookUrl(input.webhook_url);
  const row = {
    webhookUrlEnc: encryptSecret(address.url, serverSecret, 'teams_webhook_url'),
    webhookHost: address.host,
    webhookLast4: address.last4,
    setBy: actor.userId,
    setAt: now,
  };
  db.insert(projectTeamsChannels)
    .values({ projectId: project.id, ...row })
    .onConflictDoUpdate({ target: projectTeamsChannels.projectId, set: row })
    .run();
  return getProjectTeams(db, actor, slug);
}

/** `DELETE /projects/:slug/teams` — the space has no channel, and is told nothing. */
export function clearProjectTeamsChannel(db: Db, actor: ResolvedActor, slug: string): void {
  const project = requireSpace(db, actor, slug);
  db.delete(projectTeamsChannels).where(eq(projectTeamsChannels.projectId, project.id)).run();
}

/**
 * `POST /projects/:slug/teams/test` — one post to the space's channel,
 * **whether posting is on or off**: the only way to know a channel works is to
 * post to it, and that is worth knowing before turning posting on. Recorded
 * like any post; the answer is that record.
 */
export async function sendTeamsTestPost(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  serverSecret: string,
  deps: TeamsPostingDeps = {},
): Promise<TeamsPostView> {
  const project = requireSpace(db, actor, slug);
  const channel = channelOf(db, project.id);
  if (channel === undefined) {
    throw new ApiError('conflict', 'This space has no Teams channel set', {
      reason: 'teams_no_channel',
    });
  }
  const notice = buildTestPost(project, deps.publicUrl ?? null);
  const post = await postAndRecord(
    db,
    serverSecret,
    {
      projectId: project.id,
      kind: 'test',
      event: null,
      slot: null,
      title: notice.title,
      attempt: 1,
    },
    notice,
    deps,
  );
  // A test post has no slot, so nothing can have claimed it first.
  if (post === null) throw new ApiError('internal', 'The test post was not recorded');
  return postView(post);
}
