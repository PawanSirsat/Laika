/**
 * Which chunk each screen ships in, and the `import()` behind each (LAI-1219).
 *
 * Names from both sides, never a count: `ROUTE_CHUNKS` against `ROUTES`, and
 * the loaders against `SCREEN_CHUNKS`. The loaders themselves are not called
 * here — they import `.tsx` that imports CSS, which `node --test` cannot load;
 * `bundle-budget.test.ts` proves in a real build that they split.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chunksFor,
  ROUTE_CHUNKS,
  ROUTES,
  SCREEN_CHUNKS,
  SPACE_TAB_PATHS,
} from '../../src/routes/route-table.ts';
import { arrivedChunk, LOADED_CHUNKS, preloadOn } from '../../src/routes/screen-chunks.ts';

void describe('every route has a screen chunk', () => {
  void test('ROUTE_CHUNKS names every route and nothing else', () => {
    const routed = ROUTES.map((r) => r.path).sort();
    const chunked = Object.keys(ROUTE_CHUNKS).sort();
    assert.ok(routed.length > 0, 'ROUTES is empty — nothing below proves anything');
    assert.deepEqual(chunked, routed);
  });

  void test('every chunk named has a loader, and every loader a name', () => {
    assert.deepEqual([...LOADED_CHUNKS].sort(), [...SCREEN_CHUNKS].sort());
  });

  void test('every chunk but the frame is some route’s, so none is dead', () => {
    const used = new Set<string>(Object.values(ROUTE_CHUNKS));
    const unused = SCREEN_CHUNKS.filter((c) => c !== 'space-frame' && !used.has(c));
    assert.deepEqual(unused, []);
  });
});

void describe('chunksFor', () => {
  void test('a space tab needs the frame too, asked for first', () => {
    assert.ok(SPACE_TAB_PATHS.length > 0);
    for (const path of SPACE_TAB_PATHS) {
      const chunks = chunksFor(path);
      assert.equal(chunks[0], 'space-frame', `${path} does not ask for the frame`);
      assert.equal(chunks.length, 2, `${path}: ${chunks.join(', ')}`);
    }
  });

  void test('anything else needs its own chunk only', () => {
    assert.deepEqual(chunksFor('/my-day'), ['my-day']);
    assert.deepEqual(chunksFor('/inbox'), ['inbox']);
    assert.deepEqual(chunksFor('/login'), ['auth']);
  });

  void test('a parameterised path finds its route’s chunk', () => {
    assert.deepEqual(chunksFor('/spaces/laika/settings'), ['space-settings']);
    assert.deepEqual(chunksFor('/task/LAI-1'), ['workroom']);
  });

  void test('an unknown path needs nothing', () => {
    assert.deepEqual(chunksFor('/nope'), []);
  });
});

void describe('preloading', () => {
  void test('a link warms on hover, focus and pointerdown — touch has no hover', () => {
    const handlers = preloadOn('/nope?project=x');
    assert.equal(typeof handlers.onPointerEnter, 'function');
    assert.equal(typeof handlers.onFocus, 'function');
    assert.equal(typeof handlers.onPointerDown, 'function');
    // An address no route matches asks for nothing, and does not throw.
    handlers.onPointerEnter();
  });

  void test('nothing has arrived before anything was asked for', () => {
    for (const chunk of SCREEN_CHUNKS) assert.equal(arrivedChunk(chunk), undefined);
  });
});
