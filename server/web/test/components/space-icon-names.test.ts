/**
 * The space views and the task have names, tooltips and drawn icons (LAI-1213).
 *
 * LAI-1209's guard (`dialog-icon-names.test.ts`) holds the dialogs; this one
 * holds the rest of the owner's ask — *"not only to this dialog but for other
 * pages"* — for the Board, List, Timeline, Calendar, Sprints, Dashboard,
 * Activity and Meeting review screens, the space header and toolbar, the task
 * drawer and panel, the Workroom, and the CopyButton. Their files are found by
 * walking those directories, never listed one by one, so a file added there
 * tomorrow is held to the same rules the day it is written:
 *
 * 1. an icon-only `<button>` has a name (`aria-label` / `aria-labelledby`);
 * 2. and sits directly inside the shared `<Tooltip>` — the words a sighted
 *    mouse or keyboard user can read;
 * 3. no element carries a bare `title=` — it is shown to neither a keyboard
 *    nor a touch screen, and no theme can style it; a *component's* `title`
 *    prop (a dialog's heading, `DashLink`'s hint) is not an element's;
 * 4. no typed glyph (`× ⋯ ✓ ↳ ⚠ …`) stands in for an icon — those are the
 *    registry's (`components/icon/icon-paths.ts`);
 * 5. an `IconButton` never switches its tooltip off.
 *
 * Every exemption is listed below with its reason, and each must still match
 * something — a stale entry fails, so the list stays exact.
 *
 * The browser half — the tooltip actually showing on hover and on focus, the
 * reasons, CSP — is `test/browser/space-tooltips.test.ts`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';
import { buttons, hasWords, insideTooltip, named, openTags } from '../helpers/jsx-buttons.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** The area, by directory: every `.tsx` under each is held. */
const AREA_DIRS = [
  'routes/screens/board',
  'routes/screens/list',
  'routes/screens/timeline',
  'routes/screens/calendar',
  'routes/screens/sprints',
  'routes/screens/dashboard',
  'routes/screens/activity',
  'routes/screens/meeting-review',
  'routes/screens/task',
  'routes/screens/workroom',
  'components/drawer',
  'components/space',
] as const;
const AREA_FILES = ['components/CopyButton.tsx'] as const;

/**
 * Icon-only buttons with a name and **no** tooltip, on purpose. Keyed by file
 * and a class the button carries.
 */
const NO_TOOLTIP: readonly { file: string; className: string; why: string }[] = [
  {
    file: 'components/drawer/TaskDrawer.tsx',
    className: 'drawer-handle',
    why: 'the phone sheet’s grab bar: drawn only under a finger, where a long press would fight the swipe that closes it',
  },
  {
    file: 'routes/screens/board/BoardToolbar.tsx',
    className: 'bt-catcher',
    why: 'the invisible click-away layer under an open popover: a tooltip on it would follow the pointer across the whole board',
  },
];

/** Typed characters kept as text, on purpose. Keyed by file and the exact text. */
const GLYPH_TEXT: readonly { file: string; text: string; why: string }[] = [
  {
    file: 'routes/screens/timeline/TimelineScreen.tsx',
    text: '←',
    why: 'a keycap in the chart’s keyboard help (`<kbd>←</kbd>`): the key’s own name',
  },
  {
    file: 'routes/screens/timeline/TimelineScreen.tsx',
    text: '→',
    why: 'a keycap in the chart’s keyboard help (`<kbd>→</kbd>`): the key’s own name',
  },
  {
    file: 'routes/screens/task/ActivityFeed.tsx',
    text: '→',
    why: 'the arrow inside a status-move sentence (*Moved Backlog → In progress*): read as part of the words, and pinned by task-feed.test.ts',
  },
];

/** The characters that are an icon someone typed. */
const GLYPHS = /[×✕⋯✓✔✗↩↳⇄▶▲▼✎⚠▾›‹←→↑↓]/u;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const files = [
  ...AREA_DIRS.flatMap((dir) => walk(join(SRC, dir))),
  ...AREA_FILES.map((f) => join(SRC, f)),
].map((path) => relative(SRC, path));

const source = (file: string): string => code(readFileSync(join(SRC, file), 'utf8'));

const classOf = (open: string): string => /className=["{]['"`]?([^"'`}]*)/.exec(open)?.[1] ?? '';

/** JSX text between tags — not attributes, not expressions. */
function jsxText(src: string): string[] {
  return [...src.matchAll(/>([^<>{}]*)</g)].map((m) => (m[1] ?? '').trim()).filter((t) => t !== '');
}

void describe('the area is found by walking it', () => {
  void test('names that must be in it, so a broken walk cannot pass', () => {
    for (const file of [
      'routes/screens/board/TaskDetailPanel.tsx',
      'routes/screens/board/LaneRow.tsx',
      'routes/screens/list/ListView.tsx',
      'routes/screens/workroom/Workroom.tsx',
      'components/space/SpaceMenu.tsx',
      'components/CopyButton.tsx',
    ]) {
      assert.ok(files.includes(file), `${file} is not in the area`);
    }
  });
});

void describe('icon-only buttons are named and tooltipped (LAI-1213)', () => {
  for (const file of files) {
    void test(file, () => {
      const src = source(file);
      const iconOnly = buttons(src).filter((b) => !hasWords(b.inner));
      const unnamed = iconOnly.filter((b) => !named(b.open)).map((b) => b.open);
      assert.deepEqual(unnamed, [], `${file}: an icon-only <button> with no name`);
      const untipped = iconOnly
        .filter((b) => !insideTooltip(src, b.at))
        .filter(
          (b) =>
            !NO_TOOLTIP.some(
              (e) => e.file === file && classOf(b.open).split(/\s+/).includes(e.className),
            ),
        )
        .map((b) => b.open);
      assert.deepEqual(untipped, [], `${file}: an icon-only <button> with no Tooltip around it`);
      for (const tag of openTags(src, 'IconButton')) {
        assert.doesNotMatch(tag.open, /tooltip=\{false\}/, `${file}: a silenced IconButton`);
      }
    });
  }

  void test('every no-tooltip exemption still names a button that exists', () => {
    for (const e of NO_TOOLTIP) {
      const found = buttons(source(e.file)).some((b) =>
        classOf(b.open).split(/\s+/).includes(e.className),
      );
      assert.ok(found, `stale exemption: no .${e.className} button in ${e.file}`);
      assert.ok(e.why.length > 20, `${e.file} .${e.className}: say why`);
    }
  });
});

void describe('no bare title= on an element (LAI-1213)', () => {
  for (const file of files) {
    void test(file, () => {
      const src = source(file);
      const bare = [...src.matchAll(/\stitle=[{"']/g)]
        .map((m) => {
          const tag = /^<([A-Za-z][\w.]*)/.exec(src.slice(src.lastIndexOf('<', m.index)))?.[1];
          return tag ?? '?';
        })
        .filter((tag) => /^[a-z]/.test(tag));
      assert.deepEqual(
        bare,
        [],
        `${file}: a bare title= on <${bare.join('>, <')}> — use the Tooltip`,
      );
    });
  }
});

void describe('drawn icons, not typed glyphs (LAI-1213)', () => {
  for (const file of files) {
    void test(file, () => {
      const src = source(file);
      const typed = jsxText(src)
        .filter((text) => GLYPHS.test(text))
        .filter((text) => !GLYPH_TEXT.some((e) => e.file === file && e.text === text));
      assert.deepEqual(typed, [], `${file}: a typed glyph — use <Icon> from the registry`);
      const literal = [...src.matchAll(/\{\s*(['"])([^'"]{1,2})\1\s*\}/g)]
        .map((m) => m[2] ?? '')
        .filter((g) => GLYPHS.test(g));
      assert.deepEqual(literal, [], `${file}: a glyph in a {'…'} literal — use <Icon>`);
    });
  }

  void test('every glyph exemption still matches text that exists', () => {
    for (const e of GLYPH_TEXT) {
      assert.ok(
        jsxText(source(e.file)).includes(e.text),
        `stale exemption: ${e.text} in ${e.file}`,
      );
    }
  });
});
