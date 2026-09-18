/**
 * `api/org.ts` — the org agrees with the server, optionality included (LAI-459).
 *
 * ## Why this exists beside `view-type-drift.test.ts`
 *
 * `Org` and `OrgAi` **are** paired there, unlike `PresenceEntry` — both are real
 * `*View` exports, so neither hits the census wall. What that check cannot do is
 * the part that matters here: **`fieldsOf` matches `name\??\s*:`, so `ai?` and
 * `ai` are the same field to it.**
 *
 * And `ai?` is the entire §12 gate. The server omits the key for a caller
 * without `org.settings.edit` — *absent, not null* — so:
 *
 * - a client declaring `ai` **required** typechecks against a Viewer's response
 *   and then reads `undefined.configured` at runtime;
 * - a client declaring it `OrgAi | null` invites `org.ai === null`, which is
 *   `false` for a Viewer, so the AI block renders *"no provider configured"* —
 *   telling them the one thing the gate exists to withhold.
 *
 * Neither is a name mismatch, so neither is visible to the drift check.
 *
 * ## And the patch is the other direction
 *
 * `OrgPatch`'s three AI fields are `.nullable().optional()` on the server: `null`
 * clears and absent leaves alone. A client type that were only optional could
 * not express *"stop using a provider"* at all, and the request would simply not
 * be sendable — a gap that typechecks perfectly on both sides.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { AI_PROVIDERS, type Org, type OrgAi, type OrgPatch } from '../../src/api/org.ts';
import { code } from '../helpers/code.ts';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const service = read('../../../src/services/orgs.ts');
const route = read('../../../src/http/routes/orgs.ts');

/**
 * **`services/orgs.ts` re-exports `AI_PROVIDERS`; it does not declare it.**
 *
 * The first draft of the provider check grepped the service and failed with
 * *"the server no longer declares AI_PROVIDERS as a literal array"* — a sentence
 * that reads as a finding about the server and was a finding about where the
 * test was looking. `db/enums.ts` is the declaration, and a CHECK constraint
 * enforces it, which is why it is the right file to compare against.
 */
const enums = read('../../../src/db/enums.ts');

/** The body of a named `interface`, so a later one cannot answer for this one. */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  assert.notEqual(
    start,
    -1,
    `the server no longer exports ${name} — this test is aimed at nothing`,
  );
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  assert.fail(`${name} is not closed`);
}

void describe('the AI settings are absent, not null', () => {
  void test('the server declares `ai` optional and never nullable', () => {
    const body = interfaceBody(service, 'OrgView');

    // Anchored to line start so a mention inside a doc comment cannot satisfy it.
    assert.match(body, /^\s*ai\?:\s*OrgAiView;/m, '`ai` is no longer optional on the server');
    assert.doesNotMatch(
      body,
      /^\s*ai\??:\s*[^;]*\bnull\b/m,
      'the server made `ai` nullable — this client asks `!== undefined` and would render ' +
        'a withheld block as "no provider configured"',
    );
  });

  /**
   * The client's own declaration, read rather than inferred. A type-level
   * assertion would be checked by `tsc` and invisible in a test report; this
   * fails with a sentence naming what drifted.
   */
  void test('the client mirrors that exactly', () => {
    const client = readFileSync(
      fileURLToPath(new URL('../../src/api/org.ts', import.meta.url)),
      'utf8',
    );
    assert.match(client, /^\s*readonly ai\?:\s*OrgAi;/m, '`ai` is not optional on the client');
    assert.doesNotMatch(
      client,
      /^\s*readonly ai\??:[^;]*\bnull\b/m,
      '`ai` is nullable on the client',
    );
  });

  /** The compiler's half of the same claim: absence must be a reachable state. */
  void test('an org with no `ai` key is a valid Org', () => {
    const withheld: Org = {
      id: 'o1',
      name: 'An Org',
      presence_enabled: false,
      created_at: 1,
      updated_at: 2,
    };
    assert.equal('ai' in withheld, false);
    assert.equal(withheld.ai, undefined);
  });
});

void describe('the provider list matches the server', () => {
  void test('every provider the server accepts is one the client offers, and no more', () => {
    // Both sides by name, never a count: a count agrees with the wrong list
    // whenever two things change at once, which is exactly when it is needed.
    const declared = /AI_PROVIDERS = \[([^\]]*)\]/.exec(enums);
    assert.ok(declared, 'db/enums.ts no longer declares AI_PROVIDERS as a literal array');

    // …and the service really does hand that same list on, or this compares the
    // client against a constant the endpoint never sees.
    assert.match(
      service,
      /export \{[^}]*\bAI_PROVIDERS\b[^}]*\} from '\.\.\/db\/enums\.ts'/,
      "services/orgs.ts no longer re-exports db/enums.ts's list",
    );

    const onServer = [...(declared[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').sort();
    assert.ok(onServer.length > 0, 'parsed an empty provider list — the regex matched nothing');
    assert.deepEqual([...AI_PROVIDERS].sort(), onServer);
  });
});

void describe('the patch can say "clear this"', () => {
  void test('the route accepts null for each AI field, and the client can send it', () => {
    for (const field of ['ai_provider', 'ai_base_url', 'ai_api_key']) {
      assert.match(
        route,
        new RegExp(`${field}:[^,]*\\.nullable\\(\\)\\.optional\\(\\)`),
        `${field} is no longer nullable-and-optional on the route`,
      );
    }

    // `null` clears…
    const clear: OrgPatch = { ai_provider: null, ai_base_url: null, ai_api_key: null };
    assert.equal(clear.ai_provider, null);

    // …and absent leaves alone, which is a different request, not the same one.
    const untouched: OrgPatch = { presence_enabled: true };
    assert.equal('ai_provider' in untouched, false);
  });

  void test('the route refuses a patch that changes nothing', () => {
    // The client must never send `{}`: it is a `400`, not a no-op, and the
    // screen would surface it as a failure the person did not cause.
    assert.match(route, /Give at least one setting to change/);
  });
});

void describe('the key itself is never on the wire', () => {
  void test('the response type carries only a tail, and the patch is write-only', () => {
    // `code()` first, and that is the whole point of this assertion's history:
    // `OrgAiView`'s doc comment says *"Never the key… AES-256-GCM ciphertext"*,
    // so a raw scan reports the comment explaining the rule as a breach of it.
    // Punishing the explanation is how LAI-019 and LAI-020 were lost.
    const ai = code(interfaceBody(service, 'OrgAiView'));
    assert.doesNotMatch(ai, /api_key|ai_key_enc|plaintext/i, 'the server view exposes the key');
    // The stripping is not doing the work on its own — the real fields survive.
    assert.match(ai, /configured|key_last4/, 'code() removed the declarations too');

    const client: OrgAi = { configured: true, provider: 'anthropic', key_last4: '9f2a' };
    assert.equal(Object.keys(client).length, 3, 'the client view grew a field');
    assert.ok(!Object.keys(client).some((k) => /key$|api_key/.test(k)), 'a key field appeared');
  });
});
