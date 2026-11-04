/**
 * *Update your Laika CLI* (LAI-1086), in a real browser against a stubbed
 * board: the guide's content, and every place it is offered — and not.
 *
 * - Tool details: on Update available, Update required and Version unknown
 *   (which also says how to make the version appear); never on Up to date.
 * - The guide: four steps in order, the board's build from its compatibility
 *   answer, check before update, `--allow-http` only on a plain-http board,
 *   no secret anywhere.
 * - Device details: when one of its tools needs it, and not when all are up
 *   to date.
 * - Overview: no notice of its own since LAI-1096. A tool whose helper is
 *   Update required is behind the Connection status card's tools chip, and
 *   its link opens that tool's Details, where the guide is.
 * - Add device and Add tool: *Already have Laika installed?* before the
 *   `laika` command.
 * - An older CLI (LAI-1093): where `laika` comes from, then a fresh install
 *   filled from the board's own `cli.source` — never a `pull` of a checkout
 *   at `~/laika` that may not be there, or may be detached — and every
 *   command on every placement pastes as it stands.
 * - 390 px, both themes: no sideways scroll with the guide open.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save screenshots of each placement, light
 * and dark, at 1440 and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { checkoutPull, hazardsIn } from '../routes/screens/developer/v3/shell-words.ts';
import {
  BOARD,
  NOW,
  SECRET,
  agentRow,
  compat,
  report,
  stub,
  unfold,
  verification,
  type StubOver,
} from './developer-v3-fixtures.ts';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type Harness,
  type OpenOptions,
  type StubCall,
} from './harness.ts';

after(async () => {
  await closeBrowser();
});

const tool = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const toolPanel = (page: Page, id: string) =>
  page.locator(`.side-panel[data-panel="tool"] .dv3-tool-details[data-agent="${id}"]`);
const devicePanel = (page: Page) => page.locator('.side-panel[data-panel="device"]');

async function openTools(over: StubOver = {}, options: OpenOptions = {}): Promise<Harness> {
  const h = await open('/developer?tab=tools', stub(over), options);
  await tool(h.page, 'a1').waitFor({ timeout: 20_000 });
  for (const id of ['a1', 'a2', 'a3']) {
    await until(async () => {
      const key = await tool(h.page, id).getAttribute('data-update');
      return key !== null && key !== 'checking';
    }, 15_000);
  }
  return h;
}

/**
 * Open one tool's details, closing any other first, and its Helper section —
 * one folded row since LAI-1100 — where the guide is offered.
 */
async function details(page: Page, id: string): Promise<Locator> {
  const panel = page.locator('.side-panel[data-panel="tool"]');
  if ((await toolPanel(page, id).count()) > 0) return toolPanel(page, id);
  if ((await panel.count()) > 0) {
    await panel.getByRole('button', { name: 'Close details' }).click();
    await panel.waitFor({ state: 'detached' });
  }
  await tool(page, id).locator(`[data-details="tools:${id}"]`).click();
  await toolPanel(page, id).waitFor({ timeout: 10_000 });
  await unfold(toolPanel(page, id), 'helper');
  return toolPanel(page, id);
}

/** Open a placement's guide and wait for the board's build to be read. */
async function openGuide(scope: Locator): Promise<Locator> {
  const help = scope.locator('details.dv3-cli-help');
  await help.locator('summary').click();
  const guide = help.locator('[data-update-cli-guide]');
  await guide.waitFor();
  await until(
    async () => (await guide.locator('.dv3-cli-board').getAttribute('data-board-build')) === '',
  );
  return guide;
}

const wide = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

void describe('Tool details: where the guide is offered', () => {
  void test('Update required and Version unknown link to it; Up to date does not', async () => {
    const h = await openTools();
    try {
      assert.equal(await tool(h.page, 'a2').getAttribute('data-update'), 'required');
      assert.equal(await tool(h.page, 'a3').getAttribute('data-update'), 'unknown');
      assert.equal(await tool(h.page, 'a1').getAttribute('data-update'), 'up-to-date');

      const required = await details(h.page, 'a2');
      assert.equal(await required.locator('[data-update-cli="tool"]').count(), 1);
      assert.equal(
        await required.locator('[data-update-cli="tool"] > summary').innerText(),
        'How to update your Laika CLI',
      );
      assert.equal(await required.locator('[data-version-unknown-hint]').count(), 0);

      const unknown = await details(h.page, 'a3');
      assert.equal(await unknown.locator('[data-update-cli="tool"]').count(), 1);
      assert.equal(
        await unknown.locator('[data-version-unknown-hint]').innerText(),
        'To make its version appear, run laika update on that device: it reports the helper’s version to this board, even when it is already current. If laika update is an unknown command there, that CLI is older still: How to update your Laika CLI, below, has the steps for it.',
      );

      const current = await details(h.page, 'a1');
      assert.equal(await current.locator('[data-update-cli]').count(), 0);
      assert.equal(await current.locator('[data-version-unknown-hint]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Update available links to it; Could not check does not', async () => {
    const h = await openTools({
      board: 'p3',
      verifications: {
        a1: verification('a1', 'claude-code', report({ cli_commit: null, protocol: 2 }), true),
        a2: refuse(500, 'internal', 'later'),
      },
    });
    try {
      assert.equal(await tool(h.page, 'a1').getAttribute('data-update'), 'available');
      assert.equal(await tool(h.page, 'a2').getAttribute('data-update'), 'unchecked');
      assert.equal(
        await (await details(h.page, 'a1')).locator('[data-update-cli="tool"]').count(),
        1,
      );
      assert.equal(await (await details(h.page, 'a2')).locator('[data-update-cli]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the guide', () => {
  void test('four steps in order, this board’s build, check before update, no secret', async () => {
    const h = await openTools();
    try {
      const guide = await openGuide(await details(h.page, 'a2'));
      assert.deepEqual(
        await guide
          .locator('[data-guide-step]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-guide-step'))),
        ['check', 'update', 'older', 'after'],
      );
      assert.deepEqual(await guide.locator('.dv3-cli-step-title').allInnerTexts(), [
        '1\nCheck which CLI you have',
        '2\nUpdate it with laika update',
        '3\nAn older CLI, without laika update',
        '4\nAfter updating',
      ]);
      // From the compatibility answer, never written into the page.
      assert.equal(
        await guide.locator('.dv3-cli-board').innerText(),
        'This board runs build cea011d and speaks helper protocol 2; it accepts helpers from protocol 1.',
      );
      const pre = (step: string) => guide.locator(`[data-guide-step="${step}"] pre`).innerText();
      assert.equal(await pre('check'), 'laika version');
      assert.equal(
        await pre('update'),
        `laika update --check --board ${h.origin}\nlaika update --board ${h.origin}`,
      );
      // LAI-1093: where this laika comes from, then a fresh install from the board's
      // own source and commit — no pull of a checkout that may be elsewhere or detached.
      assert.deepEqual(await guide.locator('[data-guide-step="older"] pre').allInnerTexts(), [
        'ls -l "$(command -v laika)"',
        [
          'git clone https://github.com/PawanSirsat/Laika.git ~/laika &&',
          `git -C ~/laika checkout --detach ${BOARD} &&`,
          '~/laika/plugin/scripts/install.sh --no-credential',
        ].join('\n'),
        [
          'git -C ~/laika fetch origin &&',
          `git -C ~/laika checkout --detach ${BOARD} &&`,
          '~/laika/plugin/scripts/install.sh --no-credential',
        ].join('\n'),
        'hash -r\nlaika version',
        'ln -sf ~/laika/cli/bin/laika "$(command -v laika)"',
      ]);
      assert.equal(await pre('after'), 'laika doctor');
      const text = await guide.innerText();
      assert.match(
        text,
        /If it answers laika: unknown command "version", your CLI is older than this board/,
      );
      assert.match(text, /If it prints a commit, use step 2/);
      assert.match(text, /If laika update is an unknown command, use step 3/);
      const older = await guide.locator('[data-guide-step="older"]').innerText();
      assert.match(
        older,
        /ending in \/cli\/bin\/laika: the folder that holds cli is the old checkout/,
      );
      assert.match(
        older,
        /leaves a checkout anywhere else untouched: delete that folder once laika version answers/,
      );
      assert.match(
        older,
        /If ~\/laika already exists, this instead: it fetches rather than clones/,
      );
      assert.match(older, /look for laika again \(hash -r, in zsh and bash alike\)/);
      assert.doesNotMatch(older, /\brehash\b/);
      assert.match(older, /something else called laika is already on your PATH/);
      assert.match(older, /When that line starts with l \(a link\)/);
      assert.equal(await guide.locator('[data-fresh-default]').count(), 0);
      assert.doesNotMatch(text, /\bpull\b|readlink/);
      assert.match(text, /Restart Claude Code/);
      assert.match(text, /open \/hooks in Codex/);
      assert.doesNotMatch(text, /reset|--force|stash/);
      // Loopback is not plain http off the machine: no --allow-http.
      assert.equal(await guide.locator('[data-allow-http]').count(), 0);
      assert.doesNotMatch(text, /--allow-http/);
      assert.doesNotMatch(await h.page.locator('body').innerText(), new RegExp(SECRET));
    } finally {
      await h.close();
    }
  });

  void test('a plain-http board adds --allow-http to the update, and says why', async () => {
    const h = await openTools({}, { insecure: true });
    try {
      const guide = await openGuide(await details(h.page, 'a2'));
      const update = await guide.locator('[data-guide-step="update"] pre').innerText();
      assert.match(update, /^laika update --check --board http:\/\/laika\.test:\d+\n/);
      assert.match(update, /\nlaika update --board http:\/\/laika\.test:\d+ --allow-http$/);
      assert.match(
        await guide.locator('[data-allow-http]').innerText(),
        /plain http[\s\S]*unless you add --allow-http/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Device details', () => {
  void test('the guide when one of its tools needs it; none when every one is up to date', async () => {
    const h = await open('/developer?tab=devices&device=d1', stub());
    try {
      await devicePanel(h.page).waitFor({ timeout: 20_000 });
      await until(
        async () =>
          (await devicePanel(h.page)
            .locator('[data-device-update]')
            .getAttribute('data-device-update')) === 'required',
        15_000,
      );
      assert.equal(await devicePanel(h.page).locator('[data-update-cli="device"]').count(), 1);
    } finally {
      await h.close();
    }

    const current = await open(
      '/developer?tab=devices&device=d1',
      stub({
        agents: [agentRow('a1', 'claude-code')],
        verifications: { a1: verification('a1', 'claude-code', report(), true) },
      }),
    );
    try {
      await devicePanel(current.page).waitFor({ timeout: 20_000 });
      await until(
        async () =>
          (await devicePanel(current.page)
            .locator('[data-device-update]')
            .getAttribute('data-device-update')) === 'up-to-date',
        15_000,
      );
      assert.equal(await devicePanel(current.page).locator('[data-update-cli]').count(), 0);
    } finally {
      await current.close();
    }
  });
});

void describe('Overview', () => {
  const overview = (page: Page) => page.locator('[data-testid="dev-overview"]');
  const chip = (page: Page) => page.locator('[data-status] [data-attention] > button');
  /** Every report read, and the board's own answer: nothing left to arrive. */
  const settled = async (h: Harness, reports: number) => {
    await until(
      () =>
        h.calls.filter((c) => c.path.endsWith('/verification')).length >= reports &&
        h.calls.some((c) => c.path === '/api/v1/developer/compatibility'),
      15_000,
    );
    await h.page.waitForLoadState('networkidle');
  };

  void test('no notice: the tool to update is behind the tools chip, its Details one click on (LAI-1096)', async () => {
    const h = await open('/developer?tab=overview', stub());
    try {
      await overview(h.page).waitFor({ timeout: 20_000 });
      await settled(h, 3);
      // Update required (a2) needs the reader; Version unknown (a3) does not.
      assert.equal(await chip(h.page).textContent(), '1 needs an update▾');
      assert.equal(await h.page.locator('[data-cli-notice], [data-update-cli]').count(), 0);
      await chip(h.page).click();
      const items = h.page.locator('[data-attention] li');
      assert.deepEqual(await items.evaluateAll((els) => els.map((el) => el.dataset.agent)), ['a2']);
      await items.getByRole('link', { name: /^Open details →\s*: Codex · Belka$/ }).click();
      // Tool details, where the guide is offered (as the first describe asserts)
      // once the panel has read the tool's report again — in its Helper section.
      await unfold(toolPanel(h.page, 'a2'), 'helper');
      await toolPanel(h.page, 'a2')
        .locator('[data-update-cli="tool"]')
        .waitFor({ timeout: 20_000 });
      assert.equal(await toolPanel(h.page, 'a2').locator('[data-update-cli="tool"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('no notice and no chip to open when every tool is up to date', async () => {
    const h = await open(
      '/developer?tab=overview',
      stub({
        agents: [agentRow('a1', 'claude-code'), agentRow('a2', 'codex')],
        verifications: {
          a1: verification('a1', 'claude-code', report(), true),
          a2: verification('a2', 'codex', report()),
        },
      }),
    );
    try {
      await overview(h.page).waitFor({ timeout: 20_000 });
      // Both reports read, and nothing to say.
      await settled(h, 2);
      assert.equal(await h.page.locator('[data-cli-notice], [data-update-cli]').count(), 0);
      assert.equal(await h.page.locator('[data-attention]').count(), 0);
      assert.equal(
        await h.page.locator('[data-status] [data-stat="tools"] .dx-chip').textContent(),
        'Connected',
      );
    } finally {
      await h.close();
    }
  });
});

const pairing = {
  id: 'p1',
  state: 'open',
  kind: 'local',
  display_name: 'Strelka',
  device_id: null,
  claimed: null,
  created_at: NOW,
  expires_at: NOW + 10 * 60_000,
  decided_at: null,
  completed_at: null,
};

/** Add device: a pairing request is made, and nothing claims it yet. */
function addDeviceStub() {
  return stub({
    agents: [],
    routes: {
      '/api/v1/devices/pairing-requests': (call: StubCall) =>
        call.method === 'POST'
          ? reply(201, {
              pairing,
              user_code: 'K7W4-X2P8-M3QR-T9VA',
              command: 'laika device pair --board http://board.test --code K7W4-X2P8-M3QR-T9VA',
            })
          : refuse(405, 'method_not_allowed', 'no'),
      '/api/v1/devices/pairing-requests/p1': pairing,
    },
  });
}

const exchange = {
  id: 'x1',
  state: 'open',
  purpose: 'install',
  agent_id: 'a9',
  device_id: 'd1',
  created_at: NOW,
  expires_at: NOW + 600_000,
  redeemed_at: null,
};

/** Add tool on the paired device: an exchange is made, and nothing redeems it yet. */
function addToolStub() {
  return stub({
    agents: [],
    routes: {
      '/api/v1/devices/d1/tools': () =>
        reply(201, {
          agent: { ...agentRow('a9', 'claude-code'), tokens: [] },
          exchange,
          command: 'laika tool add claude-code --exchange x1',
          revokes_on_redeem: [],
        }),
      '/api/v1/tool-setup/x1': exchange,
    },
  });
}

/** Into the Add device wizard's step 2, where the command is. */
async function toPairCommand(page: Page): Promise<Locator> {
  const wizard = page.locator('[data-wizard="device"]');
  await wizard.waitFor({ timeout: 20_000 });
  await page.getByLabel('Device name').fill('Strelka');
  await page.getByLabel('Device name').press('Enter');
  await until(async () => (await wizard.getAttribute('data-step')) === '2');
  await wizard.locator('[data-update-cli="add-device"]').waitFor();
  return wizard;
}

/** Into the Add tool wizard's step 2, where the command is. */
async function toToolCommand(page: Page): Promise<Locator> {
  const wizard = page.locator('[data-wizard="tool"]');
  await wizard.waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /Get the command/ }).click();
  await until(async () => (await wizard.getAttribute('data-step')) === '2');
  await wizard.locator('[data-update-cli="add-tool"]').waitFor();
  return wizard;
}

void describe('the wizards: before the laika command', () => {
  /** Whether `a` comes before `b` in the document. */
  const before = async (a: Locator, b: Locator): Promise<boolean> => {
    const other = await b.elementHandle();
    assert.ok(other !== null);
    return a.evaluate(
      (el, o) => Boolean(el.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING),
      other,
    );
  };

  void test('Add device: “Already have Laika installed? Make sure it’s current”, then the command', async () => {
    const h = await open('/developer?tab=devices&add=device', addDeviceStub());
    try {
      // Step 1 does not show it: no command yet.
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-wizard="device"] [data-update-cli]').count(), 0);
      const wizard = await toPairCommand(h.page);
      const help = wizard.locator('[data-update-cli="add-device"]');
      assert.equal(
        await help.locator('summary').innerText(),
        'Already have Laika installed? Make sure it’s current',
      );
      assert.equal(await before(help, wizard.locator('.conn-block').first()), true);
      // Folded until asked: the command is still the step's only block.
      assert.match(await wizard.locator('pre').innerText(), /laika device pair/);
      await openGuide(wizard);
      assert.equal(await wizard.locator('[data-guide-step]').count(), 4);
    } finally {
      await h.close();
    }
  });

  void test('Add device, already installed: update through the guide first, then the pair command alone', async () => {
    const h = await open('/developer?tab=devices&add=device', addDeviceStub());
    try {
      const wizard = h.page.locator('[data-wizard="device"]');
      await wizard.waitFor({ timeout: 20_000 });
      // The choice's own label, as a person clicks it: its styling covers the input
      // (one compact line since LAI-1097, its sub-text the help line under it).
      await wizard.locator('[data-installed-choice] label', { hasText: 'Yes' }).click();
      assert.equal(await h.page.getByRole('radio', { name: /^Yes/ }).isChecked(), true);
      assert.equal(
        (await wizard.locator('[data-installed-choice] .conn-note').innerText()).trim(),
        'It has a laika command, or a ~/laika folder already',
      );
      const step = await toPairCommand(h.page);
      // Review round 1, N3: no `git -C ~/laika fetch && laika update` an old helper cannot run.
      assert.equal(
        await step.locator('pre').innerText(),
        'laika device pair --board http://board.test --code K7W4-X2P8-M3QR-T9VA',
      );
      assert.equal(
        await step.locator('.conn-block-label').first().textContent(),
        'On the device: pair',
      );
      const first = step.locator('[data-update-first]');
      assert.match(await first.innerText(), /Bring its Laika helper up to date first/);
      assert.equal(await step.locator('[data-clone-refused]').count(), 0);
      // LAI-1093: codes last ten minutes, and updating an old CLI can take longer.
      assert.match(
        await first.innerText(),
        /This code lasts ten minutes: if updating takes longer, cancel this pairing and start again for a fresh code\. Then pair:/,
      );
      assert.equal(await before(step.locator('[data-update-cli="add-device"]'), first), true);
      assert.equal(await before(first, step.locator('.conn-block').first()), true);
      // The guide it points to covers a helper without laika update — wherever its
      // checkout is, and with none at all.
      const guide = await openGuide(step);
      const older = guide.locator('[data-guide-step="older"] pre');
      assert.equal(await older.first().innerText(), 'ls -l "$(command -v laika)"');
      assert.match(await older.nth(1).innerText(), /^git clone \S+ ~\/laika &&\n/);
    } finally {
      await h.close();
    }
  });

  void test('Add device, a fresh install: no update line', async () => {
    const h = await open('/developer?tab=devices&add=device', addDeviceStub());
    try {
      const step = await toPairCommand(h.page);
      assert.equal(await step.locator('[data-update-first]').count(), 0);
      assert.equal(
        await step.locator('.conn-block-label').first().textContent(),
        'On the device: install, then pair',
      );
      // Review round 1, B2: one && list, so a clone refused because ~/laika exists
      // never reaches an older install.sh (which asks for a token) or the pair.
      const lines = (await step.locator('pre').innerText()).split('\n');
      assert.match(lines[0] ?? '', /^git clone /);
      assert.deepEqual(
        lines.slice(0, -1).filter((line) => !line.endsWith(' &&')),
        [],
        lines.join('\n'),
      );
      assert.match(lines.at(-1) ?? '', /^~\/laika\/cli\/bin\/laika device pair /);
      assert.match(
        (await step.locator('[data-clone-refused]').innerText()).replace(/\s+/g, ' '),
        /^Each line runs only if the one before it worked\. If git clone stops because ~\/laika already exists, nothing after it ran/,
      );
    } finally {
      await h.close();
    }
  });

  void test('Add tool: the same line before laika tool add', async () => {
    const h = await open('/developer?tab=tools&add=tool&tool=claude-code', addToolStub());
    try {
      const wizard = await toToolCommand(h.page);
      const help = wizard.locator('[data-update-cli="add-tool"]');
      assert.equal(
        await help.locator('summary').innerText(),
        'Already have Laika installed? Make sure it’s current',
      );
      assert.equal(await before(help, wizard.locator('.conn-block').first()), true);
      assert.equal(
        await wizard.locator('pre').innerText(),
        'laika tool add claude-code --exchange x1',
      );
    } finally {
      await h.close();
    }
  });
});

/** Every command block and inline command inside `scope`, as a person would copy it. */
async function commandsIn(scope: Locator): Promise<string[]> {
  return [
    ...(await scope.locator('pre').allInnerTexts()),
    ...(await scope.locator('code').allInnerTexts()),
  ];
}

void describe('every placement (LAI-1093): no pull of a checkout, and every command pastes', () => {
  /** Whether `a` comes before `b` in the document. */
  const before = async (a: Locator, b: Locator): Promise<boolean> => {
    const other = await b.elementHandle();
    assert.ok(other !== null);
    return a.evaluate(
      (el, o) => Boolean(el.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING),
      other,
    );
  };

  /** What a placement shows, with its guide open. */
  const check = async (scope: Locator, where: string) => {
    const text = await scope.innerText();
    assert.equal(checkoutPull(text), undefined, `${where}: tells someone to pull a checkout`);
    assert.doesNotMatch(text, /pull --ff-only/, where);
    const commands = await commandsIn(scope);
    // The guide's own five older-CLI blocks, at least: the check is reading something.
    assert.ok(commands.includes('ls -l "$(command -v laika)"'), `${where}: no guide was read`);
    assert.deepEqual(hazardsIn(commands), [], where);
  };

  // The Overview has no placement of its own since LAI-1096: its describe above
  // asserts there is none, and that its chip leads to Tool details.
  void test('Tool details, Device details, Add device and Add tool', async () => {
    const t = await openTools();
    try {
      for (const id of ['a2', 'a3']) {
        const body = await details(t.page, id);
        await openGuide(body);
        await check(body, `tool ${id}`);
      }
    } finally {
      await t.close();
    }

    const d = await open('/developer?tab=devices&device=d1', stub());
    try {
      const panel = devicePanel(d.page);
      await unfold(panel, 'helpers');
      await panel.locator('[data-update-cli="device"]').waitFor({ timeout: 20_000 });
      await openGuide(panel);
      await check(panel, 'device');
    } finally {
      await d.close();
    }

    for (const installed of [false, true]) {
      const w = await open('/developer?tab=devices&add=device', addDeviceStub());
      try {
        const wizard = w.page.locator('[data-wizard="device"]');
        await wizard.waitFor({ timeout: 20_000 });
        if (installed) {
          await wizard.locator('[data-installed-choice] label', { hasText: 'Yes' }).click();
        }
        const step = await toPairCommand(w.page);
        await openGuide(step);
        await check(step, `add device, installed ${String(installed)}`);
      } finally {
        await w.close();
      }
    }

    const a = await open('/developer?tab=tools&add=tool&tool=claude-code', addToolStub());
    try {
      const wizard = await toToolCommand(a.page);
      await openGuide(wizard);
      await check(wizard, 'add tool');
      assert.match(
        await wizard.innerText(),
        /if updating Laika first takes longer, this page offers a new command once this one expires/,
      );
    } finally {
      await a.close();
    }
  });

  void test('Tool details’ own How to update points a CLI without laika update at the guide', async () => {
    const h = await openTools();
    try {
      const body = await details(h.page, 'a2');
      await body.locator('[data-update-how] > summary').click();
      assert.equal(
        (await body.locator('[data-too-old-update]').innerText()).replace(/\s+/g, ' '),
        'If laika update is an unknown command on that device, its CLI is older still: How to update your Laika CLI, below, has the steps for it, wherever the old checkout is.',
      );
      assert.equal(
        await before(body.locator('[data-update-how]'), body.locator('[data-update-cli="tool"]')),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('a board that does not know its commit: the default branch, said so', async () => {
    const h = await openTools({
      routes: {
        '/api/v1/developer/compatibility': {
          ...compat(),
          cli: { ...compat().cli, source: { ...compat().cli.source, commit: null } },
        },
      },
    });
    try {
      const guide = await openGuide(await details(h.page, 'a2'));
      assert.equal(
        await guide.locator('[data-guide-step="older"] pre').nth(1).innerText(),
        [
          'git clone https://github.com/PawanSirsat/Laika.git ~/laika &&',
          'git -C ~/laika checkout --detach origin/HEAD &&',
          '~/laika/plugin/scripts/install.sh --no-credential',
        ].join('\n'),
      );
      assert.match(
        await guide.locator('[data-fresh-default]').innerText(),
        /does not say which commit it was built from, so this takes the newest on its repository’s default branch/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a board that does not say where its helper comes from: no install is made up', async () => {
    const { cli: _cli, ...bare } = compat();
    void _cli;
    const h = await openTools({ routes: { '/api/v1/developer/compatibility': bare } });
    try {
      const guide = await openGuide(await details(h.page, 'a2'));
      assert.match(
        await guide.locator('[data-no-source]').innerText(),
        /does not say where its helper comes from, so the install cannot be filled in here/,
      );
      const blocks = await guide.locator('[data-guide-step="older"] pre').allInnerTexts();
      assert.equal(blocks[0], 'ls -l "$(command -v laika)"');
      assert.ok(!blocks.some((b) => b.includes('git clone')), blocks.join(' | '));
    } finally {
      await h.close();
    }
  });
});

void describe('390 px, both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: no sideways scroll with the guide open`, async () => {
      const h = await openTools({}, { insecure: true });
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        const body = await details(h.page, 'a2');
        await openGuide(body);
        assert.ok((await wide(h.page)) <= 0, 'the page scrolls sideways at 390 px');
        const over = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(over <= 0, `the details overflow by ${String(over)}px`);
      } finally {
        await h.close();
      }
    });
  }
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe(
  'evidence: each placement, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const tag = `${theme}-${String(width)}`;
          const size = { width, height: width === 390 ? 844 : 900 };
          // Review round 1, N5: every page opens at this size, so a 390 px shot is a
          // real 390 px layout with its navigation drawer closed.
          const sized: OpenOptions = {
            before: async (page) => {
              await page.setViewportSize(size);
            },
          };

          const t = await openTools({}, { insecure: true, ...sized });
          try {
            await setTheme(t.page, theme);
            const unknown = await details(t.page, 'a3');
            await unknown.locator('[data-version-unknown-hint]').waitFor();
            await t.page.locator('.side-panel[data-panel="tool"]').screenshot({
              path: join(dir, `tool-version-unknown-${tag}.png`),
            });
          } finally {
            await t.close();
          }

          const d = await open('/developer?tab=devices&device=d1', stub(), sized);
          try {
            await setTheme(d.page, theme);
            await unfold(devicePanel(d.page), 'helpers');
            await devicePanel(d.page)
              .locator('[data-update-cli="device"]')
              .waitFor({ timeout: 20_000 });
            await devicePanel(d.page).screenshot({ path: join(dir, `device-details-${tag}.png`) });
          } finally {
            await d.close();
          }

          const w = await open('/developer?tab=devices&add=device', addDeviceStub(), sized);
          try {
            await setTheme(w.page, theme);
            const wizard = await toPairCommand(w.page);
            await wizard.screenshot({ path: join(dir, `add-device-line-${tag}.png`) });
          } finally {
            await w.close();
          }

          const a = await open(
            '/developer?tab=tools&add=tool&tool=claude-code',
            addToolStub(),
            sized,
          );
          try {
            await setTheme(a.page, theme);
            const wizard = await toToolCommand(a.page);
            await wizard.screenshot({ path: join(dir, `add-tool-line-${tag}.png`) });
          } finally {
            await a.close();
          }

          // The guide itself, opened in Tool details (the Overview has no notice
          // since LAI-1096). The app scrolls an inner container, so the window is
          // made tall enough for all of it; the width is the one under test.
          const g = await openTools({}, sized);
          try {
            await setTheme(g.page, theme);
            const required = await details(g.page, 'a2');
            await openGuide(required);
            await g.page.setViewportSize({ width, height: 2800 });
            await required.locator('[data-update-cli="tool"]').screenshot({
              path: join(dir, `guide-${tag}.png`),
            });
          } finally {
            await g.close();
          }
        }
      }
    });
  },
);

void describe(
  'LAI-1093 evidence: the older-CLI guidance, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const tag = `${theme}-${String(width)}`;
          const size = { width, height: width === 390 ? 844 : 900 };
          const sized: OpenOptions = {
            before: async (page) => {
              await page.setViewportSize(size);
            },
          };
          // A tall window for the shot, so a panel that scrolls inside shows all of it.
          const tall = async (page: Page) => {
            await page.setViewportSize({ width, height: 3200 });
            await page.waitForTimeout(150);
          };

          const t = await openTools({}, sized);
          try {
            await setTheme(t.page, theme);
            const unknown = await details(t.page, 'a3');
            await unknown.locator('[data-version-unknown-hint]').waitFor();
            await tall(t.page);
            await t.page.locator('.side-panel[data-panel="tool"]').screenshot({
              path: join(dir, `tool-version-unknown-${tag}.png`),
            });
            await t.page.setViewportSize(size);
            const required = await details(t.page, 'a2');
            await required.locator('[data-update-how] > summary').click();
            await openGuide(required);
            await tall(t.page);
            await t.page.locator('.side-panel[data-panel="tool"]').screenshot({
              path: join(dir, `tool-how-to-update-and-guide-${tag}.png`),
            });
          } finally {
            await t.close();
          }

          const w = await open('/developer?tab=devices&add=device', addDeviceStub(), sized);
          try {
            await setTheme(w.page, theme);
            const wizard = w.page.locator('[data-wizard="device"]');
            await wizard.waitFor({ timeout: 20_000 });
            await wizard.locator('[data-installed-choice] label', { hasText: 'Yes' }).click();
            await wizard.screenshot({ path: join(dir, `add-device-installed-option-${tag}.png`) });
            const step = await toPairCommand(w.page);
            await openGuide(step);
            await tall(w.page);
            await step.screenshot({ path: join(dir, `add-device-update-first-${tag}.png`) });
          } finally {
            await w.close();
          }

          const f = await open('/developer?tab=devices&add=device', addDeviceStub(), sized);
          try {
            await setTheme(f.page, theme);
            const step = await toPairCommand(f.page);
            await step.locator('[data-clone-refused]').waitFor();
            await tall(f.page);
            await step.screenshot({ path: join(dir, `add-device-fresh-chained-${tag}.png`) });
          } finally {
            await f.close();
          }

          const a = await open(
            '/developer?tab=tools&add=tool&tool=claude-code',
            addToolStub(),
            sized,
          );
          try {
            await setTheme(a.page, theme);
            const wizard = await toToolCommand(a.page);
            await openGuide(wizard);
            await tall(a.page);
            await wizard.screenshot({ path: join(dir, `add-tool-guide-${tag}.png`) });
          } finally {
            await a.close();
          }
        }
      }
    });
  },
);
