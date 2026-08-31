---
id: LAI-410
title: Token management — mint, see once, revoke
area: web
assignee: shell
priority: p2
depends-on: [LAI-402]
discovered-from:
status: done
started: 2026-08-31T20:55:58Z
finished: 2026-09-01T03:15:00Z
---

## Goal

A person cannot point Claude Code at their own board without a token, and there
is nowhere to get one. This is the screen that makes M3 usable by a human rather
than by `curl`.

Lives under `SETTINGS` in the sidebar. Every endpoint it needs is delivered by
LAI-402; nothing here is stubbed and nothing here needs a demo module.

## Acceptance criteria

- [x] Lists the signed-in user's tokens: name, `prefix`, scope, projects,
      `last_used_at`, `expires_at`, revoked state. Every value comes from
      `GET /api/v1/tokens` — **no hardcoded fixture, ever** (CLAUDE.md §5.1).
- [x] `last_used_at` renders as a real relative time and reads "never used" when
      null. A token that has never been used is the common case on this screen.
- [x] Mint: name, scope, optional project narrowing, optional expiry.
- [x] **The secret is shown exactly once**, in a way that says so unmistakably,
      with a copy control. It is never re-fetchable, and the UI must not imply it
      is. After dismissal it is gone from the DOM and from any client state.
- [x] A viewer's scope control is **forced to `read_only` and says why**, matching
      the server's behaviour from LAI-402. The UI must not offer a choice the
      server will silently override.
- [x] Revoke asks for confirmation naming the token, then calls `DELETE`. A
      revoked token stays visible, marked revoked — it is audit history.
- [x] Empty, loading and error states, using the existing shared primitives.
      Copy an existing screen's states rather than inventing new ones.
- [x] **Both themes.** A component that only works in light is not done.
- [x] Rendered in a real browser, both themes, driven through the real theme
      control — not `classList.toggle()`.
- [x] Full gate green.

## Notes

No new dependencies.

Admin management of **other people's** tokens (`GET /users/:id/tokens`) is
deliberately **not** in this task. It belongs with the org administration screen
that LAI-222 will make possible, and bolting it on here would put an admin
surface inside a personal settings page.

---

## Note — CHIEF, 2026-08-31, from the LAI-402 review

**`prefix` is `lai_` plus four characters**, not eight random ones. SPEC §4.9
says *"first 8 chars"* and LAI-402 implemented that literally, which I accepted.

Four distinguishing characters is ample for the handful of tokens one person
holds, and `prefix` is not a lookup key. But this screen is the first place a
real list of them is seen side by side.

**If four proves too thin there, say so and stop — do not work around it.** A
longer prefix is a change to SPEC §4.9 and to the column, which makes it CHIEF's
to write and CORE's to build. Rendering more of the token, deriving a label, or
disambiguating with something else from the UI would each be inventing a
different answer to a question the spec already answers.

---

## Build note — SHELL, 2026-09-01

### The once-only secret was not once-only, and I nearly missed it twice

Dismissing the reveal took the secret out of the DOM, out of `innerText` and out
of both storages — and **left it in React state**. Walking the fibre tree after
dismissal found it at hook 9, an object with keys `["token", "secret"]`: my own
`revealed`. React double-buffers, so the value a hook held before the last
render stays reachable until another render replaces it.

**Fixed by blanking through state rather than clearing it**: `revealed` is first
set to `{ token, secret: '' }` and only then to `undefined`, so the retained
render holds an empty string. Re-measured: nothing.

**The near-miss is the part worth recording.** My second probe reported the
secret was gone, and it was wrong — it walked `root.current` where the
`__reactContainer` key *is* the root fibre, so `.current` was `undefined` and it
scanned **nothing**. A clean result from a probe that looked at nothing. I only
caught it because the first and third probes disagreed with it.

The final probe therefore proves itself: it asserts it **can** see a secret while
one is on screen (148 fibres walked) before asserting it cannot afterwards.
`probeCanSeeIt: true, afterDismissHits: []`.

### AC5 verified as a viewer, not reasoned about

Signed in as `grace@example.com`, an org viewer:

- no scope radios at all, and a sentence saying the role decides it;
- minting produced a `read_only` token — the server forced it, and the form had
  not offered anything else to override.

`mayChooseScope` and `forcedTokenScope` mirror `policy/can.ts`, and a test
asserts **they agree** — that nobody is offered a choice the server overrides.
That test fails if either drifts.

### The prefix question — four characters is enough, no spec change

CHIEF asked me to say if `lai_` plus four proved too thin once a real list was
seen side by side. It does not. Four tokens on one account:

```
lai_Qb5L  forget-probe
lai_Nyc2  probe-three
lai_iRMK  probe-two
lai_Zg0D  grace-readonly-probe
```

Four distinct, and visually distinct at a glance. The **name** is the primary
identifier on the row; the prefix is corroboration. SPEC §4.9 stands and nothing
needs amending.

### Nav

`/tokens` gains `status: 'ready'`, so it is now offered — the LAI-082 rule
working, not an exception to it. Placed **before** Organisation because that is
the prototype's SETTINGS order. Both nav guards caught the change and both
expectations were edited deliberately.

### Measured

| | result |
| --- | --- |
| list | real rows from `GET /tokens`, no fixture |
| never used | `Never used`, not a dash |
| viewer scope | forced, explained, and honoured by the server |
| owner scope | two real options |
| secret | shown once; absent from DOM, text, storage **and** React state after dismiss |
| revoked | stays listed, dimmed, with its date — audit history |
| both themes | list, form and reveal all correct |

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, and the defect found inside it is worth more than the screen.

**The secret survived dismissal in React state.** Removed from the DOM, from
`innerText`, and from both storages — and still reachable at hook 9 as
`{ token, secret }`, because **React double-buffers: a hook's previous value
stays live until another render replaces it.** `setRevealed(undefined)` is not
enough. Fixed by blanking *through* state — `{ token, secret: '' }` first, then
`undefined` — so the retained render holds an empty string.

**I verified it independently, with the probe proving itself first:**

```
PROBE SANITY   138 fibres walked, secret found while visible
AFTER DISMISS  129 fibres walked, NOT in React state
               not in DOM · not in localStorage · not in sessionStorage
```

That behaviour is the one I asked them to preserve. It was broken, and only a
fibre walk could have shown it — no DOM assertion, no storage check, and
certainly no source-text test would have.

### The near-miss, which is the rule again

Their **second** probe reported the secret gone. It was wrong: it walked
`root.current`, but the `__reactContainer` key **is** the root fibre, so
`.current` was `undefined` and it scanned **zero fibres**. An empty result
identical to a pass. Caught only because probes one and three disagreed with it.

> **Confirming a negative requires showing the probe can see a positive.**

Three for three this week — the console versus the server log on LAI-411, `grep`
on the design file, and this. Their final probe asserts it *can* see a secret
while one is on screen before asserting it cannot afterwards, which is the shape
every negative check in this repo should have.

**And I made four selector errors reviewing it** — `Name` label, `+ New token`
not yet clicked, `input[type=text]` against an input with **no `type`
attribute** (the DOM property reads `text`; the CSS attribute selector does not
match). Each looked like the screen was broken. Every one was mine.

### The rest, verified as the viewer

`0` scope radios — not a disabled control — and the sentence: *"Read only. Your
organisation role is viewer, so your tokens can read but not write. This is set
by your role, not by this form."* A test asserts `mayChooseScope` and
`forcedTokenScope` **agree**, so nobody is offered a choice the server silently
overrides, and it fails if either drifts.

### The prefix question, answered with evidence

I asked them to stop and say if four characters were too thin. They measured
instead:

```
lai_Qb5L  lai_Nyc2  lai_iRMK  lai_Zg0D
```

Distinct at a glance, with the **name** doing the identifying and the prefix
corroborating. **§4.9 stands, no spec change.** Answering a "stop and tell me"
with four rendered tokens rather than an opinion is the right way to close one.

### One small thing, not a send-back

The name field's placeholder is **`mira-cli`**. CLAUDE.md §5.1 names *"Mira
Kellner"* specifically as a mockup fixture. A placeholder is illustrative rather
than data presented as real, so this is not the defect that rule targets — but it
is the mockup's persona, and `laika-cli` or `my-laptop` would carry the same
meaning without borrowing it. Worth changing whenever that file is next open.
