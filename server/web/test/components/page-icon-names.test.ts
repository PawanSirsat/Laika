/**
 * The pages' icon-only controls are named and tooltipped (LAI-1214) — the
 * sibling of `dialog-icon-names.test.ts` (LAI-1209), for the screens LAI-1214
 * carried the pattern to: My day, Inbox (Review, Unlisted), Work, the app
 * shell, Insights, Developer access, the Spaces directory, auth and 404.
 *
 * Read from source, every `.tsx` under the area's directories (walked, not
 * listed, so a new file there is covered the day it is written):
 *
 * 1. an icon-only `<button>` or `<a href>` — no words of its own, or words
 *    only a screen reader sees — has an accessible name;
 * 2. and sits directly inside the shared `<Tooltip>`, unless it is one of
 *    {@link NO_TOOLTIP}, each with its reason;
 * 3. no element carries a bare `title=` — a keyboard and a touch screen never
 *    show one, and a theme cannot style it;
 * 4. no control's text is a typed arrow or cross (`‹ › → × ✕ ▾`): those are
 *    Icon-registry icons, one weight in every font. {@link TYPED_OK} lists
 *    the few that are words, not controls.
 *
 * The browser half — the tooltips showing on hover and on focus, the keys,
 * the reasons — is `test/browser/page-tooltips.test.ts`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** The area: directories walked whole, and single files. */
const AREA_DIRS = [
  'routes/screens/my-day',
  'routes/screens/inbox',
  'routes/screens/review',
  'routes/screens/unlisted',
  'routes/screens/insights',
  'routes/screens/capacity',
  'routes/screens/usage',
  'routes/screens/developer',
  'routes/screens/connect',
  'routes/screens/tokens',
  'routes/screens/projects',
  'components/sidebar',
  'components/shell',
  'components/time-report',
  'components/auth',
] as const;
const AREA_FILES = [
  'routes/screens/organisation/WorkTab.tsx',
  'routes/screens/ProjectsScreen.tsx',
  'routes/screens/LoginScreen.tsx',
  'routes/screens/FirstBootScreen.tsx',
  'routes/screens/InviteScreen.tsx',
  'routes/screens/ResetPasswordScreen.tsx',
  'routes/screens/NotFound.tsx',
  'components/AppShell.tsx',
  'components/command/PaletteTrigger.tsx',
  'components/SidePanel.tsx',
  'components/CopyButton.tsx',
  'components/wizard/StepRail.tsx',
] as const;

/**
 * Icon-only controls that are named but take no tooltip, by an attribute only
 * they carry — exact, so a new one is not covered by accident.
 */
const NO_TOOLTIP: readonly {
  readonly file: string;
  readonly mark: string;
  readonly why: string;
}[] = [
  {
    file: 'routes/screens/my-day/Timeline.tsx',
    mark: 'data-edge="start"',
    why: 'a block’s drag handle: its cursor is the affordance, and a tooltip would sit under the pointer on the edge being dragged',
  },
  {
    file: 'routes/screens/my-day/Timeline.tsx',
    mark: 'data-edge="end"',
    why: 'the same handle, the block’s other edge',
  },
];

/** Typed arrows that are prose, not a control's decoration. */
const TYPED_OK: readonly { readonly file: string; readonly text: string; readonly why: string }[] =
  [
    {
      file: 'routes/screens/developer/v3/ProjectSetupTab.tsx',
      text: 'Space settings → Access',
      why: 'a path through the menus, written in a sentence',
    },
  ];

const TYPED = /[‹→×✕▾]|›(?!_)/u;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Each `<tag …>…</tag>`: where it starts, its opening tag and what it holds. Same tags do not nest here. */
function elements(
  src: string,
  tag: string,
): { readonly at: number; readonly open: string; readonly inner: string }[] {
  const out: { at: number; open: string; inner: string }[] = [];
  const start = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = start.exec(src)) !== null) {
    let depth = 0;
    let quote: string | undefined;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote !== undefined) {
        if (c === quote) quote = undefined;
        continue;
      }
      if (depth > 0 && (c === "'" || c === '"' || c === '`')) quote = c;
      else if (depth === 0 && c === '"') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    const open = src.slice(m.index, i + 1);
    if (open.endsWith('/>')) {
      out.push({ at: m.index, open, inner: '' });
      continue;
    }
    const end = src.indexOf(`</${tag}>`, i);
    out.push({ at: m.index, open, inner: end === -1 ? '' : src.slice(i + 1, end) });
  }
  return out;
}

const HIDDEN_WORDS = /<span className="visually-hidden"[^>]*>[\s\S]*?<\/span>/g;

/** Words a sighted reader sees: tags and screen-reader-only text dropped. */
function hasWords(inner: string): boolean {
  let text = inner.replace(HIDDEN_WORDS, ' ').replace(/<[^>]*>/g, ' ');
  for (let guard = 0; guard < 10 && /\{[^{}]*\}/.test(text); guard++) {
    text = text.replace(/\{([^{}]*)\}/g, (_, body: string) =>
      body.trim() === '' || /&&\s*$/.test(body.trim()) ? ' ' : ' WORDS ',
    );
  }
  return /[\p{L}\p{N}]/u.test(text);
}

const named = (open: string, inner: string): boolean =>
  /\baria-label(?:ledby)?=/.test(open) || inner.includes('className="visually-hidden"');

const inTooltip = (src: string, at: number): boolean =>
  /<Tooltip\b[^<]*>$/.test(
    src
      .slice(0, at)
      .replace(/\{\s*\}/g, '')
      .trimEnd(),
  );

const files = [
  ...AREA_DIRS.flatMap((dir) => walk(join(SRC, dir)).map((path) => relative(SRC, path))),
  ...AREA_FILES,
];

/** The icon-only controls of a file: buttons, and links with an `href`. */
function iconOnly(
  src: string,
): { readonly at: number; readonly open: string; readonly inner: string }[] {
  return [
    ...elements(src, 'button'),
    ...elements(src, 'a').filter((a) => /\bhref=/.test(a.open)),
  ].filter((b) => !hasWords(b.inner));
}

void describe('the reader (LAI-1214)', () => {
  void test('tells an icon from words, and screen-reader words from seen ones', () => {
    assert.equal(hasWords('<Icon name="close" size="small" />'), false);
    assert.equal(hasWords('<span className="visually-hidden">Close</span><svg />'), false);
    assert.equal(hasWords('{busy && <Spinner />} Save'), true);
    assert.equal(named('<button aria-label="Close">', ''), true);
    assert.equal(named('<a href="/x">', '<span className="visually-hidden">Create</span>'), true);
    assert.equal(named('<button>', '<Icon name="close" />'), false);
  });

  void test('sees a Tooltip around a control, and none where there is none', () => {
    const src =
      '<Tooltip content="Close">\n<button aria-label="Close"><Icon /></button>\n</Tooltip><button aria-label="X"><Icon /></button>';
    const found = iconOnly(src);
    assert.equal(found.length, 2);
    assert.equal(inTooltip(src, found[0]?.at ?? 0), true);
    assert.equal(inTooltip(src, found[1]?.at ?? 0), false);
  });
});

void describe('the area is found (LAI-1214)', () => {
  void test('by walking, with the files it must hold', () => {
    // Names, not a count: a broken walk that finds nothing cannot pass below.
    for (const file of [
      'routes/screens/my-day/Timeline.tsx',
      'routes/screens/my-day/TimerControl.tsx',
      'routes/screens/my-day/MyDayDrawer.tsx',
      'components/sidebar/Sidebar.tsx',
      'components/sidebar/SpacesPopover.tsx',
      'routes/screens/developer/AgentsTab.tsx',
      'routes/screens/capacity/CapacityList.tsx',
    ]) {
      assert.ok(files.includes(file), `${file} is not in the area`);
    }
  });

  void test('every exemption still names a control that exists', () => {
    for (const { file, mark } of NO_TOOLTIP) {
      assert.ok(readFileSync(join(SRC, file), 'utf8').includes(mark), `${file}: ${mark} is gone`);
    }
    for (const { file, text } of TYPED_OK) {
      assert.ok(readFileSync(join(SRC, file), 'utf8').includes(text), `${file}: ${text} is gone`);
    }
  });
});

void describe('icon-only controls on the pages are named and tooltipped (LAI-1214)', () => {
  for (const file of files) {
    void test(file, () => {
      const src = code(readFileSync(join(SRC, file), 'utf8'));
      const controls = iconOnly(src);

      const unnamed = controls.filter((c) => !named(c.open, c.inner)).map((c) => c.open);
      assert.deepEqual(unnamed, [], `${file}: an icon-only control with no name`);

      const exempt = NO_TOOLTIP.filter((e) => e.file === file).map((e) => e.mark);
      const bare = controls
        .filter((c) => !inTooltip(src, c.at))
        .filter((c) => !exempt.some((mark) => c.open.includes(mark)))
        .map((c) => c.open);
      assert.deepEqual(bare, [], `${file}: an icon-only control with no Tooltip around it`);

      assert.doesNotMatch(
        src,
        /<IconButton\b[^>]*tooltip=\{false\}/,
        `${file}: a silenced IconButton`,
      );
    });
  }
});

void describe('no bare title= on the pages (LAI-1214)', () => {
  for (const file of files) {
    void test(file, () => {
      const src = code(readFileSync(join(SRC, file), 'utf8'));
      const titled: string[] = [];
      const tag = /<([a-z][a-z0-9]*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = tag.exec(src)) !== null) {
        const open = elements(src.slice(m.index), m[1] ?? '')[0]?.open ?? '';
        // A title= on the tag, or one handed in through a spread —
        // `{...(locked ? { title: why } : {})}`, as StepRail's locked steps did.
        if (/\stitle=|\{\s*title:/.test(open)) titled.push(open.split('\n')[0] ?? open);
      }
      assert.deepEqual(titled, [], `${file}: a bare title= — use the shared Tooltip`);
    });
  }
});

void describe('no typed arrows or crosses on the pages’ controls (LAI-1214)', () => {
  for (const file of files) {
    void test(file, () => {
      let src = code(readFileSync(join(SRC, file), 'utf8'));
      for (const ok of TYPED_OK.filter((t) => t.file === file)) src = src.replace(ok.text, '');
      // JSX text — between a tag's end and the next tag, across lines — and
      // one-character string literals, which is how a glyph reaches a label.
      const typed = [
        ...[...src.matchAll(/>([^<>{}]*)</g)].map((t) => t[1] ?? ''),
        ...[...src.matchAll(/(['"])([^'"\n])\1/g)].map((t) => t[2] ?? ''),
      ].filter((t) => TYPED.test(t));
      assert.deepEqual(typed, [], `${file}: a typed glyph — draw it with <Icon>`);
    });
  }
});
