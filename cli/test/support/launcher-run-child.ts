/**
 * A real launcher process for the LAI-558 review's B2 tests: the real loop
 * and the real stop signals, with the board injected exactly as the unit
 * tests inject it. `offer` launches one run of the given harness argv;
 * `idle` launches nothing (a launcher that only starts up, and so reaps).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import type { EventRecord } from '../../src/agent-events.ts';
import { handoffsDir } from '../../src/agent-handoff.ts';
import { onStopSignals, startLauncher } from '../../src/agent-launcher.ts';
import { writeCredential } from '../../src/agent-session.ts';

const [home, mode, ...argv] = process.argv.slice(2) as [string, string, ...string[]];
const OWNER = '01M2ZHT4HVYDPS7GE8S24CF4HH';
const PROJECT = '01M50CDWK51GKGJ3JQEDM0S507';
const OFFER = '01M6C05HQA4TCKRAJTZ67SG790';
const worktree = join(home, 'wt');
mkdirSync(worktree, { recursive: true });
writeCredential(home, 'claude-code', { url: 'http://board.invalid', token: 'lai_CHILD_TOKEN' });

let stopped = false;
onStopSignals(() => {
  stopped = true;
});

const record: EventRecord = {
  event_id: '01M6C05HQA4TCKRAJTZ67SG791',
  cursor: 1,
  type: 'task.handoff_offered',
  project_id: PROJECT,
  task_id: '01M5ZDB5XRCGY0H3NE8EB8NR9R',
  task_key: 'LAIKA-810',
  offer_id: OFFER,
  offer_kind: 'handoff',
  from: null,
  to: { agent_id: '01M635B62FE71AN9FXEZEJW9ND', harness: 'claude-code', device: 'Belka' },
  context_revision: null,
  state: 'received',
  at: 0,
};

const launcher = startLauncher(
  {
    home,
    env: { PATH: process.env.PATH, HOME: home },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 200))),
    ownerOf: () => Promise.resolve(OWNER),
    poll: () => Promise.resolve(mode === 'offer' ? [record] : []),
    worktreeProblem: () => undefined,
    prepare: (args) => {
      mkdirSync(handoffsDir(home), { recursive: true });
      writeFileSync(
        join(handoffsDir(home), `${args.offerId}.json`),
        JSON.stringify({
          version: 1,
          offer_id: args.offerId,
          task_id: record.task_id,
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
    addressee: () => Promise.resolve(record.to?.agent_id),
    note: () => Promise.resolve('<<<UNTRUSTED-NOTE n\n(no note)\nUNTRUSTED-NOTE n>>>'),
    spawn,
    stopped: () => stopped,
    graceMs: 300,
  },
  {
    owner_user_id: OWNER,
    device: 'Belka',
    projects: [{ project_id: PROJECT, repo: '/unused' }],
    harnesses: { 'claude-code': argv },
    max_concurrent: 1,
    max_runtime_seconds: 600,
    poll_seconds: 10,
    pass_ssh_agent: false,
  },
);
await launcher.finished;
