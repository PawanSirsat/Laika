/**
 * The Workroom's fixture (LAI-1199): one space, four tasks — one in review
 * with an agent selected, a claim in its activity, a save and a round; its
 * subtask and its blocker; and one nobody is on.
 */

import type { ApiStub } from './harness.ts';


const NOW = Date.now();

const PROJECT = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  former_prefixes: [],
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  agents_allowed: true,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const LISTED = {
  ...PROJECT,
  task_counts: { backlog: 0, todo: 2, in_progress: 0, review: 1, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-0',
  number: 0,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  send_back: null,
  selected_agent: null,
  claim: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
  ...over,
  status_name:
    (
      {
        todo: 'To do',
        review: 'Review',
        done: 'Done',
        in_progress: 'In progress',
        backlog: 'Backlog',
      } as Record<string, string>
    )[String(over.status ?? 'todo')] ?? 'To do',
});

const AGENT = {
  id: 'a1',
  display_name: 'shell-cc',
  harness: 'claude-code',
  device_label: 'belka',
  status: 'active',
  owner: { id: 'u1', name: 'Ada Lovelace' },
};

/** In review: an agent selected, a claim recorded in activity, a save and a round. */
export const T1 = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Ship the workroom',
  status: 'review',
  assignee_id: 'u1',
  selected_agent: AGENT,
  blocked_by: ['t3'],
  description_md: 'The **description**, rendered.',
  acceptance_md: '- [x] one\n- [ ] two',
});
const T2 = task({ id: 't2', key: 'LC-2', number: 2, title: 'A subtask', parent_task_id: 't1' });
const T3 = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'The blocker',
  status: 'done',
  blocks: ['t1'],
});
/** Nobody on it at all: every lane must say so in words. */
const T4 = task({ id: 't4', key: 'LC-4', number: 4, title: 'Untouched' });

const CHECKPOINT = {
  id: 'c1',
  task_id: 't1',
  session_id: 's1',
  agent_id: 'a1',
  agent_redacted: false,
  claim_generation: 2,
  repo: 'laika',
  branch: 'LC-1-workroom',
  remote_ref: 'refs/heads/LC-1-workroom',
  commit_sha: 'abcdef0123456789abcdef0123456789abcdef01',
  manifest: [{ path: 'a.ts', lines: 3 }],
  summary: {
    work_done: 'Built it',
    next_step: 'Review',
    decisions: 'Keep the harness line once',
    open_questions: 'Touch drag on the separators?',
    failing: '',
  },
  summary_commit_sha: null,
  created_at: NOW - 3_600_000,
  verification: 'verified',
  verified_at: NOW - 3_500_000,
  pending_since: null,
  pending_notice: false,
  superseded: false,
  refs: [],
};

const ROUND = {
  id: 'r2',
  task_id: 't1',
  number: 2,
  finished_by: 'u1',
  client_name: null,
  agent: null,
  by_registered_agent: false,
  summary_md: 'Done',
  commits: [
    {
      id: 'e1',
      state: 'confirmed',
      state_source: 'github',
      state_at: NOW - 1000,
      sha: 'abcdef0123456789abcdef0123456789abcdef01',
      message: 'feat: workroom',
    },
  ],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  decision: null,
  created_at: NOW - 1_800_000,
};

const CLAIM_TAKEN = {
  id: 'ev1',
  seq: 10,
  type: 'task.status_changed',
  project_id: 'laika-core',
  task_id: 't1',
  actor_id: null,
  actor_kind: 'agent',
  actor_token_id: null,
  agent_id: 'a1',
  agent_session: null,
  payload: { via: 'claim', claim_generation: 2, from: 'todo', to: 'in_progress' },
  created_at: NOW - 7_200_000,
};

const perTask = (ids: readonly string[]): ApiStub =>
  Object.fromEntries(
    ids.flatMap((id): [string, unknown][] => [
      [`/api/v1/tasks/${id}/comments`, { data: [], next_cursor: null }],
      [`/api/v1/tasks/${id}/watchers`, { watchers: [] }],
      [`/api/v1/tasks/${id}/handoff-offers`, { data: [], next_cursor: null }],
    ]),
  );

const ACTIVITY = '/api/v1/projects/laika-core/activity';

export const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [LISTED], next_cursor: null },
  '/api/v1/projects/laika-core': PROJECT,
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/tasks': { data: [T1, T2, T3, T4], next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/projects/laika-core/mentionable': { users: [] },
  '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  [`${ACTIVITY}?task_id=t1`]: { data: [CLAIM_TAKEN], next_cursor: null },
  [`${ACTIVITY}?task_id=t2`]: { data: [], next_cursor: null },
  [`${ACTIVITY}?task_id=t3`]: { data: [], next_cursor: null },
  [`${ACTIVITY}?task_id=t4`]: { data: [], next_cursor: null },
  [`${ACTIVITY}?limit=50`]: { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
  '/api/v1/agents': { data: [], next_cursor: null },
  '/api/v1/tasks/t1': T1,
  '/api/v1/tasks/t4': T4,
  '/api/v1/tasks/t1/checkpoints': { data: [CHECKPOINT], next_cursor: null },
  '/api/v1/tasks/t4/checkpoints': { data: [], next_cursor: null },
  '/api/v1/tasks/t2/checkpoints': { data: [], next_cursor: null },
  '/api/v1/tasks/t3/checkpoints': { data: [], next_cursor: null },
  '/api/v1/tasks/t1/rounds': { rounds: [ROUND], send_back: null },
  ...perTask(['t1', 't2', 't3', 't4']),
};

