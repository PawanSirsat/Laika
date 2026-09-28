/**
 * The prompt drives the installer over a heredoc, and nothing else checks that
 * contract (LAI-622).
 *
 * `setupPrompt` feeds `install.sh` two lines on stdin: the board URL, then the
 * token. If the installer ever asks for them in the other order, the prompt
 * silently installs a URL *as* the token — and the failure does not surface at
 * install time. It surfaces two steps later as a 401 from `/api/v1/me`, which
 * reads like a bad token rather than a swapped pair.
 *
 * One assertion buys the whole chain.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const INSTALLER = fileURLToPath(
  new URL('../../../../../../plugin/scripts/install.sh', import.meta.url),
);

void describe('the installer still reads the two answers in the order the prompt sends them', () => {
  const script = readFileSync(INSTALLER, 'utf8');

  void test('the installer was found and read', () => {
    // Vacuity guard: a wrong path yields an empty string, and every assertion
    // below would then be measuring nothing.
    assert.ok(script.length > 1_000, `read ${String(script.length)} bytes`);
    assert.match(script, /read -r/, 'this does not look like the installer');
  });

  void test('the board URL is asked for before the token', () => {
    const url = script.indexOf('URL_INPUT');
    const token = script.indexOf('read -r TOKEN');
    assert.ok(script.includes('URL_INPUT'), 'no URL prompt found');
    assert.ok(script.includes('read -r TOKEN'), 'no token prompt found');
    assert.ok(
      url < token,
      'the installer now asks for the token first — the prompt feeds it a URL',
    );
  });

  void test('both answers still come from stdin, so a heredoc can supply them', () => {
    /*
     * If either prompt were skipped when stdin is not a terminal, the heredoc
     * would feed one answer into the other's slot. The `stty` echo guard is
     * `[ -t 0 ]`-conditional on purpose; the `read` itself must not be.
     */
    assert.match(script, /^read -r URL_INPUT/m, 'the URL is no longer read from stdin');
    assert.match(script, /^read -r TOKEN/m, 'the token is no longer read from stdin');
  });
});
