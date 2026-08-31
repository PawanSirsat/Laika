import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { heartbeats, projects } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Presence (SPEC §9.1, §4.10, D-005, D-023).
 *
 * An agent says "I am working in this repo, on this branch". That is the whole
 * feature, and D-023 moved the write path into M4 so the milestone can be
 * verified end to end — **reading** these rows (presence, capacity) is M5.
 *
 * ## Metadata only, and the schema is what enforces it
 *
 * §9.1: *"This is the one place where a tempting feature would cost the trust
 * the product is built on."* Repo name, branch name, timestamp. Never a file
 * path, a diff, a prompt or transcript content (D-005, §13.4).
 *
 * The permission is not what keeps that true — the table has nowhere to put
 * anything else, and the request schema refuses unknown fields rather than
 * ignoring them. A body carrying `diff` is a `422`, not a silently dropped key,
 * because a client that believes it sent something is how a promise like this
 * quietly stops being true.
 *
 * ## Why no `activity` row
 *
 * A heartbeat is presence, not an audited action. §4.8 has a `heartbeat.session`
 * verb and this deliberately does not write one: an agent beating every few
 * minutes would drown the feed that exists so a person can see what changed,
 * and "still working" is not a change. Said out loud because a reader finding no
 * `appendActivity` here would otherwise assume it was forgotten.
 *
 * ## What is deliberately absent
 *
 * `matched_task_id` stays null. Resolving a branch name to a task is §9.2 and
 * **M5**, and guessing it here would put a wrong id on a row nothing reads yet.
 * Retention pruning is M5's cron for the same reason.
 */

/**
 * Which project a heartbeat belongs to (SPEC §4.3, §9.2, LAI-116).
 *
 * ## The ambiguity is real and was chosen deliberately
 *
 * LAI-108 decided `projects.repo` is **not unique**: a monorepo tracked by a
 * frontend project and a backend project over one repository is a real
 * arrangement, and a unique index would forbid it to buy an unambiguous match
 * here. So `repo` maps one-to-many, and this is where that is answered.
 *
 * ## The branch is the second signal, and §9.2 already defined it
 *
 * §9.2 matches `[a-z]+-(\d+)` against **project prefixes** to find a task. The
 * same prefix says which project, and an agent working in a monorepo is almost
 * always on a branch named for the task it is doing. So a `repo` that matches
 * several projects is narrowed by the branch before anything else happens —
 * this reuses §9.2's convention rather than inventing a second one that could
 * disagree with it.
 *
 * Falling back to **every** match rather than to none is the honest answer when
 * the branch says nothing: a person working in a monorepo genuinely is present
 * on both projects, and §9.3 counting them twice is a fair description of a
 * shared repository. Attributing to nobody would make presence silently empty
 * for exactly the setup LAI-108 went out of its way to permit.
 *
 * ## Nothing is stored
 *
 * §9.3: *"Both are computed from `heartbeats` + `tasks` at request time. No
 * separate presence store to fall out of sync."* A `project_id` column on
 * `heartbeats` would be that store, and it could hold only one id for a result
 * that is legitimately many. So this resolves at read time and the row keeps
 * only what the agent actually said.
 */

/** Where the answer came from, so a caller can say why. */
export type RepoAttribution =
  /** The branch named a project prefix, narrowing several repo matches to one. */
  | 'branch'
  /** The repo matched, and either it was unambiguous or the branch did not help. */
  | 'repo'
  /** No project tracks this repo. */
  | 'none';

export interface RepoProjects {
  projectIds: string[];
  attribution: RepoAttribution;
}

/**
 * A git remote in any form somebody's tooling might produce → `owner/name`
 * (SPEC §4.3, LAI-144).
 *
 * ## Why the server does this and not the plugin
 *
 * `plugin/hooks/README.md` says the hooks send *"metadata only — git remote"*,
 * and a git remote is a URL. §4.3 stores `owner/name`. **None** of
 * `git@github.com:PawanSirsat/Laika.git`, the two `https://` forms, or any of
 * them with `.git` matches `PawanSirsat/Laika` by any comparison, folded or
 * otherwise — so before this existed, a correctly configured instance sending
 * exactly what the plugin documents resolved every heartbeat to no project, and
 * §9.3 presence was permanently empty.
 *
 * §9.2 already puts resolution on the server because *"the plugin cannot know a
 * deployment's project prefixes"*, and the same reasoning applies here. The
 * direction is what settles it: **an old plugin has to keep working against a
 * new server**, which is the only direction that can be relied on for something
 * self-hosted, where nobody controls when the plugin updates.
 *
 * ## Both sides are normalised, not just the incoming one
 *
 * §4.3 asks for `owner/name`, but nothing enforces it, and a project row holding
 * a URL is exactly as likely as a heartbeat carrying one. Normalising one side
 * only would be a comparison that disagrees with itself depending on which side
 * the URL happened to land on — the same fault as folding case on one side.
 *
 * Returns `null` for anything with nothing left after stripping. §9.2's rule is
 * that unrecognisable input **degrades, it never errors**, so a caller treats
 * `null` as "matches nothing" rather than as a fault.
 */
/**
 * Every remote form Laika accepts, **in the order they are tried**, and the
 * capture that holds the path.
 *
 * One table rather than a chain of `if`s, so adding a form — a self-hosted
 * GitLab path, some other scheme — is one line here instead of a new branch and
 * a new test that has to find where the branch went.
 *
 * **The order is load-bearing and is why this is a list and not a set.**
 * `https://github.com/` has no path, so the URL form does not capture one; if
 * the scp form were tried first it would read `https` as the host and return
 * `github.com` as the repository name. Scheme before scp, always.
 */
const REMOTE_FORMS: { readonly form: string; readonly pattern: RegExp }[] = [
  {
    form: 'scheme://[user@]host/owner/name',
    pattern: /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*(?:\/(.*))?$/,
  },
  {
    // What `git remote -v` prints for an SSH remote, and the form least likely
    // to have been normalised by whoever sent it.
    form: '[user@]host:owner/name',
    pattern: /^(?:[^@/:]+@)?[^/:]+:(.*)$/,
  },
  {
    form: 'owner/name',
    pattern: /^(.*)$/,
  },
];

export function normaliseRepo(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const matched = REMOTE_FORMS.reduce<string | null>(
    (found, { pattern }) => found ?? pattern.exec(trimmed)?.[1] ?? null,
    null,
  );

  // The last form matches anything, so this is unreachable in practice — but
  // `?.[1]` is `undefined` for a pattern that matches without capturing, and
  // treating that as "no repo" is the degrade §9.2 asks for.
  if (matched === null) return null;

  const repo = matched
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    // Only as a suffix. A global replace turns `PawanSirsat/PawanSirsat.github.io`
    // into `PawanSirsat/PawanSirsathub.io`, and every GitHub account has that one.
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  return repo === '' ? null : repo;
}

/**
 * The comparable form: normalised, then lowercased.
 *
 * Folded in JavaScript rather than with SQLite's `lower()`. `lower()` folds
 * ASCII only, while `String.prototype.toLowerCase` is Unicode-aware, and a
 * comparison that disagrees with itself depending on which side ran it is the
 * kind of bug that only shows up on somebody else's repo name. A self-hosted
 * board has few projects, so reading them costs nothing.
 */
function fold(value: string): string | null {
  return normaliseRepo(value)?.toLowerCase() ?? null;
}

/**
 * §9.2's convention, read for the prefix rather than the number.
 *
 * `lai-42-add-task-crud` → `lai`. Anything else → `null`, and the caller
 * degrades rather than erroring (§9.2).
 *
 * **Deliberately §9.2's regex and not a stricter one.** Unanchored, so
 * `feature/lai-42-x` resolves like `lai-42-x` does — the two commonest branch
 * shapes, and anchoring would silently drop one of them. The cost is that a
 * branch like `add-2fa-support` yields `add`, which narrows nothing unless a
 * project actually carries that prefix and shares the repo; the fallback is
 * every match, so a wrong read costs precision, never correctness.
 *
 * When §9.2's task resolution lands it must call **this** function for the
 * prefix. Two parsers for one convention will disagree, and the disagreement
 * would show up as a heartbeat attributed to one project and a task resolved
 * from another.
 */
export function branchProjectPrefix(branch: string): string | null {
  const match = /([A-Za-z]+)-\d+/.exec(branch.trim());

  return match === null ? null : match[1]!.toLowerCase();
}

export function resolveRepoProjects(db: Db, repo: string, branch: string): RepoProjects {
  const wanted = fold(repo);
  if (wanted === null) return { projectIds: [], attribution: 'none' };

  const matches = db
    .select({ id: projects.id, repo: projects.repo, prefix: projects.prefix })
    .from(projects)
    .all()
    .filter((row) => row.repo !== null && fold(row.repo) === wanted);

  if (matches.length === 0) return { projectIds: [], attribution: 'none' };
  if (matches.length === 1) return { projectIds: [matches[0]!.id], attribution: 'repo' };

  const prefix = branchProjectPrefix(branch);
  if (prefix !== null) {
    // At most one within an org — `projects_org_prefix_unique` (§4.13) — but the
    // check is on the result rather than on that index, so a second org could
    // never make this quietly pick one of two.
    const narrowed = matches.filter((row) => row.prefix.toLowerCase() === prefix);
    if (narrowed.length === 1) return { projectIds: [narrowed[0]!.id], attribution: 'branch' };
  }

  return { projectIds: matches.map((row) => row.id).sort(), attribution: 'repo' };
}

/** §4.10's columns are names, not paths. Long enough for a real branch. */
export const REPO_MAX_LENGTH = 200;
export const BRANCH_MAX_LENGTH = 255;

export interface HeartbeatInput {
  repo: string;
  branch: string;
  now?: number;
}

export interface HeartbeatView {
  id: string;
  user_id: string;
  /** Which agent session — null on a cookie, which §9.1 does not allow anyway. */
  token_id: string | null;
  repo: string;
  branch: string;
  /** Always null until §9.2 lands in M5. */
  matched_task_id: string | null;
  created_at: number;
  /**
   * Which projects track this repo — empty, one, or several (§4.3, LAI-116).
   *
   * **Not serialised.** §9.1 answers `202` with no body, and widening that is a
   * contract change that belongs in its own task rather than riding along in
   * this one. It is here so the write path can say what it resolved — today,
   * so the route can warn about a repo nobody tracks.
   */
  project_ids: string[];
  attribution: RepoAttribution;
}

export function recordHeartbeat(
  db: Db,
  actor: ResolvedActor,
  input: HeartbeatInput,
): HeartbeatView {
  assertCan(actor, 'heartbeat.send_own');

  const repo = input.repo.trim();
  const branch = input.branch.trim();

  if (repo === '' || branch === '') {
    throw new ApiError('unprocessable', 'A heartbeat needs a repo and a branch', {
      repo: input.repo,
      branch: input.branch,
    });
  }

  // Bounded here as well as in the route: an MCP tool or the plugin could reach
  // this function without passing through zod, and a bound only one entry point
  // applies is not a bound (LAI-404).
  if (repo.length > REPO_MAX_LENGTH || branch.length > BRANCH_MAX_LENGTH) {
    throw new ApiError('unprocessable', 'That repo or branch name is too long', {
      repo_length: repo.length,
      repo_limit: REPO_MAX_LENGTH,
      branch_length: branch.length,
      branch_limit: BRANCH_MAX_LENGTH,
    });
  }

  const row: typeof heartbeats.$inferInsert = {
    id: newId(),
    userId: actor.userId,
    tokenId: actor.token?.id ?? null,
    repo,
    branch,
    // §9.2, M5. Null rather than a guess.
    matchedTaskId: null,
    createdAt: input.now ?? Date.now(),
  };

  db.insert(heartbeats).values(row).run();

  // After the insert: a repo nobody tracks is **not** an error (§9.2 degrades,
  // it never errors), so the row is written either way and the resolution is
  // something the caller may report, never something that refuses the beat.
  const resolved = resolveRepoProjects(db, repo, branch);

  return {
    id: row.id,
    user_id: row.userId,
    token_id: row.tokenId ?? null,
    repo: row.repo,
    branch: row.branch,
    matched_task_id: null,
    created_at: row.createdAt,
    project_ids: resolved.projectIds,
    attribution: resolved.attribution,
  };
}
