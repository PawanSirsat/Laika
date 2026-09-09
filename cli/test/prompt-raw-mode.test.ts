/**
 * The password must not be echoed (LAI-441, guarding LAI-422's fix).
 *
 * ## The bug this exists for
 *
 * `askSecret` reads keystrokes raw so nothing appears on screen. **A paused
 * `readline` still owns the terminal's mode**, so when the shared interface was
 * `pause()`d rather than `close()`d, `setRawMode(true)` did not take and the
 * password was echoed in full — into the terminal and into scrollback.
 *
 * LAI-422 found it by driving the CLI through a real pty and fixed it in one
 * word. **Nothing caught it coming back**: swapping `closePrompt()` back to
 * `shared?.pause()` left the suite at 19 passing, 0 failing.
 *
 * ## Why this asserts the mechanism, and why that is enough
 *
 * The property — *"nothing is echoed"* — cannot be observed without a terminal,
 * and a piped stdin **has nothing to echo**. Seeing it would need `node-pty`;
 * LAI-441 permits that dependency and it is not taken, because a native module
 * in a package whose whole pitch is `npx` with nothing installed is a real cost
 * for one test, and the mechanism assertion **fails on exactly the edit that
 * caused the bug**.
 *
 * The mechanism is observable because a closed `readline` detaches from its
 * input and a paused one does not. **Both sides were measured before this
 * assertion was written** — the fixed code and the mutation, through the same
 * probe:
 *
 * ```
 *            while the interface is open   at askSecret's setRawMode(true)
 * close()    2 listeners                   1      <- it let go
 * pause()    2 listeners                   2      <- it did not
 * ```
 *
 * So the assertion is **"fewer listeners than while the interface was open"**,
 * not a magic number. An earlier draft asserted `0` — which is what a closed
 * `readline` leaves on a bare `PassThrough`, and *not* what it leaves here, so
 * the test failed against correct code. The number was never the property;
 * *"the readline let go before raw mode was set"* is.
 */

import assert from 'node:assert/strict';
// A type-only import of the module under test, so the dynamic `import()` below
// can be typed without an inline `import()` annotation, which lint forbids.
import type * as Prompt from '../src/prompt.ts';
import { PassThrough } from 'node:stream';
import { describe, test } from 'node:test';

const PROMPT = new URL('../src/prompt.ts', import.meta.url).href;

interface Harness {
  readonly input: PassThrough;
  readonly written: string[];
  /** `[on, listenerCount]` for every `setRawMode` call, in order. */
  readonly rawMode: readonly [boolean, number][];
  /** Listeners attached while the shared interface is open and owns the input. */
  listenersWhileOpen(): number;
  restore(): void;
}

/**
 * Swap `process.stdin`/`stdout` for streams we control, then import the module.
 *
 * `prompt.ts` does `import { stdin } from 'node:process'`, which binds the
 * property's value when the module is evaluated — so the substitution has to
 * happen **before** the import, and the import has to be fresh per scenario
 * because `shared` is module state.
 */
async function harness(tag: string): Promise<{ prompt: typeof Prompt; h: Harness }> {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (on: boolean) => void;
  };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };

  const written: string[] = [];
  const rawMode: [boolean, number][] = [];

  // `readline` attaches to `keypress` on a TTY and to `data` otherwise, so
  // counting both means the assertion does not depend on which.
  const listeners = (): number => input.listenerCount('data') + input.listenerCount('keypress');

  input.isTTY = true;
  input.setRawMode = (on: boolean): void => {
    rawMode.push([on, listeners()]);
  };
  output.isTTY = true;
  output.write = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };

  const realIn = Object.getOwnPropertyDescriptor(process, 'stdin');
  const realOut = Object.getOwnPropertyDescriptor(process, 'stdout');
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  Object.defineProperty(process, 'stdout', { value: output, configurable: true });

  const prompt = (await import(`${PROMPT}?scenario=${tag}`)) as typeof Prompt;

  return {
    prompt,
    h: {
      input,
      written,
      rawMode,
      listenersWhileOpen: listeners,
      restore(): void {
        // **Tear the fake down, not just the patch.** Leaving a live
        // `PassThrough` with listeners on it let one scenario's stream keep the
        // next one's `askSecret` from ever settling — the failure reads as
        // "Promise resolution is still pending", which points at the code under
        // test rather than at the harness.
        input.removeAllListeners();
        input.end();
        input.destroy();
        output.destroy();
        if (realIn !== undefined) Object.defineProperty(process, 'stdin', realIn);
        if (realOut !== undefined) Object.defineProperty(process, 'stdout', realOut);
      },
    },
  };
}

void describe('askSecret must not leave a readline owning the terminal', () => {
  /**
   * **One scenario, several assertions, and that is a harness limit stated
   * rather than a preference.**
   *
   * Substituting `process.stdin` works for the first `prompt.ts` instance in a
   * process and not for a second, however the module is cache-busted — the
   * later instance stops seeing the fake and `askSecret` never settles.
   * Measured, not assumed: the same scenario passes alone and hangs when it runs
   * second. So the flow is exercised once, in the order `init` actually uses —
   * board URL, email, then the password — and everything worth checking is
   * checked against that one run.
   */
  void test('the shared readline is closed, not paused, before raw mode is set', async () => {
    const { prompt, h } = await harness('closed-not-paused');
    try {
      // A first question, so there is a shared interface to release. Without
      // this the assertion below would pass on an interface that never existed.
      const asked = prompt.ask('Email');
      h.input.write('ada@example.com\n');
      assert.equal(await asked, 'ada@example.com');

      const whileOpen = h.listenersWhileOpen();
      assert.ok(
        whileOpen > 0,
        'no readline listener before askSecret — the probe cannot see the thing it is about',
      );

      const secret = prompt.askSecret('Password');
      h.input.write('hunter2\r');
      assert.equal(await secret, 'hunter2');

      // The last `setRawMode(true)` is askSecret's; the earlier one is
      // `readline`'s own, made while it legitimately owned the terminal.
      const entered = h.rawMode.filter(([on]) => on);
      assert.ok(entered.length > 0, 'raw mode was never set — askSecret did not run its path');
      const atEntry = entered[entered.length - 1]?.[1] ?? -1;

      assert.ok(
        atEntry < whileOpen,
        `a readline still owned the input when raw mode was set (${String(atEntry)} listeners, ` +
          `${String(whileOpen)} while open). That is \`pause()\` instead of \`close()\` — ` +
          'exactly the edit that echoed the password in full.',
      );

      // Handed back, or the shell is left unusable until the user types `reset`
      // blind. The tail, not the whole sequence: pinning every call would pin
      // `readline`'s internals rather than this function's behaviour.
      assert.deepEqual(
        h.rawMode.map(([on]) => on).slice(-2),
        [true, false],
        'raw mode was entered and not handed back',
      );

      // Weak on its own — a fake stream echoes nothing, which is exactly why
      // LAI-422 could not test the property and this file asserts the mechanism
      // instead. Kept because it states what the mechanism is *for*, and it
      // would catch a version that printed the value back deliberately.
      assert.ok(!h.written.join('').includes('hunter2'), 'the secret was written to stdout');
    } finally {
      h.restore();
    }
  });
});
