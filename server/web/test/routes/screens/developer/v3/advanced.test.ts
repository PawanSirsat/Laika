/**
 * Advanced's decisions, without a browser (LAI-1058, plan §B.6, §L7).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TokenView } from '../../../../../src/api/tokens.ts';
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  expiresAtFor,
  isLegacyToolToken,
  upgradeHref,
} from '../../../../../src/routes/screens/developer/v3/advanced.ts';
import {
  DEVELOPER_ACTIVITY_HREF,
  developerAlias,
  ownTokensHref,
  projectSetupLink,
} from '../../../../../src/routes/page-tabs.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const token = (over: Partial<TokenView> = {}): TokenView => ({
  id: 't1',
  name: 'nightly-export',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
  kind: 'personal',
  agent_id: null,
  agent_label: null,
  ...over,
});

void describe('expiry (plan §L7)', () => {
  void test('the default is 90 days, and it is what an unknown choice falls back to', () => {
    assert.equal(DEFAULT_EXPIRY, '90');
    assert.equal(expiresAtFor(DEFAULT_EXPIRY, NOW), NOW + 90 * DAY);
    assert.equal(expiresAtFor('nonsense', NOW), NOW + 90 * DAY);
  });

  void test('Never is still offered, and sends no expiry at all', () => {
    const never = EXPIRY_CHOICES.find((c) => c.label === 'Never');
    assert.ok(never, 'Never is not on the list');
    assert.equal(expiresAtFor(never.id, NOW), undefined);
  });

  void test('every dated choice is in the future, by its own number of days', () => {
    for (const choice of EXPIRY_CHOICES) {
      if (choice.days === null) continue;
      assert.equal(expiresAtFor(choice.id, NOW), NOW + choice.days * DAY, choice.label);
    }
  });
});

void describe('legacy tool tokens (plan §B.6)', () => {
  void test('a personal token a tool reached /mcp with is legacy; a REST-only one is not', () => {
    assert.equal(isLegacyToolToken(token({ last_used_at: NOW })), false);
    assert.equal(isLegacyToolToken(token({ last_mcp_at: NOW })), true);
    assert.equal(isLegacyToolToken(token({ last_client: 'codex' })), true);
  });

  void test('an agent credential is never a legacy personal token', () => {
    assert.equal(
      isLegacyToolToken(token({ kind: 'agent', agent_id: 'a1', last_mcp_at: NOW })),
      false,
    );
  });

  void test('Upgrade connection opens Add a tool on Devices, on the tool when it has a guide', () => {
    assert.equal(
      upgradeHref(token({ last_client: 'claude-code' })),
      '/developer?tab=devices&add=tool&tool=claude-code',
    );
    assert.equal(upgradeHref(token({ last_client: 'other' })), '/developer?tab=devices&add=tool');
    assert.equal(upgradeHref(token()), '/developer?tab=devices&add=tool');
  });

  void test('its target is a V3 id, so no mode moves it again', () => {
    const query = new URL(upgradeHref(token()), 'http://x').searchParams;
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      assert.equal(developerAlias(mode, query), undefined, mode);
    }
  });
});

void describe('links into Developer access from outside it (plan §B.7)', () => {
  type Mode = 'classic' | 'preview' | 'v3';
  /** Where `href` lands once the mode's aliases have run. */
  const land = (mode: Mode, href: string): URLSearchParams => {
    const query = new URL(href, 'http://x').searchParams;
    return developerAlias(mode, query) ?? query;
  };

  void test('own tokens: Tokens in classic, Advanced in preview and v3, and nothing moves it again', () => {
    const expected: Record<Mode, string> = {
      classic: '/developer?tab=tokens',
      preview: '/developer?tab=advanced',
      v3: '/developer?tab=advanced',
    };
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      assert.equal(ownTokensHref(mode), expected[mode], mode);
      assert.equal(
        developerAlias(mode, new URL(expected[mode], 'http://x').searchParams),
        undefined,
      );
    }
    // Not known yet reads as classic, as an unreadable manifest does.
    assert.equal(ownTokensHref(undefined), '/developer?tab=tokens');
  });

  void test('project setup: named as the mode names it; per-tool grants only where V3 sets them', () => {
    assert.deepEqual(projectSetupLink('classic'), {
      href: '/developer?tab=projects',
      label: 'Developer access · Projects',
      perTool: false,
    });
    assert.deepEqual(projectSetupLink(undefined), projectSetupLink('classic'));
    assert.deepEqual(projectSetupLink('preview'), {
      href: '/developer?tab=projects&setup=v3',
      label: 'Developer access · Project setup',
      perTool: true,
    });
    assert.deepEqual(projectSetupLink('v3'), {
      href: '/developer?tab=projects',
      label: 'Developer access · Project setup',
      perTool: true,
    });
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      assert.equal(land(mode, projectSetupLink(mode).href).get('tab'), 'projects', mode);
    }
  });

  void test('activity is one id in every mode', () => {
    for (const mode of ['classic', 'preview', 'v3'] as const) {
      assert.equal(land(mode, DEVELOPER_ACTIVITY_HREF).get('tab'), 'activity', mode);
    }
  });
});
