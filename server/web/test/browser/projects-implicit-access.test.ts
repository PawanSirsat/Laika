/**
 * Projects follows the server's effective project role (LAI-883): owners and
 * admins hold implicit lead everywhere, while members and viewers still see
 * their memberships plus the public spaces they may join.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const project = (id: string, name: string, visibility: 'public' | 'private') => ({
  id,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  prefix: id.toUpperCase(),
  name,
  description: null,
  repo: null,
  visibility,
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 0,
  members: [],
  last_activity_at: null,
});

const MEMBER_SPACE = project('mine', 'Member Workshop', 'private');
const PRIVATE_SPACE = project('secret', 'Private Observatory', 'private');
const PUBLIC_SPACE = project('public', 'Public Commons', 'public');

function stub(role: 'owner' | 'admin' | 'member' | 'viewer'): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'reader@example.com',
      name: 'Reader',
      org_role: role,
      is_active: true,
      memberships: [{ project_id: MEMBER_SPACE.id, role: role === 'viewer' ? 'viewer' : 'member' }],
    },
    '/api/v1/projects': {
      data: [MEMBER_SPACE, PRIVATE_SPACE, PUBLIC_SPACE],
      next_cursor: null,
    },
  };
}

void after(async () => {
  await closeBrowser();
});

void describe('Projects effective access', () => {
  void test('an owner and admin see Private Observatory without a membership', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const h = await open('/projects', stub(role));
      try {
        const yours = h.page.locator('.projects-list').first();
        await yours.getByText('Private Observatory', { exact: true }).waitFor({ timeout: 20_000 });
        assert.match(await yours.innerText(), /Private Observatory/);
        assert.match(await yours.innerText(), /Public Commons/);
      } finally {
        await h.close();
      }
    }
  });

  void test('a member and viewer keep explicit spaces and public join choices only', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const h = await open('/projects', stub(role));
      try {
        await h.page
          .locator('.project-card-name')
          .getByText('Member Workshop', { exact: true })
          .waitFor({ timeout: 20_000 });
        const page = await h.page.locator('.projects').innerText();
        assert.match(page, /Member Workshop/);
        assert.match(page, /Public Commons/);
        assert.doesNotMatch(page, /Private Observatory/);
      } finally {
        await h.close();
      }
    }
  });
});
