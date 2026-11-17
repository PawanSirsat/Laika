import { inArray } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { projectMemberships, projects } from '../db/schema.ts';
import { can } from '../policy/can.ts';
import { capabilityOf, holdsCapability } from '../policy/grants.ts';

/**
 * Whose availability a reader sees (D-137, SPEC §3.1 *See availability of
 * people in your spaces*) — one rule, read by `GET /people/availability` and
 * by every read that carries a person's leave (D-149 item 5, LAI-1183), so
 * the two cannot drift.
 *
 *  - **`people`**, *See everyone's analytics*: everyone.
 *  - **`lead`**, a reader who may manage the members of a space — a space
 *    admin, or an org role that leads every space implicitly: the people in
 *    the spaces they lead.
 *  - **`member`**, anyone else: the people who share a space with them.
 *
 * And always the reader themselves: it is their own.
 *
 * **No `can()` gate here**: it answers *who*, for callers that have each asked
 * their own question first.
 */

export type AvailabilityReader = 'people' | 'lead' | 'member';

export interface AvailabilityAudience {
  reader: AvailabilityReader;
  /** The spaces the reader may manage the members of (`project.members.manage`). */
  led: ReadonlySet<string>;
  /** The spaces whose people the reader sees; `null` is everyone. */
  scope: ReadonlySet<string> | null;
}

/**
 * Whether the reader holds *See everyone's analytics* — the grant
 * `people.analytics.read` is carried by — **asked of the reader's own role**,
 * not of some other person. `can()` answers that action only about a named
 * target, and naming an arbitrary one made an owner whose organisation held
 * nobody else listable read as a member (LAI-1130 review note 3).
 */
export function seesEveryonesAnalytics(actor: ResolvedActor): boolean {
  const capability = capabilityOf('people.analytics.read');
  return capability !== null && holdsCapability(actor.orgRole, actor.orgGrants, capability);
}

/** Which of the three readers `actor` is, and the spaces that decide it. One read of the spaces. */
export function availabilityAudienceOf(db: Db, actor: ResolvedActor): AvailabilityAudience {
  const led = new Set(
    db
      .select({ id: projects.id })
      .from(projects)
      .all()
      .map((p) => p.id)
      .filter((id) => can(withProject(actor, id), 'project.members.manage', { projectId: id })),
  );
  if (seesEveryonesAnalytics(actor)) return { reader: 'people', led, scope: null };
  if (led.size > 0) return { reader: 'lead', led, scope: led };
  return {
    reader: 'member',
    led,
    scope: new Set(actor.memberships.map((m) => m.projectId)),
  };
}

/**
 * Of `userIds`, the people whose availability `actor` sees. The reader is
 * always among them; a reader who sees everyone costs no read at all, and
 * anyone else one read of the spaces and one of the people's memberships.
 */
export function availabilityVisibleAmong(
  db: Db,
  actor: ResolvedActor,
  userIds: readonly string[],
): Set<string> {
  const seen = new Set(userIds.filter((id) => id === actor.userId));
  const others = [...new Set(userIds.filter((id) => id !== actor.userId))];
  if (others.length === 0) return seen;
  if (seesEveryonesAnalytics(actor)) {
    for (const id of others) seen.add(id);
    return seen;
  }
  const { scope } = availabilityAudienceOf(db, actor);
  if (scope === null) {
    for (const id of others) seen.add(id);
    return seen;
  }
  if (scope.size === 0) return seen;
  for (const m of db
    .select({ userId: projectMemberships.userId, projectId: projectMemberships.projectId })
    .from(projectMemberships)
    .where(inArray(projectMemberships.userId, others))
    .all()) {
    if (scope.has(m.projectId)) seen.add(m.userId);
  }
  return seen;
}
