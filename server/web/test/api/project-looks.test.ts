/**
 * `src/api/project-looks.ts` (D-152, LAI-1311): every space read is
 * remembered by slug, a change tells every listener once, an unchanged read
 * tells nobody and keeps its object, and a read that does not send `icon`
 * keeps the icon already known.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  forgetLooks,
  lookOf,
  rememberProjects,
  subscribeLooks,
} from '../../src/api/project-looks.ts';

afterEach(() => {
  forgetLooks();
});

function counting(): { readonly count: () => number; readonly stop: () => void } {
  let n = 0;
  const stop = subscribeLooks(() => {
    n += 1;
  });
  return { count: () => n, stop };
}

void describe('rememberProjects', () => {
  void test('remembers name, colour and icon by slug, and tells listeners once per change', () => {
    const heard = counting();
    rememberProjects([
      { slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🚀' } },
      { slug: 'web', name: 'Web', color: null, icon: null },
    ]);
    assert.deepEqual(lookOf('core'), {
      name: 'Core',
      color: 'teal',
      icon: { emoji: '🚀' },
      updatedAt: null,
    });
    assert.deepEqual(lookOf('web'), { name: 'Web', color: null, icon: null, updatedAt: null });
    assert.equal(lookOf('nope'), undefined);
    assert.equal(heard.count(), 1);
    heard.stop();
  });

  void test('an unchanged read keeps the same object and tells nobody', () => {
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🚀' } }]);
    const before = lookOf('core');
    const heard = counting();
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🚀' } }]);
    assert.equal(lookOf('core'), before);
    assert.equal(heard.count(), 0);
    heard.stop();
  });

  void test('a new icon, colour or name is a change', () => {
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: null }]);
    const heard = counting();
    rememberProjects([
      { slug: 'core', name: 'Core', color: 'teal', icon: { url: '/i?v=1', updated_at: 1 } },
    ]);
    rememberProjects([
      { slug: 'core', name: 'Core', color: 'teal', icon: { url: '/i?v=2', updated_at: 2 } },
    ]);
    rememberProjects([
      { slug: 'core', name: 'Core', color: 'red', icon: { url: '/i?v=2', updated_at: 2 } },
    ]);
    rememberProjects([
      { slug: 'core', name: 'Core 2', color: 'red', icon: { url: '/i?v=2', updated_at: 2 } },
    ]);
    assert.equal(heard.count(), 4);
    assert.deepEqual(lookOf('core'), {
      name: 'Core 2',
      color: 'red',
      icon: { url: '/i?v=2', updated_at: 2 },
      updatedAt: null,
    });
    heard.stop();
  });

  void test('a row that does not send icon keeps the icon already known', () => {
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🎯' } }]);
    rememberProjects([{ slug: 'core', name: 'Core', color: 'blue' }]);
    assert.deepEqual(lookOf('core'), {
      name: 'Core',
      color: 'blue',
      icon: { emoji: '🎯' },
      updatedAt: null,
    });
  });

  void test('an answer older than the one held is ignored, so a late list cannot undo a change', () => {
    rememberProjects([
      { slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🚀' }, updated_at: 20 },
    ]);
    const heard = counting();
    // A list asked for before the change, answered after it.
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: null, updated_at: 10 }]);
    assert.deepEqual(lookOf('core')?.icon, { emoji: '🚀' });
    assert.equal(heard.count(), 0);
    // As new, or newer, is taken.
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: null, updated_at: 20 }]);
    assert.equal(lookOf('core')?.icon, null);
    assert.equal(heard.count(), 1);
    heard.stop();
  });

  void test('an unsubscribed listener is not told, and forgetLooks clears and tells', () => {
    rememberProjects([{ slug: 'core', name: 'Core', color: null, icon: null }]);
    const heard = counting();
    heard.stop();
    rememberProjects([{ slug: 'core', name: 'Core', color: 'teal', icon: null }]);
    assert.equal(heard.count(), 0);

    const again = counting();
    forgetLooks();
    assert.equal(lookOf('core'), undefined);
    assert.equal(again.count(), 1);
    // Nothing to forget: nobody is told.
    forgetLooks();
    assert.equal(again.count(), 1);
    again.stop();
  });
});
