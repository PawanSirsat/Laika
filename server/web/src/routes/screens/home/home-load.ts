import { listOrgActivity, shownInFeed, type ActivityEvent } from '../../../api/activity.ts';
import {
  getAgent,
  listAgents,
  type AgentSession,
  type RegisteredAgent,
} from '../../../api/agents.ts';
import { everyPage } from '../../../api/every-page.ts';
import { listPersonHandoffs, type PersonHandoffView } from '../../../api/handoffs.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import {
  getTask,
  listAllTasks,
  listMembers,
  type Member,
  type TaskStatus,
} from '../../../api/tasks.ts';
import type { MineTask } from '../my-day/plate-derive.ts';
import {
  ACTIVITY_CAP,
  blockerIdsOf,
  HOME_CAP,
  type BlockerInfo,
  type SpaceRef,
} from './home-derive.ts';

/**
 * What each Command Center section reads (LAI-1202) — **existing endpoints
 * only**, each section on its own so one that fails leaves the rest. The API
 * functions are passed in, so the reads are tested without a server
 * (`home-load.test.ts`); the page passes {@link HOME_API}.
 */
export interface HomeApi {
  readonly listProjects: typeof listProjects;
  readonly listAllTasks: typeof listAllTasks;
  readonly getTask: typeof getTask;
  readonly listMembers: typeof listMembers;
  readonly listAgents: typeof listAgents;
  readonly getAgent: typeof getAgent;
  readonly listPersonHandoffs: typeof listPersonHandoffs;
  readonly listOrgActivity: typeof listOrgActivity;
}

export const HOME_API: HomeApi = {
  listProjects,
  listAllTasks,
  getTask,
  listMembers,
  listAgents,
  getAgent,
  listPersonHandoffs,
  listOrgActivity,
};

/** The kinds of open work that are someone's: everything but done and cancelled. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];
/** Blockers looked up one by one — enough for a person's own open work. */
export const BLOCKER_LIMIT = 20;
/** Agents whose sessions are read, one `GET /agents/:id` each. */
export const AGENT_LIMIT = 10;

export interface Spaces {
  readonly bySlug: ReadonlyMap<string, SpaceRef>;
  readonly byId: ReadonlyMap<string, SpaceRef>;
}

/** The live spaces the reader can read, every page, by slug and by id. */
export async function loadSpaces(api: HomeApi, signal: AbortSignal): Promise<Spaces> {
  const { items } = await everyPage((cursor) =>
    api.listProjects(cursor === undefined ? { limit: 100 } : { limit: 100, cursor }, signal),
  );
  const bySlug = new Map<string, SpaceRef>();
  const byId = new Map<string, SpaceRef>();
  for (const row of items) {
    if (!isProject(row) || row.archived_at !== null) continue;
    const ref = { slug: row.slug, name: row.name };
    bySlug.set(row.slug, ref);
    byId.set(row.id, ref);
  }
  return { bySlug, byId };
}

export interface MineData {
  readonly mine: readonly MineTask[];
  readonly blockers: ReadonlyMap<string, BlockerInfo>;
}

/**
 * The reader's own open work in every space they can read — `GET /tasks`
 * filtered to them, one walk per open kind — and each outside blocker once,
 * with its assignee's name from that space's members. A blocker the reader
 * cannot read is left out of the map: it still blocks, unnamed. A task in a
 * space not in `spaces` (archived, or out of a token's scope) is dropped,
 * since it would open nowhere.
 */
export async function loadMine(
  meId: string,
  spaces: Spaces,
  api: HomeApi,
  signal: AbortSignal,
): Promise<MineData> {
  const pages = await Promise.all(
    OPEN_STATUSES.map((status) =>
      everyPage((cursor) =>
        api.listAllTasks(
          { assignee: meId, status, limit: 100, ...(cursor === undefined ? {} : { cursor }) },
          signal,
        ),
      ),
    ),
  );
  const mine: MineTask[] = [];
  for (const { items } of pages) {
    for (const task of items) {
      const space = spaces.byId.get(task.project_id);
      if (space !== undefined) mine.push({ task, slug: space.slug });
    }
  }

  const blockers = new Map<string, BlockerInfo>();
  await Promise.all(
    blockerIdsOf(mine)
      .slice(0, BLOCKER_LIMIT)
      .map(async (id) => {
        let task;
        try {
          task = await api.getTask(id, signal);
        } catch {
          return;
        }
        const slug = spaces.byId.get(task.project_id)?.slug;
        let owner: string | null | undefined = task.assignee_id === null ? null : undefined;
        if (task.assignee_id !== null && slug !== undefined) {
          try {
            const { members } = await api.listMembers(slug, signal);
            owner = members.find((m) => m.user_id === task.assignee_id)?.name;
          } catch {
            // Its owner goes unnamed; the blocker is still named by key.
          }
        }
        blockers.set(id, { key: task.key, status: task.status, owner });
      }),
  );
  if (signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');
  return { mine, blockers };
}

export interface AgentsData {
  readonly agents: readonly RegisteredAgent[];
  /** Each active agent's recent sessions, newest first; absent when its read failed. */
  readonly sessions: ReadonlyMap<string, readonly AgentSession[]>;
}

/**
 * The reader's own agents (`GET /agents` — nobody else's, §3.1
 * `agent.read_own`) and, for the first {@link AGENT_LIMIT} active ones, the
 * recent sessions `GET /agents/:id` carries, which say whether each is
 * connected. A detail that fails leaves that agent's connection unknown.
 */
export async function loadAgents(api: HomeApi, signal: AbortSignal): Promise<AgentsData> {
  const { items } = await everyPage((cursor) =>
    api.listAgents(signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
  );
  const sessions = new Map<string, readonly AgentSession[]>();
  await Promise.all(
    items
      .filter((agent) => agent.status === 'active')
      .slice(0, AGENT_LIMIT)
      .map((agent) =>
        api
          .getAgent(agent.id, signal)
          .then((detail) => {
            sessions.set(agent.id, detail.sessions);
          })
          .catch(() => undefined),
      ),
  );
  return { agents: items, sessions };
}

export interface HandoffsData {
  readonly rows: readonly PersonHandoffView[];
  /** The server's count of hand-offs waiting on the reader, past the page. */
  readonly waiting: number;
}

/** The hand-offs waiting on the reader's approval — the first page, and the count. */
export async function loadHandoffs(api: HomeApi, signal: AbortSignal): Promise<HandoffsData> {
  const inbox = await api.listPersonHandoffs({ view: 'needs_approval', limit: HOME_CAP }, signal);
  return { rows: inbox.data, waiting: inbox.counts.needs_approval };
}

export interface ActivityData {
  readonly events: readonly ActivityEvent[];
  /** Who acted, from the members of the spaces the rows are in. */
  readonly members: ReadonlyMap<string, Member>;
}

/**
 * The newest rows of the feed across the reader's spaces — **one page, on
 * purpose**: a glance with a link out, never a history (that is each space's
 * Activity tab). Names come from the members of the spaces those rows are in.
 */
export async function loadActivity(
  spaces: Spaces,
  api: HomeApi,
  signal: AbortSignal,
): Promise<ActivityData> {
  const page = await api.listOrgActivity(20, signal);
  const events = shownInFeed(page.data).slice(0, ACTIVITY_CAP);
  const slugs = new Set<string>();
  for (const event of events) {
    const slug = event.project_id === null ? undefined : spaces.byId.get(event.project_id)?.slug;
    if (slug !== undefined) slugs.add(slug);
  }
  const members = new Map<string, Member>();
  await Promise.all(
    [...slugs].map((slug) =>
      api
        .listMembers(slug, signal)
        .then(({ members: list }) => {
          for (const member of list) members.set(member.user_id, member);
        })
        .catch(() => undefined),
    ),
  );
  return { events, members };
}
