import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Asking for things without putting them in shell history (LAI-422 AC2).
 *
 * **A password on a command line is a credential leak with a long tail** — it
 * lands in `~/.zsh_history`, in `ps` output while the process runs, and in
 * whatever shell-integration log the terminal keeps. So there is no
 * `--password` flag, deliberately, and no way to pass one.
 *
 * ## One interface for the whole session, and why
 *
 * The first version created a `readline` per question and closed it after.
 * That works interactively and **breaks the moment input is piped**: closing an
 * interface ends the underlying stream, so the second question read `null` and
 * `init` exited silently after printing "Email:". Found by running the thing
 * end to end — no unit test of `ask()` alone would have shown it, because each
 * call is correct in isolation and it is the *sequence* that fails.
 */

let shared: Interface | undefined;

/**
 * Answers read from a pipe, when there is no terminal.
 *
 * **A piped `readline` closes at EOF**, and it reaches EOF as soon as the writer
 * is done — which is usually while `init` is still awaiting a network call. The
 * next question then rejects with *"readline was closed"* and the whole flow
 * dies after the first answer. That is not only a testing problem: it is why
 * `laika init < answers` and any CI use of it could not work at all.
 *
 * So without a terminal the input is drained **once**, up front, and questions
 * are served from it. With a terminal nothing changes.
 */
let piped: string[] | undefined;

function rl(): Interface {
  shared ??= createInterface({ input: stdin, output: stdout });
  return shared;
}

async function drainStdin(): Promise<string[]> {
  let text = '';
  stdin.setEncoding('utf8');
  // Typed as `unknown` rather than `Buffer`: with an encoding set the stream
  // yields strings, and asserting the buffer type is what tripped the lint.
  for await (const chunk of stdin) text += String(chunk);
  return text.split('\n');
}

/** The next piped answer, or `''` when the input ran out. */
async function nextPiped(): Promise<string> {
  piped ??= await drainStdin();
  return piped.shift() ?? '';
}

/** Release stdin. Called once, when the flow is finished with it. */
export function closePrompt(): void {
  shared?.close();
  shared = undefined;
}

export async function ask(question: string, fallback?: string): Promise<string> {
  const suffix = fallback === undefined ? '' : ` [${fallback}]`;

  if (stdin.isTTY !== true) {
    stdout.write(`${question}${suffix}: `);
    const piped_ = (await nextPiped()).trim();
    stdout.write(`${piped_}\n`);
    return piped_ === '' && fallback !== undefined ? fallback : piped_;
  }

  const answer = (await rl().question(`${question}${suffix}: `)).trim();
  return answer === '' && fallback !== undefined ? fallback : answer;
}

/**
 * Ask without echoing what is typed.
 *
 * `readline` has no silent mode, so on a terminal the shared interface is
 * paused and the keystrokes are read raw. **Restoring matters more than the
 * feature**: leaving a terminal raw after a crash makes the shell unusable
 * until the user types `reset` blind, so every exit path goes through
 * `restore`.
 */
export function askSecret(question: string): Promise<string> {
  // Not a TTY — piped, or CI. Reading raw would hang, so read a line normally
  // and say plainly that it will be visible rather than pretending otherwise.
  if (stdin.isTTY !== true) {
    // Nothing to hide from: there is no terminal echoing anything. The answer
    // came from a pipe, so the only place it could leak is the caller's own
    // script, which is theirs to look after.
    stdout.write(`${question}: `);
    return nextPiped().then((value) => {
      stdout.write('\n');
      return value.trim();
    });
  }

  return new Promise((resolve, reject) => {
    // **Close it, do not pause it.** A paused `readline` still owns the
    // terminal's mode, so `setRawMode(true)` did not take and the password was
    // echoed in full — found by driving the CLI through a real pty, which is
    // the only way that shows. Closing releases the tty; `shared` is cleared so
    // a later question builds a fresh interface.
    closePrompt();
    stdout.write(`${question}: `);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const restore = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          restore();
          resolve(value);
          return;
        }
        // Ctrl-C must still quit, or raw mode has trapped the user.
        if (ch === CTRL_C) {
          restore();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === BACKSPACE || ch === DELETE) {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };

    stdin.on('data', onData);
  });
}

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DELETE = String.fromCharCode(127);

/** A yes/no, defaulting to **no** — the safe answer for anything destructive. */
export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N]`)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}
