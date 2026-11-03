/**
 * The pure half of Add device and Add tool (LAI-1061, plan LAI-1042 §E.1,
 * §E.2, §F.6): the commands, the backoff, the fingerprint's grouping and what
 * each refusal tells the person.
 *
 * The commands are the security property: **no secret and no `npx`**, the
 * server's own pair command used as it came, the clone pinned to the board's
 * commit, and the install never asked for a token.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cliSourceOf } from '../../../../../src/api/developer-compat.ts';
import { ApiError, NetworkError } from '../../../../../src/api/errors.ts';
import {
  POLL_FIRST_MS,
  POLL_MAX_MS,
  bootstrapCommands,
  exchangeEnded,
  fingerprintGroups,
  nextPollDelay,
  pairedDevice,
  pairingFinished,
  pairingNotBehind,
  pairingRefusal,
  toolAddCommand,
  toolRefusal,
} from '../../../../../src/routes/screens/developer/v3/add-flow.ts';

const PAIR = 'laika device pair --board https://board.example --code ABCD-EFGH-JKMN-PQRS';
const SOURCE = { url: 'https://github.com/PawanSirsat/Laika.git', commit: 'cea011d6abc' };

const refused = (code: 'conflict' | 'rate_limited' | 'forbidden' | 'not_found', reason?: string) =>
  new ApiError(code, `server said ${code}`, 409, reason === undefined ? null : { reason });

void describe('the bootstrap a device runs', () => {
  void test('fresh: clone at the board’s commit, install with no credential, pair through the checkout', () => {
    const { text, versionNote } = bootstrapCommands(SOURCE, PAIR, false);
    assert.deepEqual(text.split('\n'), [
      'git clone https://github.com/PawanSirsat/Laika.git ~/laika &&',
      'git -C ~/laika checkout --detach cea011d6abc &&',
      '~/laika/plugin/scripts/install.sh --no-credential &&',
      `~/laika/cli/bin/${PAIR}`,
    ]);
    assert.equal(versionNote, undefined);
  });

  void test('fresh: one && list — a refused clone runs neither install.sh nor the pair (LAI-1093)', () => {
    // An install.sh older than --no-credential ignores the flag and asks for a
    // personal token: a clone refused because ~/laika exists must stop there.
    // The per-line paste-safety scanner cannot see this, so it is its own check.
    for (const source of [SOURCE, { url: SOURCE.url, commit: null }]) {
      const lines = bootstrapCommands(source, PAIR, false).text.split('\n');
      assert.ok(lines.length >= 3, lines.join('\n'));
      assert.match(lines[0] ?? '', /^git clone /);
      assert.deepEqual(
        lines.slice(0, -1).filter((line) => !line.endsWith(' &&')),
        [],
        lines.join('\n'),
      );
      assert.equal(lines.at(-1), `~/laika/cli/bin/${PAIR}`);
      assert.ok(lines.some((line) => line.startsWith('~/laika/plugin/scripts/install.sh')));
    }
  });

  void test('installed: the server’s pair command as it came, after the update guide', () => {
    const { text, updateFirst } = bootstrapCommands(SOURCE, PAIR, true);
    assert.equal(text, PAIR);
    assert.equal(updateFirst, true);
    // Review round 1, N3: no `laika update` an old helper cannot run, and no
    // update command missing --board / --allow-http — the guide gives those.
    assert.doesNotMatch(text, /laika update|git -C/);
    for (const source of [SOURCE, { url: SOURCE.url, commit: null }, undefined]) {
      assert.equal(bootstrapCommands(source, PAIR, false).updateFirst, false);
    }
  });

  void test('a board that does not know its commit says Version unknown, never a guessed branch', () => {
    const { text, versionNote } = bootstrapCommands({ url: SOURCE.url, commit: null }, PAIR, false);
    assert.match(text, /^git clone https:\/\/github\.com\/PawanSirsat\/Laika\.git ~\/laika &&$/m);
    assert.doesNotMatch(text, /checkout --detach/);
    assert.match(versionNote ?? '', /^Version unknown/);
    // LAI-1093: no `git -C ~/laika pull`, which a detached or missing checkout refuses.
    assert.doesNotMatch(versionNote ?? '', /\bpull\b|git -C/);
    assert.match(versionNote ?? '', /How to update your Laika CLI/);
  });

  void test('no source: the pair line alone, and why', () => {
    const { text, versionNote } = bootstrapCommands(undefined, PAIR, false);
    assert.equal(text, `~/laika/cli/bin/${PAIR}`);
    assert.match(versionNote ?? '', /does not say where its helper comes from/);
  });

  void test('no command carries npx, a token, or a token variable', () => {
    for (const installed of [false, true]) {
      for (const source of [SOURCE, { url: SOURCE.url, commit: null }, undefined]) {
        const { text } = bootstrapCommands(source, PAIR, installed);
        assert.doesNotMatch(text, /\bnpx\b/);
        assert.doesNotMatch(text, /lai_/);
        assert.doesNotMatch(text, /LAIKA_TOKEN|--token/);
      }
    }
    const tool = toolAddCommand('claude-code', '01EXCHANGE');
    assert.equal(tool, 'laika tool add claude-code --exchange 01EXCHANGE');
    assert.doesNotMatch(tool, /\bnpx\b|lai_|token/i);
  });

  void test('the resumed tool command is the server’s own template', () => {
    const service = readFileSync(
      fileURLToPath(new URL('../../../../../../src/services/tool-setup.ts', import.meta.url)),
      'utf8',
    );
    assert.ok(
      service.includes('`laika tool add ${agent.harness} --exchange ${exchange.id}`'),
      'services/tool-setup.ts no longer builds the command this page rebuilds on a reload',
    );
  });

  void test('cli.source: only a cloneable address, and a commit only as hex', () => {
    const body = (source: unknown) => ({ cli: { source } });
    assert.deepEqual(cliSourceOf(body({ url: SOURCE.url, commit: 'cea011d6' })), {
      url: SOURCE.url,
      commit: 'cea011d6',
    });
    assert.deepEqual(cliSourceOf(body({ url: SOURCE.url, commit: 'main' })), {
      url: SOURCE.url,
      commit: null,
    });
    assert.equal(
      cliSourceOf(body({ url: 'https://x.example/$(whoami)', commit: null })),
      undefined,
    );
    assert.equal(cliSourceOf(body({ url: 'file:///etc', commit: null })), undefined);
    assert.equal(cliSourceOf({ cli: {} }), undefined);
    assert.equal(cliSourceOf(null), undefined);
  });
});

void describe('waiting on the board', () => {
  void test('backs off while nothing moves, resets on a change, doubles after a 429, and caps', () => {
    assert.equal(nextPollDelay(POLL_FIRST_MS, false, false), 4_500);
    assert.equal(nextPollDelay(12_000, false, false), POLL_MAX_MS);
    assert.equal(nextPollDelay(12_000, true, false), POLL_FIRST_MS);
    assert.equal(nextPollDelay(POLL_FIRST_MS, false, true), 6_000);
    assert.equal(nextPollDelay(POLL_MAX_MS * 2, false, true), POLL_MAX_MS * 2);
  });

  void test('only completed, denied, expired and cancelled are final', () => {
    for (const state of ['open', 'claimed', 'approved'] as const)
      assert.equal(pairingFinished(state), false);
    for (const state of ['completed', 'denied', 'expired', 'cancelled'] as const) {
      assert.equal(pairingFinished(state), true);
    }
  });

  void test('a poll answer behind what is on screen is not taken', () => {
    assert.equal(pairingNotBehind(undefined, 'open'), true);
    assert.equal(pairingNotBehind('claimed', 'approved'), true);
    assert.equal(pairingNotBehind('approved', 'claimed'), false);
    assert.equal(pairingNotBehind('denied', 'claimed'), false);
    assert.equal(pairingNotBehind('approved', 'completed'), true);
    assert.equal(pairingNotBehind('approved', 'approved'), true);
  });

  void test('an exchange has ended only when it closed unredeemed', () => {
    assert.equal(exchangeEnded({ state: 'expired', redeemed_at: null }), true);
    assert.equal(exchangeEnded({ state: 'cancelled', redeemed_at: null }), true);
    assert.equal(exchangeEnded({ state: 'redeemed', redeemed_at: 5 }), false);
    assert.equal(exchangeEnded({ state: 'open', redeemed_at: null }), false);
  });

  void test('a fingerprint reads in fours with every character kept', () => {
    assert.deepEqual(fingerprintGroups('3f9a1c0b7d2e4f61'), ['3f9a', '1c0b', '7d2e', '4f61']);
    assert.equal(fingerprintGroups('7F3A-91C2-0B5E-44D1').join(''), '7F3A91C20B5E44D1');
  });

  void test('a device takes a tool only once paired and active', () => {
    assert.equal(pairedDevice({ status: 'active', paired_at: 1 }), true);
    assert.equal(pairedDevice({ status: 'active', paired_at: null }), false);
    assert.equal(pairedDevice({ status: 'revoked', paired_at: 1 }), false);
  });
});

void describe('what a refusal says', () => {
  void test('pairing refusals name what happened and what to do', () => {
    assert.match(
      pairingRefusal(refused('conflict', 'public_url_unset'), 'Belka').message,
      /LAIKA_PUBLIC_URL/,
    );
    assert.match(
      pairingRefusal(refused('conflict', 'too_many_open_pairings'), 'Belka').message,
      /five pairing requests/,
    );
    assert.match(
      pairingRefusal(refused('conflict', 'device_name_taken'), 'Belka').message,
      /called Belka/,
    );
    assert.match(
      pairingRefusal(refused('conflict', 'pairing_key_changed'), 'Belka').message,
      /Nothing was approved/,
    );
    assert.equal(pairingRefusal(refused('conflict', 'pairing_expired'), 'Belka').startAgain, true);
    assert.match(pairingRefusal(refused('rate_limited'), 'Belka').message, /Too many requests/);
    assert.match(
      pairingRefusal(refused('forbidden'), 'Belka').message,
      /signed-in browser session/,
    );
    assert.match(
      pairingRefusal(new NetworkError(new Error('x')), 'Belka').message,
      /Could not reach/,
    );
  });

  void test('a duplicate pair hands back the agent ids, to route to the conflicts', () => {
    const cause = new ApiError('conflict', 'dupes', 409, {
      reason: 'agent_duplicates_need_resolution',
      agent_ids: ['a2', 'a3'],
    });
    const r = toolRefusal(cause, 'Codex');
    assert.deepEqual(r.duplicates, ['a2', 'a3']);
    assert.match(r.message, /conflicts section/);
    assert.equal(toolRefusal(refused('conflict', 'device_not_paired'), 'Codex').needsPairing, true);
  });
});
