/**
 * The real question `enable` asks on a terminal (LAI-1109).
 *
 * The `enable` tests inject a fake `ask`, so the real one was never run: it
 * closed the interface before resolving, `close` fired synchronously and
 * resolved `undefined` first, and every typed answer read as "no terminal".
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';

import { askTerminal } from '../src/agent-launcher-service.ts';

const terminal = (): PassThrough & { isTTY: boolean } =>
  Object.assign(new PassThrough(), { isTTY: true });

void describe('askTerminal', () => {
  void test('a typed line is the answer, trimmed', async () => {
    const input = terminal();
    const output = new PassThrough();
    const answer = askTerminal('Checkout: ', input, output);
    input.write('/Users/me/Laika  \n');
    assert.equal(await answer, '/Users/me/Laika');
    assert.match(String(output.read()), /Checkout: /);
  });

  void test('each question in a row gets its own line', async () => {
    const input = terminal();
    const output = new PassThrough();
    const first = askTerminal('Checkout: ', input, output);
    input.write('/Users/me/Laika\n');
    assert.equal(await first, '/Users/me/Laika');
    const second = askTerminal('Allow? ', input, output);
    input.write('yes\n');
    assert.equal(await second, 'yes');
  });

  void test('a blank line is the empty answer, not "no terminal"', async () => {
    const input = terminal();
    const answer = askTerminal('Checkout: ', input, new PassThrough());
    input.write('\n');
    assert.equal(await answer, '');
  });

  void test('input ending before a line is undefined', async () => {
    const input = terminal();
    const answer = askTerminal('Checkout: ', input, new PassThrough());
    input.end();
    assert.equal(await answer, undefined);
  });

  void test('no terminal is undefined, without asking', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: false });
    const output = new PassThrough();
    assert.equal(await askTerminal('Checkout: ', input, output), undefined);
    assert.equal(output.read(), null);
  });
});
