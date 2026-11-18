/**
 * A person's synced photo wherever a person is drawn (LAI-1336).
 *
 * LAI-1330 put the photo on the shared `Avatar`; the owner's screenshots then
 * showed the board's member stack, the Overview's People and the member
 * lists still drawing initials by hand, for people whose cards showed a face.
 * Those surfaces now draw the shared `Avatar`, and this proves it where only a
 * browser can: the photo is asked for at its `?v=` and drawn; someone the
 * directory has no photo for keeps their initials and asks for nothing; and a
 * photo that answers `404` gives way to the initials in the same box.
 *
 * `LAIKA_SHOTS=<dir>` also writes each screen's screenshots there, in both
 * themes at 1440 and 390 (`people-photos.ts`).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { task } from './capacity-org.ts';
import { closeBrowser, open, until, type ApiStub } from './harness.ts';
import { OWNER, PEOPLE } from './organisation-refine-fixtures.ts';
import { bothThemes, entry, photos, V } from './people-photos.ts';
import { ME_OWNER, SLUG, spaceSettingsStub } from './space-settings-fixture.ts';

void after(async () => {
  await closeBrowser();
});

const photoOf = (id: string) => `/api/v1/users/${id}/photo?v=${String(V)}`;

/** The photo a face draws, once it has drawn one. */
async function photoIn(face: Locator): Promise<string | null> {
  const img = face.locator('img.avatar-img');
  await until(async () => (await img.count()) === 1, 10_000);
  assert.equal(await img.count(), 1, 'no photo drawn — initials where the directory has one');
  return img.getAttribute('src');
}

/** A face with no photo: its initials, and no image at all — never a broken one. */
async function initialsIn(face: Locator): Promise<string> {
  assert.equal(await face.locator('img').count(), 0, 'an image where initials belong');
  return (await face.innerText()).trim();
}

async function size(face: Locator): Promise<string> {
  const box = await face.boundingBox();
  assert.ok(box !== null, 'the face is not drawn');
  return `${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
}

const HOME = {
  id: 'p1',
  slug: 'laika',
  prefix: 'LAI',
  name: 'Laika',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 4, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 5,
  members: [],
  last_activity_at: 2,
};

/**
 * Ada and Priya have photos; Grace was never synced; Tomas's photo was
 * deleted after the directory was read, so it answers `404`; Kenji, fifth,
 * is behind the stack's `+1`.
 */
const MEMBERS = [
  ['u1', 'Ada Lovelace', 'lead'],
  ['u2', 'Grace Hopper', 'member'],
  ['u3', 'Tomas Nel', 'member'],
  ['u4', 'Priya Raman', 'member'],
  ['u5', 'Kenji Sato', 'member'],
] as const;

const BOARD_DIRECTORY = {
  people: {
    u1: entry({ photo_v: V }),
    u3: entry({ photo_v: V }),
    u4: entry({ photo_v: V }),
    u5: entry({ photo_v: V }),
  },
};

const BOARD: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'u1@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: HOME.id, role: 'lead' }],
  },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects': { data: [HOME], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}`]: HOME,
  [`/api/v1/projects/${HOME.slug}/tasks`]: {
    data: [
      task('t1', 'LAI-1', 'Photos on the board', 'todo', HOME, 'u1'),
      task('t2', 'LAI-2', 'Nobody synced', 'todo', HOME, 'u2'),
      task('t3', 'LAI-3', 'A photo gone missing', 'todo', HOME, 'u3'),
      task('t4', 'LAI-4', 'Another photo', 'todo', HOME, 'u4'),
    ],
    next_cursor: null,
  },
  [`/api/v1/projects/${HOME.slug}/sprints`]: { data: [], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}/members`]: {
    members: MEMBERS.map(([user_id, name, role]) => ({
      user_id,
      name,
      email: `${user_id}@example.com`,
      role,
      created_at: 1,
    })),
  },
  [`/api/v1/projects/${HOME.slug}/mentionable`]: { users: [] },
  [`/api/v1/projects/${HOME.slug}/activity`]: { data: [], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}/tags`]: { tags: [] },
  [`/api/v1/projects/${HOME.slug}/meeting-reviews`]: { data: [], next_cursor: null },
  '/api/v1/people/directory': BOARD_DIRECTORY,
};

void describe('the board (LAI-1336)', () => {
  void test('the toolbar’s stack, the members popover and the cards draw the photo', async () => {
    const asked: string[] = [];
    const h = await open(`/board?project=${HOME.slug}`, BOARD, {
      before: photos(asked, new Set(['u3'])),
    });
    try {
      const stack = h.page.locator('.bt-members .bt-member');
      await until(async () => (await stack.count()) === 4, 20_000);
      const face = (name: string) =>
        h.page
          .locator('.bt-members')
          .getByRole('button', { name: `Show only ${name}'s work`, exact: true });

      // The toolbar's stack: a photo in Ada's ring, Grace's initials in hers.
      assert.equal(await photoIn(face('Ada Lovelace')), photoOf('u1'));
      assert.equal(await photoIn(face('Priya Raman')), photoOf('u4'));
      assert.equal(await initialsIn(face('Grace Hopper')), 'GH');
      const img = face('Ada Lovelace').locator('img.avatar-img');
      assert.deepEqual(
        await img.evaluate((el) => [
          el.getAttribute('loading'),
          el.getAttribute('decoding'),
          el.getAttribute('width'),
          el.getAttribute('height'),
          el.getAttribute('alt'),
        ]),
        ['lazy', 'async', '24', '24', ''],
        'lazy, async, sized, and silent beside the button’s own name',
      );

      // Overlapped, each face's canvas ring stays over the face before it: the
      // point just inside a button's left edge, where it overlaps its
      // neighbour, is that button's ring — not the neighbour's face on top.
      const rings = await stack.evaluateAll((buttons) =>
        buttons.slice(1).map((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + 1, box.top + box.height / 2);
          return hit?.closest('.bt-member') === button;
        }),
      );
      assert.deepEqual(rings, [true, true, true], 'a face paints over the next one’s ring');

      // A card's assignee: the photo, or the initials.
      const card = (id: string) => h.page.locator(`[data-task-id="${id}"] .card-avatar`);
      assert.equal(await photoIn(card('t1')), photoOf('u1'));
      assert.equal(await initialsIn(card('t2')), 'GH');

      // A photo that answers 404 gives way to the initials, in the same box.
      await until(() => asked.includes('u3'), 10_000);
      assert.ok(asked.includes('u3'), 'Tomas’s photo was never asked for: its 404 proves nothing');
      await until(async () => (await card('t3').locator('img').count()) === 0, 10_000);
      assert.equal(await initialsIn(card('t3')), 'TN');
      assert.equal(await initialsIn(face('Tomas Nel')), 'TN');
      assert.equal(await size(card('t3')), await size(card('t1')), 'the card’s face moved');
      assert.equal(await size(face('Tomas Nel')), await size(face('Ada Lovelace')));

      // Nothing is asked for a person with no photo.
      assert.equal(asked.includes('u2'), false, 'a photo asked for someone with none');

      // The fifth member, behind +1: the popover draws the photo too.
      await h.page.locator('button.bt-member-more').click();
      const pop = h.page.getByRole('dialog', { name: 'Members' });
      await pop.waitFor({ timeout: 5_000 });
      const kenji = pop.locator('.bt-mp-row', { hasText: 'Kenji Sato' }).locator('.bt-mp-avatar');
      assert.equal(await photoIn(kenji), photoOf('u5'));
      assert.equal(
        await initialsIn(
          pop.locator('.bt-mp-row', { hasText: 'Grace Hopper' }).locator('.bt-mp-avatar'),
        ),
        'GH',
      );
      await h.page.keyboard.press('Escape');
      await until(async () => (await pop.count()) === 0);

      await bothThemes(h, 'board', '[data-task-id="t1"] .card-avatar');
    } finally {
      await h.close();
    }
  });

  void test('the List view’s assignee cell draws the photo, and nobody as a dash', async () => {
    const asked: string[] = [];
    const h = await open(
      `/list?project=${HOME.slug}`,
      {
        ...BOARD,
        [`/api/v1/projects/${HOME.slug}/tasks`]: {
          data: [
            task('t1', 'LAI-1', 'Photos on the board', 'todo', HOME, 'u1'),
            task('t2', 'LAI-2', 'Nobody synced', 'todo', HOME, 'u2'),
            { ...task('t5', 'LAI-5', 'Nobody on it', 'todo', HOME), assignee_id: null },
          ],
          next_cursor: null,
        },
      },
      { before: photos(asked) },
    );
    try {
      const row = (id: string) => h.page.locator(`tr[data-task-id="${id}"] .list-avatar`);
      await row('t1').waitFor({ timeout: 20_000 });
      assert.equal(await photoIn(row('t1')), photoOf('u1'));
      assert.equal(await initialsIn(row('t2')), 'GH');
      // Unassigned is the dashed mark with its dash, never a face.
      const nobody = h.page.locator('tr[data-task-id="t5"] .list-assignee');
      assert.equal((await nobody.locator('.list-avatar-empty').innerText()).trim(), '—');
      assert.equal(await nobody.locator('.avatar').count(), 0, 'a face for nobody');
      assert.equal((await nobody.locator('.list-who').innerText()).trim(), 'Unassigned');
      await bothThemes(h, 'list', 'tr[data-task-id="t1"] .list-avatar');
    } finally {
      await h.close();
    }
  });
});

void describe('the Organisation Overview (LAI-1336)', () => {
  void test('the People card’s stack draws the photo', async () => {
    const asked: string[] = [];
    const h = await open(
      '/organisation',
      OWNER({
        '/api/v1/people/directory': {
          people: { u1: entry({ photo_v: V }), u2: entry({ photo_v: V }) },
        },
      }),
      { before: photos(asked) },
    );
    try {
      const stack = h.page.locator('[data-tile="people"] .bento-avatar');
      await stack.first().waitFor({ timeout: 20_000 });
      const face = (name: string) =>
        h.page.locator('[data-tile="people"]').getByRole('img', { name, exact: true });
      assert.equal(await photoIn(face('Ada Lovelace')), photoOf('u1'));
      assert.equal(await photoIn(face('Tomas Nel')), photoOf('u2'));
      // Named on the image itself: nothing beside a face in the stack says who.
      assert.equal(
        await face('Ada Lovelace').locator('img.avatar-img').getAttribute('alt'),
        'Ada Lovelace',
      );
      const priya = PEOPLE.find((p) => p.id === 'u3');
      assert.ok(priya !== undefined);
      assert.equal(await initialsIn(face(priya.name)), 'PR');
      assert.equal(asked.includes('u3'), false, 'a photo asked for someone with none');
      await bothThemes(h, 'overview', '[data-tile="people"] .bento-avatar');
    } finally {
      await h.close();
    }
  });
});

void describe('a member list (LAI-1336)', () => {
  void test('space settings’ Members tab draws the photo on each row', async () => {
    const asked: string[] = [];
    const h = await open(
      `/spaces/${SLUG}/settings?tab=members`,
      spaceSettingsStub(ME_OWNER, {
        '/api/v1/people/directory': {
          people: { u1: entry({ photo_v: V }), u2: entry({ photo_v: V }) },
        },
      }),
      { before: photos(asked) },
    );
    try {
      const row = (id: string) =>
        h.page.locator(`.ss-member[data-member="${id}"] .ss-member-avatar`);
      await row('u1').waitFor({ timeout: 20_000 });
      assert.equal(await photoIn(row('u2')), photoOf('u2'));
      assert.equal(await photoIn(row('u1')), photoOf('u1'));
      assert.equal(await initialsIn(row('u3')), 'PR');
      assert.equal(asked.includes('u3'), false, 'a photo asked for someone with none');
      await bothThemes(h, 'space-members', '.ss-member');
    } finally {
      await h.close();
    }
  });
});
