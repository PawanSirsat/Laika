/**
 * The client's types must not fall behind the server's (LAI-213).
 *
 * ## Why this exists
 *
 * **Six times now the server has sent a field the client could not see**, and
 * every one was found by accident while building something else:
 *
 * | field | served since | found while doing |
 * | --- | --- | --- |
 * | `Task.sprint_id` | LAI-011 | LAI-089 |
 * | `TaskFilter.sprint` | LAI-011 | LAI-089 |
 * | `Project.repo` | LAI-108 | LAI-076 |
 * | `Project.task_counts` + 4 more | LAI-053 | LAI-046 |
 * | `Task.tags` | LAI-079 | LAI-066 |
 * | `Task.comment_count` | LAI-072 | LAI-066 |
 *
 * **Nothing failed in any of them.** No error, no test, no type complaint — the
 * data arrived and was invisible, which looks exactly like the feature not
 * existing. That is the worst shape of defect available: it is indistinguishable
 * from "not built yet", so nobody investigates.
 *
 * The existing drift checks do not cover this. LAI-051 and LAI-080 compare
 * SPEC §4 to `schema.ts`; LAI-211 pins one function's contract. Nothing compared
 * the server's **view types** to the client's **declarations** until now.
 *
 * ## Where it lives, and why
 *
 * In `web/test/`, reading `server/src/services/`. That is the consumer guarding
 * its own dependency — D-030's rule, which CLAUDE.md keeps past its original
 * example: *a cross-ownership dependency is allowed, an unguarded one is not.*
 * The web client depends on shapes Builder-A owns under D-016, so the guard
 * belongs with the side that breaks.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { fieldsOf } from '../helpers/interfaces.ts';

interface Pair {
  /** The server's view type, and the module that declares it. */
  readonly server: string;
  readonly serverFile: string;
  /** The client's interface, and its module. Names differ where they differ. */
  readonly client: string;
  readonly clientFile: string;
  /**
   * Fields the client deliberately does not declare, each with a reason.
   *
   * The same shape as `WEB_NO_MIRROR_REQUIRED` in `structure.test.ts`, and for
   * the same reason: **a deliberate omission is fine, a silent one is not.**
   * A list to keep short — an entry here is a field the UI cannot use.
   */
  readonly clientOmits?: Readonly<Record<string, string>>;
}

const PAIRS: readonly Pair[] = [
  {
    server: 'TaskView',
    serverFile: 'services/tasks.ts',
    client: 'Task',
    clientFile: 'tasks.ts',
  },
  {
    // `ProjectSummary extends ProjectView` — the list endpoint serves the
    // derived shape, which is what the client mirrors.
    server: 'ProjectSummary',
    serverFile: 'services/projects.ts',
    client: 'Project',
    clientFile: 'projects.ts',
  },
  {
    server: 'SprintView',
    serverFile: 'services/sprints.ts',
    client: 'Sprint',
    clientFile: 'sprints.ts',
  },
  {
    server: 'MemberView',
    serverFile: 'services/projects.ts',
    client: 'Member',
    clientFile: 'tasks.ts',
  },
  {
    server: 'UserView',
    serverFile: 'services/users.ts',
    client: 'OrgUser',
    clientFile: 'users.ts',
  },
  {
    server: 'CommentView',
    serverFile: 'services/comments.ts',
    client: 'Comment',
    clientFile: 'comments.ts',
  },
  {
    server: 'EventView',
    serverFile: 'services/events.ts',
    client: 'ActivityEvent',
    clientFile: 'activity.ts',
  },
];

const SERVER = new URL('../../../src/', import.meta.url);
const CLIENT = new URL('../../src/api/', import.meta.url);

const sources = new Map<string, string>();
const read = async (base: URL, rel: string): Promise<string> => {
  const path = fileURLToPath(new URL(rel, base));
  const cached = sources.get(path);
  if (cached !== undefined) return cached;
  const text = await readFile(path, 'utf8');
  sources.set(path, text);
  return text;
};

interface Resolved {
  readonly pair: Pair;
  readonly serverFields: readonly string[];
  readonly clientFields: readonly string[];
}

let resolved: Resolved[] = [];

before(async () => {
  resolved = [];
  for (const pair of PAIRS) {
    const serverSource = await read(SERVER, pair.serverFile);
    const clientSource = await read(CLIENT, pair.clientFile);

    const serverFields = fieldsOf(serverSource, pair.server);
    const clientFields = fieldsOf(clientSource, pair.client);

    // A rename must fail loudly. Comparing an empty set would pass silently and
    // leave the pair unguarded for ever, which is the failure this whole file
    // exists to prevent.
    assert.ok(serverFields, `${pair.server} not found in src/${pair.serverFile}`);
    assert.ok(clientFields, `${pair.client} not found in web/src/api/${pair.clientFile}`);

    resolved.push({ pair, serverFields, clientFields });
  }
});

void describe('every server field is visible to the client', () => {
  void test('the guard has pairs to check', () => {
    // Without this the suite passes by finding nothing — the same way
    // `not-in-bundle.test.ts` went quiet when its needles stopped matching.
    assert.equal(resolved.length, PAIRS.length);
    assert.ok(PAIRS.length >= 7, 'the pair list has shrunk');
  });

  void test('no server field is missing from its client type', () => {
    const problems: string[] = [];

    for (const { pair, serverFields, clientFields } of resolved) {
      for (const field of serverFields) {
        if (clientFields.includes(field)) continue;
        const reason = pair.clientOmits?.[field];
        if (reason !== undefined) continue;
        problems.push(
          `${pair.server}.${field} is served and ${pair.client} does not declare it ` +
            `— add it, or list it in clientOmits with a reason`,
        );
      }
    }

    assert.deepEqual(problems, [], problems.join('\n'));
  });

  void test('the client declares nothing the server does not send', () => {
    // The other direction, and it fails later and worse: a field the server
    // never sends is `undefined` at runtime, on a type that promised it was
    // there. TypeScript cannot catch it — the shape is asserted, not checked.
    const problems: string[] = [];

    for (const { pair, serverFields, clientFields } of resolved) {
      for (const field of clientFields) {
        if (serverFields.includes(field)) continue;
        problems.push(
          `${pair.client}.${field} is declared and ${pair.server} does not send it ` +
            `— it will be undefined at runtime`,
        );
      }
    }

    assert.deepEqual(problems, [], problems.join('\n'));
  });

  void test('every omission carries a reason, and names a real field', () => {
    // An exemption for a field that no longer exists is a stale note that will
    // hide the next real drift on the same name.
    for (const { pair, serverFields } of resolved) {
      for (const [field, reason] of Object.entries(pair.clientOmits ?? {})) {
        assert.ok(reason.length > 10, `${pair.client}.${field} is omitted without a real reason`);
        assert.ok(
          serverFields.includes(field),
          `${pair.client} omits ${field}, which ${pair.server} does not have — stale exemption`,
        );
      }
    }
  });
});
