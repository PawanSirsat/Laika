---
id: LAI-246
title: 'Take the design''s 9 contrast-lifted tokens'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-244
started: 2026-09-18T13:02:18+05:30
status: in-progress
---

## Goal

The owner redirected the whole queue: **the shipped app should follow the Claude
Design prototype's flow and philosophy**, keeping every feature we have.

First and smallest piece: **the palette moved.** Reading the design through the
MCP (project `a931b00e…`) against `src/theme/tokens.css`, **9** values changed,
all contrast lifts:

| token | from | to |
| --- | --- | --- |
| `--tx3` | `#8d94a4` | `#606775` |
| `--acc` | `#2f6bff` | `#2158e0` |
| `--accs` | `rgba(47,107,255,.09)` | `rgba(33,88,224,.09)` |
| `--accb` | `rgba(47,107,255,.34)` | `rgba(33,88,224,.34)` |
| `--pur` | `#8b5cf6` | `#6d3ddb` |
| `--grn` | `#11996a` | `#0d7d56` |
| `--amb` | `#b6740b` | `#8f5a08` |
| `--red` | `#d93a45` | `#c42630` |
| `.dk --tx3` | `#71717d` | `#9a9aa4` |

**It was 13 in the first draft of this task, and that was wrong.** `--mk`,
`--ta`, `--sv`, `--jd` and `--rb` are **design-only** — the prototype's avatar
colours, which we derive in `theme/avatar-color.ts` instead of storing. They are
not ours to change and were never in `tokens.css`.

**My own AC3 caught it**: *"checked against the design by name, not by count."*
The count was taken from the design's changed-token list, not from the
intersection with ours — which is the exact failure that criterion names, in the
task that names it.

A further 24 declarations differ only in **formatting** — `rgba(15, 23, 42,
0.09)` against `rgba(15,23,42,.09)`, because Prettier expands ours. Normalised
before comparing; none is a value change.

**This answers LAI-041.** That task asks the owner to decide `--tx3`'s contrast;
they decided it in the design. LAI-041 should close against this rather than be
worked.

## Acceptance criteria

- [ ] All 13 values match the design **exactly**, light and dark. Taken from the
      MCP copy, not from `docs/design/`, which is 94 hunks stale — and say so.
- [ ] `token-list.ts` and `tokens.css` still agree (`test/tokens.test.ts`).
- [ ] **Every token is checked against the design by name, not by count.** A
      count agrees with the wrong list whenever two things change at once.
- [ ] **Contrast is measured, not assumed.** `--tx3` on `--page` and on `--card`,
      both themes, reported as a ratio. It is the reason the owner changed them.
- [ ] Screenshots of at least the Board and one dense screen, both themes, so the
      lift is seen rather than trusted.
- [ ] Full gate — **`pnpm test` `EXIT 0`**, repo root.

## Notes / context

**`docs/design/` is stale and is CHIEF's to refresh** (§1). Until it does, the
MCP copy is the source of truth and this task names that.

**Do not restyle anything else.** Later tasks judge the design against the new
palette; a screen tweaked now is a screen tweaked twice.
