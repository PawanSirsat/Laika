/**
 * One board column is one project status (LAI-739).
 *
 * The owner's Option B, 2026-10-12: real custom statuses, Jira team-managed
 * style. What replaced LAI-266's multi-status columns is a handful of plain
 * operations on a column — rename in place, add one with a kind, hide and
 * show, delete with somewhere for the work to go — and a drop that sets the
 * column's status. Each is asserted **on the wire** (the request the board
 * sends) and **on the screen** (what the reader sees after), because either
 * alone has been green on broken code in this repo before.
 *
 * The stub is stateful — a write changes what the next read returns, and
 * every status write answers with the whole list, as LAI-738's server does —
 * so an optimistic guess that the answer then contradicts would show here.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  fakeStream,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const FULL_PROJECT = {
  ...PROJECT,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 1, review: 1, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

interface Status {
  id: string;
  project_id: string;
  name: string;
  category: string;
  position: number;
  hidden: boolean;
  created_at: number;
  task_count: number;
}

function status(id: string, name: string, category: string, position: number, hidden = false) {
  return { id, project_id: 'p1', name, category, position, hidden, created_at: 1, task_count: 0 };
}

function task(id: string, number: number, title: string, s: Status) {
  return {
    id,
    key: `LAI-${String(number)}`,
    project_id: 'p1',
    number,
    title,
    description_md: null,
    acceptance_md: null,
    status: s.category,
    status_id: s.id,
    status_name: s.name,
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    ready: false,
    blocked_by: [],
    blocks: [],
    tags: [],
    comment_count: 0,
    branch: null,
    external_ref: null,
    started_at: null,
    completed_at: null,
    stale_flagged_at: null,
    position: `a${String(number)}`,
    created_at: 1,
    updated_at: 1,
  };
}

/** A project with two review columns, one of them empty, and Cancelled hidden. */
function world(over: Partial<ApiStub> = {}) {
  const statuses: Status[] = [
    status('s-todo', 'To do', 'todo', 0),
    status('s-doing', 'In progress', 'in_progress', 1),
    status('s-qa', 'QA', 'review', 2),
    status('s-cr', 'Code review', 'review', 3),
    status('s-done', 'Done', 'done', 4),
    status('s-cancel', 'Cancelled', 'cancelled', 5, true),
  ];
  const tasks = [
    task('t1', 1, 'Write the guide', statuses[0]!),
    task('t2', 2, 'Wire the stream', statuses[1]!),
    task('t3', 3, 'Check the dialog', statuses[2]!),
  ];
  const list = () => ({
    data: statuses
      .map((s) => ({ ...s, task_count: tasks.filter((t) => t.status_id === s.id).length }))
      .sort((a, b) => a.position - b.position),
  });
  const renumber = () => {
    statuses.sort((a, b) => a.position - b.position).forEach((s, i) => (s.position = i));
  };

  const one = (id: string) => (call: { method: string; body: unknown }) => {
    const found = statuses.find((s) => s.id === id);
    if (found === undefined) return refuse(404, 'not_found', 'No such status');
    if (call.method === 'PATCH') {
      Object.assign(found, call.body as Partial<Status>);
      return list();
    }
    // DELETE
    const moveTo = (call.body as { move_to: string }).move_to;
    const target = statuses.find((s) => s.id === moveTo);
    let moved = 0;
    for (const t of tasks) {
      if (t.status_id !== id || target === undefined) continue;
      Object.assign(t, { status_id: target.id, status_name: target.name, status: target.category });
      moved += 1;
    }
    statuses.splice(statuses.indexOf(found), 1);
    renumber();
    return { ...list(), moved };
  };

  const stub: ApiStub = {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': { data: [FULL_PROJECT], next_cursor: null },
    '/api/v1/projects/laika-core': FULL_PROJECT,
    '/api/v1/projects/laika-core/statuses': (call: { method: string; body: unknown }) => {
      if (call.method !== 'POST') return list();
      const body = call.body as { name: string; category: string };
      // Right after the last status of its kind, as the server places it.
      const last = statuses
        .filter((s) => s.category === body.category)
        .reduce((at, s) => Math.max(at, s.position), -1);
      for (const s of statuses) if (s.position > last) s.position += 1;
      statuses.push(status('s-new', body.name, body.category, last + 1));
      return reply(201, list());
    },
    ...Object.fromEntries(
      statuses.map((s) => [`/api/v1/projects/laika-core/statuses/${s.id}`, one(s.id)]),
    ),
    '/api/v1/projects/laika-core/tasks': () => ({ data: tasks, next_cursor: null }),
    '/api/v1/tasks/t1/status': (call: { body: unknown }) => {
      const to = statuses.find((s) => s.id === (call.body as { status_id: string }).status_id);
      if (to === undefined) return refuse(422, 'unprocessable', 'No such status');
      Object.assign(tasks[0]!, { status_id: to.id, status_name: to.name, status: to.category });
      return tasks[0];
    },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/presence': { data: [], next_cursor: null },
    ...over,
  };
  return { stub, statuses, tasks };
}

async function board(h: Harness): Promise<void> {
  await h.page.waitForSelector('.lane-title');
}

async function titles(h: Harness): Promise<string[]> {
  return h.page.locator('.lane-title').allTextContents();
}

function lane(h: Harness, name: string) {
  return h.page.locator('.lane', {
    has: h.page.locator('.lane-title', { hasText: new RegExp(`^${name}$`) }),
  });
}

function sent(h: Harness, method: string, suffix: string) {
  return h.calls.filter((c) => c.method === method && c.path.endsWith(suffix));
}

const sameList = async (h: Harness, want: readonly string[]): Promise<boolean> =>
  JSON.stringify(await titles(h)) === JSON.stringify(want);

async function columnMenu(h: Harness, name: string, item: string): Promise<void> {
  await h.page.getByRole('button', { name: `Column menu for ${name}` }).click();
  await h.page.getByRole('menuitem', { name: item }).click();
}

/** A real HTML5 drag between two elements, sharing one `DataTransfer`. */
async function drag(h: Harness, from: string, to: string): Promise<void> {
  await h.page.evaluate(
    ([fromSelector, toSelector]) => {
      const source = document.querySelector(fromSelector);
      const target = document.querySelector(toSelector);
      if (source === null || target === null) throw new Error('drag endpoints not found');
      const transfer = new DataTransfer();
      const fire = (node: Element, type: string): void => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        node.dispatchEvent(event);
      };
      fire(source, 'dragstart');
      fire(target, 'dragover');
      fire(target, 'drop');
      fire(source, 'dragend');
    },
    [from, to] as const,
  );
}

after(async () => {
  await closeBrowser();
});

void describe('the columns are the project’s statuses', () => {
  void test('every visible status is a column, in order — an empty one included', async () => {
    // Code review has no tasks. LAI-617 hid a column with nothing to own;
    // nothing hides a column now but the reader.
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      assert.deepEqual(await titles(h), ['To do', 'In progress', 'QA', 'Code review', 'Done']);
      assert.equal(await lane(h, 'Code review').locator('.card').count(), 0);
      assert.match(await lane(h, 'Code review').innerText(), /Nothing waiting on review/);
    } finally {
      await h.close();
    }
  });
});

void describe('renaming a column in place', () => {
  void test('Enter saves the name, and the header shows it at once', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await lane(h, 'QA').locator('.lane-title-editable').click();
      const input = h.page.locator('.lane-rename-input');
      await input.fill('Testing');
      await input.press('Enter');
      await until(
        async () =>
          sent(h, 'PATCH', '/statuses/s-qa').length > 0 && (await titles(h)).includes('Testing'),
      );

      const patch = sent(h, 'PATCH', '/statuses/s-qa');
      assert.equal(patch.length, 1, 'no rename was sent');
      assert.deepEqual(patch[0]?.body, { name: 'Testing' });
      assert.ok((await titles(h)).includes('Testing'), 'the header kept its old name');
      assert.equal(await h.page.locator('.lane-rename-input').count(), 0, 'the field stayed open');
    } finally {
      await h.close();
    }
  });

  void test('Escape cancels, and nothing is sent', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await lane(h, 'Done').locator('.lane-title-editable').click();
      await h.page.locator('.lane-rename-input').fill('Shipped');
      await h.page.locator('.lane-rename-input').press('Escape');
      await h.page.waitForTimeout(150);

      assert.equal(sent(h, 'PATCH', '/statuses/s-done').length, 0);
      assert.ok((await titles(h)).includes('Done'));
    } finally {
      await h.close();
    }
  });

  void test('a refusal is said under the header, with what was typed kept', async () => {
    const h = await open(
      '/board?project=laika-core',
      world({
        '/api/v1/projects/laika-core/statuses/s-done': refuse(
          422,
          'unprocessable',
          'This project already has a status called To do',
        ),
      }).stub,
    );
    try {
      await board(h);
      await lane(h, 'Done').locator('.lane-title-editable').click();
      await h.page.locator('.lane-rename-input').fill('To do');
      await h.page.locator('.lane-rename-input').press('Enter');

      // The header is the field again, so the lane is found by its error.
      const error = h.page.locator('.lane-rename-error');
      await error.waitFor({ state: 'visible', timeout: 3000 });
      assert.match(await error.innerText(), /already has a status called To do/);
      assert.equal(await h.page.locator('.lane-rename-input').inputValue(), 'To do');
      // Not in the board's alert bar as well: one place, beside the column.
      assert.equal(await h.page.locator('.board-alert').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('adding a column', () => {
  void test('asks a name and what kind of work it is, in plain words, then makes it', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Add column' });
      await dialog.waitFor();

      const words = await dialog.innerText();
      assert.match(words, /What kind of work is this\?/i);
      assert.match(words, /waiting for a person to check/i);
      assert.doesNotMatch(words, /status|category/i, 'jargon on the add-column form');

      await dialog.getByLabel('Name').fill('Blocked');
      await dialog.getByRole('radio', { name: /^In progress/ }).check();
      await dialog.getByRole('button', { name: 'Add column' }).click();
      await until(
        async () =>
          sent(h, 'POST', '/projects/laika-core/statuses').length > 0 &&
          (await dialog.count()) === 0 &&
          (await titles(h)).includes('Blocked'),
      );

      const post = sent(h, 'POST', '/projects/laika-core/statuses');
      assert.equal(post.length, 1);
      assert.deepEqual(post[0]?.body, { name: 'Blocked', category: 'in_progress' });
      assert.equal(await dialog.count(), 0, 'the dialog stayed open');
      // Where the server put it: after the last column of its kind.
      assert.deepEqual(await titles(h), [
        'To do',
        'In progress',
        'Blocked',
        'QA',
        'Code review',
        'Done',
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('hiding a column and showing it again', () => {
  void test('Hide takes it off the board; Hidden columns brings it back', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Hide column');
      await until(
        async () =>
          sent(h, 'PATCH', '/statuses/s-qa').length > 0 && !(await titles(h)).includes('QA'),
      );

      assert.deepEqual(sent(h, 'PATCH', '/statuses/s-qa')[0]?.body, { hidden: true });
      assert.ok(!(await titles(h)).includes('QA'), 'the hidden column is still drawn');

      await h.page.getByRole('button', { name: 'More actions' }).click();
      // Cancelled was hidden already: two.
      await h.page.getByRole('menuitem', { name: 'Hidden columns (2)' }).click();
      const dialog = h.page.getByRole('dialog', { name: /Hidden columns/ });
      await dialog.getByRole('button', { name: 'Show QA' }).click();
      await until(
        async () =>
          sent(h, 'PATCH', '/statuses/s-qa').length > 1 &&
          (await sameList(h, ['To do', 'In progress', 'QA', 'Code review', 'Done'])),
      );

      assert.deepEqual(sent(h, 'PATCH', '/statuses/s-qa')[1]?.body, { hidden: false });
      assert.deepEqual(await titles(h), ['To do', 'In progress', 'QA', 'Code review', 'Done']);
    } finally {
      await h.close();
    }
  });
});

void describe('deleting a column', () => {
  void test('asks where its tasks go, then moves them and removes the column', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Delete column');
      const dialog = h.page.getByRole('dialog', { name: 'Delete “QA”?' });
      await dialog.waitFor();

      const words = await dialog.innerText();
      assert.match(words, /Move its 1 task to/i);
      // Another column of the same kind first, and the consequence said.
      assert.match(words, /Its 1 task moves to “Code review”/);
      assert.match(words, /No task is deleted/);

      await dialog.getByRole('button', { name: 'Delete column' }).click();
      await until(
        async () =>
          sent(h, 'DELETE', '/statuses/s-qa').length > 0 &&
          (await sameList(h, ['To do', 'In progress', 'Code review', 'Done'])),
      );

      const del = sent(h, 'DELETE', '/statuses/s-qa');
      assert.equal(del.length, 1);
      assert.deepEqual(del[0]?.body, { move_to: 's-cr' });
      assert.deepEqual(await titles(h), ['To do', 'In progress', 'Code review', 'Done']);
      // The task re-read from the server, in its new column.
      await lane(h, 'Code review').locator('.card', { hasText: 'Check the dialog' }).waitFor();
    } finally {
      await h.close();
    }
  });

  void test('the last column of its kind cannot go, and the dialog says why', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'In progress', 'Delete column');
      const dialog = h.page.getByRole('dialog', { name: 'Delete “In progress”?' });
      await dialog.waitFor();

      assert.match(
        await dialog.getByTestId('delete-blocked').innerText(),
        /only In progress column\. Add another In progress column first/,
      );
      assert.equal(await dialog.getByRole('button', { name: 'Delete column' }).isDisabled(), true);
      assert.equal(sent(h, 'DELETE', '/statuses/s-doing').length, 0);
    } finally {
      await h.close();
    }
  });
});

void describe('dropping a card on a column', () => {
  void test('sets that column’s status, before the server answers', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await board(h);
      await h.page.route('**/api/v1/tasks/t1/status', async (route) => {
        await held;
        await route.continue();
      });

      // Into the *empty* review column — the second of its kind, which a drop
      // that sent the kind would never reach.
      await drag(h, '.lane-item[data-task-id="t1"] .card', '.lane:nth-of-type(4)');
      await until(
        async () =>
          (await lane(h, 'Code review').locator('.lane-item[data-task-id="t1"]').count()) === 1,
      );
      assert.equal(
        await lane(h, 'Code review').locator('.lane-item[data-task-id="t1"]').count(),
        1,
        'the card waited for the server',
      );

      release();
      await until(() => sent(h, 'POST', '/tasks/t1/status').length > 0);
      // And a beat more, so an answer that undid the move would be on screen.
      await h.page.waitForTimeout(300);
      const move = sent(h, 'POST', '/tasks/t1/status');
      assert.equal(move.length, 1);
      assert.deepEqual(move[0]?.body, { status_id: 's-cr' });
      assert.equal(
        await lane(h, 'Code review').locator('.lane-item[data-task-id="t1"]').count(),
        1,
      );
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a refusal puts the card back and says why', async () => {
    const h = await open(
      '/board?project=laika-core',
      world({
        '/api/v1/tasks/t1/status': refuse(
          422,
          'unprocessable',
          'Cannot move a task from todo to done without review',
        ),
      }).stub,
    );
    try {
      await board(h);
      await drag(h, '.lane-item[data-task-id="t1"] .card', '.lane:nth-of-type(5)');
      await until(
        async () =>
          (await h.page.locator('.board-alert').count()) > 0 &&
          (await lane(h, 'To do').locator('.lane-item[data-task-id="t1"]').count()) === 1,
      );

      assert.equal(await lane(h, 'To do').locator('.lane-item[data-task-id="t1"]').count(), 1);
      assert.equal(await lane(h, 'Done').locator('.lane-item[data-task-id="t1"]').count(), 0);
      assert.match(
        await h.page.locator('.board-alert').first().innerText(),
        /without review/,
        'the server’s own sentence',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes (CLAUDE.md §5.1)', () => {
  void test('the column dialogs draw on the card surface, readable, in light and dark', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      const seen: Record<string, { bg: string; fg: string; card: string; hint: string }> = {};
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        await h.page.locator('.lane-new').click();
        const dialog = h.page.getByRole('dialog', { name: 'Add column' });
        await dialog.waitFor();
        seen[theme] = await dialog.evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--bg-card)';
          document.body.append(probe);
          const card = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const hint = el.querySelector('.cd-kind-hint');
          return {
            bg: getComputedStyle(el).backgroundColor,
            fg: getComputedStyle(el.querySelector('.cd-kind-label')!).color,
            card,
            hint: hint === null ? 'missing' : getComputedStyle(hint).color,
          };
        });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
      for (const [theme, s] of Object.entries(seen)) {
        assert.equal(s.bg, s.card, `${theme}: the dialog is not on the card surface`);
        assert.notEqual(s.fg, s.bg, `${theme}: the labels vanish into the dialog`);
        assert.notEqual(s.hint, s.bg, `${theme}: the descriptions vanish into the dialog`);
      }
      assert.notEqual(seen.light?.bg, seen.dark?.bg, 'the dialog did not follow the theme');
    } finally {
      await h.close();
    }
  });
});

/* ----------------------------------------------- review round 1 (LAI-739) */

/** What holds focus: its accessible name, and whether it sits in a dialog. */
async function focused(h: Harness): Promise<{ name: string; role: string; inDialog: boolean }> {
  return h.page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      name: (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim(),
      role: el?.getAttribute('role') ?? el?.tagName.toLowerCase() ?? '',
      inDialog:
        el?.closest('[role="dialog"]') !== null && el?.closest('[role="dialog"]') !== undefined,
    };
  });
}

void describe('focus in the column dialogs (review round 1)', () => {
  void test('Delete opens on its picker, keeps Tab inside, and gives focus back to the ⋯', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Delete column');
      await h.page.getByRole('dialog', { name: 'Delete “QA”?' }).waitFor();
      await until(async () => (await focused(h)).role === 'combobox');

      const first = await focused(h);
      assert.equal(first.role, 'combobox', `focus opened on ${JSON.stringify(first)}`);
      assert.equal(first.inDialog, true);

      for (let i = 0; i < 6; i += 1) {
        await h.page.keyboard.press(i % 2 === 0 ? 'Tab' : 'Shift+Tab');
        await h.page.keyboard.press('Tab');
        assert.equal((await focused(h)).inDialog, true, 'Tab left the dialog');
      }

      await h.page.keyboard.press('Escape');
      await h.page.getByRole('dialog').waitFor({ state: 'detached' });
      await until(async () => (await focused(h)).name === 'Column menu for QA');
      assert.equal((await focused(h)).name, 'Column menu for QA');
    } finally {
      await h.close();
    }
  });

  void test('a Delete that cannot happen opens on Cancel', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'In progress', 'Delete column');
      await h.page.getByRole('dialog', { name: 'Delete “In progress”?' }).waitFor();
      await until(async () => (await focused(h)).name === 'Cancel');
      assert.equal((await focused(h)).name, 'Cancel');
    } finally {
      await h.close();
    }
  });

  void test('Hidden columns is on the toolbar, opens on its first Show, and gives focus back', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      // Visible on the toolbar, not only in the ⋯ menu: Cancelled starts hidden.
      const entry = h.page.getByRole('button', { name: 'Hidden columns (1)' });
      await entry.click();
      await h.page.getByRole('dialog', { name: /Hidden columns/ }).waitFor();
      await until(async () => (await focused(h)).name === 'Show Cancelled');
      assert.equal((await focused(h)).name, 'Show Cancelled');

      await h.page.keyboard.press('Tab');
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.press('Tab');
      assert.equal((await focused(h)).inDialog, true, 'Tab left the dialog');

      await h.page.keyboard.press('Escape');
      await h.page.getByRole('dialog').waitFor({ state: 'detached' });
      await until(async () => (await focused(h)).name === 'Hidden columns (1)');
      assert.equal((await focused(h)).name, 'Hidden columns (1)');
    } finally {
      await h.close();
    }
  });

  void test('hiding a column moves focus to the next column’s header', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Hide column');
      await until(async () => (await focused(h)).name === 'Code review');
      assert.equal((await focused(h)).name, 'Code review', 'focus was left on nothing');
    } finally {
      await h.close();
    }
  });
});

void describe('hiding and deleting, said plainly (review round 1)', () => {
  void test('the last column on the board cannot be hidden, and the menu says why', async () => {
    const w = world();
    for (const s of w.statuses) s.hidden = s.id !== 's-todo';
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await board(h);
      await h.page.getByRole('button', { name: 'Column menu for To do' }).click();
      const hide = h.page.getByRole('menuitem', { name: /Hide column/ });
      assert.equal(await hide.isDisabled(), true, 'the last column could be hidden');
      assert.match(await hide.innerText(), /last column on the board/i);
      assert.equal(sent(h, 'PATCH', '/statuses/s-todo').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a hidden column names its kind only when its name does not already', async () => {
    const h = await open('/board?project=laika-core', world().stub);
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Hide column');
      await h.page.waitForTimeout(200);
      await h.page.getByRole('button', { name: 'Hidden columns (2)' }).click();
      const dialog = h.page.getByRole('dialog', { name: /Hidden columns/ });
      await dialog.waitFor();
      const rows = await dialog.locator('.cd-hidden-row .cd-kind-hint').allInnerTexts();
      // QA is a review column; Cancelled is called what it is.
      assert.deepEqual(rows, ['In review · 1 task', '0 tasks']);
    } finally {
      await h.close();
    }
  });

  void test('if the column picked to take the work disappears, Delete says so and picks another', async () => {
    const w = world();
    // A third review column, so QA can still be deleted once Code review goes.
    w.statuses.push(status('s-uat', 'UAT', 'review', 6));
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    try {
      await board(h);
      await columnMenu(h, 'QA', 'Delete column');
      const dialog = h.page.getByRole('dialog', { name: 'Delete “QA”?' });
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /moves to “Code review”/);

      // Someone else deletes Code review; the frame re-reads the statuses.
      w.statuses.splice(
        w.statuses.findIndex((s) => s.id === 's-cr'),
        1,
      );
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (t: string, d: unknown, id: string) => void };
          }
        ).__laikaStream.emit('project.updated', { entity: 'project_status' }, '9');
      });
      await dialog.getByText(/“Code review” is no longer on this board/).waitFor({ timeout: 5000 });

      await dialog.getByRole('button', { name: 'Delete column' }).click();
      await until(() => sent(h, 'DELETE', '/statuses/s-qa').length > 0);
      const del = sent(h, 'DELETE', '/statuses/s-qa');
      assert.equal(del.length, 1);
      // The default again: the other review column that is left.
      assert.equal((del[0]?.body as { move_to: string }).move_to, 's-uat');
    } finally {
      await h.close();
    }
  });
});

void describe('a drag inside one column (review round 1)', () => {
  void test('between swimlanes is not a status change', async () => {
    const w = world();
    // Ada's row and the Unassigned row both have a To do column.
    w.tasks[1]!.assignee_id = 'u1' as never;
    const h = await open('/board?project=laika-core&group=assignee', w.stub);
    try {
      await h.page.waitForSelector('.swim');
      await drag(
        h,
        '.lane-item[data-task-id="t1"] .card',
        '.swim:nth-of-type(1) .lane:nth-of-type(1)',
      );
      await h.page.waitForTimeout(300);
      assert.equal(sent(h, 'POST', '/tasks/t1/status').length, 0, 'a same-column drop sent a move');
      assert.equal(await h.page.locator('.board-alert').count(), 0);
    } finally {
      await h.close();
    }
  });
});
