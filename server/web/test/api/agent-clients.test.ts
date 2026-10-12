/**
 * `api/agent-clients.ts` — the client's slug list agrees with the server's
 * (LAI-737, mirroring LAI-736).
 *
 * **Names from both sides, never a count** (CLAUDE.md §2): a count stays green
 * when one slug is renamed on one side, and a name list cannot.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  AGENT_CLIENT_MONOGRAMS,
  AGENT_CLIENT_NAMES,
  AGENT_CLIENT_TONES,
  AGENT_CLIENTS,
  asAgentClient,
  asAgentClients,
} from '../../src/api/agent-clients.ts';

const SERVER = fileURLToPath(new URL('../../../src/auth/agent-clients.ts', import.meta.url));

/** The string literals inside `export const AGENT_CLIENTS = [ … ]`. */
function serverSlugs(): string[] {
  const source = readFileSync(SERVER, 'utf8');
  const list = /export const AGENT_CLIENTS = \[([\s\S]*?)\]/.exec(source);
  assert.ok(list !== null, 'AGENT_CLIENTS not found in server/src/auth/agent-clients.ts');
  return [...(list[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1] ?? '');
}

void describe('the slug list mirrors the server', () => {
  void test('every server slug is known here', () => {
    const missing = serverSlugs().filter(
      (slug) => !(AGENT_CLIENTS as readonly string[]).includes(slug),
    );
    assert.deepEqual(
      missing,
      [],
      `the server sends slugs this client does not know: ${missing.join(', ')}`,
    );
  });

  void test('every slug here is one the server can send', () => {
    const server = serverSlugs();
    assert.ok(server.length > 0, 'parsed no server slugs — this would prove nothing');
    const invented = AGENT_CLIENTS.filter((slug) => !server.includes(slug));
    assert.deepEqual(
      invented,
      [],
      `this client lists slugs the server never sends: ${invented.join(', ')}`,
    );
  });
});

void describe('every slug can be drawn', () => {
  void test('each has a name, a two-character monogram and a tone', () => {
    for (const slug of AGENT_CLIENTS) {
      assert.ok(AGENT_CLIENT_NAMES[slug].length > 1, `${slug} has no name`);
      assert.equal(AGENT_CLIENT_MONOGRAMS[slug].length, 2, `${slug}'s monogram`);
      assert.ok(AGENT_CLIENT_TONES[slug].length > 0, `${slug} has no tone`);
    }
  });

  void test('no two agents share a monogram, or the marks stop telling them apart', () => {
    const seen = new Map<string, string>();
    for (const slug of AGENT_CLIENTS) {
      const mono = AGENT_CLIENT_MONOGRAMS[slug];
      assert.equal(seen.get(mono), undefined, `${slug} and ${seen.get(mono) ?? ''} share ${mono}`);
      seen.set(mono, slug);
    }
  });
});

void describe('reading a slug off the wire', () => {
  void test('a known slug is kept', () => {
    assert.equal(asAgentClient('codex'), 'codex');
  });

  void test('CONTROL: an unknown or missing value is no agent, never undefined', () => {
    // A fixture from before LAI-736 has no `client`; a server ahead of this
    // list sends a slug it has never seen. Neither may render as `undefined`.
    assert.equal(asAgentClient(undefined), null);
    assert.equal(asAgentClient('teleporter'), null);
    assert.equal(asAgentClient(null), null);
  });

  void test('a list keeps order, drops unknowns and repeats', () => {
    assert.deepEqual(asAgentClients(['codex', 'nope', 'cursor', 'codex']), ['codex', 'cursor']);
    assert.deepEqual(asAgentClients(undefined), []);
  });
});
