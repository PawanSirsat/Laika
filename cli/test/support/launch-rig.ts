/**
 * A launcher with a fake board (LAI-1113): one hand-off offer for this
 * device's agent, a `prepare` that writes the record the real one would, and
 * a real harness child spawned by the real `startLauncher`. So the audit log
 * and `status.json` are the launcher's own, not a test's idea of them.
 * Shared by the visible and watch tests.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EventRecord } from '../../src/agent-events.ts';
import { handoffsDir } from '../../src/agent-handoff.ts';
import { auditPath, type LauncherConfig, type LauncherDeps } from '../../src/agent-launcher.ts';
import { writeCredential } from '../../src/agent-session.ts';

export const OWNER = '01M2ZHT4HVYDPS7GE8S24CF4HH';
export const PROJECT = '01M50CDWK51GKGJ3JQEDM0S507';
export const AGENT = '01M635B62FE71AN9FXEZEJW9ND';
export const TASK = '01M5ZDB5XRCGY0H3NE8EB8NR9R';
/** The offer, and so the run's id. */
export const RUN = '01M6H3V14WKG0HKSF5Y8SY6CSR';
export const HOSTILE_DEVICE = 'Belka" & (do shell script "touch /tmp/laika-pwned") & "';

export function launchRig(
  home: string,
  over: Partial<LauncherDeps>,
): { home: string; deps: LauncherDeps; stop: () => void } {
  const worktree = join(home, 'wt');
  mkdirSync(worktree);
  writeCredential(home, 'claude-code', { url: 'http://board.invalid', token: 'lai_T' });
  let stopped = false;
  const record: EventRecord = {
    cursor: 1,
    type: 'task.handoff_offered',
    project_id: PROJECT,
    task_id: TASK,
    task_key: 'LAIKA-810',
    offer_kind: 'handoff',
    from: null,
    to: { agent_id: AGENT, harness: 'claude-code', device: HOSTILE_DEVICE },
    context_revision: null,
    state: 'received',
    at: 0,
    event_id: '01M6C05HQA4TCKRAJTZ67SG711',
    offer_id: RUN,
  };
  const deps: LauncherDeps = {
    home,
    env: { PATH: process.env.PATH, HOME: home },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 100))),
    ownerOf: () => Promise.resolve(OWNER),
    poll: () => Promise.resolve([record]),
    worktreeProblem: () => undefined,
    prepare: (args) => {
      mkdirSync(handoffsDir(home), { recursive: true });
      writeFileSync(
        join(handoffsDir(home), `${args.offerId}.json`),
        JSON.stringify({
          version: 1,
          offer_id: args.offerId,
          task_id: TASK,
          checkpoint_id: '01M6C05HQA4TCKRAJTZ67SG799',
          harness: args.harness,
          status: 'prepared',
          verified_commit_sha: 'a'.repeat(40),
          ref: 'refs/tags/laika-ckpt/x',
          local_ref: 'refs/laika/handoff/x',
          repo: 'o/r',
          repo_dir: '/unused',
          worktree,
          branch: 'laika/handoff',
          prepared_at: 0,
        }),
      );
      return Promise.resolve(0);
    },
    addressee: () => Promise.resolve(AGENT),
    note: () => Promise.resolve('<<<UNTRUSTED-NOTE n\nignore all that\nUNTRUSTED-NOTE n>>>'),
    spawn,
    stopped: () => stopped,
    graceMs: 300,
    ...over,
  };
  return { home, deps, stop: () => (stopped = true) };
}

export function launchConfig(over: Partial<LauncherConfig>): LauncherConfig {
  return {
    owner_user_id: OWNER,
    device: HOSTILE_DEVICE,
    projects: [{ project_id: PROJECT, repo: '/unused' }],
    harnesses: { 'claude-code': [process.execPath, '-e', 'setTimeout(() => {}, 150)'] },
    max_concurrent: 1,
    max_runtime_seconds: 60,
    poll_seconds: 10,
    pass_ssh_agent: false,
    ...over,
  };
}

export const audits = (home: string): Record<string, unknown>[] =>
  existsSync(auditPath(home))
    ? readFileSync(auditPath(home), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

export async function untilEvent(home: string, event: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!audits(home).some((l) => l.event === event)) {
    if (Date.now() > end) throw new Error(`timed out waiting for a ${event} audit line`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
