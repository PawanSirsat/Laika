/**
 * `src/components/shell-chrome.ts` (LAI-062).
 *
 * The bug this guards is only visible **without** a session, which is why the
 * rule lives in a function that can be handed one. Signed out, `/login`,
 * `/setup` and `/invite` each rendered the full sidebar — eight protected
 * destinations beside the words "Not signed in", every one bouncing straight
 * back to `/login`. Anything tested while holding a session sees none of it.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { showsAppNav } from '../../src/components/shell-chrome.ts';
import { code } from '../helpers/code.ts';

const USER = {
  id: '01M0T6D7VM2JX3C58YDHB2FFXT',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  org_role: 'owner',
  memberships: [],
} as never;

void describe('the app nav belongs to a session, not to a route', () => {
  void test('signed out gets no application nav', () => {
    assert.equal(showsAppNav({ status: 'anonymous' }), false);
  });

  void test('still checking gets no application nav', () => {
    // Nav offered before the session resolves is nav that may be about to
    // bounce. A reader who clicks it lands on /login having done nothing wrong.
    assert.equal(showsAppNav({ status: 'loading' }), false);
  });

  void test('a failed session check gets no application nav', () => {
    assert.equal(showsAppNav({ status: 'error', error: new Error('nope') }), false);
  });

  void test('signed in gets it', () => {
    assert.equal(showsAppNav({ status: 'authenticated', user: USER }), true);
  });

  void test('only "authenticated" passes — every other state is closed', () => {
    // Written as an exhaustive sweep rather than three separate asserts so a
    // fifth session state added later fails here instead of silently picking up
    // whichever default it happens to get. That defaulting is the whole bug.
    const states = [
      { status: 'loading' },
      { status: 'anonymous' },
      { status: 'error', error: null },
      { status: 'authenticated', user: USER },
    ] as const;

    const allowed = states.filter((s) => showsAppNav(s)).map((s) => s.status);
    assert.deepEqual(allowed, ['authenticated']);
  });
});

void describe('the shell actually applies the rule', () => {
  void test('AppShell gates the sidebar on it, not on the path', async () => {
    const src = code(
      await readFile(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8'),
    );

    assert.ok(src.includes('showsAppNav(session)'), 'AppShell must ask the rule');
    assert.match(src, /\{signedIn && \(\s*<Sidebar/, 'the sidebar must be behind the rule');

    // Gating on the route is the mistake being fixed: a list of pre-auth paths
    // has to be maintained by hand, so the next route added inherits whatever
    // default it lands on.
    assert.ok(
      !/routeIsPublic[\s\S]{0,80}<Sidebar/.test(src),
      'the sidebar must not be gated on which route is showing',
    );
  });

  void test('nothing else renders the sidebar behind the shell’s back', async () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const files = (await readdir(src, { recursive: true }))
      .filter((f) => typeof f === 'string' && f.endsWith('.tsx'))
      .map((f) => join(src, f));

    const renderers: string[] = [];
    for (const file of files) {
      const text = code(await readFile(file, 'utf8'));
      if (/<Sidebar[\s/>]/.test(text)) renderers.push(file.slice(src.length));
    }

    assert.deepEqual(
      renderers,
      ['components/AppShell.tsx'],
      'one gate, one place — a second caller would be a second policy',
    );
  });

  void test('the identity survives without the navigation', async () => {
    // AC4: a signed-out page carries no nav but must still say what it is.
    // The brand used to live inside the sidebar, so removing one removed both.
    const shell = code(
      await readFile(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8'),
    );
    const sidebar = code(
      await readFile(new URL('../../src/components/Sidebar.tsx', import.meta.url), 'utf8'),
    );

    assert.ok(shell.includes('<Brand />'), 'the shell must show the brand when there is no nav');
    assert.ok(sidebar.includes('<Brand />'), 'and the sidebar must show the same one');
  });

  void test('the theme control is outside the gate', async () => {
    // AC3: someone setting up an instance at night should not have to sign in
    // to stop being dazzled.
    const src = code(
      await readFile(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8'),
    );
    const gated = /\{signedIn &&[\s\S]{0,400}<ThemeToggle/.test(src);
    assert.ok(!gated, 'the theme toggle must render pre-auth');
    assert.ok(src.includes('<ThemeToggle />'));
  });
});
