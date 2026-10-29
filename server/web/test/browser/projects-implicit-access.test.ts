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
const ARCHIVED_SPACE = {
  ...project('archive', 'Archived Workshop', 'private'),
  archived_at: 2,
};

function stub(
  role: 'owner' | 'admin' | 'member' | 'viewer',
  implicit: 'lead' | 'viewer' | null = role === 'owner' || role === 'admin' ? 'lead' : null,
): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'reader@example.com',
      name: 'Reader',
      org_role: role,
      is_active: true,
      memberships: [MEMBER_SPACE, ARCHIVED_SPACE].map((space) => ({
        project_id: space.id,
        role: role === 'viewer' ? 'viewer' : 'member',
      })),
    },
    '/api/v1/projects': {
      data: [MEMBER_SPACE, PRIVATE_SPACE, PUBLIC_SPACE, ARCHIVED_SPACE],
      next_cursor: null,
    },
    '/api/v1/permissions': {
      org_roles: [],
      project_roles: [],
      permissions: [],
      me: {
        org_role: role,
        credential: 'session',
        project_scope: 'all',
        implicit_project_role: implicit,
        actions: [],
        projects: [],
      },
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
        // An archived space is listed under the *Archived* chip, not here
        // (D-103 item 10, LAI-978).
        assert.doesNotMatch(await yours.innerText(), /Archived Workshop/);
        assert.equal(
          await yours.getByText('Public Commons', { exact: true }).count(),
          1,
          'Public Commons was duplicated outside Your spaces',
        );
        assert.equal(
          await h.page.getByText('PUBLIC IN THIS ORG', { exact: true }).count(),
          0,
          'owner/admin still gets a public join section',
        );
        assert.equal(
          await h.page.getByRole('button', { name: 'Join', exact: true }).count(),
          0,
          'owner/admin is offered Join for an implicit-lead space',
        );
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
        assert.doesNotMatch(page, /Archived Workshop/, 'an archived space is under Archived');
        assert.match(page, /Public Commons/);
        assert.doesNotMatch(page, /Private Observatory/);
      } finally {
        await h.close();
      }
    }
  });

  void test('live grants override the role: revoked admin loses implicit spaces, granted member gains them', async () => {
    for (const [role, implicit, seesPrivate] of [
      ['admin', null, false],
      ['member', 'lead', true],
      ['owner', 'lead', true],
    ] as const) {
      const h = await open('/projects', stub(role, implicit));
      try {
        // The end state, not the first frame: Join is offered only once the
        // server has said which spaces this reader leads, so its presence (or
        // Private Observatory's) is the answer having landed.
        const settled = seesPrivate
          ? h.page.locator('.project-card-name').getByText('Private Observatory', { exact: true })
          : h.page.getByRole('button', { name: 'Join', exact: true });
        await settled.waitFor({ timeout: 20_000 });
        const page = await h.page.locator('.projects').innerText();
        assert.equal(
          page.includes('Private Observatory'),
          seesPrivate,
          `${role} ignored live grants`,
        );
        assert.equal(
          await h.page.getByRole('button', { name: 'Join', exact: true }).count(),
          seesPrivate ? 0 : 1,
        );
      } finally {
        await h.close();
      }
    }
  });

  void test('an explicit lead edits the project context without any implicit role', async () => {
    // A member who leads Member Workshop by membership: no implicit role at
    // all, so a gate that asked `implicitlyLeads` would offer read-only.
    const lead = stub('member', null);
    const h = await open('/projects', {
      ...lead,
      '/api/v1/me': {
        ...(lead['/api/v1/me'] as object),
        memberships: [{ project_id: MEMBER_SPACE.id, role: 'lead' }],
      },
      '/api/v1/permissions': {
        org_roles: [],
        project_roles: [],
        permissions: [],
        me: {
          org_role: 'member',
          credential: 'session',
          project_scope: 'all',
          implicit_project_role: null,
          actions: [],
          projects: [
            {
              project_id: MEMBER_SPACE.id,
              role: 'lead',
              actions: ['project.settings.edit', 'project.members.manage'],
            },
          ],
        },
      },
      [`/api/v1/projects/${MEMBER_SPACE.slug}/context`]: {
        context_md: '',
        revision: 0,
        length: 0,
        limit: 20_000,
        updated_at: null,
        updated_by: null,
      },
    });
    try {
      const card = h.page.locator('.project-card', { hasText: 'Member Workshop' });
      await card.getByRole('button', { name: 'Context' }).click();
      await h.page.locator('.ctx-save').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.ctx-editor').getAttribute('readonly'), null);
      assert.equal(await h.page.locator('.ctx-readonly').count(), 0);
    } finally {
      await h.close();
    }
  });
});
