import { and, eq, inArray, isNull } from 'drizzle-orm';
import { loadActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { commentMentions, comments, users } from '../db/schema.ts';
import { assertCan, can } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * `@mentions` in a comment body — parsed and resolved **server-side** (SPEC
 * §4.19, LAI-094).
 *
 * ## Why the server parses
 *
 * Two clients that parse the same body can disagree about who was mentioned, and
 * there is then no single place to fix it. The rows this module writes are the
 * answer; a client renders them rather than re-deriving them.
 *
 * ## Why an id is stored, never the typed text
 *
 * A rename would silently break every past mention. `comment_mentions.user_id`
 * is a foreign key, so a mention survives a rename and disappears with the user.
 *
 * ## What `@` matches, and why it is the email local part
 *
 * There is no handle column on `users` (§4.1) and adding one is a schema change,
 * a uniqueness rule and a backfill — its own task if it is ever wanted. The email
 * local part is unique per instance because §4.2 is single-org, and it is stable
 * where `name` is not.
 *
 * **An ambiguous mention resolves to nobody.** If two users share a local part,
 * `@ada` links to neither. Picking one silently fails twice over: the writer
 * believes they notified somebody, *and the wrong person may be notified
 * instead.* The text stands as plain text and no row exists.
 *
 * Ambiguity is judged across **every** user row, deactivated ones included. A
 * deactivated `ada@old.example` still makes `@ada` an unclear thing to have
 * typed, and quietly resolving to the other Ada is the silent pick this rule
 * exists to prevent.
 *
 * ## A mention is not an invitation
 *
 * A row is written only if the mentioned person passes `project.read` on the
 * task's project. The picker draws on `GET /users`, which is org-wide, while a
 * task is project-scoped — that mismatch is exactly where this would leak. A
 * mention never widens who can see anything.
 *
 * ## Known limitation
 *
 * The parse does not understand Markdown, so an `@` inside a code span or fence
 * is treated like any other. In practice it resolves to nobody unless a user's
 * email local part collides with the code (`@types`, say), and the cost of a
 * false positive is one extra watcher rather than a disclosure — the
 * `project.read` check above still runs. A Markdown-aware parse needs a renderer
 * the server does not have.
 */

/**
 * Every `@handle` in a body, lowercased, in order, without duplicates.
 *
 * The character before `@` must not be one that can appear in an email address,
 * so `ada@example.com` written in a comment is an address rather than a mention
 * of `example.com`. The handle must start and end alphanumeric, so trailing
 * punctuation — `@ada.` at the end of a sentence — is not part of it.
 */
export function parseMentionHandles(bodyMd: string): string[] {
  const pattern = /(?<![A-Za-z0-9_@.+%-])@([A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?)/g;

  const seen = new Set<string>();
  for (const match of bodyMd.matchAll(pattern)) seen.add(match[1]!.toLowerCase());

  return [...seen];
}

/** The part of an email before the `@`, lowercased. */
function localPart(email: string): string {
  const at = email.indexOf('@');
  return (at === -1 ? email : email.slice(0, at)).toLowerCase();
}

/**
 * Can this person be mentioned on this project — on **their own** authority?
 *
 * The single definition of "mentionable", used by `resolveMentions` at write
 * time and by `mentionableUsers` for the picker (LAI-143). **Two implementations
 * of one predicate is one implementation and one bug**, and the bug is silent: a
 * picker built on a wider set offers a name, the mention resolves to nobody, and
 * nothing happens at all — no error, no notification, no trace. That reads as
 * the mention feature being broken.
 *
 * Their authority, not the author's, and no token context — the question is
 * whether *they* may see this project. `can()` also refuses a deactivated user
 * (§4.1), so that rule is not restated here.
 */
export function canBeMentioned(db: Db, userId: string, projectId: string): boolean {
  const person = loadActor(db, userId);
  if (person === null) return false;

  const membership = person.memberships.find((m) => m.projectId === projectId);

  return can({ ...person, projectRole: membership?.role ?? null }, 'project.read', { projectId });
}

/**
 * Everyone who may be mentioned on this project, for a picker.
 *
 * **Not `GET /projects/:slug/members`**, which is a subset: org Owners and
 * Admins hold implicit `lead` everywhere and have **no membership row** (D-006),
 * so they are mentionable and absent from it. Sorted by name so a picker does
 * not have to.
 */
export function mentionableUsers(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): { id: string; name: string }[] {
  const project = requireProjectBySlug(db, slug);
  // The *caller* must be able to read the project to ask who is mentionable in
  // it; `canBeMentioned` then answers for each candidate on their own authority.
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const projectId = project.id;

  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .all()
    .filter((row) => canBeMentioned(db, row.id, projectId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Handles → user ids, dropping any handle that is ambiguous or that names
 * somebody who cannot read the project.
 *
 * Exported because it is the whole of the rule, and a test that goes through
 * `recordMentions` alone cannot tell "resolved to nobody" from "wrote no row".
 */
export function resolveMentions(db: Db, projectId: string, handles: readonly string[]): string[] {
  if (handles.length === 0) return [];

  const wanted = new Set(handles);
  const byHandle = new Map<string, string[]>();

  // Every row, not a filtered query: ambiguity is a property of the whole table,
  // and a `WHERE` that skipped deactivated users would make `@ada` look
  // unambiguous the moment one of the two Adas was deactivated.
  for (const row of db.select({ id: users.id, email: users.email }).from(users).all()) {
    const handle = localPart(row.email);
    if (!wanted.has(handle)) continue;

    byHandle.set(handle, [...(byHandle.get(handle) ?? []), row.id]);
  }

  const resolved: string[] = [];

  for (const handle of handles) {
    const candidates = byHandle.get(handle) ?? [];
    if (candidates.length !== 1) continue;

    const userId = candidates[0]!;
    if (!canBeMentioned(db, userId, projectId)) continue;

    resolved.push(userId);
  }

  return resolved;
}

/**
 * Replace a comment's mention rows with what its body says **now**.
 *
 * Called on create and on edit. The rows are the record of what was written, so
 * an edit re-derives them: a name no longer in the body is no longer a mention.
 * Deleting the comment row cascades (§4.19).
 */
export function syncMentions(
  db: Db,
  commentId: string,
  projectId: string,
  bodyMd: string,
  now: number,
): string[] {
  const resolved = resolveMentions(db, projectId, parseMentionHandles(bodyMd));

  db.delete(commentMentions).where(eq(commentMentions.commentId, commentId)).run();

  for (const userId of resolved) {
    db.insert(commentMentions).values({ id: newId(), commentId, userId, createdAt: now }).run();
  }

  return resolved;
}

/**
 * Who was mentioned on these tasks, from comments that are still live.
 *
 * A soft-deleted comment keeps its mention rows — they record what was written —
 * but it must not keep anybody subscribed, so this join drops them. That matches
 * `commentCounts`, which counts only live comments for the same reason.
 */
export function mentionedUserIds(db: Db, taskIds: readonly string[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>(taskIds.map((id) => [id, new Set<string>()]));
  if (taskIds.length === 0) return result;

  const rows = db
    .select({ taskId: comments.taskId, userId: commentMentions.userId })
    .from(commentMentions)
    .innerJoin(comments, eq(comments.id, commentMentions.commentId))
    .where(and(inArray(comments.taskId, [...taskIds]), isNull(comments.deletedAt)))
    .all();

  for (const row of rows) result.get(row.taskId)?.add(row.userId);

  return result;
}
