---
id: LAI-162
title: 'Rotating `LAIKA_SECRET` silently unconfigures the instance'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-161]
discovered-from: LAI-161
status: backlog
---

## Goal

LAI-161 answered *"can `LAIKA_SECRET` be rotated"* with **no, and here is what
happens** — written into `src/secrets.ts` and pinned by a test. This task is the
procedure that makes the answer survivable, and it starts as a documentation
decision rather than code.

## What happens today

Changing `LAIKA_SECRET` changes every derived key, so **every stored secret stops
decrypting** — `SecretAuthError`, from the first read after restart.

**And the instance still looks configured.** `ai_api_key_enc`, `smtp_json_enc`
and `github_webhook_secret_enc` are all still non-null, so `GET /org` reports
`configured: true`, the settings screen shows a key is set, and every *use* of
those secrets fails. An operator sees a configured provider that will not answer.

**Rotation also signs everybody out**, because `LAIKA_SECRET` signs session
cookies too (`env.ts`). That part is at least loud.

## Why this is `area: docs` first

Three options, and picking one is a decision before it is an implementation:

- **Rotation is unsupported and documented.** Operators re-enter every secret
  after changing it. Cheapest, and honest, but it needs to be *written where an
  operator looks* — §11.7 or the deployment notes — not only in a source comment
  that nobody reads before editing an env var.
- **A re-encryption command.** `laika secrets rotate --old <secret>`, decrypting
  with the old and re-encrypting with the new. Needs both values present at once,
  which is a deployment procedure with its own failure modes — including being
  interrupted half-way, which the version prefix does not by itself solve.
- **Decrypt with a fallback.** Accept `LAIKA_SECRET_PREVIOUS` for a window and
  re-encrypt lazily on read. Kindest to operate, most surface to get wrong, and
  it keeps a retired secret alive in the environment.

## Acceptance criteria

- [ ] The decision recorded, with the reasoning, in `docs/` where a deployment
      reader meets it — not only in `src/secrets.ts`.
- [ ] If rotation stays unsupported: **the instance must stop claiming to be
      configured** when its secrets will not decrypt, or say why reporting
      `configured: true` for an unusable key is acceptable. That is LAI-437's
      shape and it is the part that turns a bad day into a long one.
- [ ] If a procedure is built, it is interruptible and re-runnable — a rotation
      that dies half-way must leave every row decryptable by something.
- [ ] §11.7's `LAIKA_SECRET` entry says what rotating it costs. It currently says
      what it must be, and nothing about changing it.

## Notes

`src/secrets.ts`'s stored format is `v1.` + base64url, versioned specifically so
a second scheme can coexist with the first. That is all LAI-161 owed this task
and it is deliberately not more.

Filed from LAI-161 at CHIEF's request: *"whether `LAIKA_SECRET` can be rotated at
all, and what happens to existing ciphertext if it is. Either answer is fine; the
undecided one becomes somebody's outage."* The answer is recorded; the procedure
is this.
