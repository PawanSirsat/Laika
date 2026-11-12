/**
 * Space settings, the UX pass (LAI-1211), on the owner's own example —
 * `/spaces/mobile/settings` — against the real built SPA and a stubbed API.
 *
 * Each test is about what the page says or does **before or after** a save:
 * a value the server would refuse caught as it is typed, what a key change
 * does, the owner/name inside a pasted link, a role change answered, the
 * effect of a visibility change, the typed key that archiving waits for, and
 * the save bar that stays on screen at 390. `space-settings.test.ts` keeps the
 * contract with the server — refusals in its words, grants never the role.
 *
 * Every wait is followed by an assertion on what it waited for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type Harness, type StubCall } from './harness.ts';
import { pick } from './dropdown.ts';
import { answerConfirm } from './confirm.ts';
import {
  MEMBERS,
  ME_MEMBER,
  ME_OWNER,
  PROJECT,
  SLUG,
  member,
  spaceSettingsStub,
} from './space-settings-fixture.ts';

const SETTINGS = `/spaces/${SLUG}/settings`;

after(async () => {
  await closeBrowser();
});

async function settled(h: Harness): Promise<void> {
  const reader = h.page.locator('.ss-reader');
  await reader.waitFor({ timeout: 20_000 });
  await until(async () => (await reader.innerText()) !== 'Space settings', 10_000);
  assert.notEqual(await reader.innerText(), 'Space settings');
}

const patches = (h: Harness): unknown[] =>
  h.calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

/** The space as the server holds it, changed by every PATCH the page sends. */
function liveProject(start: Record<string, unknown> = PROJECT) {
  let current = { ...start };
  return (call: StubCall) => {
    if (call.method === 'PATCH') {
      const body = call.body as Record<string, unknown>;
      const { archived, ...rest } = body;
      current = {
        ...current,
        ...rest,
        ...(archived === undefined ? {} : { archived_at: archived === true ? 5 : null }),
      };
    }
    return current;
  };
}

void describe('General', () => {
  void test('a key the server would refuse is said as it is left, and Save sends nothing', async () => {
    const h = await open(SETTINGS, spaceSettingsStub(ME_OWNER));
    try {
      await settled(h);
      const key = h.page.locator('#ss-prefix');
      await key.fill('9');
      // Not yet: the field has not been left.
      assert.equal(await h.page.locator('#ss-prefix-error').count(), 0);
      await key.blur();
      const error = h.page.locator('#ss-prefix-error');
      await error.waitFor({ timeout: 5_000 });
      assert.equal(
        await error.innerText(),
        'A key is 2–8 letters and digits, starting with a letter.',
      );
      assert.equal(await key.getAttribute('aria-invalid'), 'true');
      assert.equal(
        await h.page.locator('[data-unsaved]').innerText(),
        'Fix the field marked above to save',
      );

      // A cleared name too, then Save: nothing is sent and the focus goes to the first problem.
      await h.page.locator('#ss-name').fill('');
      await h.page.locator('[data-action="save-general"]').click();
      await until(async () => h.page.evaluate(() => document.activeElement?.id === 'ss-name'));
      assert.equal(await h.page.evaluate(() => document.activeElement?.id), 'ss-name');
      assert.equal(await h.page.locator('#ss-name-error').innerText(), 'A space needs a name.');
      assert.equal(
        await h.page.locator('[data-unsaved]').innerText(),
        'Fix 2 fields marked above to save',
      );
      assert.deepEqual(patches(h), [], 'a refused value was sent');

      // Fixing it clears the mark as it is typed.
      await key.fill('APP');
      await until(async () => (await h.page.locator('#ss-prefix-error').count()) === 0);
      assert.equal(await key.getAttribute('aria-invalid'), null);
    } finally {
      await h.close();
    }
  });

  void test('a pasted repository link is caught, and its owner/name offered in one click', async () => {
    const h = await open(
      SETTINGS,
      spaceSettingsStub(ME_OWNER, { [`/api/v1/projects/${SLUG}`]: liveProject() }),
    );
    try {
      await settled(h);
      const repo = h.page.locator('#ss-repo');
      await repo.fill('https://github.com/kvelld/mobile-ios.git');
      const error = h.page.locator('#ss-repo-error');
      await error.waitFor({ timeout: 5_000 });
      assert.match(await error.innerText(), /not a link/);
      const use = h.page.locator('[data-action="use-repo"]');
      assert.equal(await use.innerText(), 'Use kvelld/mobile-ios');
      await use.click();
      assert.equal(await repo.inputValue(), 'kvelld/mobile-ios');
      await until(async () => (await h.page.locator('#ss-repo-error').count()) === 0);
      assert.equal(await use.count(), 0);

      await h.page.locator('[data-action="save-general"]').click();
      const saved = h.page.locator('.ss-card-foot [data-save-status="saved"]');
      await saved.waitFor({ timeout: 10_000 });
      assert.match(await saved.innerText(), /Saved/);
      assert.deepEqual(patches(h), [{ repo: 'kvelld/mobile-ios' }]);
    } finally {
      await h.close();
    }
  });

  void test('a key change says what it does before it is saved', async () => {
    const h = await open(SETTINGS, spaceSettingsStub(ME_OWNER));
    try {
      await settled(h);
      assert.equal(await h.page.locator('[data-key-change]').count(), 0);
      await h.page.locator('#ss-prefix').fill('app');
      const note = h.page.locator('[data-key-change]');
      await note.waitFor({ timeout: 5_000 });
      const said = (await note.innerText()).replace(/\s+/g, ' ');
      assert.match(said, /New tasks will be APP-43 onwards\./);
      assert.match(
        said,
        /The 42 existing tasks keep their MOB- keys, and MOB-1 keeps opening MOB-1\./,
      );
      // Back to the old key: nothing to warn about.
      await h.page.locator('#ss-prefix').fill('MOB');
      await until(async () => (await note.count()) === 0);
      assert.equal(await note.count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the colours are one radio group: named, one Tab stop, arrows choose', async () => {
    const h = await open(SETTINGS, spaceSettingsStub(ME_OWNER));
    try {
      await settled(h);
      const group = h.page.getByRole('radiogroup', { name: 'Colour' });
      assert.equal(await group.locator('[tabindex="0"]').count(), 1);
      const teal = group.getByRole('radio', { name: 'Teal' });
      assert.equal(await teal.getAttribute('aria-checked'), 'true');
      assert.equal(await h.page.locator('[data-colour-name]').innerText(), 'Teal');

      await teal.focus();
      await h.page.keyboard.press('ArrowRight');
      const blue = group.getByRole('radio', { name: 'Blue' });
      await until(async () => (await blue.getAttribute('aria-checked')) === 'true');
      assert.equal(await blue.getAttribute('aria-checked'), 'true');
      assert.equal(await teal.getAttribute('aria-checked'), 'false');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-swatch')),
        'blue',
      );
      assert.equal(await group.locator('[tabindex="0"]').getAttribute('data-swatch'), 'blue');
      assert.equal(await h.page.locator('[data-colour-name]').innerText(), 'Blue');

      await h.page.keyboard.press('End');
      await until(
        async () =>
          (await group.getByRole('radio', { name: 'Green' }).getAttribute('aria-checked')) ===
          'true',
      );
      assert.equal(await h.page.locator('[data-colour-name]').innerText(), 'Green');
    } finally {
      await h.close();
    }
  });

  void test('390: with changes to save, the save bar stays on screen', async () => {
    const h = await open(SETTINGS, spaceSettingsStub(ME_OWNER), {
      before: async (page) => {
        await page.setViewportSize({ width: 390, height: 700 });
      },
    });
    try {
      await settled(h);
      const bar = h.page.locator('[data-save-bar]');
      await h.page.locator('#ss-name').fill('Mobile apps');
      await h.page.locator('[data-unsaved]').waitFor({ timeout: 5_000 });
      await h.page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('*').forEach((el) => {
          if (el.scrollTop > 0) el.scrollTop = 0;
        });
      });
      const box = await bar.boundingBox();
      assert.ok(box !== null, 'no save bar');
      assert.ok(
        box.y + box.height <= 700 + 1 && box.y >= 0,
        `the save bar is off screen at the top of the page: y=${String(box.y)} h=${String(box.height)}`,
      );
      assert.ok(
        await h.page.getByRole('button', { name: 'Save changes' }).isVisible(),
        'Save is not visible',
      );
      // Single column: the page does not scroll sideways.
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Members', () => {
  void test('find a member: filtered, counted, no match with a way back', async () => {
    const h = await open(`${SETTINGS}?tab=members`, spaceSettingsStub(ME_OWNER));
    try {
      await settled(h);
      const summary = h.page.locator('[data-role-summary]');
      await summary.waitFor({ timeout: 10_000 });
      assert.equal(await summary.innerText(), '3 people · 1 space admin · 1 member · 1 viewer');

      const find = h.page.locator('[data-find-member]');
      await find.fill('pri');
      await until(async () => (await h.page.locator('[data-member]').count()) === 1);
      assert.deepEqual(
        await h.page
          .locator('[data-member]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-member'))),
        ['u3'],
      );
      assert.equal(await summary.innerText(), '1 of 3 match');

      await find.fill('zzz');
      const none = h.page.locator('[data-members-no-match]');
      await none.waitFor({ timeout: 5_000 });
      assert.match(await none.innerText(), /Nobody here matches “zzz”\./);
      await none.getByRole('button', { name: 'Clear search' }).click();
      await until(async () => (await h.page.locator('[data-member]').count()) === 3);
      assert.equal(await find.inputValue(), '');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.hasAttribute('data-find-member')),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('a role change is answered, and your own row offers Leave rather than Remove', async () => {
    let list = MEMBERS;
    const h = await open(
      `${SETTINGS}?tab=members`,
      spaceSettingsStub(ME_OWNER, {
        [`/api/v1/projects/${SLUG}/members`]: () => ({ members: list }),
        [`/api/v1/projects/${SLUG}/members/u2`]: (call: StubCall) => {
          const role = (call.body as { role: string }).role;
          list = list.map((m) => (m.user_id === 'u2' ? member('u2', 'Tomas Nel', role) : m));
          return { members: list };
        },
      }),
    );
    try {
      await settled(h);
      await h.page.locator('[data-member="u2"]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-member="u1"] [data-action="remove"]').count(), 0);
      assert.match(
        await h.page.locator('[data-member="u1"] [data-self-note]').innerText(),
        /Leave space/,
      );

      await pick(h.page.locator('[data-member="u2"] [role="combobox"]'), 'viewer');
      const toast = h.page.locator('[data-toast]');
      await toast.waitFor({ timeout: 10_000 });
      assert.match(await toast.innerText(), /Tomas Nel is now Viewer in Mobile\./);
      assert.deepEqual(patches(h), [{ role: 'viewer' }]);
      assert.equal(
        await h.page.locator('[data-role-summary]').innerText(),
        '3 people · 1 space admin · 2 viewers',
      );
    } finally {
      await h.close();
    }
  });

  void test('200 members, a 55-character name and an 81-character email stay on one line each', async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      i === 1
        ? member(
            'u2',
            'Maximilian Alexander Konstantinos Papadopoulos-Wellington',
            'member',
            'maximilian.alexander.konstantinos.papadopoulos-wellington@subsidiary.example.com',
          )
        : member(
            i === 0 ? 'u1' : `m${String(i)}`,
            i === 0 ? 'Pawan Sirsat' : `Person ${String(i)}`,
            i === 0 ? 'lead' : 'member',
          ),
    );
    const h = await open(
      `${SETTINGS}?tab=members`,
      spaceSettingsStub(ME_OWNER, { [`/api/v1/projects/${SLUG}/members`]: { members: many } }),
      {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
        },
      },
    );
    try {
      await settled(h);
      const row = h.page.locator('[data-member="u2"]');
      await row.waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('[data-role-summary]').innerText(),
        '200 people · 1 space admin · 199 members',
      );
      for (const sel of ['.ss-member-name-text', '.ss-member-email']) {
        const lines = await row.locator(sel).evaluate((el) => {
          const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
          return Math.round(el.getBoundingClientRect().height / lh);
        });
        assert.equal(lines, 1, `${sel} wrapped`);
        assert.ok(
          (await row.locator(sel).getAttribute('title'))?.startsWith('maximilian') ||
            (await row.locator(sel).getAttribute('title'))?.startsWith('Maximilian'),
          `${sel} lost its full text`,
        );
      }
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        'the page scrolls sideways',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Access', () => {
  void test('visibility is a radio group whose effect is said, and Public asks first', async () => {
    const h = await open(
      `${SETTINGS}?tab=access`,
      spaceSettingsStub(ME_OWNER, { [`/api/v1/projects/${SLUG}`]: liveProject() }),
    );
    try {
      await settled(h);
      const effect = h.page.locator('[data-visibility-effect]');
      await until(async () => /3 members/.test(await effect.innerText()), 10_000);
      assert.match(await effect.innerText(), /Right now: only its 3 members .* can see Mobile\./);

      const priv = h.page.locator('[data-visibility="private"]');
      assert.equal(await priv.getAttribute('tabindex'), '0');
      assert.equal(
        await h.page.locator('[data-visibility="public"]').getAttribute('tabindex'),
        '-1',
      );
      await priv.focus();
      await h.page.keyboard.press('ArrowRight');
      // The arrow chooses Public exactly as a click does — which asks before saving.
      const said = h.page.locator('[data-action="confirm-public"]');
      await said.waitFor({ timeout: 5_000 });
      assert.deepEqual(patches(h), [], 'made public without asking');
      await said.click();
      await until(async () => /everyone in Kvelld/.test(await effect.innerText()), 10_000);
      assert.match(await effect.innerText(), /Right now: everyone in Kvelld can find Mobile/);
      assert.deepEqual(patches(h), [{ visibility: 'public' }]);
      assert.equal(
        await h.page.locator('[data-visibility="public"]').getAttribute('aria-checked'),
        'true',
      );

      const handoff = h.page.locator('[data-handoff-summary]');
      await handoff.waitFor({ timeout: 10_000 });
      assert.match(await handoff.innerText(), /only to another agent the same person registered/);
    } finally {
      await h.close();
    }
  });
});

void describe('Danger zone', () => {
  void test('archive waits for the key, Escape backs out, and the result says where to restore', async () => {
    const h = await open(
      `${SETTINGS}?tab=danger`,
      spaceSettingsStub(ME_OWNER, { [`/api/v1/projects/${SLUG}`]: liveProject() }),
    );
    try {
      await settled(h);
      const archive = h.page.locator('[data-action="archive"]');
      await archive.click();
      const key = h.page.locator('#ss-archive-key');
      await key.waitFor({ timeout: 5_000 });
      await until(async () =>
        h.page.evaluate(() => document.activeElement?.id === 'ss-archive-key'),
      );
      assert.equal(await h.page.evaluate(() => document.activeElement?.id), 'ss-archive-key');

      const confirm = h.page.locator('[data-action="confirm-archive"]');
      await key.fill('MOX');
      assert.equal(await confirm.getAttribute('aria-disabled'), 'true');
      assert.match(await h.page.locator('[data-typed-confirm]').innerText(), /Type MOB to archive/);
      await confirm.click({ force: true });
      assert.deepEqual(patches(h), [], 'archived with the wrong key');

      await h.page.keyboard.press('Escape');
      await until(async () => (await key.count()) === 0);
      await until(async () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'archive'),
      );
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-action')),
        'archive',
      );

      await archive.click();
      await key.fill('mob');
      assert.equal(await confirm.getAttribute('aria-disabled'), null);
      await confirm.click();
      const result = h.page.locator('[data-danger-result="archived"]');
      await result.waitFor({ timeout: 10_000 });
      assert.match(
        await result.innerText(),
        /Mobile is archived and its board is read-only\. Restore it here at any time, or from Spaces › Archived\./,
      );
      assert.equal(
        await result.getByRole('link').getAttribute('href'),
        '/projects?filter=archived',
      );
      assert.deepEqual(patches(h), [{ archived: true }]);
      assert.match(
        await h.page.locator('[data-consequences="restore"]').innerText(),
        /opens for work again/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a reader', () => {
  void test('sees every value read only, with the reason, and nothing to change', async () => {
    const h = await open(SETTINGS, spaceSettingsStub(ME_MEMBER));
    try {
      await settled(h);
      assert.equal(
        await h.page.locator('.ss-reader').innerText(),
        'Space settings · read only — space admins change these',
      );
      assert.equal(await h.page.locator('input, textarea').count(), 0);
      assert.match(await h.page.locator('.ss-card').innerText(), /Colour\s+Teal/);
      assert.equal(await h.page.locator('[data-save-bar]').count(), 0);

      await h.page.locator('.page-tab[data-tab="danger"]').click();
      const reason = h.page.locator('.ss-danger .ss-muted');
      await reason.waitFor({ timeout: 5_000 });
      assert.match(await reason.innerText(), /you need to be its Space admin/);
      assert.equal(await h.page.locator('[data-action="archive"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});
