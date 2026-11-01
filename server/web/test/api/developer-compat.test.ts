/**
 * Reading the Developer access mode off `GET /developer/compatibility`
 * (LAI-1048, plan §I): only the three names, and anything else is classic.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEVELOPER_ACCESS_MODES, developerAccessMode } from '../../src/api/developer-compat.ts';

const body = (mode: unknown) => ({
  server: { version: '0.1.0', build_commit: null },
  features: { developer_access: mode, device_pairing: false },
});

void describe('developerAccessMode', () => {
  void test('the three modes read as themselves', () => {
    for (const mode of DEVELOPER_ACCESS_MODES) assert.equal(developerAccessMode(body(mode)), mode);
    assert.deepEqual([...DEVELOPER_ACCESS_MODES], ['classic', 'preview', 'v3']);
  });

  void test('an unknown or missing mode is classic, never a half-built page', () => {
    for (const odd of ['V3', 'beta', '', 3, null, undefined, true]) {
      assert.equal(developerAccessMode(body(odd)), 'classic', String(odd));
    }
    for (const broken of [null, undefined, 'v3', 42, {}, { features: null }, { features: 'v3' }]) {
      assert.equal(developerAccessMode(broken), 'classic', JSON.stringify(broken));
    }
  });
});
