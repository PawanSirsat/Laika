/**
 * A space called Mobile, for Space settings' UX tests (LAI-1211): the owner's
 * own example, `/spaces/mobile/settings`, with its members, the people in the
 * organisation and its hand-off policy. `worstStub` is the same space under
 * `break-ui`'s worst case — a long name, a long repository, 200 members.
 */

import type { ApiStub } from './harness.ts';

export const SLUG = 'mobile';

export const PROJECT = {
  id: 'p1',
  slug: SLUG,
  name: 'Mobile',
  prefix: 'MOB',
  description: 'The iOS and Android apps.',
  repo: 'kvelld/mobile-app',
  visibility: 'private',
  color: 'teal',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [] as string[],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null as number | null,
  created_at: 1,
  updated_at: 1,
};

/** 42 tasks counted, so the next key is MOB-43. */
const COUNTS = { backlog: 10, todo: 12, in_progress: 4, review: 2, done: 14, cancelled: 0 };

const summary = (project: Record<string, unknown>) => ({
  ...project,
  task_counts: COUNTS,
  blocked_count: 0,
  member_count: 3,
  members: [],
  last_activity_at: 2,
});

export const member = (user_id: string, name: string, role: string, email?: string) => ({
  user_id,
  name,
  email: email ?? `${user_id}@example.com`,
  role,
  created_at: 1,
});

export const user = (id: string, name: string, org_role: string, email?: string) => ({
  id,
  name,
  email: email ?? `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

export const ME_OWNER = {
  id: 'u1',
  email: 'u1@example.com',
  name: 'Pawan Sirsat',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

/** A member of the space, as a member: reads every value, changes nothing. */
export const ME_MEMBER = {
  ...ME_OWNER,
  id: 'u2',
  name: 'Tomas Nel',
  org_role: 'member',
  memberships: [{ project_id: 'p1', role: 'member' }],
};

export const MEMBERS = [
  member('u1', 'Pawan Sirsat', 'lead'),
  member('u2', 'Tomas Nel', 'member'),
  member('u3', 'Priya Raman', 'viewer'),
];

export const POLICY = {
  project_id: 'p1',
  allow_other_owners: false,
  cross_owner_requires_approval: true,
  max_handoffs: 3,
  offer_ttl_minutes: 60,
  updated_by: null,
  is_set: false,
};

export function spaceSettingsStub(
  me: Record<string, unknown>,
  overrides: ApiStub = {},
  project: Record<string, unknown> = PROJECT,
): ApiStub {
  return {
    '/api/v1/me': me,
    '/api/v1/org': {
      id: 'o1',
      name: 'Kvelld',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/projects': {
      data: [
        summary(project),
        summary({ ...PROJECT, id: 'p2', slug: 'web', name: 'Web', prefix: 'WEB' }),
      ],
      next_cursor: null,
    },
    [`/api/v1/projects/${SLUG}`]: project,
    [`/api/v1/projects/${SLUG}/members`]: { members: MEMBERS },
    '/api/v1/projects/web/members': { members: [member('u4', 'Sam Okafor', 'member')] },
    [`/api/v1/projects/${SLUG}/handoff-policy`]: POLICY,
    '/api/v1/users': {
      data: [
        user('u1', 'Pawan Sirsat', 'owner'),
        user('u2', 'Tomas Nel', 'member'),
        user('u3', 'Priya Raman', 'member'),
        user('u4', 'Sam Okafor', 'member'),
        user('u5', 'Lerato Dlamini', 'viewer'),
      ],
      next_cursor: null,
    },
    ...overrides,
  };
}

const LONG_NAME =
  'Mobile platform — iOS, Android and the shared React Native design system migration';
const LONG_REPO = 'kvelld-enterprise-platform-engineering/mobile-react-native-monorepo-2026';

/** 200 members: long names, unbreakable emails, non-Latin text. */
export const MANY_MEMBERS = Array.from({ length: 200 }, (_, i) => {
  const n = String(i + 1);
  if (i === 0) return member('u1', 'Pawan Sirsat', 'lead');
  if (i === 1)
    return member(
      'u2',
      'Maximilian Alexander Konstantinos Papadopoulos-Wellington',
      'member',
      'maximilian.alexander.konstantinos.papadopoulos-wellington@subsidiary.example.com',
    );
  if (i === 2) return member('u3', '王小明', 'viewer');
  return member(`m${n}`, `Person ${n}`, i % 7 === 0 ? 'lead' : i % 3 === 0 ? 'viewer' : 'member');
});

export function worstStub(): ApiStub {
  const project = { ...PROJECT, name: LONG_NAME, repo: LONG_REPO, prefix: 'MOBILEPLAT' };
  return spaceSettingsStub(
    ME_OWNER,
    { [`/api/v1/projects/${SLUG}/members`]: { members: MANY_MEMBERS } },
    project,
  );
}
