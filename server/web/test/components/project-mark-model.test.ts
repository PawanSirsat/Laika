/**
 * `src/components/project-mark-model.ts` (D-152, LAI-1311): an image, else an
 * emoji, else the first letter on the space's colour — what was last read for
 * the slug winning over the site's own copy — and a broken image falling back
 * to the letter.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { markLetter, markName, markOf } from '../../src/components/project-mark-model.ts';
import { spaceColor } from '../../src/theme/space-color.ts';

const IMAGE = { url: '/api/v1/projects/core/icon?v=3', updated_at: 3 };

void describe('markOf', () => {
  void test('draws the image, else the emoji, else the letter on the colour', () => {
    assert.deepEqual(
      markOf({ slug: 'core', name: 'Core', color: 'teal', icon: IMAGE }, undefined),
      {
        kind: 'image',
        url: IMAGE.url,
      },
    );
    assert.deepEqual(
      markOf({ slug: 'core', name: 'Core', color: 'teal', icon: { emoji: '🚀' } }, undefined),
      { kind: 'emoji', emoji: '🚀', color: 'teal' },
    );
    assert.deepEqual(markOf({ slug: 'core', name: 'core', color: 'teal', icon: null }, undefined), {
      kind: 'letter',
      letter: 'C',
      color: 'teal',
    });
  });

  void test('with no colour, the letter takes the slug-derived one', () => {
    const mark = markOf({ slug: 'laika-web', name: 'Web' }, undefined);
    assert.deepEqual(mark, {
      kind: 'letter',
      letter: 'W',
      color: spaceColor({ slug: 'laika-web', color: null }),
    });
  });

  void test('the icon last read for the slug wins over the site’s own copy', () => {
    const look = { name: 'Core', color: 'red' as const, icon: { emoji: '🎯' }, updatedAt: null };
    assert.deepEqual(markOf({ slug: 'core', name: 'Core', color: 'teal', icon: null }, look), {
      kind: 'emoji',
      emoji: '🎯',
      color: 'teal',
    });
    // A look that cleared the icon clears it everywhere, the site's stale copy too.
    const cleared = { name: 'Core', color: 'red' as const, icon: null, updatedAt: null };
    assert.deepEqual(markOf({ slug: 'core', name: 'Core', icon: IMAGE }, cleared), {
      kind: 'letter',
      letter: 'C',
      color: 'red',
    });
  });

  void test('the colour is the site’s when it has one — a save hands the page the newest', () => {
    const look = { name: 'Core', color: 'red' as const, icon: null, updatedAt: null };
    assert.deepEqual(markOf({ slug: 'core', name: 'Core', color: 'teal' }, look), {
      kind: 'letter',
      letter: 'C',
      color: 'teal',
    });
    // A site that sends no colour (`null` is "none stored") takes the slug's, not the look's.
    assert.deepEqual(markOf({ slug: 'core', name: 'Core', color: null }, look), {
      kind: 'letter',
      letter: 'C',
      color: spaceColor({ slug: 'core', color: null }),
    });
  });

  void test('an image that would not load gives way to the letter', () => {
    assert.deepEqual(
      markOf({ slug: 'core', name: 'Core', color: 'teal', icon: IMAGE }, undefined, IMAGE.url),
      { kind: 'letter', letter: 'C', color: 'teal' },
    );
    // Only that image: a new one is tried.
    assert.equal(
      markOf({ slug: 'core', name: 'Core', icon: { ...IMAGE, url: '/new' } }, undefined, IMAGE.url)
        .kind,
      'image',
    );
  });
});

void describe('markLetter and markName', () => {
  void test('the first grapheme of the name, upper-cased; the slug when the name is blank', () => {
    assert.equal(markLetter('  laika', 'x'), 'L');
    assert.equal(markLetter('élan', 'x'), 'É');
    assert.equal(markLetter('   ', 'docs'), 'D');
    assert.equal(markLetter('🚀 Rockets', 'x'), '🚀');
  });

  void test('the site’s name, else the one last read, else the slug', () => {
    const look = { name: 'From the list', color: null, icon: null, updatedAt: null };
    assert.equal(markName({ slug: 's', name: 'Here' }, look), 'Here');
    assert.equal(markName({ slug: 's' }, look), 'From the list');
    assert.equal(markName({ slug: 's' }, undefined), 's');
  });
});
