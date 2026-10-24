/**
 * Old addresses keep working (LAI-796).
 *
 * The navigation was reorganised: Review and Unlisted work became the tabs of
 * Inbox, Capacity and Usage the tabs of Insights, and Connect and Tokens one
 * page, Developer access. A bookmark, a link an agent printed or a teammate
 * pasted names the old page, so every old address answers with its new home,
 * carrying the query it was given.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REDIRECTS, redirectFor } from '../../src/routes/redirects.ts';
import { matchRoute } from '../../src/routes/route-table.ts';

void describe('every old address has a new home', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['/review', '', '/inbox?tab=review'],
    ['/unlisted', '', '/inbox?tab=unlisted'],
    ['/capacity', '', '/insights?tab=capacity'],
    ['/usage', '', '/insights?tab=usage'],
    ['/tokens', '', '/developer?tab=tokens'],
    ['/connect', '', '/developer?tab=connect'],
    ['/developer/connect', '', '/developer?tab=connect'],
  ];

  for (const [from, search, to] of cases) {
    void test(`${from} → ${to}`, () => {
      assert.equal(redirectFor(from, search), to);
    });
  }

  void test('every target is a real route, so a redirect never lands on a 404', () => {
    for (const [from] of cases) {
      const to = redirectFor(from, '');
      assert.ok(to !== undefined, `${from} has no redirect`);
      const path = to.split('?')[0] ?? '';
      assert.ok(
        matchRoute(path) !== undefined,
        `${from} redirects to ${path}, which is not routed`,
      );
    }
  });

  void test('no old address is still a route of its own', () => {
    // A redirect beside a live route would mean two pages for one thing, and
    // which one a reader saw would depend on how they arrived.
    for (const from of Object.keys(REDIRECTS)) {
      assert.equal(matchRoute(from), undefined, `${from} is both routed and redirected`);
    }
  });

  void test('the table is exactly the seven pages that moved', () => {
    assert.deepEqual(Object.keys(REDIRECTS).sort(), [
      '/capacity',
      '/connect',
      '/developer/connect',
      '/review',
      '/tokens',
      '/unlisted',
      '/usage',
    ]);
  });
});

void describe('the query travels with the redirect', () => {
  void test('Connect keeps ?agent=, which a lead sends to set the page to the team’s agent', () => {
    assert.equal(redirectFor('/connect', '?agent=codex'), '/developer?tab=connect&agent=codex');
    // The wizard's own old address keeps the step as well (LAI-997).
    assert.equal(
      redirectFor('/developer/connect', '?agent=codex&step=2'),
      '/developer?tab=connect&agent=codex&step=2',
    );
  });

  void test('Usage keeps whatever it was given', () => {
    assert.equal(redirectFor('/usage', '?days=7'), '/insights?tab=usage&days=7');
  });

  void test('Capacity drops ?project=, as it did when it became one page (LAI-754)', () => {
    assert.equal(redirectFor('/capacity', '?project=laika-core'), '/insights?tab=capacity');
  });

  void test('a tab the old address implied wins over a stray ?tab=', () => {
    assert.equal(redirectFor('/unlisted', '?tab=review'), '/inbox?tab=unlisted');
  });

  void test('a trailing slash is the same old address', () => {
    assert.equal(redirectFor('/tokens/', ''), '/developer?tab=tokens');
  });

  void test('a search with or without its ? is read the same', () => {
    assert.equal(redirectFor('/connect', 'agent=cursor'), '/developer?tab=connect&agent=cursor');
  });
});

void describe('nothing else is redirected', () => {
  void test('a current page answers undefined', () => {
    for (const path of [
      '/board',
      '/inbox',
      '/insights',
      '/developer',
      '/my-day',
      '/organisation',
    ]) {
      assert.equal(redirectFor(path, ''), undefined, `${path} was redirected`);
    }
  });

  void test('a path that only starts like an old one is not it', () => {
    assert.equal(redirectFor('/reviewers', ''), undefined);
    assert.equal(redirectFor('/tokens/abc', ''), undefined);
  });
});
