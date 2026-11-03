/**
 * The real questions `enable` asks on a terminal (LAI-1109, LAI-1111).
 *
 * The `enable` tests inject a fake `ask`, so the real one was never run. It
 * closed the interface before resolving, so every typed answer read as "no
 * terminal" (LAI-1109). Then each question made its own readline, and answers
 * typed or pasted ahead went with the first one when it closed (LAI-1111):
 * every question of one `enable` is now asked on one readline. The pty test
 * (`agent-launcher-enable-pty.test.ts`) drives the same thing through a real
 * terminal.
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';

import { terminalAsker } from '../src/agent-launcher-service.ts';

const terminal = (): PassThrough & { isTTY: boolean } =>
  Object.assign(new PassThrough(), { isTTY: true });

void describe('terminalAsker', () => {
  void test('a typed line is the answer, trimmed', async () => {
    const input = terminal();
    const output = new PassThrough();
    const asker = terminalAsker(input, output);
    const answer = asker.ask('Checkout: ');
    input.write('/Users/me/Laika  \n');
    assert.equal(await answer, '/Users/me/Laika');
    assert.match(String(output.read()), /Checkout: /);
    asker.close();
  });

  void test('each question in a row gets its own line', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const first = asker.ask('Checkout: ');
    input.write('/Users/me/Laika\n');
    assert.equal(await first, '/Users/me/Laika');
    const second = asker.ask('Allow? ');
    input.write('yes\n');
    assert.equal(await second, 'yes');
    asker.close();
  });

  void test('answers pasted at once are each read by the next question, in order', async () => {
    const input = terminal();
    const output = new PassThrough();
    const asker = terminalAsker(input, output);
    const first = asker.ask('Checkout: ');
    input.write('/Users/me/Laika\nyes\nenable\n');
    assert.equal(await first, '/Users/me/Laika');
    assert.equal(await asker.ask('Allow? '), 'yes');
    assert.equal(await asker.ask('Type enable: '), 'enable');
    // A question answered from what was pasted shows its answer, so the transcript reads in order.
    assert.match(String(output.read()), /Allow\? yes\nType enable: enable\n/);
    asker.close();
  });

  void test('answers typed before the first question, and between questions, are kept', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    input.write('/Users/me/Laika\n');
    assert.equal(await asker.ask('Checkout: '), '/Users/me/Laika');
    input.write('yes\n');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await asker.ask('Allow? '), 'yes');
    asker.close();
  });

  void test('a blank line is the empty answer, not the end of input', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const answer = asker.ask('Checkout: ');
    input.write('\n');
    assert.equal(await answer, '');
    asker.close();
  });

  void test('input ending before a line is undefined, and so is every question after it', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const answer = asker.ask('Checkout: ');
    input.end();
    assert.equal(await answer, undefined);
    assert.equal(await asker.ask('Allow? '), undefined);
  });

  void test('LAI-1109: a line that arrives with the end of input is still the answer', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const answer = asker.ask('Checkout: ');
    input.end('/Users/me/Laika\n');
    assert.equal(await answer, '/Users/me/Laika');
  });

  void test('pasted answers outlive the end of input; only the question after them is undefined', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const first = asker.ask('Checkout: ');
    input.end('/Users/me/Laika\nyes\n');
    assert.equal(await first, '/Users/me/Laika');
    assert.equal(await asker.ask('Allow? '), 'yes');
    assert.equal(await asker.ask('Type enable: '), undefined);
  });

  void test('no terminal is undefined, without asking or listening', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: false });
    const output = new PassThrough();
    const asker = terminalAsker(input, output);
    assert.equal(await asker.ask('Checkout: '), undefined);
    assert.equal(output.read(), null);
    assert.equal(input.listenerCount('data'), 0);
    asker.close();
  });

  void test('a closed asker answers undefined and never listens again (review N1)', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    asker.close();
    input.write('/Users/me/Laika\n');
    assert.equal(await asker.ask('Checkout: '), undefined);
    assert.equal(input.listenerCount('data'), 0, 'closed before a question: no reader opened');
    assert.equal(asker.interrupted(), false);
  });

  void test('a closed asker after a question answers undefined too', async () => {
    const input = terminal();
    const asker = terminalAsker(input, new PassThrough());
    const first = asker.ask('Checkout: ');
    input.write('/Users/me/Laika\n');
    assert.equal(await first, '/Users/me/Laika');
    asker.close();
    assert.equal(await asker.ask('Allow? '), undefined);
  });

  void test('Ctrl+C at a question is undefined, and says it was interrupted', async () => {
    const input = terminal();
    // A terminal on both sides, so readline reads keys and Ctrl+C is one.
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    const asker = terminalAsker(input, output);
    const answer = asker.ask('Checkout: ');
    input.write('\x03');
    assert.equal(await answer, undefined);
    assert.equal(asker.interrupted(), true);
    assert.equal(await asker.ask('Allow? '), undefined);
  });
});
