import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Asking for things without putting them in shell history (LAI-422 AC2).
 *
 * **A password on a command line is a credential leak with a long tail** — it
 * lands in `~/.zsh_history`, in `ps` output while the process runs, and in
 * whatever shell-integration log the terminal keeps. So there is no
 * `--password` flag, deliberately, and no way to pass one.
 */

export async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback === undefined ? '' : ` [${fallback}]`;
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer === '' && fallback !== undefined ? fallback : answer;
  } finally {
    rl.close();
  }
}

/**
 * Ask without echoing what is typed.
 *
 * `readline` has no silent mode, so the terminal goes into raw mode and the
 * keystrokes are read directly. **Restoring it matters more than the feature**:
 * leaving a terminal raw after a crash makes the user's shell unusable until
 * they type `reset` blind, so every exit path goes through `restore`.
 */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(`${question}: `);

    // Not a TTY — a pipe, or CI. Reading raw would hang forever, so fall back
    // to a normal read and say plainly that it will be visible.
    if (stdin.isTTY !== true) {
      stdout.write('\n(no terminal — input will be visible)\n');
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question('')
        .then((answer) => {
          rl.close();
          resolve(answer.trim());
        })
        .catch((cause: unknown) => {
          rl.close();
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        });
      return;
    }

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
