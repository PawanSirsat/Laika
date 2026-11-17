/**
 * The deliverable trial's fixtures (LAI-1131): their shape, their diagrams,
 * and — the D-032 rule — that none of them, nor the libraries that render
 * them, reaches the entry chunk every screen loads.
 *
 * The needles are **derived**, as `agent-gallery-bundle.test.ts` does it:
 * every plain-prose line of the fixtures that appears nowhere else in `src/`.
 * A hand-picked list would rot.
 *
 * Built into a temp directory, never `server/public/` (LAI-204).
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { build } from 'vite';
import { diagramKey, mermaidSources } from '../../../../src/components/documents/diagram-key.ts';

const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC = join(WEB_ROOT, 'src');
const TRIAL = join(SRC, 'components', 'documents', 'trial');
const FIXTURES = join(TRIAL, 'fixtures');
const DIAGRAMS = join(TRIAL, 'diagrams');

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const ALL = readdirSync(FIXTURES).filter((f) => f.endsWith('.md'));

void describe('the fixtures are what the trial spec asks for', () => {
  void test('A: long-form, deep headings, four languages, three diagrams, footnotes, callouts', () => {
    for (const name of ['architecture-v1.md', 'architecture-v2.md']) {
      const md = fixture(name);
      assert.ok((md.match(/^#{1,4} /gm) ?? []).length >= 30, `${name}: fewer than 30 headings`);
      for (const lang of ['ts', 'sql', 'bash', 'json']) {
        assert.ok(md.includes('```' + lang), `${name}: no ${lang} block`);
      }
      assert.ok(md.includes('[^incidents]:'), `${name}: no footnote`);
      assert.match(md, /> \[!(NOTE|WARNING|TIP)\]/);
    }
    assert.equal(mermaidSources(fixture('architecture-v1.md')).length, 3);
    // v2 removed the ER diagram — a realistic edit the compare view must show.
    assert.equal(mermaidSources(fixture('architecture-v2.md')).length, 2);
  });

  void test('B: five or more tables, one at least 12 columns by 150 rows, every status', () => {
    const md = fixture('uat-report.md');
    // A table is a run of `|` lines whose second line is the header rule.
    const tables: string[][] = [];
    let run: string[] = [];
    for (const line of [...md.split('\n'), '']) {
      if (line.startsWith('|')) {
        run.push(line);
        continue;
      }
      if (run.length >= 2 && /^\|(?:\s*:?-+:?\s*\|)+$/.test(run[1] ?? '')) tables.push(run);
      run = [];
    }
    assert.ok(tables.length >= 5, `${String(tables.length)} tables`);
    const widest = tables
      .map((t) => ({ cols: (t[0]?.match(/\|/g)?.length ?? 1) - 1, rows: t.length - 2 }))
      .sort((x, y) => y.rows - x.rows)[0];
    assert.ok(
      widest !== undefined && widest.cols >= 12 && widest.rows >= 150,
      JSON.stringify(widest),
    );
    for (const s of ['Pass', 'Fail', 'Blocked', 'Skipped']) assert.ok(md.includes(`**${s}**`), s);
  });

  void test('C: short, with a decision, risks, and outstanding issues', () => {
    const md = fixture('management-summary.md');
    assert.ok(md.split(/\s+/).length < 700, 'not a one-to-two page summary');
    for (const h of [
      '## Decisions required',
      '## Risks',
      '## Outstanding issues',
      '## Recommendation',
    ]) {
      assert.ok(md.includes(h), h);
    }
  });

  void test('synthetic only: labelled illustrative, no real addresses', () => {
    for (const name of ALL) {
      const md = fixture(name);
      assert.match(md, /Illustrative fixture/, `${name} does not say it is illustrative`);
      // `$host` is a shell variable in a code block, not an address.
      for (const [, host] of md.matchAll(/https?:\/\/([^/\s)$"]+)/g)) {
        assert.match(
          host ?? '',
          /\.(test|example)$|^example\.(com|org)$/,
          `${name}: real host ${host ?? ''}`,
        );
      }
      assert.doesNotMatch(
        md,
        /[\w.+-]+@[\w-]+\.(com|net|io|co\.za)\b/,
        `${name}: an email address`,
      );
    }
  });
});

void describe('every diagram has a current picture, and only those', () => {
  const sources = ALL.flatMap((n) => mermaidSources(fixture(n)));
  const files = readdirSync(DIAGRAMS).filter((f) => f.endsWith('.svg'));

  void test('each diagram in the fixtures has a light and a dark SVG', () => {
    assert.ok(sources.length >= 4, 'no diagrams found — is the fence parser working?');
    const missing = sources
      .map(diagramKey)
      .flatMap((k) => [`${k}-light.svg`, `${k}-dark.svg`])
      .filter((f) => !files.includes(f));
    assert.deepEqual(missing, [], 'run `npx tsx scripts/render-trial-diagrams.ts`');
  });

  void test('no picture of a diagram the fixtures no longer contain', () => {
    const keys = new Set(sources.map(diagramKey));
    assert.deepEqual(
      files.filter((f) => !keys.has(f.slice(0, 8))),
      [],
    );
  });

  void test('the pictures carry no script and fetch nothing', () => {
    for (const f of files) {
      const svg = readFileSync(join(DIAGRAMS, f), 'utf8');
      assert.ok(svg.startsWith('<svg'), `${f} is not an SVG`);
      assert.doesNotMatch(svg, /<script|\son[a-z]+=|javascript:/i, `${f} has script`);
      assert.doesNotMatch(svg, /(?:href|src)="https?:/i, `${f} references the network`);
    }
  });
});

let outDir: string;
let entry: string;
let chunks: Map<string, string>;

async function needles(): Promise<string[]> {
  const others: string[] = [];
  for (const e of await readdir(SRC, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !/\.tsx?$/.test(e.name)) continue;
    others.push(await readFile(join(e.parentPath, e.name), 'utf8'));
  }
  const found = new Set<string>();
  for (const name of ALL) {
    for (const line of fixture(name).split('\n')) {
      // Plain prose survives bundling byte for byte; quotes and backslashes
      // would be escaped inside the JS string.
      if (line.length >= 30 && /^[A-Za-z][A-Za-z0-9 ,.;:()-]+$/.test(line)) found.add(line);
    }
  }
  return [...found].filter((s) => !others.some((text) => text.includes(s)));
}

void describe('the trial stays out of the entry chunk', () => {
  before(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'laika-doc-trial-'));
    await build({
      root: WEB_ROOT,
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
    });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const src = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
    assert.ok(src !== undefined, 'index.html names no entry script');
    entry = src;
    chunks = new Map();
    for (const f of (await readdir(join(outDir, 'assets'))).filter((n) => n.endsWith('.js'))) {
      chunks.set(f, await readFile(join(outDir, 'assets', f), 'utf8'));
    }
  });

  after(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  void test('the needle list is real', async () => {
    const list = await needles();
    assert.ok(
      list.length >= 40,
      `only ${String(list.length)} needles — is the derivation working?`,
    );
  });

  void test('fixture text is built, and only into the lazily loaded trial chunk', async () => {
    const list = await needles();
    const where = new Map<string, number>();
    for (const needle of list) {
      for (const [file, js] of chunks)
        if (js.includes(needle)) where.set(file, (where.get(file) ?? 0) + 1);
    }
    const files = [...where.keys()];
    assert.ok(files.length > 0, 'no fixture reached any chunk — the trial is not built at all');
    assert.ok(!files.includes(entry), `fixtures in the entry chunk ${entry}`);
    assert.deepEqual(
      files.filter((f) => !f.startsWith('DocumentsTrial-')),
      [],
    );
  });

  void test('lowlight and highlight.js are not in the entry chunk', () => {
    const js = chunks.get(entry) ?? '';
    for (const marker of ['highlightAuto', 'registerAlias', 'subLanguage']) {
      assert.ok(!js.includes(marker), `${marker} in the entry chunk`);
    }
    const trial = [...chunks].find(([f]) => f.startsWith('DocumentsTrial-'))?.[1] ?? '';
    assert.ok(trial.includes('highlightAuto'), 'positive control: lowlight is in the trial chunk');
  });

  void test('the entry reaches the trial chunk only through import()', () => {
    const trial = [...chunks.keys()].find((f) => f.startsWith('DocumentsTrial-'));
    assert.ok(trial !== undefined, 'no DocumentsTrial chunk — is it still lazy?');
    for (const [file, js] of chunks) {
      if (file === trial) continue;
      assert.ok(
        !new RegExp(`(?:from|import)\\s*["'][^"']*${trial.replace(/\./g, '\\.')}["']`).test(js),
        `${file} imports ${trial} statically`,
      );
    }
  });
});
