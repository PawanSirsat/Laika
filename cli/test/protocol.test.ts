import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PROTOCOL } from '../src/protocol.ts';

/**
 * The CLI speaks the protocol the board in this same checkout speaks
 * (LAI-1067). LAI-1062 moved the server to protocol 2 and nothing failed until
 * LAI-1064 moved `cli/src/protocol.ts` by hand; with this test, a bump on
 * either side alone is red.
 *
 * The server's module is imported, not retyped, and by path rather than a
 * static import because `cli/`'s tsconfig stops at its own root (the same way
 * `device-pair-tool-add.test.ts` imports `device-signature.ts`). Both numbers
 * are read from their sources; neither is written here.
 */

const DEVELOPER_COMPAT = fileURLToPath(
  new URL('../../server/src/services/developer-compat.ts', import.meta.url),
);

interface DeveloperCompat {
  readonly PROTOCOL: { readonly current: unknown; readonly minClient: unknown };
  readonly FEATURE_NAMES: readonly string[];
  compatibility(input: {
    version: string;
    buildCommit: string | null;
    developerAccess: string;
    cliSourceUrl: string;
    servedRoutes: Iterable<string>;
  }): {
    protocol: { current: number; min_client: number };
    cli: { min_protocol_for: Record<string, number> };
  };
}

const server = (await import(pathToFileURL(DEVELOPER_COMPAT).href)) as DeveloperCompat;

void describe('the CLI and the server speak one protocol (LAI-1067)', () => {
  void test('the import is the real developer-compat.ts', () => {
    assert.equal(
      typeof server.compatibility,
      'function',
      'developer-compat.ts has no compatibility',
    );
    assert.equal(typeof server.PROTOCOL.current, 'number');
    assert.equal(typeof server.PROTOCOL.minClient, 'number');
    assert.ok(
      server.FEATURE_NAMES.includes('device_pairing'),
      'not the module that names features',
    );
    // What the board actually answers carries the same number as the constant.
    const body = server.compatibility({
      version: '0.0.0',
      buildCommit: null,
      developerAccess: 'classic',
      cliSourceUrl: 'https://example.test/laika.git',
      servedRoutes: [],
    });
    assert.equal(body.protocol.current, server.PROTOCOL.current);
  });

  void test("cli/src/protocol.ts's PROTOCOL is the server's PROTOCOL.current", () => {
    assert.equal(
      PROTOCOL,
      server.PROTOCOL.current,
      'bump cli/src/protocol.ts and server/src/services/developer-compat.ts together',
    );
  });

  void test('this CLI speaks every protocol a feature on this board can need', () => {
    const body = server.compatibility({
      version: '0.0.0',
      buildCommit: null,
      developerAccess: 'classic',
      cliSourceUrl: 'https://example.test/laika.git',
      servedRoutes: [],
    });
    assert.ok(PROTOCOL >= body.protocol.min_client);
    for (const [feature, min] of Object.entries(body.cli.min_protocol_for)) {
      assert.ok(PROTOCOL >= min, `${feature} needs protocol ${String(min)}`);
    }
  });
});
