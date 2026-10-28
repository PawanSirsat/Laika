import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * A stand-in harness (LAI-542). The test runs it through a symlink named
 * `claude`, so `ps` names it as it names the real one, and it runs each hook
 * the way Claude Code documents: `sh -c <command>` with the event's JSON on
 * stdin. Each stdin line is `{ command, payload }`; each answer one line of
 * `{ stdout, stderr, code }`. It lives until it is killed.
 */

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const { command, payload } = JSON.parse(line) as { command: string; payload: string };
  const hook = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  hook.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
  hook.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
  hook.on('close', (code) => {
    process.stdout.write(`${JSON.stringify({ stdout, stderr, code })}\n`);
  });
  hook.stdin.end(payload);
});

// Never exit on our own: the test decides when this harness dies.
setInterval(() => undefined, 60_000);
