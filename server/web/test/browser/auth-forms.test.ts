/**
 * The signed-out forms and the 404, driven by keyboard alone (LAI-1203).
 *
 * What is asserted needs a page: where focus goes when a submit is refused —
 * by the client or by the server — that a blurred field explains itself, that
 * the show/hide toggle has a name and works, that the busy button keeps its
 * label, and that the 404's ways out go somewhere. Nothing here clicks or calls
 * `.focus()` on a control the reader would reach: they Tab, type and press
 * Enter or Space, as a keyboard-only reader does.
 *
 * Every wait is followed by an assertion on what it waited for (`until` itself
 * asserts nothing and times out quietly).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const SIGNED_OUT: ApiStub = {
  '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
  '/api/v1/setup/status': { setup_required: false },
};

/** A 422 as the server sends one (§6.3): `details.issues[].path` names the field. */
function unprocessable(issues: readonly { path: string; message: string }[]) {
  return reply(422, {
    error: { code: 'unprocessable', message: 'Invalid body', details: { issues } },
  });
}

void after(async () => {
  await closeBrowser();
});

/** What has focus: its accessible label, or a description of it. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return '(nothing)';
    if (el.hasAttribute('data-auth-summary')) return `summary:${el.innerText.trim()}`;
    const id = el.id;
    const label = id === '' ? null : document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label !== null) return `field:${(label.textContent ?? '').replace('*', '').trim()}`;
    return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.innerText).trim()}`;
  });
}

/**
 * The control labelled `label`. By the `<label>`'s own text rather than
 * `getByLabel`, whose substring match also finds a form named by a heading
 * that contains the word, and whose exact match counts the required star.
 */
async function field(page: Page, label: string): Promise<Locator> {
  const id = await page.evaluate((want) => {
    for (const l of document.querySelectorAll('label.field-label')) {
      if ((l.textContent ?? '').replace('*', '').trim() === want) return l.getAttribute('for');
    }
    return null;
  }, label);
  assert.ok(id !== null, `no field labelled ${label}`);
  return page.locator(`[id="${id}"]`);
}

/** Tab forward until focus is on `want`, as a reader would; fail if it never is. */
async function tabTo(page: Page, want: string, max = 15): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if ((await focused(page)) === want) return;
    await page.keyboard.press('Tab');
  }
  assert.equal(await focused(page), want, `Tab never reached ${want}`);
}

/** The error shown under the field labelled `label`, read from the page. */
async function fieldError(page: Page, label: string): Promise<string> {
  const input = await field(page, label);
  const describedBy = (await input.getAttribute('aria-describedby')) ?? '';
  const errorId = describedBy.split(' ').find((id) => id.endsWith('-error'));
  if (errorId === undefined) return '';
  return (await page.locator(`[id="${errorId}"]`).innerText()).trim();
}

function posted(calls: readonly StubCall[], path: string): StubCall[] {
  return calls.filter((c) => c.method === 'POST' && c.path === path);
}

void describe('sign in, keyboard only', () => {
  void test('an empty submit focuses the first invalid field and says what is wrong', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.getByRole('heading', { level: 1 }).innerText(),
        'Sign in to your instance',
      );
      // One lockup, one heading, one primary action.
      assert.equal(await h.page.getByRole('heading', { level: 1 }).count(), 1);
      assert.equal(await h.page.locator('.auth-card .button-primary').count(), 1);
      assert.equal(await h.page.locator('.auth-card.glass-2').count(), 1, 'not the shared glass');

      await tabTo(h.page, 'field:Password');
      await h.page.keyboard.press('Enter');
      await until(async () => (await focused(h.page)) === 'field:Email');
      assert.equal(await focused(h.page), 'field:Email', 'focus did not go to the first invalid');
      assert.equal(await fieldError(h.page, 'Email'), 'Email is required.');
      assert.equal(await fieldError(h.page, 'Password'), 'Password is required.');
      assert.equal(await (await field(h.page, 'Email')).getAttribute('aria-invalid'), 'true');
      assert.equal(posted(h.calls, '/api/v1/auth/sign-in/email').length, 0, 'it posted anyway');
    } finally {
      await h.close();
    }
  });

  void test('a field explains itself on blur, and only once something was typed', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Email');
      // Tabbing past an empty field says nothing.
      await h.page.keyboard.press('Tab');
      assert.equal(await focused(h.page), 'field:Password');
      assert.equal(await fieldError(h.page, 'Email'), '', 'an untouched field complained');

      await h.page.keyboard.press('Shift+Tab');
      await h.page.keyboard.type('ada.example.com');
      await h.page.keyboard.press('Tab');
      await until(async () => (await fieldError(h.page, 'Email')) !== '');
      assert.match(await fieldError(h.page, 'Email'), /does not look like an email/);
      assert.equal(await focused(h.page), 'field:Password', 'blur moved focus');
    } finally {
      await h.close();
    }
  });

  void test('the show/hide toggle is named, reachable and works', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Password');
      await h.page.keyboard.type('correct horse');
      await h.page.keyboard.press('Tab');
      const toggle = h.page.getByRole('button', { name: 'Show password' });
      assert.equal(await toggle.count(), 1, 'the toggle has no accessible name');
      assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');

      await h.page.keyboard.press('Space');
      const shown = h.page.getByRole('button', { name: 'Hide password' });
      await shown.waitFor({ timeout: 5_000 });
      assert.equal(await shown.getAttribute('aria-pressed'), 'true');
      const input = await field(h.page, 'Password');
      assert.equal(await input.getAttribute('type'), 'text', 'the password is still masked');
      assert.equal(
        await shown.getAttribute('aria-controls'),
        await input.getAttribute('id'),
        'the toggle does not name the field it acts on',
      );
    } finally {
      await h.close();
    }
  });

  void test('Caps Lock is said in words, tied to the field, and cleared on leaving it', async () => {
    const h = await open('/login', SIGNED_OUT);
    try {
      await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Password');
      const input = await field(h.page, 'Password');
      const hint = h.page.locator('.field-caps');
      assert.equal((await hint.innerText()).trim(), '', 'a hint before Caps Lock was pressed');

      // Playwright's keyboard does not carry Caps Lock into `getModifierState`
      // (measured: the press lands, the state stays off), so the one event the
      // field reads it from is sent with the modifier set — to whatever has
      // focus, which Tab put there.
      await h.page.evaluate(() => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'A', bubbles: true, modifierCapsLock: true }),
        );
      });
      await until(async () => (await hint.innerText()).trim() !== '');
      assert.equal((await hint.innerText()).trim(), 'Caps Lock is on');
      assert.match(
        (await input.getAttribute('aria-describedby')) ?? '',
        /-caps\b/,
        'the hint is not tied to the field',
      );

      await h.page.keyboard.press('Tab');
      await until(async () => (await hint.innerText()).trim() === '');
      assert.equal((await hint.innerText()).trim(), '', 'the hint outlived the field');
    } finally {
      await h.close();
    }
  });

  void test('rejected credentials: one sentence for both fields, focus back on the form', async () => {
    const h = await open('/login', {
      ...SIGNED_OUT,
      // As the server forwards better-auth's refusal (`http/auth-errors.ts`):
      // the §6.3 envelope, better-auth's own body as `details`.
      '/api/v1/auth/sign-in/email': reply(401, {
        error: {
          code: 'unauthorized',
          message: 'Invalid email or password',
          details: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
        },
      }),
    });
    try {
      await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Email');
      await h.page.keyboard.type('ada@example.com');
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('a wrong password');
      await h.page.keyboard.press('Enter');

      const rejected = h.page.locator('.auth-rejected');
      await rejected.waitFor({ timeout: 10_000 });
      assert.equal((await rejected.innerText()).trim(), 'Email or password is wrong.');
      assert.equal(
        await rejected.evaluate((el) => el.closest('[role="alert"]') !== null),
        true,
        'the rejection is not in a live region',
      );
      await until(async () => (await focused(h.page)) === 'field:Email');
      assert.equal(await focused(h.page), 'field:Email', 'focus was left on the button');

      const sent = posted(h.calls, '/api/v1/auth/sign-in/email');
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0]?.body, {
        email: 'ada@example.com',
        password: 'a wrong password',
        rememberMe: true,
      });
    } finally {
      await h.close();
    }
  });

  void test('a refusal that names no field lands in the summary, and focus goes there', async () => {
    const h = await open('/login', {
      ...SIGNED_OUT,
      '/api/v1/auth/sign-in/email': reply(429, {
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Please try again later.',
          details: { message: 'Too many requests. Please try again later.' },
        },
      }),
    });
    try {
      await h.page.locator('.auth-card input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Email');
      await h.page.keyboard.type('ada@example.com');
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('a password');
      await h.page.keyboard.press('Enter');

      await until(async () => (await focused(h.page)).startsWith('summary:'));
      const where = await focused(h.page);
      assert.match(where, /^summary:/, `focus is on ${where}, not the summary`);
      assert.doesNotMatch(where, /Email or password is wrong/, 'a rate limit blamed the password');
      assert.equal(where, 'summary:Too many requests. Please try again later.');
    } finally {
      await h.close();
    }
  });
});

const SYSTEM = { database: 'SQLite · WAL', migrations_applied: 18, smtp_configured: false };
const SETUP: ApiStub = {
  '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
  '/api/v1/setup/status': { setup_required: true, system: SYSTEM },
  '/api/v1/health': { status: 'ok', version: '0.1.0', uptime_ms: 1234 },
};

async function progress(page: Page): Promise<string[]> {
  return page.locator('.boot-progress li').evaluateAll((items) =>
    items.map((li) =>
      [...li.children]
        .map((c) => (c.textContent ?? '').trim())
        .join(' ')
        .replace(' ,', ','),
    ),
  );
}

void describe('first boot, keyboard only', () => {
  void test('rules are shown before typing; an empty submit focuses Full name', async () => {
    const h = await open('/setup', SETUP);
    try {
      await h.page.locator('form input').first().waitFor({ timeout: 20_000 });
      const passwordHelp = await h.page.locator('.boot-form .field-help').allInnerTexts();
      assert.ok(
        passwordHelp.some((t) => t.includes('At least 12 characters')),
        'the password rule is not shown up front',
      );
      assert.deepEqual(await progress(h.page), [
        '1 Owner account, current step',
        '2 Organisation, not started',
        '3 Create instance, not started',
      ]);

      await tabTo(h.page, 'field:Full name');
      await h.page.keyboard.press('Enter');
      await until(async () => (await fieldError(h.page, 'Full name')) !== '');
      assert.equal(await focused(h.page), 'field:Full name');
      assert.equal(await fieldError(h.page, 'Full name'), 'Full name is required.');
      assert.equal(await fieldError(h.page, 'Org name'), 'Org name is required.');
      assert.equal(posted(h.calls, '/api/v1/setup').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('progress follows the form; a 422 lands under its field and takes focus', async () => {
    let creates = 0;
    const h = await open('/setup', {
      ...SETUP,
      '/api/v1/setup': () => {
        creates += 1;
        return unprocessable([{ path: 'owner_email', message: 'That address is not allowed.' }]);
      },
    });
    try {
      await h.page.locator('form input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Full name');
      await h.page.keyboard.type('Ada Lovelace');
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('ada@example.com');
      await tabTo(h.page, 'field:Password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Confirm password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Org name');

      const afterOwner = await progress(h.page);
      assert.match(afterOwner[0] ?? '', /Owner account, done/);
      assert.match(afterOwner[1] ?? '', /Organisation, current step/);

      await h.page.keyboard.type('Borealis Labs');
      await h.page.keyboard.press('Enter');

      await until(async () => (await fieldError(h.page, 'Email')) !== '');
      assert.equal(creates, 1, 'the form did not post');
      assert.equal(await fieldError(h.page, 'Email'), 'That address is not allowed.');
      assert.equal(await focused(h.page), 'field:Email', 'focus did not go to the field named');
      assert.match(
        await h.page.locator('.auth-summary').innerText(),
        /Some details need fixing/,
        'no summary for the refusal',
      );
    } finally {
      await h.close();
    }
  });

  void test('busy: the button keeps its label, the status names the real database', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open('/setup', SETUP, {
      before: async (page) => {
        await page.route('**/api/v1/setup', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          await held;
          return route.fulfill({
            status: 409,
            json: { error: { code: 'conflict', message: 'x' } },
          });
        });
      },
    });
    try {
      await h.page.locator('form input').first().waitFor({ timeout: 20_000 });
      await tabTo(h.page, 'field:Full name');
      await h.page.keyboard.type('Ada Lovelace');
      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('ada@example.com');
      await tabTo(h.page, 'field:Password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Confirm password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Org name');
      await h.page.keyboard.type('Borealis Labs');
      await h.page.keyboard.press('Enter');

      const button = h.page.locator('.boot-footer button[type="submit"]');
      await until(async () => (await button.getAttribute('aria-busy')) === 'true');
      assert.equal(await button.getAttribute('aria-busy'), 'true', 'no busy state');
      assert.equal((await button.innerText()).trim(), 'Create instance', 'the label swapped');
      assert.equal(await button.locator('.spinner').count(), 1, 'no spinner on the control');
      const status = await h.page.locator('.boot-footnote').innerText();
      assert.match(status, /SQLite · WAL/, 'the status does not name the instance’s database');
      assert.doesNotMatch(status, /postgres/i);
      release();
    } finally {
      release();
      await h.close();
    }
  });
});

const INVITE = {
  org_name: 'Borealis Labs',
  inviter_name: 'Grace Hopper',
  org_role: 'member',
  project_id: null,
  project_name: null,
  project_role: null,
  email: null,
  expires_at: Date.now() + 3 * 86_400_000,
};

void describe('accepting an invite, keyboard only', () => {
  void test('client and server errors both land on a field, and focus follows', async () => {
    let accepts = 0;
    const h = await open('/invite?token=tok1', {
      ...SIGNED_OUT,
      '/api/v1/invites/tok1': INVITE,
      '/api/v1/invites/accept': () => {
        accepts += 1;
        return unprocessable([{ path: 'password', message: 'That password is too common.' }]);
      },
    });
    try {
      await h.page.locator('form input').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.auth-card.glass-2').count(), 1, 'not the shared glass');
      assert.equal(await h.page.getByRole('heading', { level: 1 }).count(), 1);
      assert.match(
        await fieldHelp(h.page, 'Choose a password'),
        /At least 12 characters/,
        'the rule is not shown up front',
      );

      await tabTo(h.page, 'field:Full name');
      await h.page.keyboard.type('Ada Lovelace');
      await h.page.keyboard.press('Enter');
      await until(async () => (await focused(h.page)) === 'field:Email');
      assert.equal(await focused(h.page), 'field:Email', 'the link invite’s email was skipped');
      assert.equal(await fieldError(h.page, 'Full name'), '');

      await h.page.keyboard.type('ada@example.com');
      await tabTo(h.page, 'field:Choose a password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Confirm password');
      await h.page.keyboard.type('correct horse battery');
      await h.page.keyboard.press('Enter');

      await until(async () => (await fieldError(h.page, 'Choose a password')) !== '');
      assert.equal(accepts, 1);
      assert.equal(await fieldError(h.page, 'Choose a password'), 'That password is too common.');
      assert.equal(await focused(h.page), 'field:Choose a password');
      const sent = posted(h.calls, '/api/v1/invites/accept')[0]?.body as Record<string, unknown>;
      assert.equal(sent.email, 'ada@example.com');
      assert.equal(sent.name, 'Ada Lovelace');
    } finally {
      await h.close();
    }
  });
});

async function fieldHelp(page: Page, label: string): Promise<string> {
  const input = await field(page, label);
  const describedBy = (await input.getAttribute('aria-describedby')) ?? '';
  const helpId = describedBy.split(' ').find((id) => id.endsWith('-help'));
  if (helpId === undefined) return '';
  return (await page.locator(`[id="${helpId}"]`).innerText()).trim();
}

void describe('resetting a password, keyboard only', () => {
  void test('mismatch focuses confirm; the server’s password complaint lands on the field; success says what next', async () => {
    let consumes = 0;
    const h = await open('/reset-password?token=reset1', {
      ...SIGNED_OUT,
      '/api/v1/password-resets/consume': () => {
        consumes += 1;
        return consumes === 1
          ? unprocessable([{ path: 'new_password', message: 'That password was in a breach.' }])
          : { sessions_ended: 2 };
      },
    });
    try {
      await h.page.locator('form input').first().waitFor({ timeout: 20_000 });
      assert.match(await fieldHelp(h.page, 'New password'), /At least 12 characters/);

      await tabTo(h.page, 'field:New password');
      await h.page.keyboard.type('correct horse battery');
      await tabTo(h.page, 'field:Confirm password');
      await h.page.keyboard.type('correct horse batterz');
      await h.page.keyboard.press('Enter');
      await until(async () => (await fieldError(h.page, 'Confirm password')) !== '');
      assert.equal(await fieldError(h.page, 'Confirm password'), 'The two passwords do not match.');
      assert.equal(await focused(h.page), 'field:Confirm password');
      assert.equal(consumes, 0, 'a mismatch was posted');

      await h.page.keyboard.press('Backspace');
      await h.page.keyboard.type('y');
      await h.page.keyboard.press('Enter');
      await until(async () => (await fieldError(h.page, 'New password')) !== '');
      assert.equal(await fieldError(h.page, 'New password'), 'That password was in a breach.');
      assert.equal(await focused(h.page), 'field:New password');

      await h.page.keyboard.press('Enter');
      const done = h.page.getByRole('heading', { level: 1, name: 'Your password is set' });
      await done.waitFor({ timeout: 10_000 });
      assert.equal(consumes, 2);
      const next = await h.page.locator('[data-reset-state="done"] [role="status"]').innerText();
      assert.match(next, /Sign in with your new password next/);
      assert.match(next, /signed out of 2 other sessions/);
    } finally {
      await h.close();
    }
  });
});

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [],
};

const SIGNED_IN: ApiStub = {
  '/api/v1/me': ME,
  '/api/v1/setup/status': { setup_required: false },
  '/api/v1/projects': { data: [], next_cursor: null },
};

void describe('the 404', () => {
  for (const [label, path] of [
    ['Go to My day', '/my-day'],
    ['Browse spaces', '/projects'],
  ] as const) {
    void test(`says what happened, and "${label}" goes to ${path} by keyboard`, async () => {
      const h = await open('/no/such/place', SIGNED_IN);
      try {
        const card = h.page.locator('.not-found-card');
        await card.waitFor({ timeout: 20_000 });
        assert.match(await card.innerText(), /Nothing is routed at \/no\/such\/place/);
        assert.doesNotMatch(await card.innerText(), /⌘K|Ctrl\+K/, 'a palette hint with no palette');

        const link = h.page.getByRole('link', { name: label });
        assert.equal(await link.getAttribute('href'), path, 'not a real link');
        // Reach it the way a keyboard reader does.
        for (let i = 0; i < 40; i += 1) {
          if (await link.evaluate((el) => el === document.activeElement)) break;
          await h.page.keyboard.press('Tab');
        }
        assert.equal(await link.evaluate((el) => el === document.activeElement), true);
        await h.page.keyboard.press('Enter');
        await until(async () => (await h.page.evaluate(() => location.pathname)) === path);
        assert.equal(await h.page.evaluate(() => location.pathname), path);
        assert.equal(await h.page.locator('.not-found-card').count(), 0, 'the 404 stayed up');
      } finally {
        await h.close();
      }
    });
  }

  void test('offers Back once there is somewhere to go back to', async () => {
    const h = await open('/my-day', SIGNED_IN);
    try {
      await h.page.goto(`${h.origin}/no/such/place`);
      const back = h.page.getByRole('button', { name: 'Go back' });
      await back.waitFor({ timeout: 20_000 });
      assert.equal(await back.count(), 1);
      await back.press('Enter');
      await until(async () => (await h.page.evaluate(() => location.pathname)) === '/my-day');
      assert.equal(await h.page.evaluate(() => location.pathname), '/my-day');
    } finally {
      await h.close();
    }
  });
});
