---
id: LAI-287
title: The comment thread reads as a conversation
area: web
assignee: shell
status: done
priority: p2
depends-on: []
discovered-from: LAI-285
started: 2026-09-19T01:20:00Z
finished: 2026-09-19T01:40:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

Owner report against the reference, with both screenshots side by side. Seven
differences in the thread alone, and together they made four replies read as
four unrelated notices rather than a conversation:

1. **A bordered card per comment.** LAI-285 added a rule to remove it and the
   rule lost: `task-detail.css` is imported *after* `task-panel.css`, so its
   `.panel-comment` won at equal specificity. I did not check the computed
   style, I assumed the rule applied.
2. **A 22px pastel chip** for an avatar, where the design has a 36px filled
   circle with white initials.
3. **No bot mark** on an agent's avatar.
4. **`Mira Kellner`** where the design writes **`Mira Kellner's agent`**.
5. **`agent`** where the design writes **`AGENT`**.
6. **`13/09/2026, 00:45:26`**, right-aligned, where the design writes
   **`5d ago`** beside the name.
7. **A toolbar of bordered buttons above a white box**, where the design has one
   filled box with the marks and Send along its foot, and your avatar beside it.

## What

- The thread gets its own markup and classes (`cmt*`) rather than fighting an
  imported stylesheet for `.panel-comment`.
- `avatarColorSolid` in `theme/avatar-color.ts` — **same hash, same hue**, filled
  at 38% lightness with white initials. A person is one colour in both forms, so
  recognising them in a thread and on a card is one learned association.
- `X's agent`, `AGENT`, the bot glyph on the avatar, and a short relative time
  with the exact one in the `title`.
- The composer: your avatar, then one filled box.
- The code block loses its corner `HTTP` label — the design has none, the tag is
  metadata for a highlighter this app does not have, and it stays on the element
  as `data-language`.

## Acceptance criteria

- [x] No border and no fill on a comment row — asserted from the **computed
      style**, not from the stylesheet.
- [x] 36px avatar; the bot mark only on an agent's.
- [x] An agent comment is attributed `X's agent`; a person's is not.
- [x] Exactly one `AGENT` badge for one agent comment.
- [x] Every timestamp is short and relative.
- [x] Full gate — all three `EXIT 0`, repo root, on a plain build.

## Notes

**The lesson is the same one as LAI-285, one layer down.** LAI-285's tests
asserted that the sections existed; they could not see that a rule had lost a
specificity fight, because nothing read a computed style. The new test asserts
`borderTopWidth` and `backgroundColor` off the element — a rule that stops
applying now fails rather than quietly reverting the design.

**`avatarColorSolid` is a second function, not a parameter on the first.** The
pastel is right everywhere else — beside text that already names the person, the
avatar is decoration — and a boolean flag would have made every call site argue
about which it wanted. Two named things, one hash.

**38% lightness is not a taste choice.** White on `hsl(h 55% 38%)` clears 4.5:1
for every hue in the ramp; an avatar whose initials cannot be read is a coloured
dot.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.
