/**
 * Whether the sidebar is the icon rail (LAI-796): remembered per browser,
 * automatic on a narrow window, and never broken by storage that refuses.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  NARROW_QUERY,
  SIDEBAR_KEY,
  railCollapsed,
  readSidebar,
  toggleRail,
  writeSidebar,
} from '../../../src/components/sidebar/sidebar-state.ts';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const refusing = {
  getItem: (): string | null => {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

void describe('the choice is remembered per browser', () => {
  void test('it is read back as it was written', () => {
    const storage = memory();
    writeSidebar(storage, 'collapsed');
    assert.equal(storage.map.get(SIDEBAR_KEY), 'collapsed');
    assert.equal(readSidebar(storage), 'collapsed');
    writeSidebar(storage, 'expanded');
    assert.equal(readSidebar(storage), 'expanded');
  });

  void test('nothing stored is no choice — the rail opens expanded on a wide window', () => {
    assert.equal(readSidebar(memory()), undefined);
    assert.equal(railCollapsed({ preference: undefined, narrow: false, openedWhileNarrow: false }), false);
  });

  void test('a stored value it does not know is no choice, not a crash', () => {
    assert.equal(readSidebar(memory({ [SIDEBAR_KEY]: 'sideways' })), undefined);
  });

  void test('storage that throws is survived on read and on write', () => {
    // A private window or blocked site data: the toggle still works for the
    // session, it is only not remembered.
    assert.equal(readSidebar(refusing), undefined);
    assert.doesNotThrow(() => {
      writeSidebar(refusing, 'collapsed');
    });
  });
});

void describe('a narrow window collapses it by itself', () => {
  void test('the breakpoint is a width query, above the phone’s off-canvas one', () => {
    assert.match(NARROW_QUERY, /max-width:\s*\d+px/);
    const px = Number(/(\d+)px/.exec(NARROW_QUERY)?.[1]);
    assert.ok(px > 900 && px < 1366, `${String(px)}px — a 1366 laptop must keep the full sidebar`);
  });

  void test('narrow is the rail even when the stored choice is expanded', () => {
    assert.equal(railCollapsed({ preference: 'expanded', narrow: true, openedWhileNarrow: false }), true);
  });

  void test('the toggle still opens it while narrow, for now', () => {
    assert.equal(railCollapsed({ preference: 'expanded', narrow: true, openedWhileNarrow: true }), false);
  });

  void test('wide follows the stored choice', () => {
    assert.equal(railCollapsed({ preference: 'collapsed', narrow: false, openedWhileNarrow: false }), true);
    assert.equal(railCollapsed({ preference: 'expanded', narrow: false, openedWhileNarrow: true }), false);
  });
});

void describe('what the toggle changes', () => {
  void test('wide, it flips and remembers the choice', () => {
    assert.deepEqual(toggleRail({ preference: undefined, narrow: false, openedWhileNarrow: false }), {
      preference: 'collapsed',
      openedWhileNarrow: false,
      remember: true,
    });
    assert.deepEqual(toggleRail({ preference: 'collapsed', narrow: false, openedWhileNarrow: false }), {
      preference: 'expanded',
      openedWhileNarrow: false,
      remember: true,
    });
  });

  void test('narrow, it opens or closes for now and leaves the stored choice alone', () => {
    // Remembering here would mean a reader who once peeked at the full
    // sidebar on a small window finds it collapsed on their wide one.
    assert.deepEqual(toggleRail({ preference: 'expanded', narrow: true, openedWhileNarrow: false }), {
      preference: 'expanded',
      openedWhileNarrow: true,
      remember: false,
    });
    assert.deepEqual(toggleRail({ preference: 'expanded', narrow: true, openedWhileNarrow: true }), {
      preference: 'expanded',
      openedWhileNarrow: false,
      remember: false,
    });
  });
});
