/**
 * The proposed agent UI's words and styling (LAI-536, proposal §6).
 *
 * `node --test` cannot render a `.tsx`, so this reads the data the components
 * draw from and the CSS they draw with. What a browser shows is
 * `test/browser/agent-states.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import type { AgentChoice } from '../../../src/components/agent/AgentPicker.tsx';
import {
  CONTEXT_RECEIVED_ONLY,
  DEFAULT_HANDOFF_POLICY,
  EXECUTION_STATE_WORDS,
  EXECUTION_STATES,
  HANDOFF_FILTER_WORDS,
  HANDOFF_KIND_WORDS,
  NO_CHECKPOINT,
  NOTE_WORDS,
  READINESS_WORDS,
  RECEIVER_MUST_ACCEPT,
  REGISTRATION_STEPS,
  VERIFICATION_WORDS,
  VERIFY_STATES,
  VERIFY_WORDS,
} from '../../../src/components/agent/agent-states.ts';
import { code } from '../../helpers/code.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const AGENT = `${SRC}components/agent/`;

void describe('every state proposal §6 names has words', () => {
  void test('the card execution states, verbatim', () => {
    // Quoted from proposal §6 ("Waiting for agent, Waiting for approval,
    // Connection lost, Recovery available, Save needs attention"), the task's
    // scope ("Working") and §4.3.1 ("Verification pending").
    const named = [
      'Waiting for agent',
      'Waiting for approval',
      'Working',
      'Connection lost',
      'Recovery available',
      'Save needs attention',
      'Verification pending',
    ];
    assert.deepEqual(
      EXECUTION_STATES.map((s) => EXECUTION_STATE_WORDS[s].label),
      named,
    );
    for (const s of EXECUTION_STATES) {
      assert.ok(EXECUTION_STATE_WORDS[s].meaning.length > 20, `${s} says nothing about itself`);
    }
  });

  void test('the checkpoint, note and recovery wording', () => {
    assert.equal(NOTE_WORDS.earlier, 'Note describes an earlier save');
    assert.equal(NOTE_WORDS.missing, 'No continuation note');
    assert.equal(VERIFICATION_WORDS.pending, 'Verification pending');
    assert.equal(NO_CHECKPOINT, 'Automatic recovery unavailable — no saved checkpoint');
    assert.equal(RECEIVER_MUST_ACCEPT, 'The receiver must accept');
  });

  void test('the inbox filters and kinds', () => {
    assert.deepEqual(Object.values(HANDOFF_FILTER_WORDS), [
      'Received',
      'Sent',
      'Needs approval',
      'Recovery',
    ]);
    assert.equal(HANDOFF_KIND_WORDS.work_request, 'Work request');
    assert.equal(HANDOFF_KIND_WORDS.recovery, 'Recovery offer');
  });

  void test('the five wizard steps and the three readiness facts, kept apart', () => {
    assert.equal(REGISTRATION_STEPS.length, 5);
    assert.deepEqual(
      Object.values(READINESS_WORDS).map((w) => w.label),
      ['Credential created', 'Connected', 'Ready for recovery'],
    );
  });
});

void describe('the rest of §6, and §4.5 and §4.6', () => {
  void test('verify has three outcomes, each in words', () => {
    assert.deepEqual([...VERIFY_STATES], ['waiting', 'verified', 'failed']);
    assert.match(VERIFY_WORDS.verified, /its own token/);
    assert.equal(new Set(Object.values(VERIFY_WORDS)).size, 3);
  });

  void test('the hand-off policy defaults are the proposal’s (§4.5)', () => {
    assert.deepEqual(DEFAULT_HANDOFF_POLICY, {
      allowOtherOwners: false,
      crossOwnerRequiresApproval: true,
      maxHandoffs: 3,
      offerTtlMinutes: 30,
    });
  });

  void test('context says received, and says that is not understood (§4.6)', () => {
    assert.match(CONTEXT_RECEIVED_ONLY, /^Received means the revision reached that session\./);
    assert.match(CONTEXT_RECEIVED_ONLY, /does not mean the agent read or understood it/);
  });

  void test('an agent that cannot be picked must carry a reason (compile-time)', () => {
    const base = { id: 'x', client: 'codex', owner: 'Someone', device: 'box' } as const;
    // @ts-expect-error — LAI-536: `unavailable` without a reason must not type-check.
    const silent: AgentChoice = { ...base, availability: 'unavailable' };
    const said: AgentChoice = { ...base, availability: 'unavailable', reason: 'Revoked' };
    assert.equal(silent.availability, said.availability);
  });
});

void describe('no colour of its own (D-020)', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;
  const RGB = /\b(?:rgba?|hsla?)\s*\(/g;

  void test('agent CSS has no literal colour and declares no token', async () => {
    const files = [`${AGENT}agent.css`, `${SRC}components/agent-states/agent-state-gallery.css`];
    for (const file of files) {
      const css = await readFile(file, 'utf8');
      assert.ok(css.length > 200, `${file} looks empty — the reader is wrong`);
      assert.deepEqual(
        [...css.matchAll(HEX)].map((m) => m[0]),
        [],
        `literal hex in ${file}`,
      );
      assert.deepEqual(
        [...css.matchAll(RGB)].map((m) => m[0]),
        [],
        `literal rgb() in ${file}`,
      );
      assert.deepEqual(
        [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
        [],
        `${file} declares a custom property — a new token belongs to the owner`,
      );
    }
  });

  void test('the chip is the secondary text on the neutral chip surface, and nothing else', async () => {
    const css = await readFile(`${AGENT}agent.css`, 'utf8');
    const rule = /\.agent-chip \{([^}]*)\}/.exec(css)?.[1];
    assert.ok(rule !== undefined, 'no .agent-chip rule');
    const colours = [...rule.matchAll(/\b(color|background|border)\s*:\s*([^;]+);/g)].map(
      (m) => `${m[1] ?? ''}: ${m[2] ?? ''}`,
    );
    assert.deepEqual(colours, [
      'border: 1px solid var(--chip-neutral-border)',
      'background: var(--chip-neutral-bg)',
      'color: var(--text-secondary)',
    ]);
  });

  void test('the agent components carry no literal colour or inline style', async () => {
    for (const file of (await readdir(AGENT)).filter((f) => f.endsWith('.tsx'))) {
      const src = code(await readFile(AGENT + file, 'utf8'));
      assert.deepEqual(
        [...src.matchAll(HEX)].map((m) => m[0]),
        [],
        `literal hex in ${file}`,
      );
      assert.ok(!src.includes('style={'), `${file} sets an inline style`);
    }
  });
});

void describe('the gallery stays the gallery', () => {
  void test('StateGallery loads it with import(), never a static import', async () => {
    const src = code(await readFile(`${SRC}components/StateGallery.tsx`, 'utf8'));
    assert.match(src, /lazy\(\(\) => import\('\.\/agent-states\/AgentStateGallery\.tsx'\)\)/);
    assert.ok(
      !/^import .*agent-states/m.test(src),
      'a static import puts the example data in the main bundle',
    );
  });

  void test('the existing agent badge keeps its meaning on the live card', async () => {
    const card = await readFile(`${SRC}routes/screens/board/TaskCard.tsx`, 'utf8');
    assert.match(card, /const byAgent = task\.created_via === 'mcp';/);
    assert.match(card, /title=\{`Written by \$\{assignee\.name\}'s agent`\}/);
  });
});
