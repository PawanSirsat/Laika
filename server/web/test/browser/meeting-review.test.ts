/**
 * The Meeting review screen, in a browser (LAI-455) — M6's exit criterion.
 *
 * **This is the highest-stakes screen in Laika.** Every other one shows a person
 * what is on their board; this one asks them to authorise an LLM's reading of a
 * conversation to change it. So what is tested here is not that it renders — it
 * is that **accepting something wrong is hard**:
 *
 * - nothing is accepted by default, and an empty selection cannot be applied;
 * - the four tags are distinguishable, in both themes, by more than colour;
 * - discard is separated from apply and asks;
 * - **what landed is read from the response**, so a refusal shows as a refusal
 *   rather than as the success the screen was hoping for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, setTheme } from './harness.ts';

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LC',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const REVIEW = {
  id: 'r1',
  project_id: 'p1',
  source: 'standup-2026-09-16.txt',
  status: 'pending',
  proposal_count: 4,
  reviewed_by: null,
  reviewed_at: null,
  expires_at: 9_999_999_999_999,
  created_at: 1,
};

/** One of each tag, so all four are on screen at once. */
const PROPOSALS = [
  {
    id: 'p-new',
    kind: 'new',
    task: null,
    title: 'Write the retention job',
    description: 'Prune heartbeats older than 30 days.',
    changes: null,
    reason: null,
    quote: 'we should really prune those heartbeats, it is getting big',
    applied_at: null,
  },
  {
    id: 'p-change',
    kind: 'change',
    task: 'LC-4',
    title: null,
    description: null,
    changes: { status: 'done', priority: 'p1' },
    reason: 'Ada said it shipped on Friday',
    quote: 'LC-4 went out on Friday, that one is done',
    applied_at: null,
  },
  {
    id: 'p-dead',
    kind: 'dead',
    task: 'LC-9',
    title: null,
    description: null,
    changes: null,
    reason: 'superseded by the new parser',
    quote: 'we are not doing the old parser any more, drop it',
    applied_at: null,
  },
  {
    id: 'p-decision',
    kind: 'decision',
    task: null,
    title: null,
    description: 'SQLite stays; no Postgres before v2.',
    changes: null,
    reason: null,
    quote: 'we agreed, sqlite is fine, revisit after v2',
    applied_at: null,
  },
];

/** The task `p-change` edits, so the screen can show what it changes *from*. */
const TASK = {
  id: 't4',
  key: 'LC-4',
  project_id: 'p1',
  number: 4,
  title: 'Rate limit headers',
  description_md: null,
  acceptance_md: null,
  status: 'in_progress',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
};

function stub(over: Partial<Record<string, unknown>> = {}): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/projects/laika-core': PROJECT,
    '/api/v1/projects/laika-core/meeting-reviews': { data: [REVIEW], next_cursor: null },
    '/api/v1/meeting-reviews/r1': { ...REVIEW, proposals: PROPOSALS },
    '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
    ...over,
  };
}

void after(async () => {
  await closeBrowser();
});

void describe('nothing is accepted by default', () => {
  void test('no box is ticked and apply is unavailable', async () => {
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      await h.page.locator('.mr-proposal').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.mr-proposal').count(), 4, 'all four tags must render');

      const boxes = h.page.locator('.mr-accept input');
      assert.equal(await boxes.count(), 4);
      for (let i = 0; i < 4; i += 1) {
        assert.equal(await boxes.nth(i).isChecked(), false, `proposal ${String(i)} pre-accepted`);
      }

      // **An empty set is not "apply everything".** The control says so by being
      // unavailable rather than by sending nothing and reporting success.
      const apply = h.page.locator('.mr-apply');
      assert.equal(await apply.isDisabled(), true, 'apply is available with nothing accepted');
      assert.match(await h.page.locator('.mr-count').innerText(), /nothing accepted/i);
    } finally {
      await h.close();
    }
  });

  void test('accepting one enables apply, and it names the count', async () => {
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      await h.page.locator('.mr-accept input').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.mr-accept input').first().check();
      assert.equal(await h.page.locator('.mr-apply').isDisabled(), false);
      assert.match(await h.page.locator('.mr-apply').innerText(), /Apply 1/);
      assert.match(await h.page.locator('.mr-count').innerText(), /1 of 4/);
    } finally {
      await h.close();
    }
  });
});

void describe('the four tags are distinguishable, in both themes', () => {
  void test('each renders, in its own colour, and says what it means in words', async () => {
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      await h.page.locator('.mr-tag').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await h.page.locator('.mr-tag').allInnerTexts(), [
        'NEW',
        'CHANGED',
        'DEAD',
        'DECISION',
      ]);

      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(300);

        const colours = await h.page
          .locator('.mr-tag')
          .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
        assert.equal(new Set(colours).size, 4, `${theme}: tags share a colour`);
        for (const c of colours) {
          assert.notEqual(c, 'rgba(0, 0, 0, 0)', `${theme}: a tag has no colour`);
        }

        // **Not colour alone.** `DEAD` proposes closing work; a colour-blind
        // reader and a screenshot both need the words.
        const dead = h.page.locator('.mr-proposal', { hasText: 'DEAD' }).first();
        assert.match(await dead.innerText(), /clos/i, `${theme}: DEAD does not say what it does`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('a CHANGED proposal shows what it would set', () => {
  void test('each field appears with its new value', async () => {
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      const changed = h.page.locator('.mr-proposal', { hasText: 'CHANGED' }).first();
      await changed.waitFor({ timeout: 20_000 });
      const text = await changed.innerText();
      assert.match(text, /status/);
      assert.match(text, /done/);
      assert.match(text, /priority/);
      assert.match(text, /p1/);
      // `set status to done` is not reviewable; the field and value both show.
      assert.equal(await changed.locator('.mr-change').count(), 2);

      // **And what it changes *from*** — AC4. The proposal carries only the new
      // value, so the before is read off the task the board holds. Without it a
      // reader is asked to authorise `done` with nothing to compare it to.
      assert.equal(await changed.locator('.mr-change-from').count(), 2, 'no before is shown');
      assert.match(text, /in_progress/, 'the status it would replace is missing');
      assert.match(text, /p2/, 'the priority it would replace is missing');
    } finally {
      await h.close();
    }
  });

  void test('every proposal shows its quote', async () => {
    // There is no transcript to locate it in (D-056) — the quote is the whole
    // of the evidence, so a proposal without one is unreviewable.
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      await h.page.locator('.mr-quote').first().waitFor({ timeout: 20_000 });
      const quotes = await h.page.locator('.mr-quote').allInnerTexts();
      assert.equal(quotes.length, 4);
      for (const quote of quotes) assert.ok(quote.trim().length > 10, `thin quote: ${quote}`);
    } finally {
      await h.close();
    }
  });
});

void describe('a selection does not survive changing review', () => {
  void test('accepting on one review leaves the next one empty', async () => {
    // **The safety property**: a tick made against one meeting must not be
    // carried into another. Without the reset, switching reviews would let
    // somebody apply a proposal they ticked while reading a different meeting.
    const second = { ...REVIEW, id: 'r2', source: 'retro.txt', proposal_count: 1 };
    const h = await open(
      '/meeting-review?project=laika-core',
      stub({
        '/api/v1/projects/laika-core/meeting-reviews': {
          data: [REVIEW, second],
          next_cursor: null,
        },
        '/api/v1/meeting-reviews/r2': {
          ...second,
          proposals: [PROPOSALS[0]],
        },
      }),
    );
    try {
      await h.page.locator('.mr-accept input').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.mr-accept input').first().check();
      assert.match(await h.page.locator('.mr-count').innerText(), /1 of 4/);

      await h.page.locator('.mr-item', { hasText: 'retro.txt' }).click();
      await h.page.locator('.mr-proposal').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(300);

      assert.equal(
        await h.page.locator('.mr-accept input:checked').count(),
        0,
        'a selection carried across from another meeting',
      );
      assert.equal(await h.page.locator('.mr-apply').isDisabled(), true);
    } finally {
      await h.close();
    }
  });
});

void describe('a before the board does not hold is omitted, not invented', () => {
  void test('no arrow appears when the task is unknown', async () => {
    // `? → done` claims a fact nobody has. An empty task list is the ordinary
    // case for a meeting about a project the reader has partly loaded.
    const h = await open(
      '/meeting-review?project=laika-core',
      stub({ '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null } }),
    );
    try {
      const changed = h.page.locator('.mr-proposal', { hasText: 'CHANGED' }).first();
      await changed.waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);
      assert.equal(await changed.locator('.mr-change').count(), 2, 'the changes vanished too');
      assert.equal(await changed.locator('.mr-change-from').count(), 0, 'a before was invented');
    } finally {
      await h.close();
    }
  });
});

void describe('what landed is read from the response', () => {
  void test('a refused proposal reads as refused, not as applied', async () => {
    // The screen sends three and the server applies one. **A screen reporting
    // its selection would call all three a success.**
    const h = await open(
      '/meeting-review?project=laika-core',
      stub({
        '/api/v1/meeting-reviews/r1/apply': {
          id: 'r1',
          status: 'applied',
          applied: [
            { id: 'p-new', kind: 'new', outcome: { effect: 'task.created', task_id: 't9' } },
          ],
          already_applied: ['p-change'],
        },
      }),
    );
    try {
      await h.page.locator('.mr-accept input').first().waitFor({ timeout: 20_000 });
      for (const id of ['p-new', 'p-change', 'p-decision']) {
        await h.page
          .locator(
            `.mr-proposal:has-text("${id === 'p-new' ? 'NEW' : id === 'p-change' ? 'CHANGED' : 'DECISION'}") .mr-accept input`,
          )
          .first()
          .check();
      }
      await h.page.locator('.mr-apply').click();
      await h.page.locator('.mr-landed-applied').first().waitFor({ timeout: 20_000 });

      const body = await h.page.locator('.mr-proposals').innerText();
      assert.match(body, /created t9/, 'the applied one does not report what it did');
      assert.match(body, /already applied/i, 'the repeat is not reported as a repeat');
      assert.match(body, /not applied/i, 'the refused one is not reported');

      // And the refusal is not dressed as an error: accepting a lead-only
      // decision is the ordinary case (LAI-451), not a fault.
      assert.equal(await h.page.locator('.mr-landed-refused').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('an expired review is read-only with the reason', () => {
  void test('it shows its proposals, says why, and offers no apply', async () => {
    const expired = { ...REVIEW, status: 'expired' };
    const h = await open(
      '/meeting-review?project=laika-core',
      stub({
        '/api/v1/projects/laika-core/meeting-reviews': { data: [expired], next_cursor: null },
        '/api/v1/meeting-reviews/r1': { ...expired, proposals: PROPOSALS },
      }),
    );
    try {
      await h.page.locator('.mr-blocked').waitFor({ timeout: 20_000 });
      const why = await h.page.locator('.mr-blocked').innerText();
      assert.match(why, /expired/i);
      assert.match(why, /seven days/, 'it does not say why it expired');

      // Not an error state and not an empty one: the proposals are still there.
      assert.equal(await h.page.locator('.mr-proposal').count(), 4);
      assert.equal(
        await h.page.locator('.mr-apply').count(),
        0,
        'apply is offered on an expired review',
      );
      assert.equal(await h.page.locator('.mr-discard').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('discard is separated from apply', () => {
  void test('they are not adjacent, and discard asks first', async () => {
    const h = await open('/meeting-review?project=laika-core', stub());
    try {
      await h.page.locator('.mr-discard').waitFor({ timeout: 20_000 });
      const discard = await h.page.locator('.mr-discard').boundingBox();
      const apply = await h.page.locator('.mr-apply').boundingBox();
      assert.ok(discard !== null && apply !== null);
      // A destructive control within a thumb's width of the ordinary one is how
      // the wrong button gets pressed.
      assert.ok(
        apply.x - (discard.x + discard.width) > 80,
        `only ${String(Math.round(apply.x - (discard.x + discard.width)))}px between discard and apply`,
      );

      let asked = false;
      h.page.on('dialog', (d) => {
        asked = true;
        void d.dismiss();
      });
      await h.page.locator('.mr-discard').click();
      await h.page.waitForTimeout(300);
      assert.ok(asked, 'discard threw the set away without asking');
    } finally {
      await h.close();
    }
  });
});
