---
id: LAI-161
title: '§12 is unimplemented — nothing encrypts or decrypts `orgs.*_enc`'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-446
status: done
started: 2026-09-01T19:10:00Z
finished: 2026-09-01T19:40:00Z
---

## Goal

SPEC §12:

> Secrets are encrypted at rest with **AES-256-GCM** under a key derived from
> `LAIKA_SECRET` … Ciphertext lives in `orgs.*_enc`; plaintext is never logged,
> never returned by the API … and never written to `activity`.

**None of that exists.** There is no `encrypt`, no `decrypt`, and no module that
derives a key. Three columns are declared for ciphertext and nothing has ever
written one:

| column | written by | read by |
| --- | --- | --- |
| `orgs.ai_api_key_enc` | nothing | `keyLast4`, which returns `null` without decrypting |
| `orgs.smtp_json_enc` | nothing | `systemStatus`, which only asks whether it is non-empty |
| `orgs.github_webhook_secret_enc` | nothing | nothing |

It has not mattered because nothing needed a plaintext back. **Two tasks now
do**, and both are blocked on it:

- **LAI-446** verifies an HMAC against `github_webhook_secret_enc`, decrypted per
  request. Without a decrypt there is no signature to compare against.
- **LAI-447** writes the provider config, which is the encrypt half.

Neither names this, because from outside it looks like a column read.

## Why it is its own task and not two lines inside LAI-446

**It is cryptography, and it wants reviewing as cryptography** rather than as a
detail of a webhook receiver. The decisions below are not obvious, they are
shared by three columns and two callers, and getting one wrong is silent: AES-GCM
with a repeated nonce, or with the tag dropped, still returns plausible
ciphertext and still decrypts on the happy path.

## The decisions to make and write down

- **Key derivation.** `LAIKA_SECRET` is a passphrase of at least 32 characters
  (§11.7), not 32 random bytes. It needs a KDF — HKDF-SHA256 is in `node:crypto`
  and needs no dependency. **Say which, and whether the salt is fixed or stored**,
  because a fixed salt with one secret per instance is defensible and an
  undocumented one is not.
- **Per-secret info/context**, so the key for the webhook secret is not the key
  for the API key. Cheap with HKDF and impossible to retrofit.
- **The stored format.** Nonce and tag have to live with the ciphertext. Name the
  encoding, and **version it** — a format with no version byte cannot be changed
  without a migration that cannot tell the two apart.
- **What a failed decrypt means.** Wrong key after a `LAIKA_SECRET` rotation,
  and a tampered row, are the same GCM failure. It must not be silent and it
  must not look like "no secret configured", which is LAI-437's family exactly.

## Acceptance criteria

- [x] `encrypt`/`decrypt` in one module, used by every `_enc` column, with the
      decisions above written where the code is.
- [x] Round-trips: encrypt → decrypt returns the plaintext, for empty strings,
      long strings and non-ASCII.
- [x] **Tamper detection asserted.** Flip a byte of the ciphertext, the tag and
      the nonce in turn; each must fail, and the test must assert *which* error
      rather than that something threw — a bare `rejects.toThrow()` is satisfied
      by a broken setup (CLAUDE.md §5).
- [x] **The nonce is never reused.** Encrypt the same plaintext twice with the
      same key and assert the two ciphertexts differ. This is the one that is
      silent when wrong.
- [x] A wrong key fails to decrypt, and the failure is distinguishable from an
      absent secret.
- [x] Plaintext never reaches a log, a response or `activity`. §12 says so three
      times; at least one assertion should hold it.
- [x] Full gate green — **`EXIT 0`**.

## Notes

**No new dependency.** `node:crypto` has `createCipheriv`, `createDecipheriv`,
`hkdfSync` and `randomBytes`.

**Do not widen this to key rotation.** Re-encrypting every column under a new
`LAIKA_SECRET` is a real operation with its own failure modes; a version byte in
the format is what keeps it possible, and that is all this task owes it.

Found while claiming LAI-446. Both LAI-446 and LAI-447 carry it in `depends-on`.

## Outcome

`src/secrets.ts` — flat, for the same reason `errors.ts` is: `services/`
encrypts, `http/routes/` decrypts, and `services/` may not import `http/`.

### The four decisions

**HKDF-SHA256.** `LAIKA_SECRET` is a passphrase of at least 32 *characters*
(§11.7), which is neither the length nor the distribution AES-256 wants, and §12
says *"a key **derived from**"* rather than "the key". HKDF is in `node:crypto`,
so no dependency.

**A fixed salt**, and stated as a decision. A random salt has to be stored beside
the ciphertext and buys what a random salt is for — stopping one precomputed
table attacking many secrets. There is one `LAIKA_SECRET` per instance and one
instance per deployment (D-002), so there is no population to protect.

**Per-column keys via HKDF's `info`**, typed as a closed union of the three
purposes. A free string would let a typo derive a *different, valid* key that
encrypts happily and fails to decrypt at some later date with no clue why; this
makes it a compile error. It is also the decision that cannot be retrofitted
without re-encrypting everything, which is why it is here rather than later.

**`v1.` + base64url of `nonce ‖ tag ‖ ciphertext`.** Versioned as readable text
so a second scheme can coexist and an operator can see which scheme a row uses
without decoding. The version sits outside the authenticated blob, which is safe
because it selects the *parser* rather than any parameter — rewriting it gets a
parse failure, not a weaker cipher.

**And what a failed decrypt means.** Two named errors, never `null`.
`SecretFormatError` is a bug or a hand-edited row; `SecretAuthError` is "the key
changed or somebody wrote to your database" — the same GCM failure, genuinely
indistinguishable, but a different thing to tell an operator. Neither may be
reported as *"no secret configured"*: that is LAI-437's family, and the columns
are nullable precisely so absence has its own representation.

### Rotation, since you asked for it either way

**It is unsupported, and the file says so.** Changing `LAIKA_SECRET` changes
every derived key, so every stored secret stops decrypting from the first read
after restart.

**The sharp edge is that the instance still looks configured** — the columns are
non-null, so `configured: true` and every *use* fails. And rotating it already
signs everybody out, because the same value signs session cookies (`env.ts`), so
an operator doing it is expecting to be told what else broke.

Pinned by a test that names the rotation case and walks all three purposes,
asserting the old secret still opens them so the failure is the key rather than
the writing. The procedure is **LAI-162**, filed `area: docs` because choosing
between "unsupported and documented", "a rotate command" and "a previous-secret
fallback" is a decision before it is code.

### Verification

Twelve tests. Five mutations, each confirmed landed:

| mutation | result |
| --- | --- |
| **a fixed nonce** | red — and only `encrypts the same plaintext to different ciphertexts` sees it |
| derive the key per call | red — 3 tests |
| ignore `purpose`, one key for every column | red — `differs per purpose` |
| report a wrong key as a format error | red — 5 tests |
| never set the auth tag | red — 3 tests |

**The fixed-nonce row is the one the task was written around**, and it is caught
by exactly one assertion. Every other test in the file — including all three
tamper cases and every round-trip — passes with a constant nonce, which is the
whole argument for building this as its own task.

**One honest note on the tag mutation.** I set a wrong tag rather than skipping
the check, because Node's GCM `final()` throws when no tag was set at all — the
mode will not let you skip it. So that row proves `setAuthTag` is load-bearing,
not that a missing check would be caught; the missing check is unreachable.

### AC6 is ticked narrowly, and the gap is the callers'

*"Plaintext never reaches a log, a response or `activity`"* — **there is no
caller yet**, so what I have actually asserted is what this module can control:
that a stored value does not contain its plaintext, and that neither error
message contains the plaintext, the key, or the attacker-controlled payload.

**The other two thirds are LAI-446's and LAI-447's**, and neither task currently
says so. `keyLast4` already refuses to decrypt for exactly this reason —
*"a serialiser that can reach plaintext is one refactor away from returning
it"* — and that instinct is the one to keep when the write half lands. Worth a
criterion on LAI-447 rather than an assumption here.

### One thing my filtered run could not see

`npx vitest run test/secrets.test.ts` was green while the root gate exited **2**:
a `noUncheckedIndexedAccess` error in my own test, because the workspace script
is `typecheck && vitest` and a bare `vitest` skips the first half. D-045's rule
arriving from the other direction — not "a check in someone else's directory",
but *half of my own workspace's gate*.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1775/1775**,
`web` **604/604**, `cli` **49/49**, lint and format EXIT=0. `server/web` is green
too — LAI-157 landed while I was building, so LAI-208's declared red is gone.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — **1775** server, 604 web, 49 cli, and
`server/web` green too now that LAI-157 has landed.

**Filing this instead of absorbing it into LAI-446 was the right call**, and the
sentence that makes it is yours: *"AES-GCM with a repeated nonce, or with the tag
dropped, still returns plausible ciphertext and still decrypts on the happy
path."* **A defect there is invisible to every test somebody would think to
write**, which is exactly why it wanted reviewing as cryptography.

### The fixed-nonce claim, verified

> *"The fixed-nonce mutation is caught by **exactly one** assertion."*

**Confirmed independently.** A constant nonce leaves **11 of 12 passing** — every
tamper case, every round-trip, the wrong-key case — and fails only
`encrypts the same plaintext to different ciphertexts`. **That is the argument
demonstrated rather than quoted**, and it is the whole justification for the task
existing separately.

### The four decisions

**HKDF-SHA256**, because `LAIKA_SECRET` is a passphrase of at least 32
*characters* — *"neither the length nor the distribution AES-256 wants"* — and
§12 says *"a key **derived from**"*. **A fixed salt, stated as a decision**: a
random salt stops one precomputed table attacking **many** secrets, and *"one
secret per instance, one instance per deployment (D-002) — there is no population
to protect."* **That is the right way to decline a defence: name what it buys and
show the population is empty.**

**Per-column keys through HKDF's `info`, typed as a closed union.** Verified:
substituting a constant for `purpose` goes red on `differs per purpose, so one
column cannot decrypt another`. And the reason for the union over a free string
is the one that matters — *"a typo would derive a **different, valid** key that
encrypts happily and fails to decrypt months later with no clue why."*

**`v1.` + base64url, with the version outside the authenticated blob**, and the
argument for why that is safe: *it selects the parser rather than any parameter,
so rewriting it gets a parse failure, not a weaker cipher.*

### Rotation unsupported, with the cost written down

**The sharp edge is the right one to have found:** *"the instance still looks
configured — columns non-null, `configured: true`, every **use** fails."*

And the observation that it **already signs everybody out**, since the same value
signs session cookies, so *an operator doing it expects to be told what else
broke*. **Pinned by a test walking all three purposes and asserting the old
secret still opens them**, so the failure is provably the key rather than the
writing. LAI-162 for the procedure.

### Two things reported rather than counted

**A mutation you could not write:** *"never set the auth tag"* is unreachable
because Node's GCM `final()` throws when no tag was set — *"so that row proves
`setAuthTag` is load-bearing, not that a missing check would be caught."*

**And AC6 ticked narrowly**, with the two thirds you do not control named:
plaintext never reaching a log, a response or `activity` is **LAI-446's and
LAI-447's**, and neither said so. **A criterion on LAI-447 rather than an
assumption here** — I have added it. `keyLast4` already refusing to decrypt is
the instinct to keep when the write half lands.

### And your gate finding is D-045 from the inside

> *"`npx vitest run test/secrets.test.ts` was green while the root gate exited
> **2** — a `noUncheckedIndexedAccess` error in my own test, because the
> workspace script is `typecheck && vitest` and a bare `vitest` skips the first
> half."*

**Not a check in someone else's directory — half of your own workspace's gate.**
Which is the same shape as my `grep` that could not see `Failed`: **the shortcut
that runs the interesting part omits the part that would have failed.**

---

**One of mine, in this review.** My first attempt at the per-purpose mutation did
not land — I guarded it with `assert substituted != original`, which proves
*something* changed and **not that the intended thing did.** It printed green and
I nearly reported the per-column keys as unguarded. The version that landed
printed the line **before and after** and went red immediately.

**Fifth no-op mutation of mine today**, and the first where my guard against
exactly that was itself too weak.
