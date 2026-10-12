/**
 * The vendored agent marks (LAI-740).
 *
 * What is asserted is what would break quietly: a slug with no mark falling
 * back to letters nobody noticed, a mark that reaches for another origin
 * (SPEC §13.4), and a mark whose provenance was not written down.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { AGENT_CLIENTS } from '../../../src/api/agent-clients.ts';
import { AGENT_LOGOS, agentLogo } from '../../../src/components/agent-mark/agent-logos.ts';

const NOTICE = readFileSync(
  new URL('../../../src/components/agent-mark/NOTICE.md', import.meta.url),
  'utf8',
);

void describe('every agent has its real mark', () => {
  void test('every slug but `other` has a logo; `other` keeps its monogram', () => {
    const missing = AGENT_CLIENTS.filter(
      (slug) => slug !== 'other' && agentLogo(slug) === undefined,
    );
    assert.deepEqual(missing, [], 'these agents fell back to a monogram');
    assert.equal(agentLogo('other'), undefined, '"another agent" is not a brand');
  });

  void test('every mark is drawable path data', () => {
    for (const [slug, logo] of Object.entries(AGENT_LOGOS)) {
      assert.match(logo.viewBox, /^0 0 \d+ \d+$/, `${slug}'s viewBox`);
      assert.ok(logo.shapes.length > 0, `${slug} has no shapes`);
      for (const shape of logo.shapes) {
        assert.match(shape.d, /^[Mm][\d\s.,\-+eEMmLlHhVvCcSsQqTtAaZz]+$/, `${slug}: not path data`);
        const paint = shape.paint;
        if (typeof paint === 'object') {
          assert.ok(
            logo.gradients?.some((g) => g.id === paint.gradient),
            `${slug}: a shape paints with a gradient it does not define`,
          );
        } else if (paint !== 'ink') {
          assert.match(paint, /^#[0-9A-F]{3,8}$/, `${slug}: ${paint}`);
        }
        if (shape.masked === true) assert.ok(logo.mask !== undefined, `${slug}: mask missing`);
      }
    }
  });
});

void describe('nothing is fetched', () => {
  void test('CONTROL: no drawn field carries a URL or a reference to another document', () => {
    for (const [slug, logo] of Object.entries(AGENT_LOGOS)) {
      const drawn = JSON.stringify({
        viewBox: logo.viewBox,
        shapes: logo.shapes,
        mask: logo.mask,
        gradients: logo.gradients,
      });
      assert.doesNotMatch(
        drawn,
        /https?:|\/\/|url\(|href|xlink/i,
        `${slug} reaches outside the page`,
      );
    }
  });
});

void describe('provenance', () => {
  void test('every mark names where it was downloaded from and under what terms', () => {
    for (const [slug, logo] of Object.entries(AGENT_LOGOS)) {
      assert.match(logo.source, /^https:\/\//, `${slug} has no source`);
      assert.ok(logo.licence.length > 10, `${slug} has no licence line`);
    }
  });

  void test('NOTICE.md lists every source, from both sides', () => {
    const sources = new Set(
      Object.values(AGENT_LOGOS).map((logo) => logo.source.split(' ')[0] ?? ''),
    );
    for (const source of sources) {
      assert.ok(NOTICE.includes(source), `NOTICE.md does not record ${source}`);
    }
    // As sets, not counts (LAI-741): a count is satisfied by one slug listed
    // twice and another missing. `other` is the monogram, listed and not drawn.
    const listed = new Set(
      [...NOTICE.matchAll(/`([a-z-]+)`\s*\|/g)]
        .map((m) => m[1] ?? '')
        .filter((slug) => slug !== 'other'),
    );
    assert.deepEqual(
      [...listed].sort(),
      Object.keys(AGENT_LOGOS).sort(),
      'NOTICE.md and the shipped marks name different slugs',
    );
  });
});
