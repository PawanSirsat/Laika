---
id: LAI-161
title: '§12 is unimplemented — nothing encrypts or decrypts `orgs.*_enc`'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-446
status: backlog
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

- [ ] `encrypt`/`decrypt` in one module, used by every `_enc` column, with the
      decisions above written where the code is.
- [ ] Round-trips: encrypt → decrypt returns the plaintext, for empty strings,
      long strings and non-ASCII.
- [ ] **Tamper detection asserted.** Flip a byte of the ciphertext, the tag and
      the nonce in turn; each must fail, and the test must assert *which* error
      rather than that something threw — a bare `rejects.toThrow()` is satisfied
      by a broken setup (CLAUDE.md §5).
- [ ] **The nonce is never reused.** Encrypt the same plaintext twice with the
      same key and assert the two ciphertexts differ. This is the one that is
      silent when wrong.
- [ ] A wrong key fails to decrypt, and the failure is distinguishable from an
      absent secret.
- [ ] Plaintext never reaches a log, a response or `activity`. §12 says so three
      times; at least one assertion should hold it.
- [ ] Full gate green — **`EXIT 0`**.

## Notes

**No new dependency.** `node:crypto` has `createCipheriv`, `createDecipheriv`,
`hkdfSync` and `randomBytes`.

**Do not widen this to key rotation.** Re-encrypting every column under a new
`LAIKA_SECRET` is a real operation with its own failure modes; a version byte in
the format is what keeps it possible, and that is all this task owes it.

Found while claiming LAI-446. Both LAI-446 and LAI-447 carry it in `depends-on`.
