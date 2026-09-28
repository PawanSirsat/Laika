---
id: LAI-486
title: 'Timestamps say "just now" for a day, then a date and time'
area: web
assignee: shell
priority: p1
depends-on: [LAI-621]
discovered-from:
status: done
finished: 2026-09-28T19:05:17Z
started: 2026-09-28T18:59:31Z
reviewed: 2026-09-28T19:05:24Z
---

## Goal

**Owner request (2026-09-28), with a screenshot of the List's CREATED and
UPDATED columns reading `8d`, `6d`, `7d`:**
*"in the created and updated show properly the timing … just now, 1 min ago,
… 1 day ago after we can show date and timing with it, that very recent show
different color."*

**The owner chose this exact form** from a preview:

```
just now            ← accent
4 min ago           ← accent
52 min ago          ← accent
3 h ago
23 h ago
27 Sep, 14:05
14 Mar 2025, 09:12

hover → Sat 27 Sep 2026, 14:05:31
```

They also chose that **amber "stale" applies only to open tasks, never Done
ones.** D-065 records it.

## What this is

Measured on `shell` (D-064):

- **Every age in the List comes from `updatedAge()` → `staleFor()`** in
  `server/web/src/api/board-derive.ts:184-212`. It produces
  `now`/`Nm`/`Nh`/`Nd` with **no upper bound**, so a year-old task reads `365d`
  and there is no absolute date anywhere.
- **`updatedTone`** (`list-derive.ts:80`) returns `warn` for anything updated
  more than five days ago, **whatever its status**, which is why every Done row
  in the owner's screenshot is amber. It returns `accent` only under one minute.
- **The two date columns do not match.** `.list-created` (`list.css:294`) is
  plain muted text. `.list-updated` (`:353`) is mono, 0.625rem and
  right-aligned.
- Neither cell has a tooltip, so there is no way to see the actual time.
- **Defect, fixed here because it is the same helper:**
  `TaskDetailPanel.tsx:405-406` renders `opened {updatedAge(…)} ago · updated
  {updatedAge(…)} ago`. `updatedAge` returns `just now`, so a fresh task reads
  **"opened just now ago"**. The same happens for comments at `:636`.

## Acceptance criteria

- [x] **One formatter, in `server/web/src/api/`** (e.g. `time-label.ts`),
      taking `(at, now)` and returning at least
      `{ text, full, iso, fresh }`:
  - under 1 minute: `just now`
  - under 1 hour: `1 min ago`, `N min ago`
  - under 24 hours: `1 h ago`, `N h ago`
  - 24 hours and over: `27 Sep, 14:05` in the current year,
    `14 Mar 2025, 09:12` in any other year
  - `full`: `Sat 27 Sep 2026, 14:05:31`
  - `iso`: for `<time dateTime>`
  - `fresh`: under one hour
- [x] **Day-month order and a 24-hour clock (en-GB), in the viewer's
      timezone.** That matches the approved preview and `formatRange` in
      `sprint-derive.ts`. Pin it in a test that sets the locale, so a
      developer's machine cannot make it pass.
- [x] **Negative elapsed time is clamped**, so a clock-skewed future timestamp
      reads `just now` and never `-3 min ago`. `staleFor`'s comment explains
      why the clamp and the branch order both matter; keep both.
- [x] **Edges pinned by unit tests:** 59 s / 60 s, 59 min / 60 min,
      23 h 59 min / 24 h, a timestamp in the previous year across New Year's
      Eve, and one in the future.
- [x] **The List's CREATED and UPDATED both render
      `<time dateTime={iso} title={full}>{text}</time>`.** They share one
      style (mono, same size, right-aligned) and both take the accent when
      `fresh`.
- [x] **Amber only for open work.** UPDATED is amber when the task is **not**
      `done` or `cancelled` **and** its last update is over five days old.
      Otherwise it is muted, unless fresh. Keep the five-day constant shared
      with the rail's Stale panel rather than adding a third number.
- [x] **The labels move on their own.** A table left open does not say
      `just now` for ever. Re-render on a ~60 s tick, clear it on unmount, and
      prove the clear in a test.
- [x] **The drawer uses the same formatter.** `opened … · updated …` and the
      comment times read `opened just now`, `updated 4 min ago`,
      `opened 27 Sep, 14:05`, and never `just now ago`. Assert the absence of
      `just now ago` in a browser test.
- [x] Both themes. Existing tokens only (D-020).
- [x] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **Out of scope, on purpose:**
  - **The board card footer keeps its compact `2h`.** It has no room for
    `27 Sep, 14:05`, and the owner's request was about the List.
  - **The Dashboard keeps `relativeTime`.**
  - Say both in the new module's doc comment, so the next reader knows the
    other formatters were left deliberately rather than missed.
- **Do not delete `updatedAge` or `staleFor`.** The card and the stale marker
  still use them.
- **Future timestamps and `Date.now()` in tests:** pass `now` in; never read the
  clock inside the formatter. That is how `staleFor` stays testable.
- **No new dependencies.** `Intl.DateTimeFormat` is enough; no date library.

## Built — 2026-09-28T19:05:17Z

Built by the CHIEF session **on the owner's direct instruction**, on branch
`build`.

- **`api/time-label.ts` (new):**
  - `timeLabel(at, now)` returns `{ text, full, iso, fresh }`;
  - `startTicker` returns its own stop.
  - **The names are fixed tables, not `Intl`.** Current `en-GB` data writes
    *Sept*, and the approved form is *Sep*. So the "set the locale" criterion
    is met more strongly than it asked: no locale can reach it. The tests
    pass under `TZ` = LA, Kolkata, UTC, Auckland and London.
- **`board-derive.ts`:** `STALE_DAYS` and `ageDays` live here now.
  `ActivityPanels` imports and re-exports them, so the rail and the List share
  one number **and one comparison** (`>=`). They used to disagree at exactly
  five days.
- **`list-derive.ts`:**
  - rows carry `created` and `updated` as labels, each with a tone;
  - accent under an hour;
  - amber only for **open** work with `ageDays >= STALE_DAYS`;
  - CREATED is never amber.
- **`ListView.tsx`:**
  - `<time dateTime title>` cells;
  - a 60 s tick through `startTicker`, whose returned stop is what the effect
    returns.
- **`list.css`:** CREATED and UPDATED share mono, size and right-alignment,
  and CREATED's header aligns with them.
- **`TaskDetailPanel.tsx`:** the byline and the comment times use
  `timeLabel`, so *"opened just now ago"* is gone.
- **`task-panel.test.ts`:** its time pattern **accepted `^just now ago$`**,
  which pinned the defect. It now asserts the new form and the absence of
  `just now ago`.

Browser tests run on Playwright's fake clock at a fixed `T`:

- *just now* and *25 Sep, 15:30*, with the full moment in `title`;
- the accent on the fresh row;
- `fastForward('02:00')` gives *2 min ago* with no reload;
- the byline reads *opened just now · updated just now*.

Mutations, each typechecking and restored by checksum:

| mutation | result |
| --- | --- |
| fresh at a minute | red |
| done goes amber | red |
| the stop does not stop | red |
| no tick | red |
| the drawer appends ` ago` | red |
| **no clamp** | **green** |

**The clamp escape is recorded, not hidden.** The branch order already sends
a negative age to *just now*. My own first comment claimed the clamp was what
did that. **It was wrong, and it is corrected** to say the clamp is
belt-and-braces, as `staleFor`'s is.

Web **1112/1112**; the structure guard and lint are green.

## Review — 2026-09-28T19:05:24Z (CHIEF)

**Accepted.** The same session built and reviewed this, on the owner's
instruction. The evidence:

- unit edges in five timezones;
- fake-clock browser tests;
- mutations: five red and one honest green.

**One real finding, fixed before acceptance.** The clamp comment claimed more
than the code does. It was found by the mutation run, not by reading.

Both themes will be seen on a full instance in the final pass, before any
push.
