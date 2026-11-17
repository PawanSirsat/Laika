import type { Member } from '../../api/tasks.ts';
import type { ProjectStatus } from '../../api/statuses.ts';
import { defaultStatusId, type CreateTaskDraft } from './create-task-form.ts';

/**
 * Which space the Create task dialog creates in (LAI-1227) — pure, so the
 * unit test pins every rule without a browser: which spaces are offered, which
 * one is chosen first, and what a change of space keeps and clears.
 *
 * The dialog is the app's one way to create a task. The header's *+ Create*
 * opens it on any screen, so the space is a field of the form, not a fact of
 * the page it was opened on.
 */

/** A space as the Space field offers it: its colour, its name and its key. */
export interface CreatableSpace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly key: string;
  readonly color?: string | null | undefined;
}

/**
 * The spaces the reader may create a task in: **the server's grant,
 * `task.create`, per space** (LAI-178), asked through `may` — never a role
 * read here. Archived spaces are not in the list the shell fetches.
 */
export function creatableSpaces<S extends CreatableSpace>(
  spaces: readonly S[],
  may: (spaceId: string) => boolean,
): readonly S[] {
  return spaces.filter((space) => may(space.id));
}

export interface SpaceChoice {
  /** Asked for by whoever opened the dialog: a lane's own +, a space's `c`, `?new=task&project=`. */
  readonly preset?: string | undefined;
  /** The space on screen, when the dialog was opened from one. */
  readonly current?: string | undefined;
  /** The space the reader last created in, from this browser. */
  readonly last?: string | undefined;
  /** Every space the reader may create in, in the shell's order. */
  readonly allowed: readonly { readonly slug: string }[];
}

/**
 * The first space the field shows: what the opener asked for, else the space
 * on screen, else the last one created in — each **only if the reader may
 * still create there** — else the first allowed. `undefined` when there is
 * none: the dialog then says so rather than guessing.
 */
export function defaultCreateSpace({
  preset,
  current,
  last,
  allowed,
}: SpaceChoice): string | undefined {
  const ok = (slug: string | undefined): slug is string =>
    slug !== undefined && allowed.some((space) => space.slug === slug);
  for (const slug of [preset, current, last]) if (ok(slug)) return slug;
  return allowed[0]?.slug;
}

/** Per browser, like the rail's pins: a slug, never a name. */
export const LAST_CREATE_SPACE_KEY = 'laika.create.space';

/** The last space created in, or nothing — storage that refuses is no memory, never an error. */
export function readLastCreateSpace(
  storage: Pick<Storage, 'getItem'> | undefined,
): string | undefined {
  try {
    const raw = storage?.getItem(LAST_CREATE_SPACE_KEY) ?? null;
    return raw !== null && /^[a-z0-9][a-z0-9-]*$/i.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastCreateSpace(
  storage: Pick<Storage, 'setItem'> | undefined,
  slug: string,
): void {
  try {
    storage?.setItem(LAST_CREATE_SPACE_KEY, slug);
  } catch {
    // A browser that will not store it creates in the space on screen next time.
  }
}

/**
 * The draft after the Space field changes. What describes **the task** stays
 * — title, the editors' text, priority, dates, effort, labels, what it
 * delivers, the outside id. What names **something in the old space** goes:
 * its status (the new space's default takes over once its statuses load), its
 * sprint, its agent pick (agents are allowed per space), its parent and its
 * blockers (tasks of the old space). The assignee waits for the new space's
 * members: {@link keepValidInSpace} drops it only if they do not include them.
 */
export function draftForSpace(draft: CreateTaskDraft): CreateTaskDraft {
  return {
    ...draft,
    statusId: undefined,
    sprintId: null,
    agentId: null,
    parentId: null,
    blockedBy: [],
  };
}

export interface SpaceFacts {
  /** The space's statuses; empty while they load. */
  readonly statuses: readonly ProjectStatus[];
  /** The space's members; `undefined` while they load. */
  readonly members: readonly Member[] | undefined;
}

/**
 * The draft with every value the space cannot take replaced: a status not
 * among its statuses becomes its default, an assignee not among its members
 * becomes nobody. Unchanged (the same object) when nothing is invalid, so an
 * effect calling it settles.
 */
export function keepValidInSpace(draft: CreateTaskDraft, facts: SpaceFacts): CreateTaskDraft {
  let next = draft;
  if (facts.statuses.length > 0) {
    const known =
      draft.statusId !== undefined && facts.statuses.some((s) => s.id === draft.statusId);
    if (!known) {
      const fallback = defaultStatusId(facts.statuses);
      if (fallback !== draft.statusId) next = { ...next, statusId: fallback };
    }
  }
  if (
    facts.members !== undefined &&
    draft.assigneeId !== null &&
    !facts.members.some((m) => m.user_id === draft.assigneeId)
  ) {
    next = { ...next, assigneeId: null };
  }
  return next;
}
