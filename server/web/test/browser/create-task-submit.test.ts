/**
 * What the Create task dialog sends and says (LAI-1167, D-145): the create
 * body with only what was filled in and `status_id` alone; the sprint and
 * the blocker as their own calls after it; the toast with *Open*; a `422`
 * laid onto its fields with nothing lost; a step after the create failing
 * as *created, but…*; and *Create another* keeping the four fields it keeps.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { pick } from './dropdown.ts';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  until,
  type Harness,
  type StubCall,
} from './harness.ts';
import { ADA, DIALOG, NEW_TASK, stub, task } from './create-task-fixtures.ts';

void after(async () => {
  await closeBrowser();
});

/** The project's task list on GET; `answer` on POST. */
const tasksRoute = (answer: unknown) => (call: { method: string }) =>
  call.method === 'POST' ? answer : { data: [task(1), task(2)], next_cursor: null };

const posts = (h: Harness, suffix: string): StubCall[] =>
  h.calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix));

async function openDialog(path = '/board?project=laika-core', extra = {}): Promise<Harness> {
  const h = await open(
    path,
    stub(ADA, { '/api/v1/projects/laika-core/tasks': tasksRoute(reply(201, NEW_TASK)), ...extra }),
  );
  await h.page.setViewportSize({ width: 1440, height: 900 });
  await h.page.locator('.space-create').waitFor({ timeout: 20_000 });
  await h.page.locator('.space-create').click();
  await h.page.locator(DIALOG).waitFor({ timeout: 5_000 });
  await h.page.locator(`${DIALOG} .ct-title-input`).waitFor({ timeout: 5_000 });
  return h;
}

const box = (h: Harness) => h.page.locator(DIALOG);

void describe('a create with a sprint and a blocker', () => {
  void test('one POST with the filled fields and status_id only, then the sprint, then the dependency; the toast opens it', async () => {
    const h = await openDialog('/board?project=laika-core', {
      '/api/v1/sprints/s1/tasks': { tasks: [NEW_TASK] },
      '/api/v1/tasks/t-new/dependencies': { ...NEW_TASK, blocked_by: ['t2'] },
      '/api/v1/tasks/t-new': NEW_TASK,
    });
    try {
      const d = box(h);
      await d.locator('.ct-title-input').fill('Ship the dialog');
      await pick(d.getByLabel('Priority', { exact: true }), 'p1');
      await pick(d.getByLabel('Status', { exact: true }), 'st-todo');
      await pick(d.getByLabel('Assignee', { exact: true }), 'u2');
      await pick(d.getByLabel('Sprint', { exact: true }), 's1');
      await d.getByLabel('Due date', { exact: true }).fill('2026-11-20');
      // Labels: the picker's suggestion for the project's one tag.
      await d.getByRole('button', { name: '+ Add' }).click();
      await d.locator('.tagp-input').fill('ui');
      await d.locator('.tagp-input').press('Enter');
      await d.locator('.tagp-chip', { hasText: 'ui' }).waitFor({ timeout: 5_000 });
      // Under More: blocked by LC-2.
      await d.locator('.ct-more-summary').click();
      await pick(d.getByLabel('Blocked by', { exact: true }), 't2');
      await d.locator('.ct-chip', { hasText: 'LC-2' }).waitFor({ timeout: 5_000 });

      await d.getByRole('button', { name: 'Create', exact: true }).click();
      await d.waitFor({ state: 'detached', timeout: 10_000 });

      const created = posts(h, '/projects/laika-core/tasks');
      assert.equal(created.length, 1, 'one create');
      assert.deepEqual(created[0]?.body, {
        title: 'Ship the dialog',
        created_via: 'web',
        priority: 'p1',
        status_id: 'st-todo',
        assignee_id: 'u2',
        due_on: Date.UTC(2026, 10, 20),
        tags: ['ui'],
      });
      const sprint = posts(h, '/sprints/s1/tasks');
      assert.deepEqual(
        sprint.map((c) => c.body),
        [{ task_ids: ['t-new'] }],
      );
      const deps = posts(h, '/tasks/t-new/dependencies');
      assert.deepEqual(
        deps.map((c) => c.body),
        [{ blocked_by_task_id: 't2' }],
      );
      // In that order: the task first, then what hangs off it.
      const order = h.calls
        .filter((c) => c.method === 'POST')
        .map((c) => c.path.split('/').slice(-2).join('/'));
      assert.deepEqual(order, ['laika-core/tasks', 's1/tasks', 't-new/dependencies']);
      // And the list was walked again after the POST, which is what draws the card.
      const postAt = h.calls.indexOf(created[0]);
      assert.ok(
        h.calls
          .slice(postAt + 1)
          .some((c) => c.method === 'GET' && c.path.endsWith('/projects/laika-core/tasks')),
        'no task-list GET after the create',
      );

      const toast = h.page.locator('[data-created-toast] [role="status"]');
      await toast.waitFor({ timeout: 5_000 });
      assert.match(await toast.innerText(), /^LC-7 created$/);
      await h.page.locator('[data-created-toast]').getByRole('button', { name: 'Open' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('task') === 't-new');
      assert.equal(new URL(h.page.url()).searchParams.get('task'), 't-new');
    } finally {
      await h.close();
    }
  });
});

void describe('a refused create', () => {
  void test('a zod 422 lands under Outside id and Labels; the dialog stays, the title is kept, no toast', async () => {
    const h = await openDialog('/board?project=laika-core', {
      '/api/v1/projects/laika-core/tasks': tasksRoute(
        reply(422, {
          error: {
            code: 'unprocessable',
            message: 'Invalid request body',
            details: {
              issues: [
                {
                  path: 'external_ref',
                  message: 'An outside id is at most 120 characters',
                  code: 'too_big',
                },
                { path: 'tags.0', message: '"has space" is not a valid tag', code: 'custom' },
              ],
            },
          },
        }),
      ),
    });
    try {
      const d = box(h);
      await d.locator('.ct-title-input').fill('Keep me');
      await d.getByRole('button', { name: '+ Add' }).click();
      await d.locator('.tagp-input').fill('ui');
      await d.locator('.tagp-input').press('Enter');
      await d.locator('.ct-more-summary').click();
      await d.getByLabel('Outside id', { exact: true }).fill('JIRA-1');
      await d.getByRole('button', { name: 'Create', exact: true }).click();

      const outside = d.locator('.field', {
        has: h.page.getByLabel('Outside id', { exact: true }),
      });
      await until(async () => (await outside.locator('.field-error').innerText()).trim() !== '');
      assert.match(await outside.locator('.field-error').innerText(), /at most 120 characters/);
      const labels = d.locator('.field', { hasText: 'Labels' });
      assert.match(await labels.locator('.field-error').first().innerText(), /not a valid tag/);
      assert.equal(await outside.getAttribute('class'), 'field field-invalid');

      assert.equal(await d.count(), 1, 'the dialog closed on a refusal');
      assert.equal(await d.locator('.ct-title-input').inputValue(), 'Keep me');
      // Focus is on the first refused control (review round 1): the Outside
      // id input — Labels is a group, and a control comes first.
      assert.equal(
        await d
          .getByLabel('Outside id', { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
        'focus is not on the first refused field',
      );
      assert.equal(await h.page.locator('[data-created-toast]').count(), 0, 'a toast on a refusal');
      assert.equal(posts(h, '/sprints/s1/tasks').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a service 422 naming status_id lands under Status', async () => {
    const h = await openDialog('/board?project=laika-core', {
      '/api/v1/projects/laika-core/tasks': tasksRoute(
        reply(422, {
          error: {
            code: 'unprocessable',
            message: 'No such status in this project',
            details: { field: 'status_id' },
          },
        }),
      ),
    });
    try {
      const d = box(h);
      await d.locator('.ct-title-input').fill('Where?');
      await d.locator('.ct-title-input').press('Enter');
      const status = d.locator('.field', { has: h.page.getByLabel('Status', { exact: true }) });
      await until(async () => (await status.locator('.field-error').innerText()).trim() !== '');
      assert.match(
        await status.locator('.field-error').innerText(),
        /No such status in this project/,
      );
      assert.equal(await d.count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('a step after the create that fails', () => {
  void test('the task exists, so the dialog closes and the toast is an alert: created, but…', async () => {
    const h = await openDialog('/board?project=laika-core', {
      '/api/v1/sprints/s1/tasks': refuse(409, 'conflict', 'Sprint 4 is completed'),
    });
    try {
      const d = box(h);
      await d.locator('.ct-title-input').fill('Ship the dialog');
      await pick(d.getByLabel('Sprint', { exact: true }), 's1');
      await d.getByRole('button', { name: 'Create', exact: true }).click();
      await d.waitFor({ state: 'detached', timeout: 10_000 });

      const alert = h.page.locator('[data-created-toast] [role="alert"]');
      await alert.waitFor({ timeout: 5_000 });
      assert.match(await alert.innerText(), /LC-7 created, but could not add it to Sprint 4/);
      assert.match(await alert.innerText(), /Sprint 4 is completed/);
      assert.equal(
        await h.page.locator('[data-created-toast]').getByRole('button', { name: 'Open' }).count(),
        1,
      );
      // The list was walked again all the same: the task is there to be drawn.
      const created = posts(h, '/projects/laika-core/tasks')[0];
      assert.ok(created !== undefined);
      const postAt = h.calls.indexOf(created);
      assert.ok(
        h.calls
          .slice(postAt + 1)
          .some((c) => c.method === 'GET' && c.path.endsWith('/projects/laika-core/tasks')),
        'no task-list GET after the create',
      );
      // An alert stays until closed.
      await new Promise((r) => setTimeout(r, 1_000));
      assert.equal(await alert.count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('the link popover inside the dialog', () => {
  /*
   * **Not a form inside the form** (review round 1, measured): Apply used to
   * submit the page as a GET — a reload, the draft gone — and Enter in the
   * address was read by the dialog as its own submit. Both ways of applying
   * a link now leave the dialog open with the title kept and no navigation,
   * and the link reaches the create body.
   */
  for (const via of ['Enter', 'Apply'] as const) {
    void test(`a link applied via ${via} stays in the description; nothing navigates`, async () => {
      const h = await openDialog();
      try {
        let navigations = 0;
        h.page.on('framenavigated', (frame) => {
          if (frame === h.page.mainFrame()) navigations += 1;
        });
        const d = box(h);
        await d.locator('.ct-title-input').fill('Keep me');
        const doc = d.locator('[data-ct-editor="description"] .rich-editor-doc');
        await doc.waitFor({ timeout: 10_000 });
        await doc.click();
        await h.page.keyboard.type('see docs');
        await h.page.keyboard.press('ControlOrMeta+a');
        await d.getByRole('button', { name: 'Link', exact: true }).click();
        const address = d.getByLabel('Link address');
        await address.fill('https://example.com');
        if (via === 'Enter') await address.press('Enter');
        else await d.getByRole('button', { name: 'Apply' }).click();
        await address.waitFor({ state: 'detached', timeout: 5_000 });

        assert.equal(await d.count(), 1, 'the dialog closed');
        assert.equal(await d.locator('.ct-title-input').inputValue(), 'Keep me');
        assert.equal(navigations, 0, 'the page navigated');
        assert.equal(
          posts(h, '/projects/laika-core/tasks').length,
          0,
          'applying a link created the task',
        );
        assert.equal(await doc.locator('a[href="https://example.com"]').count(), 1);

        await d.getByRole('button', { name: 'Create', exact: true }).click();
        await d.waitFor({ state: 'detached', timeout: 10_000 });
        const body = posts(h, '/projects/laika-core/tasks')[0]?.body as { description_md?: string };
        assert.match(body.description_md ?? '', /\[see docs\]\(https:\/\/example\.com\/?\)/);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('Create another', () => {
  void test('the dialog stays with status, priority, sprint and assignee kept, the rest cleared, focus on the Title; the next create carries the kept four', async () => {
    const h = await openDialog('/board?project=laika-core', {
      '/api/v1/sprints/s1/tasks': { tasks: [NEW_TASK] },
    });
    try {
      const d = box(h);
      await d.locator('.ct-title-input').fill('First');
      // Enter on the Create another box toggles nothing and sends nothing (review).
      await d.getByLabel('Create another', { exact: true }).focus();
      await h.page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        posts(h, '/projects/laika-core/tasks').length,
        0,
        'Enter on the checkbox submitted',
      );
      assert.equal(await d.getByLabel('Create another', { exact: true }).isChecked(), false);
      await pick(d.getByLabel('Priority', { exact: true }), 'p1');
      await pick(d.getByLabel('Status', { exact: true }), 'st-in_progress');
      await pick(d.getByLabel('Assignee', { exact: true }), 'u2');
      await pick(d.getByLabel('Sprint', { exact: true }), 's1');
      await d.getByLabel('Due date', { exact: true }).fill('2026-11-20');
      await d.locator('.ct-more-summary').click();
      await d.getByLabel('Outside id', { exact: true }).fill('JIRA-1');
      await d.getByLabel('Create another', { exact: true }).check();
      await d.getByRole('button', { name: 'Create', exact: true }).click();

      await until(() => posts(h, '/projects/laika-core/tasks').length === 1);
      await until(async () => (await d.locator('.ct-title-input').inputValue()) === '');
      assert.equal(await d.count(), 1, 'the dialog closed');
      assert.equal(await d.locator('.ct-title-input').inputValue(), '');
      assert.equal(await d.getByLabel('Due date', { exact: true }).inputValue(), '');
      assert.equal(await d.getByLabel('Outside id', { exact: true }).inputValue(), '');
      assert.equal(
        await d.getByLabel('Priority', { exact: true }).getAttribute('data-value'),
        'p1',
      );
      assert.equal(
        await d.getByLabel('Status', { exact: true }).getAttribute('data-value'),
        'st-in_progress',
      );
      assert.equal(
        await d.getByLabel('Assignee', { exact: true }).getAttribute('data-value'),
        'u2',
      );
      assert.equal(await d.getByLabel('Sprint', { exact: true }).getAttribute('data-value'), 's1');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.classList.contains('ct-title-input')),
        true,
        'focus is not back on the Title',
      );
      await h.page.locator('[data-created-toast] [role="status"]').waitFor({ timeout: 5_000 });

      await d.locator('.ct-title-input').fill('Second');
      await d.locator('.ct-title-input').press('Enter');
      await until(() => posts(h, '/projects/laika-core/tasks').length === 2);
      // The sprint call follows the create; wait for it rather than read early.
      await until(() => posts(h, '/sprints/s1/tasks').length === 2);
      assert.deepEqual(posts(h, '/projects/laika-core/tasks')[1]?.body, {
        title: 'Second',
        created_via: 'web',
        priority: 'p1',
        status_id: 'st-in_progress',
        assignee_id: 'u2',
      });
      assert.equal(
        posts(h, '/sprints/s1/tasks').length,
        2,
        'the kept sprint was not set on the second',
      );
    } finally {
      await h.close();
    }
  });
});
