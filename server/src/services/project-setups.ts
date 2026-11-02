import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type ProjectSetupSource } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { presenceEnabled } from '../db/orgs.ts';
import { agentProjectGrants, agents, projectRepoSetups, projects } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { visibleProjectIds } from './activity.ts';
import { requireActiveAgent, requireOwnAgent } from './agents.ts';
import { registeredAgent } from './claims.ts';
import { requireReadableProjectBySlug } from './projects.ts';

/**
 * Project repository setup records (SPEC §4.82, LAI-1066; plan LAI-1042 §D.2,
 * §E.5, §G): what is known about the Laika block in one repository's
 * instructions file.
 *
 * **Two sources, never confused.** The owner, signed in, says *I've added it*
 * (`self_reported_browser`) — their word, shown as theirs and never as
 * verified. `laika project check`, on a device with the agent's **own** token,
 * says what it read in the file (`local_check`). The board itself never sees
 * a repository, and nothing here pretends it did.
 *
 * **Evidence, never access.** No `can()` call, fence or claim reads a row; a
 * record grants nothing and a missing one takes nothing away. Who may write
 * one is asked of `can()` like every other write: the owner's
 * `agent.manage_own` (session only) for the browser, the agent's own
 * `heartbeat.send_own` for a local check — its own record about its own work,
 * as `POST /agents/me/client-report` is — and in both cases the project must
 * be one the caller can read, so an agent records only inside its grants.
 *
 * **Nobody else's.** Rows are read and written by owner; another owner's
 * agent, a project the caller cannot read, and an id that names nothing are
 * the same `404`. **No local path** is accepted: a repository is a hash the
 * CLI made of its remote and a label the person chose, and the instructions
 * path is relative to the repository. While the org has presence off,
 * `checked_at` is stored and answered `null` (§4.2).
 */

/** At most this long, the label a person chose for a repository. */
export const REPO_LABEL_MAX = 90;

export interface ProjectSetupView {
  id: string;
  /** Null for a browser record about no tool in particular. */
  agent_id: string | null;
  /** The agent's device, as it is named now — where a local check ran. */
  device_label: string | null;
  project_id: string;
  project_slug: string;
  repo_label: string | null;
  instructions_path: string | null;
  block_found: boolean;
  /** The instructions template's revision — never the brief's `context_revision`. */
  template_revision: number | null;
  /** Null when not checked: a browser record, a legacy block, or no block. */
  project_match: boolean | null;
  prefix_match: boolean | null;
  source: ProjectSetupSource;
  /** Null while the org has presence off (§4.2). */
  checked_at: number | null;
}

export interface BrowserRecordInput {
  agentId: string | null;
  projectSlug: string;
  templateRevision: number;
  instructionsPath: string | null;
}

export interface LocalCheckInput {
  projectSlug: string;
  repoKey: string;
  repoLabel: string;
  instructionsPath: string | null;
  blockFound: boolean;
  templateRevision: number | null;
  /** The `project=` slug in the block's begin marker; null for a legacy block. */
  blockProject: string | null;
  /** The prefix in the block's *Task keys look like* line, when it has one. */
  blockPrefix: string | null;
}

export type RecordInput =
  | ({ source: 'self_reported_browser' } & BrowserRecordInput)
  | ({ source: 'local_check' } & LocalCheckInput);

type Row = typeof projectRepoSetups.$inferSelect;

/**
 * `POST /project-setups`. The caller decides the source: a registered agent's
 * token can only make a `local_check` about itself, and a session only a
 * browser record. A personal token is neither — it is not the agent that read
 * the file, and it is not the owner signed in — so it is refused
 * `403 not_an_agent`.
 */
export function recordProjectSetup(
  db: Db,
  actor: ResolvedActor,
  input: RecordInput,
  now: number = Date.now(),
): ProjectSetupView {
  const agent = registeredAgent(actor);
  const onToken = actor.token !== null && actor.token !== undefined;

  if (input.source === 'local_check') {
    assertCan(actor, 'heartbeat.send_own');
    if (agent === null) {
      throw new ApiError('forbidden', 'Only a registered agent’s token records a local check', {
        reason: 'not_an_agent',
      });
    }
  } else {
    if (onToken) {
      throw new ApiError('forbidden', 'This needs a signed-in web session, not a token', {
        action: 'agent.manage_own',
        reason: agent === null ? 'not_an_agent' : 'session_required',
      });
    }
    assertCan(actor, 'agent.manage_own');
  }

  const project = requireReadableProjectBySlug(db, actor, input.projectSlug);
  const agentId =
    input.source === 'local_check'
      ? (agent?.id ?? null)
      : input.agentId === null
        ? null
        : requireGrantedAgent(db, actor, input.agentId, project.id);

  const checkedAt = presenceEnabled(db) ? now : null;
  const values =
    input.source === 'local_check'
      ? {
          repoKey: input.repoKey,
          repoLabel: input.repoLabel,
          instructionsPath: input.instructionsPath,
          blockFound: input.blockFound,
          templateRevision: input.blockFound ? input.templateRevision : null,
          projectMatch:
            input.blockFound && input.blockProject !== null
              ? input.blockProject === project.slug
              : null,
          prefixMatch:
            input.blockFound && input.blockPrefix !== null
              ? input.blockPrefix === project.prefix
              : null,
          checkedAt,
        }
      : {
          repoKey: '',
          repoLabel: null,
          instructionsPath: input.instructionsPath,
          blockFound: true,
          templateRevision: input.templateRevision,
          projectMatch: null,
          prefixMatch: null,
          checkedAt,
        };

  const row = db.transaction((tx) => {
    const existing = tx
      .select({ id: projectRepoSetups.id })
      .from(projectRepoSetups)
      .where(
        and(
          eq(projectRepoSetups.ownerUserId, actor.userId),
          agentId === null
            ? isNull(projectRepoSetups.agentId)
            : eq(projectRepoSetups.agentId, agentId),
          eq(projectRepoSetups.projectId, project.id),
          eq(projectRepoSetups.repoKey, values.repoKey),
          eq(projectRepoSetups.source, input.source),
        ),
      )
      .get();
    if (existing !== undefined) {
      return tx
        .update(projectRepoSetups)
        .set(values)
        .where(eq(projectRepoSetups.id, existing.id))
        .returning()
        .get();
    }
    return tx
      .insert(projectRepoSetups)
      .values({
        id: newId(),
        orgId: project.orgId,
        ownerUserId: actor.userId,
        agentId,
        projectId: project.id,
        source: input.source,
        ...values,
      })
      .returning()
      .get();
  });

  return toView(db, row, project.slug, checkedAt !== null);
}

/**
 * The owner's agent, active, **with a grant on the project** (LAI-1073): a
 * browser record about a tool says no more than that tool could record for
 * itself, and its own token is refused outside its grants. Refused the same
 * way, `403 agent_not_granted`; the owner already knows the agent's grants.
 */
function requireGrantedAgent(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  projectId: string,
): string {
  const row = requireActiveAgent(db, actor, agentId);
  const granted = db
    .select({ scope: agentProjectGrants.scope })
    .from(agentProjectGrants)
    .where(and(eq(agentProjectGrants.agentId, row.id), eq(agentProjectGrants.projectId, projectId)))
    .get();
  if (granted === undefined) {
    throw new ApiError(
      'forbidden',
      'This tool has no access to this project; give it access first',
      {
        reason: 'agent_not_granted',
      },
    );
  }
  return row.id;
}

/**
 * `GET /project-setups?project=&agent_id=`: the caller's own records for one
 * project they can read — or, with no `project`, across every project they can
 * read (LAI-1077). An agent's token reads only its own; asking for another
 * agent — a sibling, another owner's, or none at all — is the agent `404`, the
 * answer an id that names nothing gets.
 */
export function listProjectSetups(
  db: Db,
  actor: ResolvedActor,
  projectSlug: string | undefined,
  agentId: string | undefined,
): ProjectSetupView[] {
  assertCan(actor, 'agent.read_own');
  if (projectSlug === undefined) return listAcrossProjects(db, actor, agentId);

  const project = requireReadableProjectBySlug(db, actor, projectSlug);
  const only = onlyAgent(db, actor, agentId);

  const rows = db
    .select()
    .from(projectRepoSetups)
    .where(
      and(
        eq(projectRepoSetups.ownerUserId, actor.userId),
        eq(projectRepoSetups.projectId, project.id),
        only === undefined ? undefined : eq(projectRepoSetups.agentId, only),
      ),
    )
    .orderBy(asc(projectRepoSetups.id))
    .all();

  const presence = presenceEnabled(db);
  return rows.map((row) => toView(db, row, project.slug, presence));
}

/**
 * Every project's records at once, newest first by id (a ULID, so by when the
 * record was first made). Each project is asked the same `project.read` the
 * per-project read asks (`visibleProjectIds`, §3.3), and only those ids reach
 * the query: a project the caller cannot read contributes nothing and is named
 * nowhere — there is no project to answer `404` about.
 */
function listAcrossProjects(
  db: Db,
  actor: ResolvedActor,
  agentId: string | undefined,
): ProjectSetupView[] {
  const only = onlyAgent(db, actor, agentId);
  const readable = visibleProjectIds(db, actor);
  if (readable.length === 0) return [];

  const rows = db
    .select({ row: projectRepoSetups, slug: projects.slug })
    .from(projectRepoSetups)
    .innerJoin(projects, eq(projects.id, projectRepoSetups.projectId))
    .where(
      and(
        eq(projectRepoSetups.ownerUserId, actor.userId),
        inArray(projectRepoSetups.projectId, readable),
        only === undefined ? undefined : eq(projectRepoSetups.agentId, only),
      ),
    )
    .orderBy(desc(projectRepoSetups.id))
    .all();

  const presence = presenceEnabled(db);
  return rows.map(({ row, slug }) => toView(db, row, slug, presence));
}

/** The one agent a read is narrowed to, if any — the token's own, or the owner's named one. */
function onlyAgent(db: Db, actor: ResolvedActor, agentId: string | undefined): string | undefined {
  const self = registeredAgent(actor);
  if (self !== null) {
    if (agentId !== undefined && agentId !== self.id) throw ApiError.agentNotFound();
    return self.id;
  }
  return agentId === undefined ? undefined : requireOwnAgent(db, actor, agentId).id;
}

function toView(db: Db, row: Row, projectSlug: string, presence: boolean): ProjectSetupView {
  const deviceLabel =
    row.agentId === null
      ? null
      : (db
          .select({ deviceLabel: agents.deviceLabel })
          .from(agents)
          .where(eq(agents.id, row.agentId))
          .get()?.deviceLabel ?? null);
  return {
    id: row.id,
    agent_id: row.agentId,
    device_label: deviceLabel,
    project_id: row.projectId,
    project_slug: projectSlug,
    repo_label: row.repoLabel,
    instructions_path: row.instructionsPath,
    block_found: row.blockFound,
    template_revision: row.templateRevision,
    project_match: row.projectMatch,
    prefix_match: row.prefixMatch,
    source: row.source,
    // A row written while presence was on still says nothing once it is off.
    checked_at: presence ? row.checkedAt : null,
  };
}
