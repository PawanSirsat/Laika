/** `src/routes/space-settings-url.ts` (LAI-977): one spelling of the address. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { spaceSettingsHref } from '../../src/routes/space-settings-url.ts';
import { matchRoute, routeParams } from '../../src/routes/route-table.ts';

void describe('spaceSettingsHref', () => {
  void test('is /spaces/<slug>/settings, with a tab when asked', () => {
    assert.equal(spaceSettingsHref('laika'), '/spaces/laika/settings');
    assert.equal(spaceSettingsHref('laika', 'access'), '/spaces/laika/settings?tab=access');
  });

  void test('is the route the table matches, and gives the slug back', () => {
    const route = matchRoute(spaceSettingsHref('laika-core'));
    assert.equal(route?.path, '/spaces/:slug/settings');
    assert.deepEqual(routeParams('/spaces/:slug/settings', '/spaces/laika-core/settings'), {
      slug: 'laika-core',
    });
  });

  void test('an empty or extra segment is not the route', () => {
    assert.equal(matchRoute('/spaces//settings'), undefined);
    assert.equal(matchRoute('/spaces/a/b/settings'), undefined);
    assert.equal(routeParams('/board', '/board'), undefined, 'a path with no parameter');
  });
});
