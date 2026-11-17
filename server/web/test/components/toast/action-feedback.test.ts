/**
 * Every action says how it went (LAI-1310).
 *
 * The owner: *"add proper toast message for each and every action carried
 * out"*. The audit found ~270 mutation call sites and ten that used the
 * shared toast; the rest ended in an inline banner, a `SaveStatus`, a private
 * toast, or nothing at all. This guard holds the line the migration draws:
 * **a screen or component that can change something on the server reports
 * through `useAction`, `useToast` or `useSaveStatus`**, or is on the
 * allow-list below with the reason it does not.
 *
 * How "can change something" is read, statically:
 *
 * 1. **Mutating api functions** are parsed out of `src/api/*.ts`: a top-level
 *    function whose body sends `method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'`,
 *    or calls another one in the same module (a wrapper, a private helper).
 *    A floor on the count stops a broken parser passing by finding nothing.
 * 2. **Mutating hooks** — hooks whose callers write through them without
 *    importing an api function themselves — are listed by hand in
 *    {@link MUTATING_HOOKS}. Each entry is checked to really import a
 *    mutating function, so the list cannot keep a hook that stopped writing.
 * 3. A file under `routes/screens/` or `components/` that imports either is
 *    a mutating file, and must reference one of {@link FEEDBACK}.
 *
 * {@link ALLOWED_WITHOUT_TOAST} is **exact**: a file missing from it fails,
 * and so does an entry whose file now passes or no longer mutates — the same
 * shape as `test/components/forms/raw-controls.test.ts`. Migrating a file
 * means deleting its entry here, or this goes red.
 *
 * Comments are stripped first (`helpers/code.ts`), so prose naming a hook is
 * not mistaken for a call.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, type TestContext } from 'node:test';
import { code } from '../../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const API = join(SRC, 'api');

/** The three ways a file may say what happened. */
const FEEDBACK = /\b(?:useAction|useToast|useSaveStatus)\(/;

/** Fewer than this many mutating api functions means the parser broke, not the app. */
const MIN_MUTATING = 100;

/**
 * Hooks a screen writes through without importing the api function itself.
 * Found by listing every module outside `api/` (and every `api/use-*.ts`)
 * that imports a mutating api function and exports a hook, then keeping the
 * hooks that hand a write to their caller. Hooks exported from a plain api
 * module (`useNotices` in `api/notices.ts`) need no entry: the parser above
 * already counts them, through the write they call.
 * Keyed by module (relative to `src/`) → the exported hook names that hand
 * out a write. `useProjectStatuses` and `useTaskRounds` are reads and are
 * deliberately absent; `runBulkAction` and `applyAction` are not hooks but
 * are the same case — the bulk bar's writes, behind a module of its own.
 */
const MUTATING_HOOKS: Readonly<Record<string, readonly string[]>> = {
  'api/use-board.ts': ['useBoard'],
  'api/use-session.ts': ['useSession'],
  'api/use-statuses.ts': ['useStatusEditor'],
  'api/use-members.ts': ['useMembers'],
  'api/use-task-detail.ts': ['useTaskDetail'],
  'routes/screens/sprints/use-sprints.ts': ['useSprints'],
  'routes/screens/list/list-bulk.ts': ['runBulkAction', 'applyAction'],
  'routes/screens/task/use-task-review.ts': ['useTaskReview'],
  'components/drawer/use-space-reads.ts': ['useLocalMoves'],
};

/**
 * Mutating files that do not yet report through the shared feedback, each
 * with why. `LAI-1310: not migrated yet` is the migration's to-do list: each
 * area's pass deletes its entries. Any other reason must say why the file
 * needs no toast of its own (e.g. it hands the write to a parent that toasts).
 */
const ALLOWED_WITHOUT_TOAST: Readonly<Record<string, string>> = {
  'components/drawer/TaskDrawerHost.tsx':
    'moves go through useLocalMoves, which toasts (use-space-reads.ts); the panel it renders reports its own actions',
  'routes/screens/calendar/calendar-drag.ts':
    'pure write helper with a node unit test; its only caller, CalendarScreen, runs it through useAction',
  'routes/screens/space-settings/SpaceSettingsScreen.tsx':
    'hands useMembers’ writes to MembersTab, which toasts them',
};

/** Top-level declarations: `[export] [async] function name` or `[export] const name =`. */
const DECL =
  /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)/gm;

interface Fn {
  readonly name: string;
  readonly exported: boolean;
  readonly body: string;
}

/** Split a module into its top-level declarations, each with the text up to the next one. */
function declarations(src: string): Fn[] {
  const starts: { name: string; exported: boolean; at: number }[] = [];
  for (const m of src.matchAll(DECL)) {
    const name = m[1] ?? m[2];
    if (name === undefined) continue;
    starts.push({ name, exported: m[0].startsWith('export'), at: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    exported: s.exported,
    body: src.slice(s.at, starts[i + 1]?.at ?? src.length),
  }));
}

const WRITES = /method:[^,}\n]*['"](?:POST|PATCH|PUT|DELETE)['"]/;

/** The mutating exports of one module, following calls between its own functions. */
function mutatingIn(src: string): string[] {
  const fns = declarations(code(src));
  const mutating = new Set(fns.filter((f) => WRITES.test(f.body)).map((f) => f.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fns) {
      if (mutating.has(f.name)) continue;
      const callsOne = [...mutating].some((n) => new RegExp(`\\b${n}\\s*[(<]`).test(f.body));
      if (callsOne) {
        mutating.add(f.name);
        grew = true;
      }
    }
  }
  return fns.filter((f) => f.exported && mutating.has(f.name)).map((f) => f.name);
}

/** `src/api/<file>` → its mutating exports. */
function mutatingApi(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of readdirSync(API)) {
    if (!file.endsWith('.ts')) continue;
    const names = mutatingIn(readFileSync(join(API, file), 'utf8'));
    if (names.length > 0) out.set(`api/${file}`, new Set(names));
  }
  return out;
}

interface Import {
  /** The module, relative to `src/`. */
  readonly from: string;
  readonly names: readonly string[];
}

/** The value imports of a file (type-only ones dropped), resolved against `src/`. */
function importsOf(src: string, file: string): Import[] {
  const out: Import[] = [];
  for (const m of src.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
    if (m[1] !== undefined) continue;
    const spec = m[3] ?? '';
    if (!spec.startsWith('.')) continue;
    const from = relative(SRC, resolve(dirname(file), spec))
      .split('\\')
      .join('/');
    const names = (m[2] ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n !== '' && !n.startsWith('type '))
      .map((n) => n.split(/\s+as\s+/)[0]?.trim() ?? '');
    out.push({ from, names });
  }
  return out;
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(SRC, dir), { recursive: true })
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f))
    .map((f) => `${dir}/${f.split('\\').join('/')}`)
    .filter((rel) => !rel.startsWith('components/toast/'))
    .sort();
}

interface Census {
  readonly api: Map<string, Set<string>>;
  readonly mutating: readonly string[];
  readonly passing: readonly string[];
  readonly failing: readonly string[];
}

function census(): Census {
  const api = mutatingApi();
  const hooks = new Map(Object.entries(MUTATING_HOOKS).map(([m, n]) => [m, new Set(n)]));
  const mutating: string[] = [];
  const passing: string[] = [];
  const failing: string[] = [];
  for (const rel of [...sourcesUnder('routes/screens'), ...sourcesUnder('components')]) {
    if (hooks.has(rel)) continue; // the hook itself: its callers are the ones that answer
    const text = code(readFileSync(join(SRC, rel), 'utf8'));
    const writes = importsOf(text, join(SRC, rel)).some(({ from, names }) => {
      const set = api.get(from) ?? hooks.get(from);
      return set !== undefined && names.some((n) => set.has(n));
    });
    if (!writes) continue;
    mutating.push(rel);
    (FEEDBACK.test(text) ? passing : failing).push(rel);
  }
  return { api, mutating, passing, failing };
}

function byArea(files: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const parts = f.split('/');
    const area = parts[0] === 'routes' ? parts.slice(0, 3).join('/') : parts.slice(0, 2).join('/');
    const key = area.endsWith('.tsx') || area.endsWith('.ts') ? dirname(area) : area;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([a, n]) => `${a} ${String(n)}`)
    .join(', ');
}

void describe('the mutation parser (so the guard below cannot pass by finding nothing)', () => {
  void test('reads a direct write, a ternary method, and a wrapper of a private helper', () => {
    const src = [
      "export function a() { return request('/x', { method: 'POST' }); }",
      "export function b(on: boolean) { return request('/x', { method: on ? 'PUT' : 'DELETE' }); }",
      "function send(p: string) { return request(p, { method: 'PATCH', body: {} }); }",
      'export const c = (id: string) => send(`/x/${id}`);',
      "export function d() { return request('/x'); }",
      "export function e() { return request('/x', { method: 'GET' }); }",
    ].join('\n');
    assert.deepEqual(mutatingIn(src), ['a', 'b', 'c']);
  });

  void test(`finds at least ${String(MIN_MUTATING)} mutating api functions, including known ones`, (t: TestContext) => {
    const api = mutatingApi();
    const total = [...api.values()].reduce((n, s) => n + s.size, 0);
    t.diagnostic(`mutating api functions: ${String(total)} in ${String(api.size)} modules`);
    assert.ok(total >= MIN_MUTATING, `only ${String(total)} — the parser is broken`);
    assert.ok(api.get('api/tasks.ts')?.has('watchTask'), 'watchTask (PUT) not found');
    assert.ok(api.get('api/tasks.ts')?.has('unwatchTask'), 'unwatchTask (DELETE) not found');
    assert.ok(api.get('api/auth.ts')?.has('signOut'), 'signOut (POST) not found');
    assert.ok(api.get('api/notices.ts')?.has('markNoticeRead'), 'markNoticeRead not found');
    assert.equal(api.get('api/auth.ts')?.has('getSession') ?? false, false);
  });

  void test('every listed mutating hook really writes — the hand list cannot keep a stale one', () => {
    const api = mutatingApi();
    for (const [mod, names] of Object.entries(MUTATING_HOOKS)) {
      const text = code(readFileSync(join(SRC, mod), 'utf8'));
      const writes = importsOf(text, join(SRC, mod)).some(({ from, names: imported }) => {
        const set = api.get(from);
        return set !== undefined && imported.some((n) => set.has(n));
      });
      assert.ok(writes, `${mod} imports no mutating api function — drop it from MUTATING_HOOKS`);
      for (const n of names) {
        assert.match(text, new RegExp(`export (?:async )?function ${n}\\b`), `${mod} has no ${n}`);
      }
    }
  });
});

void describe('every action says how it went (LAI-1310)', () => {
  void test('a mutating screen or component reports through useAction, useToast or useSaveStatus', (t: TestContext) => {
    const { mutating, passing, failing } = census();
    t.diagnostic(`mutating files: ${String(mutating.length)} — ${byArea(mutating)}`);
    t.diagnostic(`passing: ${String(passing.length)} — ${byArea(passing)}`);
    t.diagnostic(`allow-listed: ${String(failing.length)} — ${byArea(failing)}`);
    const unlisted = failing.filter((f) => !(f in ALLOWED_WITHOUT_TOAST));
    assert.deepEqual(
      unlisted,
      [],
      'these files change data on the server and never say so — run the action through ' +
        'useAction() from components/toast/use-action.ts (or useToast / useSaveStatus)',
    );
  });

  void test('the allow-list is exact — an entry whose file now reports, or no longer writes, is removed', () => {
    const { failing } = census();
    const stale = Object.keys(ALLOWED_WITHOUT_TOAST).filter((f) => !failing.includes(f));
    assert.deepEqual(stale, [], 'migrated or no longer mutating — delete the entry');
    for (const [file, why] of Object.entries(ALLOWED_WITHOUT_TOAST)) {
      assert.ok(why.trim().length > 0, `${file} needs a reason`);
    }
  });
});
