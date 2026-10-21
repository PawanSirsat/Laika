/**
 * Which agent proposed a draft, in a real browser (LAI-835): the row's badge
 * and the inspector name it — *claude-code*, *Proposed by claude-code* — and
 * a board that does not say keeps the old words, *agent* and *Proposed by an
 * agent*.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';
import { TODAY, viewOf, weekData, weekStub, type Draft } from './my-day-week.ts';

function stub(client: string | undefined): ApiStub {
  const data = weekData();
  const today = data.get(TODAY);
  if (today !== undefined && client !== undefined) {
    today.drafts = today.drafts.map((d): Draft => (d.id === 'd5' ? { ...d, client } : d));
  }
  return { ...weekStub(data), [`/api/v1/me/time?day=${TODAY}`]: () => viewOf(TODAY, data) };
}

async function openToday(client: string | undefined): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(client));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

async function badgeAndSource(h: Harness): Promise<[string, string]> {
  const row = h.page.locator('li', { has: h.page.locator('[data-select="d5"]') });
  const badge = ((await row.locator('.myday-source').textContent()) ?? '').trim();
  await h.page.locator('[data-select="d5"]').click();
  const inspector = h.page.locator('[data-inspector-for="d5"]');
  await inspector.waitFor({ timeout: 5_000 });
  const source = ((await inspector.locator('.inspector-source').textContent()) ?? '').trim();
  return [badge, source];
}

after(async () => {
  await closeBrowser();
});

void describe('which agent proposed a draft (LAI-835)', () => {
  void test('the row and the inspector name the agent', async () => {
    const h = await openToday('claude-code');
    try {
      const [badge, source] = await badgeAndSource(h);
      assert.equal(badge, 'claude-code');
      assert.match(source, /^Proposed by claude-code · “Reviewed the retry backoff”$/);
    } finally {
      await h.close();
    }
  });

  void test('a board that does not say keeps the old words', async () => {
    const h = await openToday(undefined);
    try {
      const [badge, source] = await badgeAndSource(h);
      assert.equal(badge, 'agent');
      assert.match(source, /^Proposed by an agent · “Reviewed the retry backoff”$/);
    } finally {
      await h.close();
    }
  });
});
