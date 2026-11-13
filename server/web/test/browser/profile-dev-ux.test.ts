/**
 * The profile's developer tab after its UX pass (LAI-1217), in a real browser.
 *
 * The summary leads with the state and one next step. **Your own** setup's
 * step and section links go into Developer access (`/developer?tab=…`), where
 * the actions live; **someone else's** never link there — `/developer` is the
 * reader's own page — and their only step moves within the tab. Token flags
 * come from the token's own fields; a revoke goes through its confirm and
 * reports its result; the empty state carries its first step; the tab fits a
 * phone; and nothing breaks the CSP.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, reply, until, type ApiStub, type StubCall } from './harness.ts';
import {
  ADMIN_TAB,
  OWN_TAB,
  adminStub,
  ownStub,
  realistic,
  sparse,
} from '../helpers/profile-dev-stub.ts';

void after(async () => {
  await closeBrowser();
});

async function at(path: string, stub: ApiStub, width = 1440, csp = false) {
  return open(path, stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
      if (csp) await withCsp(page);
    },
  });
}

const devLinks = (page: Page) =>
  page.locator('[data-ds-dev-link]').evaluateAll((els) => els.map((el) => el.getAttribute('href')));

void describe('own vs someone else’s (what the server returns, never inferred)', () => {
  void test('your own: the step and every section link into Developer access', async () => {
    const h = await at(OWN_TAB, ownStub(realistic()));
    try {
      const cta = h.page.locator('[data-ds-next]');
      await cta.waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('[data-ds-health] [role="status"]').innerText(),
        '2 things need attention',
      );
      assert.equal(await cta.getAttribute('data-ds-next'), 'link');
      assert.equal(await cta.getAttribute('href'), '/developer?tab=tools');
      assert.equal((await cta.innerText()).trim(), 'Fix in Developer access');
      assert.deepEqual(await devLinks(h.page), [
        '/developer?tab=overview',
        '/developer?tab=tools',
        '/developer?tab=devices',
        '/developer?tab=tools',
        '/developer?tab=projects',
        '/developer?tab=tokens',
      ]);
      assert.equal(await h.page.locator('[data-ds-only-they]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('someone else’s: no link into /developer, a jump step, and who can change it', async () => {
    const h = await at(ADMIN_TAB, adminStub(realistic()));
    try {
      const cta = h.page.locator('[data-ds-next]');
      await cta.waitFor({ timeout: 20_000 });
      assert.equal(await cta.getAttribute('data-ds-next'), 'jump');
      assert.equal(await cta.getAttribute('href'), '#dev-tool-a2');
      assert.deepEqual(await devLinks(h.page), []);
      assert.equal(
        (await h.page.locator('[data-ds-only-they]').innerText()).trim(),
        'Only Rowan can add, pair or fix things, from their own Developer access.',
      );
      assert.ok(
        !(await h.page.locator('[data-ds-ready]').innerHTML()).includes('href="/developer'),
        'no /developer href anywhere in someone else’s setup',
      );
      // can_revoke from the read: the revokes are offered.
      assert.ok((await h.page.getByRole('button', { name: /^Actions for / }).count()) > 0);
    } finally {
      await h.close();
    }
  });

  void test('someone else’s with can_revoke false: no revoke offered anywhere', async () => {
    const h = await at(ADMIN_TAB, adminStub(realistic({ can_revoke: false })));
    try {
      await h.page.locator('[data-ds-owner-note]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: /^Actions for / }).count(), 0);
      assert.deepEqual(await devLinks(h.page), []);
    } finally {
      await h.close();
    }
  });
});

void describe('the summary and its next step', () => {
  void test('the step follows in-app into Developer access’s Tools tab', async () => {
    const h = await at(OWN_TAB, ownStub(realistic()));
    try {
      const cta = h.page.locator('[data-ds-next="link"]');
      await cta.waitFor({ timeout: 20_000 });
      await cta.click();
      await until(() => new URL(h.page.url()).pathname === '/developer');
      const url = new URL(h.page.url());
      assert.equal(`${url.pathname}${url.search}`, '/developer?tab=tools');
    } finally {
      await h.close();
    }
  });

  void test('someone else’s step moves focus to the first issue', async () => {
    const h = await at(ADMIN_TAB, adminStub(realistic()));
    try {
      const cta = h.page.locator('[data-ds-next="jump"]');
      await cta.waitFor({ timeout: 20_000 });
      await cta.click();
      await until(() => h.page.evaluate(() => document.activeElement?.id === 'dev-tool-a2'));
      assert.equal(await h.page.evaluate(() => document.activeElement?.id), 'dev-tool-a2');
      assert.ok(new URL(h.page.url()).pathname === '/people', 'it stays on the profile');
    } finally {
      await h.close();
    }
  });

  void test('a device row names its tools with their state', async () => {
    const h = await at(OWN_TAB, ownStub(realistic()));
    try {
      const row = h.page.locator('[data-ds-device="d1"] [data-ds-device-tool-list]');
      await row.waitFor({ timeout: 20_000 });
      assert.match(await row.innerText(), /Claude Code[\s\S]*Codex/);
      assert.equal(
        (await h.page.locator('[data-ds-device-tool="a2"] .visually-hidden').innerText()).trim(),
        ': Needs setup',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('token flags, from the fixture’s own fields', () => {
  void test('never used, unused 90+ days and expiring soon are flagged and counted', async () => {
    const h = await at(OWN_TAB, ownStub(realistic()));
    try {
      await h.page.locator('[data-ds-token="p5"]').waitFor({ timeout: 20_000 });
      const flags = await h.page
        .locator('[data-ds-token]')
        .evaluateAll((els): Record<string, string | null> =>
          Object.fromEntries(
            els.map(
              (e) =>
                [
                  e.getAttribute('data-ds-token') ?? '',
                  e.getAttribute('data-ds-token-flags'),
                ] as const,
            ),
          ),
        );
      assert.equal(flags.p1, '');
      assert.equal(flags.p4, 'never');
      assert.equal(flags.p5, 'stale');
      assert.equal(flags.p6, 'expiring');
      assert.equal(flags['c-a2'], 'never');
      assert.equal(
        (await h.page.locator('[data-ds-token="p5"] [data-ds-token-flag]').innerText()).trim(),
        'Unused 90+ days',
      );
      assert.equal(
        (await h.page.locator('[data-ds-token="p6"] [data-ds-token-flag]').innerText()).trim(),
        'Expires soon',
      );
      const attn = h.page.locator('[data-ds-attn-tokens]');
      assert.equal(await attn.getAttribute('data-ds-attn-tokens'), '4');
      assert.match(await attn.innerText(), /^4 tokens to review/);
    } finally {
      await h.close();
    }
  });
});

void describe('revoke: confirm, then the result', () => {
  void test('a flagged token is revoked through its confirm, and the result is said', async () => {
    const calls: StubCall[] = [];
    const h = await at(
      ADMIN_TAB,
      adminStub(realistic(), {
        '/api/v1/users/u2/tokens/p5': (c: StubCall) => {
          calls.push(c);
          return reply(204, null);
        },
      }),
    );
    try {
      const more = h.page.getByRole('button', { name: 'Actions for backup-script' });
      await more.click({ timeout: 20_000 });
      await h.page.getByRole('menuitem', { name: 'Revoke token…' }).click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /What stops working/i);
      assert.equal(calls.length, 0, 'nothing is revoked before the confirm');
      await dialog.getByRole('button', { name: 'Revoke token' }).click();
      await h.page.locator('[data-ds-done]').waitFor();
      assert.deepEqual(
        calls.map((c) => [c.method, c.path]),
        [['DELETE', '/api/v1/users/u2/tokens/p5']],
      );
      assert.equal(
        (await h.page.locator('[data-ds-done]').innerText()).trim(),
        'Token revoked. Rowan was notified.',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('empty states', () => {
  void test('your own, nothing set up: the first step is pairing a device', async () => {
    const h = await at(OWN_TAB, ownStub(sparse()));
    try {
      const empty = h.page.locator('[data-ds-empty]');
      await empty.waitFor({ timeout: 20_000 });
      const cta = empty.locator('[data-ds-next="link"]');
      assert.equal((await cta.innerText()).trim(), 'Pair a device');
      assert.equal(await cta.getAttribute('href'), '/developer?tab=devices');
      assert.equal(
        await empty.locator('[data-ds-dev-link="empty-add-tool"]').getAttribute('href'),
        '/developer?tab=connect',
      );
    } finally {
      await h.close();
    }
  });

  void test('someone else’s, nothing set up: the honest words and no step', async () => {
    const h = await at(ADMIN_TAB, adminStub(sparse()));
    try {
      const empty = h.page.locator('[data-ds-empty]');
      await empty.waitFor({ timeout: 20_000 });
      assert.match(await empty.innerText(), /Admins can’t set it up for them/);
      assert.equal(await h.page.locator('[data-ds-next]').count(), 0);
      assert.deepEqual(await devLinks(h.page), []);
    } finally {
      await h.close();
    }
  });
});

void describe('a phone at 390', () => {
  void test('the summary stacks and nothing scrolls sideways', async () => {
    const h = await at(OWN_TAB, ownStub(realistic()), 390);
    try {
      const cta = h.page.locator('[data-ds-next]');
      await cta.waitFor({ timeout: 20_000 });
      const overflow = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
      const lead = await h.page.locator('[data-ds-summary]').boundingBox();
      const box = await cta.boundingBox();
      assert.ok(lead !== null && box !== null);
      assert.ok(box.x + box.width <= 390, 'the step is on the phone');
      assert.ok(box.width > lead.width * 0.8, 'the step runs the lead’s width');
      const columns = await h.page
        .locator('.ds-tiles')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(columns, 2);
    } finally {
      await h.close();
    }
  });
});

/* --- the CSP ------------------------------------------------------------- */

/** The runtime directives of the server's CSP (copied as `overlays.test.ts` does). */
function policy(html: string): string {
  const hashes = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem ${["'self'", ...hashes].join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}

async function withCsp(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(event.effectiveDirective + ' ' + event.blockedURI);
      });
    `,
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), 'content-security-policy': policy(body) },
    });
  });
}

const violations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

void describe('CSP', () => {
  void test('the tab, both views, draws with zero violations — and the check is live', async () => {
    for (const [path, stub] of [
      [OWN_TAB, ownStub(realistic())],
      [ADMIN_TAB, adminStub(realistic())],
    ] as const) {
      const h = await at(path, stub, 1440, true);
      try {
        await h.page.locator('[data-ds-next]').waitFor({ timeout: 20_000 });
        // A token flag chip has drawn (the shared Chip and its glyphs).
        await h.page.locator('[data-ds-token-flag]').first().waitFor();
        assert.deepEqual(await violations(h.page), []);
        // Check the check: an injected <style> must be refused.
        await h.page.evaluate(() => {
          const style = document.createElement('style');
          style.textContent = 'body { outline: 1px solid; }';
          document.head.append(style);
          style.remove();
        });
        await until(async () => (await violations(h.page)).length > 0);
        assert.ok((await violations(h.page)).some((v) => v.startsWith('style-src-elem')));
      } finally {
        await h.close();
      }
    }
  });
});
