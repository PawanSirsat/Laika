import type { Project } from '../../../api/projects.ts';
import type { SpaceSettingsPatch } from '../../../api/space-settings.ts';
import type { SpaceColor } from '../../../theme/space-color.ts';

/**
 * What Space settings decides, without a renderer (D-103, LAI-977): the
 * General form's draft and what it sends, the next key, and how the header
 * says who is reading.
 */

/** The General tab's fields, as typed. */
export interface GeneralDraft {
  readonly name: string;
  readonly prefix: string;
  readonly description: string;
  readonly color: SpaceColor | null;
  readonly repo: string;
}

export function draftOf(project: Project): GeneralDraft {
  return {
    name: project.name,
    prefix: project.prefix,
    description: project.description ?? '',
    color: project.color,
    repo: project.repo ?? '',
  };
}

/**
 * Only what changed, in the shape `PATCH` takes — so a save of a new name
 * does not also re-send a prefix and trip a check it has nothing to do with.
 * An emptied repository is `null`, which clears it; the server refuses an
 * empty string.
 */
export function generalPatch(project: Project, draft: GeneralDraft): SpaceSettingsPatch {
  const was = draftOf(project);
  const patch: { -readonly [K in keyof SpaceSettingsPatch]: SpaceSettingsPatch[K] } = {};
  if (draft.name.trim() !== was.name) patch.name = draft.name.trim();
  if (draft.prefix.trim().toUpperCase() !== was.prefix) {
    patch.prefix = draft.prefix.trim().toUpperCase();
  }
  if (draft.description.trim() !== was.description.trim()) {
    patch.description = draft.description.trim();
  }
  if (draft.color !== was.color) patch.color = draft.color;
  const repo = draft.repo.trim();
  if (repo !== was.repo) patch.repo = repo === '' ? null : repo;
  return patch;
}

export function isDirty(project: Project, draft: GeneralDraft): boolean {
  return Object.keys(generalPatch(project, draft)).length > 0;
}

/**
 * The key the next task will take: the prefix being typed and the next
 * number. Tasks are never deleted — a task is cancelled, not removed — and
 * numbers have no gaps (`numbering.ts`), so the next number is every task
 * counted plus one. `undefined` until the counts are known: a guess here
 * would be a number on screen that no response said.
 */
export function nextTaskKey(
  prefix: string,
  counts: Readonly<Record<string, number>> | undefined,
): string | undefined {
  if (counts === undefined) return undefined;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const key = prefix.trim().toUpperCase();
  return `${key === '' ? '…' : key}-${String(total + 1)}`;
}

/**
 * The header's second line: who is reading, and what they may do here.
 * `mayEdit` is the server's `project.settings.edit` answer and the only thing
 * that decides; the rest picks the words for *why*. An owner or admin who
 * leads every space through *Open every project* (`implicitLead`) manages it
 * as their organisation role; anyone else who may edit is this space's admin.
 */
export function readerLine(input: {
  readonly mayEdit: boolean;
  readonly orgRole: string;
  readonly implicitLead: boolean;
}): string {
  if (!input.mayEdit) return 'Space settings · read only — space admins change these';
  if (input.implicitLead && (input.orgRole === 'owner' || input.orgRole === 'admin')) {
    const role = input.orgRole === 'owner' ? 'Owner' : 'Admin';
    return `Space settings · you manage this space as organisation ${role}`;
  }
  return 'Space settings · you manage this space as space admin';
}

/*
 * ---------------------------------------------------------------------------
 * LAI-1211: what the page says *before* a save, so a value the server will
 * refuse is caught as it is typed and a key change shows what it does.
 *
 * **The server is the authority** and validates independently; these mirror
 * its rules so the common mistakes cost no round trip. The rules are quoted
 * from the server, not paraphrased: `Prefix` and `UpdateBody.name` in
 * `server/src/http/routes/projects.ts`, `assertRepoShape` in
 * `server/src/services/projects.ts`. A refusal the client did not predict
 * still lands under its field in the server's words (`settingsFieldErrors`).
 * ---------------------------------------------------------------------------
 */

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const REPO_MAX = 200;
const PREFIX_SHAPE = /^[A-Za-z][A-Za-z0-9]{1,7}$/;
const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The field the server would refuse, and in what words; empty when none. */
export function generalIssues(draft: GeneralDraft): Readonly<Record<string, string>> {
  const issues: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === '') issues.name = 'A space needs a name.';
  else if (name.length > NAME_MAX) {
    issues.name = `A name is at most ${String(NAME_MAX)} characters — this is ${String(name.length)}.`;
  }
  const prefix = draft.prefix.trim();
  if (prefix === '') issues.prefix = 'A space needs a key.';
  else if (!PREFIX_SHAPE.test(prefix)) {
    issues.prefix = 'A key is 2–8 letters and digits, starting with a letter.';
  }
  if (draft.description.trim().length > DESCRIPTION_MAX) {
    issues.description = `A description is at most ${String(DESCRIPTION_MAX)} characters.`;
  }
  const repo = repoIssue(draft.repo);
  if (repo !== undefined) issues.repo = repo;
  return issues;
}

function repoIssue(value: string): string | undefined {
  const repo = value.trim();
  if (repo === '') return undefined; // Empty clears it.
  if (repo.length > REPO_MAX) {
    return `A repository is at most ${String(REPO_MAX)} characters.`;
  }
  if (repoFromPaste(repo) !== undefined) {
    return 'Use owner/name, not a link — Laika matches it against what the plugin reports.';
  }
  if (repo.endsWith('.git')) return 'Leave off “.git” — the plugin reports owner/name without it.';
  if (!REPO_SHAPE.test(repo)) return 'Write it as owner/name — for example, kvelld/mobile-app.';
  return undefined;
}

/**
 * The `owner/name` inside a pasted repository link or clone address —
 * `https://github.com/kvelld/mobile-app`, `git@gitlab.com:kvelld/mobile-app.git`
 * — so the page can offer it in one click. `undefined` when the value is not a
 * link, or the link does not end in exactly two path segments: a guess at which
 * two is worse than asking.
 */
export function repoFromPaste(value: string): string | undefined {
  const raw = value.trim();
  let path: string | undefined;
  const scp = /^[\w.-]+@[\w.-]+:(.+)$/.exec(raw);
  if (scp !== null) path = scp[1];
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      return undefined;
    }
  }
  if (path === undefined) return undefined;
  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter((s) => s !== '');
  if (segments.length !== 2) return undefined;
  const candidate = segments.join('/');
  return REPO_SHAPE.test(candidate) ? candidate : undefined;
}

/**
 * What a key change does, in words, before it is saved: the next task's key,
 * that every existing task keeps its old key, and that the old keys keep
 * opening their tasks (the server keeps `former_prefixes` resolving — D-103
 * item 3). `undefined` when the key is unchanged or not yet valid.
 */
export function keyChange(
  project: Pick<Project, 'prefix'>,
  draftPrefix: string,
  counts: Readonly<Record<string, number>> | undefined,
): { readonly from: string; readonly to: string; readonly next: string | undefined; readonly existing: number | undefined } | undefined {
  const to = draftPrefix.trim().toUpperCase();
  if (to === project.prefix || !PREFIX_SHAPE.test(to)) return undefined;
  const existing =
    counts === undefined ? undefined : Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { from: project.prefix, to, next: nextTaskKey(to, counts), existing };
}

/** A colour's name as people say it: *Teal*, not `teal`. */
export function colorLabel(color: SpaceColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** People in the space whose name or email holds every word typed, in list order. */
export function filterMembers<T extends { readonly name: string; readonly email: string }>(
  members: readonly T[],
  query: string,
): readonly T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return members;
  return members.filter((m) => {
    const hay = `${m.name} ${m.email}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * *3 people · 1 space admin · 1 member · 1 viewer* — the list's own counts,
 * roles with nobody in them left out.
 */
export function roleSummary(members: readonly { readonly role: string }[]): string {
  const count = (role: string) => members.filter((m) => m.role === role).length;
  const people = members.length;
  const parts = [`${String(people)} ${people === 1 ? 'person' : 'people'}`];
  for (const [role, one, many] of [
    ['lead', 'space admin', 'space admins'],
    ['member', 'member', 'members'],
    ['viewer', 'viewer', 'viewers'],
  ] as const) {
    const n = count(role);
    if (n > 0) parts.push(`${String(n)} ${n === 1 ? one : many}`);
  }
  return parts.join(' · ');
}

/**
 * Who can open the space right now, for the line under Visibility. Private
 * counts the members the list returned; org roles granted *Open every
 * project* reach it too, and the sentence says so rather than pretending the
 * count is everyone.
 */
export function visibilityEffect(input: {
  readonly visibility: Project['visibility'];
  readonly spaceName: string;
  readonly orgName: string;
  readonly memberCount: number | undefined;
}): string {
  if (input.visibility === 'public') {
    return `Right now: everyone in ${input.orgName} can find ${input.spaceName}, read its board and join it.`;
  }
  const who =
    input.memberCount === undefined
      ? 'its members'
      : `its ${String(input.memberCount)} ${input.memberCount === 1 ? 'member' : 'members'}`;
  return `Right now: only ${who} — and organisation roles that open every space — can see ${input.spaceName}. Nobody else can find it.`;
}

/**
 * The hand-off policy in one plain paragraph — what happens to a task an agent
 * offers on — in the words `HandoffPolicyForm` uses for each control, so the
 * summary and the switches never disagree.
 */
export function handoffSummary(policy: {
  readonly allow_other_owners: boolean;
  readonly cross_owner_requires_approval: boolean;
  readonly max_handoffs: number;
  readonly offer_ttl_minutes: number;
}): string {
  if (policy.max_handoffs === 0) {
    return 'In practice: agents cannot hand tasks on here. When an agent stops, a person reassigns its task.';
  }
  const who = !policy.allow_other_owners
    ? 'it can pass only to another agent the same person registered'
    : policy.cross_owner_requires_approval
      ? 'it can be offered to any member’s agent with access, and a person approves before it moves to another owner’s agent'
      : 'it can be offered to any member’s agent with access, with no approval';
  const m = policy.offer_ttl_minutes;
  const ttl =
    m % 60 === 0 ? `${String(m / 60)} ${m === 60 ? 'hour' : 'hours'}` : `${String(m)} minutes`;
  const times = `${String(policy.max_handoffs)} ${policy.max_handoffs === 1 ? 'hand-off' : 'hand-offs'}`;
  return `In practice: when an agent offers a task on, ${who}. An offer nobody takes lapses after ${ttl} and the sender carries on; after ${times} a person reassigns the task.`;
}
