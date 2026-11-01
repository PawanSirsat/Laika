/**
 * Connect renders exactly as it did before LAI-1044 moved its parts into
 * `components/wizard/` (Developer access V3, slice A3).
 *
 * The refactor promised no behaviour change, and a promise like that is only
 * worth the instrument that checks it. So each scenario below walks the
 * classic wizard the way a person does and records three things:
 *
 * - **the markup** of the whole Connect screen, byte for byte, with only the
 *   values that differ between runs replaced (the stub server's port, React's
 *   generated ids);
 * - **the accessibility tree** Playwright reads from it — roles, names,
 *   states — kept readable in the golden file so a reviewer can see what a
 *   screen reader is told;
 * - **the computed style** of every element under it, in light **and** dark:
 *   colour, background, borders, spacing, type, display. Geometry (width,
 *   height, position) is left out on purpose — it depends on the fonts a
 *   machine has, and CI is Linux while the golden was taken on macOS. What is
 *   kept depends only on the stylesheet, so a moved or reordered rule shows.
 *
 * The markup and the style dump are stored as SHA-256 digests to keep the
 * golden small; on a mismatch the actual dumps are written to the temp
 * directory and the failure names them, so the difference can be read.
 *
 * `LAIKA_GOLDEN=update` rewrites `golden/connect.json` from the page in front
 * of it. It was taken on the commit **before** the extraction, and must not
 * be regenerated to make a red run green — a red run here is a rendering
 * change, which this task said it would not make.
 *
 * It was regenerated once, when the **instrument** changed: the first CI run
 * showed `.conn-line`'s padding is in `ch` (see `capture`). That regeneration
 * was run against the same pre-extraction source (`35ad1314`, in a temporary
 * worktree), not against the refactored page.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';

const GOLDEN = fileURLToPath(new URL('./golden/connect.json', import.meta.url));
const UPDATE = process.env.LAIKA_GOLDEN === 'update';

const SECRET = 'lai_GoldenSecretForTheConnectSnapshotOnly0';
/** A fixed macOS Chrome, so the suggested token name is the same on every runner. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MINTED_AT = 1_790_000_000_000;

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const tokenRow = {
  id: 't1',
  name: 'claude-code on macOS',
  prefix: SECRET.slice(0, 8),
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: MINTED_AT + 90 * 86_400_000,
  revoked_at: null,
  created_at: MINTED_AT,
};

function stub(): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': (call: { method?: string }) =>
      call.method === 'POST'
        ? { token: tokenRow, secret: SECRET }
        : { data: [tokenRow], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvell Dynamics',
      presence_enabled: true,
      developer_insights: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/me/activity-sharing': {
      org_enabled: false,
      enabled: false,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    },
    '/api/v1/me/local-activity': {
      start: '2026-10-02',
      end: '2026-10-15',
      tz: 'UTC',
      days: [],
      collectors: 0,
      oldest_day: null,
    },
  };
}

/** Kept to what the stylesheet decides; the one font-sized value is normalised in `capture`. */
const STYLE_PROPS = [
  'display',
  'position',
  'visibility',
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-top-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-color',
  'border-left-width',
  'border-radius',
  'outline-style',
  'outline-color',
  'box-shadow',
  'padding',
  'margin',
  'gap',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'opacity',
  'cursor',
  'grid-template-columns',
  'flex-direction',
  'align-items',
  'justify-content',
  'overflow-y',
] as const;

interface Capture {
  readonly html: string;
  readonly styles: string;
  readonly aria: string;
}

interface Entry {
  readonly aria: string;
  readonly html_sha256: string;
  readonly styles_sha256: { readonly light: string; readonly dark: string };
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Settle every transition and freeze every running animation, then read. */
async function capture(page: Page, origin: string): Promise<Capture> {
  await page.mouse.move(0, 0);
  const raw = await page.evaluate((props) => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSTransition) a.finish();
      else {
        a.pause();
        a.currentTime = 0;
      }
    }
    const root = document.querySelector('.connect');
    if (root === null) throw new Error('no .connect on the page');
    const lines: string[] = [];
    /*
     * One rule here is sized by the font itself: `.conn-line` pads by
     * `calc((var(--lead) + 2) * 1ch)`, and `1ch` is the mono font's glyph
     * width — so the px value differs between macOS and the Linux runner
     * while the rule is identical (CI measured it: steps 3–4, and only they,
     * failed on styles with the markup unchanged). Such an element's padding
     * is recorded in `ch`, measured against a probe in its own font, to one
     * decimal: leads are whole columns, and the probe's own width is rounded
     * to layout units (it reads 2.003ch for 2ch on macOS).
     */
    const inCh = (el: Element, px: string): string => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:1ch;padding:0;';
      el.append(probe);
      const ch = probe.getBoundingClientRect().width;
      probe.remove();
      return px
        .split(' ')
        .map((part) => `${(Number.parseFloat(part) / ch).toFixed(1)}ch`)
        .join(' ');
    };
    const walk = (el: Element, path: string): void => {
      const style = getComputedStyle(el);
      const fontSized = el.classList.contains('conn-line');
      lines.push(
        `${path} ${props
          .map((p) => {
            const value = style.getPropertyValue(p);
            return `${p}:${fontSized && p === 'padding' ? inCh(el, value) : value}`;
          })
          .join(';')}`,
      );
      [...el.children].forEach((child, i) => {
        walk(child, `${path}>${child.tagName.toLowerCase()}[${String(i)}]`);
      });
    };
    walk(root, 'connect');
    return { html: root.outerHTML, styles: lines.join('\n') };
  }, STYLE_PROPS);
  const aria = await page.locator('.connect').ariaSnapshot();
  return {
    html: normalise(raw.html, origin),
    styles: normalise(raw.styles, origin),
    aria: normalise(aria, origin),
  };
}

/** The port and React's generated ids differ between runs; nothing else may. */
function normalise(text: string, origin: string): string {
  const ids = new Map<string, string>();
  return text
    .split(origin)
    .join('ORIGIN')
    .replace(/«[^»]+»|:r[0-9a-z]+:/g, (id) => {
      const seen = ids.get(id);
      if (seen !== undefined) return seen;
      const named = `«id${String(ids.size)}»`;
      ids.set(id, named);
      return named;
    });
}

type H = Awaited<ReturnType<typeof open>>;

async function goTo(h: H, n: 1 | 2 | 3 | 4): Promise<void> {
  await h.page
    .locator('.conn-rail-step')
    .nth(n - 1)
    .click();
  await h.page.locator(`.conn-wizard-card[data-step="${String(n)}"]`).waitFor({ timeout: 20_000 });
}

/** Each scenario reaches one state of the page from a fresh load. */
const SCENARIOS: readonly {
  readonly name: string;
  readonly path: string;
  readonly reach: (h: H) => Promise<void>;
}[] = [
  {
    name: 'step-1-picker',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await h.page.locator('.conn-wizard-card[data-step="1"]').waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'step-1-no-match',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await h.page.getByRole('searchbox', { name: 'Search agents' }).fill('zzzz');
      await h.page.locator('.conn-agents-empty').waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'step-2-before-mint',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await goTo(h, 2);
    },
  },
  {
    name: 'step-2-minted',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.locator('.conn-mint button').click();
      await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'step-3-automatic-minted',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.locator('.conn-mint button').click();
      await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
      await goTo(h, 3);
    },
  },
  {
    name: 'step-3-by-hand-brought',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.getByRole('button', { name: 'Use a token I already have' }).click();
      await goTo(h, 3);
      await h.page.getByRole('button', { name: 'Switch to By hand' }).click();
      await h.page.locator('.conn-segment[aria-pressed="true"]', { hasText: 'By hand' }).waitFor();
    },
  },
  {
    name: 'step-4-watching-minted',
    path: '/developer?tab=connect',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.locator('.conn-mint button').click();
      await h.page.locator('.conn-secret-value').waitFor({ timeout: 20_000 });
      await goTo(h, 4);
      await h.page.locator('.conn-live-watching').waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'step-3-codex-brought',
    path: '/developer?tab=connect&agent=codex',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.getByRole('button', { name: 'Use a token I already have' }).click();
      await goTo(h, 3);
    },
  },
  {
    name: 'step-4-idle-brought',
    path: '/developer?tab=connect&agent=cursor',
    reach: async (h) => {
      await goTo(h, 2);
      await h.page.getByRole('button', { name: 'Use a token I already have' }).click();
      await goTo(h, 4);
      await h.page.locator('.conn-live-idle').waitFor({ timeout: 20_000 });
    },
  },
];

function readGolden(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, Entry>;
  } catch {
    return {};
  }
}

const golden = readGolden();
const fresh: Record<string, Entry> = {};

after(async () => {
  await closeBrowser();
  if (UPDATE) writeFileSync(GOLDEN, `${JSON.stringify(fresh, null, 2)}\n`);
});

void describe('Connect renders as it did before the LAI-1044 extraction', () => {
  for (const scenario of SCENARIOS) {
    void test(scenario.name, async () => {
      const h = await open(scenario.path, stub(), {
        before: async (page) => {
          await page.addInitScript(`Object.defineProperty(navigator, 'userAgent', {
            get: () => ${JSON.stringify(USER_AGENT)},
          });`);
        },
      });
      try {
        await setTheme(h.page, 'light');
        await scenario.reach(h);
        const light = await capture(h.page, h.origin);
        await setTheme(h.page, 'dark');
        const dark = await capture(h.page, h.origin);

        assert.equal(dark.html, light.html, 'the markup changed with the theme');

        const actual: Entry = {
          aria: light.aria,
          html_sha256: sha(light.html),
          styles_sha256: { light: sha(light.styles), dark: sha(dark.styles) },
        };
        fresh[scenario.name] = actual;

        const dump = (part: string, text: string): string => {
          const file = join(tmpdir(), `connect-golden-${scenario.name}.${part}`);
          writeFileSync(file, text);
          return file;
        };
        if (process.env.LAIKA_GOLDEN_DUMP !== undefined) {
          dump('html', light.html);
          dump('light.styles', light.styles);
          dump('dark.styles', dark.styles);
        }
        if (UPDATE) return;

        const expected = golden[scenario.name];
        assert.ok(expected !== undefined, `no golden for ${scenario.name}`);
        assert.equal(actual.aria, expected.aria, 'the accessibility tree changed');
        assert.equal(
          actual.html_sha256,
          expected.html_sha256,
          `the markup changed — actual written to ${dump('html', light.html)}`,
        );
        assert.equal(
          actual.styles_sha256.light,
          expected.styles_sha256.light,
          `light computed styles changed — actual written to ${dump('light.styles', light.styles)}`,
        );
        assert.equal(
          actual.styles_sha256.dark,
          expected.styles_sha256.dark,
          `dark computed styles changed — actual written to ${dump('dark.styles', dark.styles)}`,
        );
      } finally {
        await h.close();
      }
    });
  }
});
