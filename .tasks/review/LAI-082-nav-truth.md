---
id: LAI-082
title: Ship only nav that works, and register the four real screens
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-25T01:45:00+05:30
finished: 2026-08-25T02:20:00+05:30
---

## Goal

**Seven of eight sidebar destinations are empty placeholders.** The owner opened
the app and found dead links everywhere. Fix that tonight, and unblock Builder-A
to build screens in parallel (D-028).

## Acceptance criteria

- [x] **Hide `Tokens`, `Capacity` and `Meeting review`.** No API exists behind
      any of them (M3, M5, M6). Do not delete the routes — hide them from the
      sidebar, so a direct URL still renders the placeholder.
- [x] **The rule is data-driven, not a hand-kept list.** A route declares whether
      it ships; the sidebar renders only those. The next screen must not need
      anyone to remember to unhide it — that is how seven dead links happened.
- [x] A test asserts **every visible nav item resolves to a real screen**, and
      fails if a placeholder is exposed. Break it on purpose and watch it go red.
- [x] **Register routes and empty screen shells for `sprints`, `timeline` and
      `dashboard`** at `routes/screens/sprints/`, `.../timeline/`,
      `.../dashboard/` — one component file each, rendering the existing loading
      state. **Builder-A fills them in (D-028) and must never edit
      `route-table.ts` or `Sidebar.tsx`.** This step is what lets them start.
- [x] `Projects` appears in the sidebar. It works today and is unreachable except
      by typing the URL.
- [x] Both themes.

## Notes / context

After this the sidebar is **Board · Sprints · Timeline · Projects · Dashboard ·
Organisation** — six, four of which work immediately and two arriving behind
them. That is an honest sidebar.

Do this first and commit it on its own. Builder-A is blocked until the shells and
routes exist.

## Notes at review — builder-b

### The sidebar is five, not six — `Organisation` is a placeholder too

Your note says the result is *Board · Sprints · Timeline · Projects · Dashboard ·
Organisation*, six with four working. **`/organisation` has no screen and no
API** — there is no `/orgs` route mounted in `app.ts`, and it falls through to the
same `<Screen>` placeholder as Tokens, Capacity and Meeting review.

I did not special-case it. The rule decides, and the rule hid it — keeping it
visible would have reproduced the exact defect this task exists to fix, one item
instead of seven. **If you want it shown, that is a product call and I will take
it**, but it needs a screen behind it first (LAI-063 is the copy task; there is
no data task yet).

So the sidebar is **Board · Sprints · Timeline · Projects · Dashboard** — two
working immediately, three shells Builder-A fills.

### How the rule works, and why it is not another list

A route declares `status: 'ready' | 'building'`; **absent means hidden**. The
default is the hidden one deliberately: visibility used to be the default and
hiding took an act of memory, which is how seven dead links shipped.

The test does **not** keep a second list of real screens — that is the thing that
drifts. It reads `AppShell.tsx`, extracts every `path === '...'` branch, and
compares reality against the table. They cannot disagree without failing.

It guards **both** directions. A nav entry with no screen fails; and a screen
that exists but is offered nowhere fails too — that second one is the `Projects`
bug, which is the same defect seen from the other side and would otherwise have
gone on being invisible. Three failures reintroduced and watched go red: a
placeholder exposed in nav, `Projects` stranded, and a Builder-A route
unregistered.

### The shells render a loading state, which has a shelf life

As asked. It is honest only while someone is about to fill them — a spinner that
never resolves says "data is coming" and means "nobody built this", which is a
worse lie than an empty state. Each file says so in a comment. **If Builder-A's
screens slip more than a day, these should become empty states that say what
they are.**

### Folded in the mirror-rule gap you raised

Your call to leave it to me; it shares this task's purpose, so it is here rather
than a separate file.

Rather than exempt every `.ts` under their three folders, the exemption matches
**`use-*.ts` in those folders and nothing else** — the one case with no home,
not the whole area. Any other module they add still needs a test or its own
entry. Proven both ways: `sprints/use-sprints.ts` passes, `sprints/derive.ts`
still fails with the usual message. A test asserts the pattern does not swallow
hooks elsewhere or non-hooks inside.

### Verified live

Signed in and followed **every** nav entry in the browser: five items, all five
render a real screen, none reaches the placeholder (`.screen-phase` absent
everywhere). Board and Projects show real data; Sprints, Timeline and Dashboard
show their loading shells. Tokens, Capacity, Meeting review and Organisation
still resolve by direct URL.
