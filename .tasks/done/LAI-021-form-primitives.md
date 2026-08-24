---
id: LAI-021
title: Form primitives and the login and first-boot layouts
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-018, LAI-020]
discovered-from:
status: done
finished: 2026-08-24T06:51:47+05:30
reviewed: 2026-08-24T08:00:00+05:30
started: 2026-08-24T06:41:30+05:30
---

## Goal

The input vocabulary, plus the two forms that need no board data to exist: sign
in and first boot. Layout, validation and every visual state — **wiring is
somebody else's task.**

## Acceptance criteria

- [x] Primitives: text input, password input with show/hide, checkbox, select,
      button (primary/secondary/danger), field label, help text, inline error,
      password-strength meter. All in both themes.
- [x] Every input has a real label, `aria-describedby` for help and error text,
      and a visible focus ring. Error is announced, not only coloured.
- [x] **Login layout**: instance host always visible, email and password,
      keep-signed-in, submit, the "only an Owner or Admin can invite you" note,
      and the wrong-credentials error state with attempts remaining.
- [x] **Invite-accept layout**: inviter, org, expiry, the **pre-assigned role and
      what it permits**, name/email/password fields with email locked.
- [x] **First-boot layout**: owner name/email/password with confirm, org name,
      optional first project, presence opt-in toggle, and the system-status panel.
- [x] The status panel shows **SQLite** — its migration state and SMTP state.
      **Never Postgres**: the mockup says `postgres 16 · connected` and that is an
      artifact (D-001, `docs/design/README.md`).
- [x] **No "Forgot?" link and no "Email me a sign-in link" button.** Neither is
      specified and both need SMTP (SPEC §14, q11).
- [x] Client-side validation only — required, format, password match, strength.
      Every message is specific about what to fix.
- [x] Forms render their submitting, disabled and server-error states, driven by
      props. No network calls in this task.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

**Explicitly out of scope:** submitting anything. `POST /auth/*` wiring is
LAI-007; `POST /setup` is LAI-009. This task hands them finished forms that take
an `onSubmit` and render whatever result they are given.

This is not a D-012 violation: a form renders what the user types, not data
fetched from an endpoint that does not exist. Nothing here displays invented
board data — and if you find yourself typing "13/34 done", stop.

---

## Implementation notes for review (Builder-B)

`components/forms/` — `validation.ts` (pure), `Field`, `TextInput`,
`PasswordInput`, `PasswordStrength`, `Checkbox`, `Select`, `Button`, `forms.css`.
`routes/screens/` — `LoginScreen`, `InviteScreen`, `FirstBootScreen`,
`SystemStatus`, `auth.css`. New route `/invite`.

### Copy is the design's

Taken verbatim from the prototype: *"Sign in to your instance"*, *"Keep me
signed in on this device"*, *"No account? Only an Owner or Admin can invite you.
Ask them for a link."*, *"Email or password is wrong. N attempts left before an
N-minute lockout."*, *"Your role is already set by the person who invited you.
Only an Owner can change it later."*, *"This invite has expired"* / *"Invites
last 7 days…"*, *"This instance has no owner yet"*, *"You're the first person
here…"*, *"Track presence — record which repo and task each person is working
in. Powers the capacity view."*, *"Create instance"*, *"Takes about two
seconds…"*.

Counts and names in that copy are **props**: attempts-left, lockout minutes,
migrations applied/total, inviter, org, expiry, host. The prototype's `41/41`,
`3 attempts`, `Mira Kellner` and `laika.kvelld.internal` are fixtures and a test
fails if any appears.

The instance host comes from `window.location.host` — correct on every
deployment with no configuration, and impossible to accidentally hardcode.

### Verified in a browser

**Login** — title, host visible, both fields labelled with `autocomplete`,
show/hide button, keep-signed-in, no *Forgot?* and no magic link. Submitting
empty produced `aria-invalid="true"`, `aria-describedby` pointing at a
`aria-live="polite"` region containing *"Email is required."* / *"Password is
required."*; typing `nope` gave *"That does not look like an email address —
check for a missing @ or domain."*; a valid address cleared both the error and
`aria-invalid`.

**First boot** — groups *Owner account* and *Organisation*, seven labelled
controls, presence opt-in, *Create instance*. Status panel reads **SQLite ·
WAL**, migrations `0/0 applied`, `SMTP not configured`. `/postgres/i` against
the whole document: **false**. Strength meter: `password123` → *"weak — That is
one of the first passwords anyone tries."*; `correct horse battery staple` →
*"strong"*; announced `aria-live="polite"`. Mismatched confirmation → *"The two
passwords do not match."*

**Invite** — role badge plus what it permits, the "your role is already set"
note, email `readOnly` with help explaining why, expired variant with *Request a
new invite*.

**Dark theme** — five sampled values across card, input, text, button and role
badge; **none** unchanged. Console clean.

### Decisions worth checking

- **Length-dominant password rules, no composition requirements.** `password()`
  requires 12+ characters and nothing else. Composition rules push people to
  `Password1!`; Argon2id (SPEC §13.1) is what makes a long passphrase safe. The
  first version of `strength()` then contradicted this by scoring
  `correct horse battery staple` as merely *fair* for being all lowercase —
  **my own test caught it**, and length now decides on its own past 24
  characters.
- **Permissive email check.** Something, `@`, something with a dot. Full
  RFC 5322 in a regex rejects addresses that work; the only authority is whether
  mail arrives.
- **`busy` is a separate prop from `disabled`.** They look identical to a user
  but only one resolves by waiting, so `aria-busy` says which.
- **The error region is always in the DOM**, empty most of the time. A live
  region created in the same tick as its text often is not announced.
- **`exactOptionalPropertyTypes` needed explicit `| undefined`** on every
  optional prop a wrapper forwards. Noted in `Field.tsx` so the next person
  writing a wrapper does not have to rediscover it.

### One thing to look at

`/invite` currently renders the layout with generic placeholder props
("An administrator", "this organisation") because nothing reads an invite token
yet — that is LAI-007. They are deliberately generic English rather than a
fabricated person or company. **If you would rather `/invite` showed its empty
state until a token exists**, the copy is already written
(`screen-copy.ts` → *"No invite in this link"*) and it is a two-line change. I
left the layout rendering so it is reviewable.

### Tests — 29 new, 90 in the package

Real unit tests over `validation.ts` (boundaries, awkward-but-valid emails,
common-password floor, score always inside the meter) plus structural guards for
the criteria that are absences: no *Forgot?*, no magic link, no Postgres, no
fixtures, host always a prop, nothing fetches.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass. `@laika/web`
90/90.

## Review — PM, 2026-08-24

**Accepted.** Gate green: format, lint, typecheck, **90 web tests** (up from 61)
and 303 server. **Unblocks LAI-007** — the last of its three dependencies.

**Every forbidden artifact is absent and asserted absent.** `no password-reset
link`, `no magic-link sign-in`, `the status panel never says Postgres (AC6,
D-001)`. The only occurrences of "Forgot", "sign-in link" and "postgres" anywhere
in `server/web/src` are comments explaining why they are missing — nothing
rendered. Fourth submission today to test an absence rather than merely omit the
thing.

**No network calls.** `grep` for `fetch`, `XMLHttpRequest` and `axios` returns
nothing, so the "wiring is somebody else's task" boundary held — LAI-007 gets
finished forms that take an `onSubmit`.

**`migration and SMTP state are props, not fixtures`** and `the instance host is
a prop on every auth screen` are the tests that make the no-hardcoded-data rule
structural. A component that cannot express `laika.kvelld.internal` cannot leak
it.

### The password work is better than the criterion

I asked for a strength meter. What landed is a considered position:

- **`no composition rules — length is the requirement`.** Refusing to demand a
  symbol and a digit is the correct modern answer and the opposite of what most
  implementations do — composition rules push people toward `Password1!` and
  away from length, which is the thing that actually helps.
- **`common passwords are weak however long`** — length alone is not sufficient
  either, and a dictionary check is what closes that gap.
- **`empty is silent — no scolding before typing`** — a meter that shows "weak"
  before the first keystroke trains people to ignore it.
- **`short is weak and the hint points at length, not symbols`** — the guidance
  matches the rule, so the meter teaches rather than nags.

`accepts at the boundary` and `score always fits the meter` are the off-by-one
cases that would otherwise show up as a UI glitch nobody can reproduce.

**Accessibility, again unrequested and again the stronger half:** `every control
is labelled and described`, `the error region is announced, not only coloured`.
I asked for both in prose; they are now tests.

**Boundaries clean:** `server/web/` plus your own log and task files.
