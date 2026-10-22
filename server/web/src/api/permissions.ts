import { request } from './client.ts';
import { sharedCache } from './query-cache.ts';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Who may do what (SPEC §6.4, LAI-885; the screen is LAI-950).
 *
 * **Every cell is `can()`'s answer**, computed on the server about a synthetic
 * actor holding each role — so this file declares the shape and nothing else.
 * No role, action or label is listed here: a client copy of §3 is exactly the
 * second source of truth the endpoint exists to retire, and the screen renders
 * whatever roles and actions the response names, including ones this client
 * has never heard of.
 *
 * The shapes mirror `server/src/services/permissions.ts`; the field lists are
 * compared against it in `test/api/permissions.test.ts`.
 */

/** `yes`, `no` or `conditional` today. Typed open, so a fourth is rendered rather than dropped. */
export type Holding = string;

/** One action and which built-in roles hold it. */
export interface PermissionRow {
  readonly action: string;
  readonly scope: 'org' | 'project';
  /** The SPEC §3.1 / §3.2 row, or `null` for an action no row grants yet. */
  readonly label: string | null;
  /** No token may perform it, whatever its scope. */
  readonly session_only: boolean;
  /** A `read_only` token may perform it. */
  readonly read_only: boolean;
  /** Set when some role is `conditional`; says what the condition is. */
  readonly condition: string | null;
  /** Org roles for an `org` row, project roles for a `project` row. */
  readonly roles: Readonly<Record<string, Holding>>;
}

/** The caller's actions in one project they are a member of. */
export interface ProjectGrants {
  readonly project_id: string;
  /** The effective role — an org viewer's membership is capped at `viewer`. */
  readonly role: string | null;
  readonly actions: readonly string[];
}

/** The wire shape of `GET /api/v1/permissions`. */
export interface Permissions {
  readonly org_roles: readonly string[];
  readonly project_roles: readonly string[];
  readonly permissions: readonly PermissionRow[];
  readonly me: {
    readonly org_role: string;
    readonly credential: 'session' | 'token';
    /** `'all'`, or a token's project whitelist (§4.9). */
    readonly project_scope: 'all' | readonly string[];
    /** `lead` for an Owner or Admin on every project in scope, else `null`. */
    readonly implicit_project_role: string | null;
    /** Org actions the caller may take on this credential. */
    readonly actions: readonly string[];
    /** Project actions per membership this credential may read. */
    readonly projects: readonly ProjectGrants[];
  };
}

export function getPermissions(signal?: AbortSignal): Promise<Permissions> {
  return request<Permissions>('/permissions', signal === undefined ? {} : { signal });
}

/** Where the browser's copy of `GET /permissions` stands for the signed-in user. */
export type PermissionsStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface Snapshot {
  /** Whose answer this is — the store's user (`setStoreUser`), `undefined` signed out. */
  readonly user: string | undefined;
  readonly status: PermissionsStatus;
  readonly permissions: Permissions | undefined;
}

/**
 * The browser's one source of effective authority, a module store read through
 * `useSyncExternalStore`: every mounted gate subscribes, so an answer published
 * after it mounted — a first load, a refresh after the owner saves grants —
 * re-renders it, however late it mounted.
 *
 * **Keyed by user.** `setPermissionsUser` runs inside `setStoreUser`, which the
 * session calls before it publishes the user and so before any screen reads
 * this; a different user, or none, drops the answer and every request still in
 * flight for the last one. Nothing the previous person held survives a switch
 * in the same tab.
 */
let snapshot: Snapshot = { user: undefined, status: 'idle', permissions: undefined };
/** Bumped on every change of user: an answer for an older generation is never stored. */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/** Whose permissions the store holds. A different user, or none, starts again. */
export function setPermissionsUser(userId: string | undefined): void {
  if (userId === snapshot.user) return;
  generation += 1;
  publish({ user: userId, status: 'idle', permissions: undefined });
}

/**
 * Ask the server again and publish its answer to every mounted gate. Never
 * rejects: a failure is a state (`failed`), which the gates deny on and the
 * shell offers a retry for. A refresh that fails keeps the last good answer —
 * it was the server's, and denying everything over a blip helps nobody.
 */
function load(fresh: boolean): Promise<void> {
  const asked = generation;
  if (fresh) sharedCache.invalidate((key) => key === '/permissions');
  if (snapshot.permissions === undefined) publish({ ...snapshot, status: 'loading' });
  return getPermissions().then(
    (permissions) => {
      if (asked === generation) publish({ ...snapshot, status: 'ready', permissions });
    },
    () => {
      if (asked !== generation) return;
      if (snapshot.permissions === undefined) publish({ ...snapshot, status: 'failed' });
    },
  );
}

/** For tests: forget everything, as a fresh page load would. */
export function resetPermissions(): void {
  generation += 1;
  publish({ user: undefined, status: 'idle', permissions: undefined });
}

export interface EffectivePermissions {
  /** The server's answer, or `undefined` until it has one (or it failed). */
  readonly permissions: Permissions | undefined;
  /** The question has an answer: read, or failed. */
  readonly settled: boolean;
  /** `GET /permissions` failed and there is no earlier answer. Gates deny. */
  readonly failed: boolean;
  /** Ask again — after the owner saves grants, or to retry a failure. */
  readonly refresh: () => void;
}

export function usePermissions(enabled = true): EffectivePermissions {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (enabled && current.status === 'idle') void load(false);
  }, [enabled, current]);
  const refresh = useCallback(() => {
    void load(true);
  }, []);
  return {
    permissions: enabled ? current.permissions : undefined,
    settled: !enabled || current.status === 'ready' || current.status === 'failed',
    failed: enabled && current.status === 'failed',
    refresh,
  };
}

/**
 * Re-read for a screen that shows the answer itself (Roles & permissions) and
 * so needs the failure, not a state: rejects as the request does. Its answer is
 * published like any other — every mounted gate re-renders on it, which is how
 * a save of the owner's grants reaches the controls on screen.
 */
export async function refreshPermissions(signal?: AbortSignal): Promise<Permissions> {
  const asked = generation;
  sharedCache.invalidate((key) => key === '/permissions');
  const permissions = await getPermissions(signal);
  if (asked === generation) publish({ ...snapshot, status: 'ready', permissions });
  return permissions;
}

/**
 * The gates. **Each one denies until the server has said yes** — while
 * `/permissions` is in flight, and when it failed. A control briefly absent is
 * harmless; one shown to somebody the owner withdrew it from is the bug
 * (LAI-970). There is no role fallback: a role says what an organisation whose
 * owner changed nothing allows, and this one may have.
 */
export interface Gates {
  readonly org: (action: string) => boolean;
  readonly project: (projectId: string, action: string) => boolean;
  readonly leads: (projectId: string) => boolean;
  readonly settled: boolean;
  readonly failed: boolean;
  readonly refresh: () => void;
}

export function useGates(enabled = true): Gates {
  const { permissions, settled, failed, refresh } = usePermissions(enabled);
  return useMemo(
    () => ({
      org: (action) => holdsOrgAction(permissions, action),
      project: (projectId, action) => holdsProjectAction(permissions, projectId, action),
      leads: (projectId) => implicitlyLeads(permissions, projectId),
      settled,
      failed,
      refresh,
    }),
    [permissions, settled, failed, refresh],
  );
}

export function holdsOrgAction(view: Permissions | undefined, action: string): boolean {
  return view?.me.actions.includes(action) === true;
}

function inScope(view: Permissions, projectId: string): boolean {
  return view.me.project_scope === 'all' || view.me.project_scope.includes(projectId);
}

/**
 * Whether the caller may take a §3.2 action in one project, as the server
 * reports it.
 *
 * A project they are a member of is answered by `me.projects` — the server's
 * own `can()` for that membership, with the implicit role already folded in.
 * One they are not a member of is answered by `implicit_project_role` alone,
 * mirroring `effectiveProjectRole()` in `server/src/policy/can.ts`: an implicit
 * `lead` holds every §3.2 action a lead holds (all of them), an implicit
 * `viewer` (an org viewer granted *Open every project*) holds only what a
 * project viewer holds — which is no write, and never `project.settings.edit`.
 */
export function holdsProjectAction(
  view: Permissions | undefined,
  projectId: string,
  action: string,
): boolean {
  if (view === undefined || !inScope(view, projectId)) return false;
  const explicit = view.me.projects.find((project) => project.project_id === projectId);
  if (explicit !== undefined) return explicit.actions.includes(action);
  return view.me.implicit_project_role === 'lead';
}

/** The caller leads this project without a membership (`implicit_project_role`, in scope). */
export function implicitlyLeads(view: Permissions | undefined, projectId: string): boolean {
  if (view === undefined) return false;
  return view.me.implicit_project_role === 'lead' && inScope(view, projectId);
}

/**
 * Who can do what — what the owner has granted each org role (SPEC §6.4,
 * D-102 rule 6, LAI-958; the grid is LAI-960).
 *
 * Mirrors `server/src/services/org-permissions.ts`; the three shapes are
 * paired in `test/api/view-type-drift.test.ts`. Roles and capabilities are
 * typed open, as above: the grid draws whatever the response names.
 */

/** One grantable capability, as the grid lists it. */
export interface Capability {
  readonly id: string;
  readonly label: string;
  /** One line saying what it lets a role do, in the server's words (LAI-985). */
  readonly description: string;
  /** The §3.1 actions it carries. Empty for one that is a project role. */
  readonly actions: readonly string[];
}

/** An action no grant reaches: the owner's alone. */
export interface OwnerLocked {
  readonly action: string;
  /** Its §3.1 row, or `null` for an action no row names yet. */
  readonly label: string | null;
}

/** Role → capability → on. */
export type Grants = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

/** The wire shape of `GET` and `PUT /api/v1/org/permissions`. */
export interface OrgPermissions {
  /** The roles a grant can be given to. The owner is not one: they hold everything. */
  readonly roles: readonly string[];
  readonly capabilities: readonly Capability[];
  /** Every role and every capability, always — `PUT` takes it back whole. */
  readonly grants: Grants;
  readonly owner_locked: readonly OwnerLocked[];
  /** The last change, or `null` while every cell is still its default. */
  readonly updated_at: number | null;
  readonly updated_by: string | null;
}

export function getOrgPermissions(signal?: AbortSignal): Promise<OrgPermissions> {
  return request<OrgPermissions>('/org/permissions', signal === undefined ? {} : { signal });
}

/** Replace the whole matrix (the owner, signed in). Answers the matrix as stored. */
export function setOrgPermissions(grants: Grants): Promise<OrgPermissions> {
  return request<OrgPermissions>('/org/permissions', { method: 'PUT', body: { grants } });
}
