# docs/design/ — the visual reference

Imported 2026-08-24 from the Claude Design project
**"Skynet Kanban UI Enhancement"** (`a931b00e-ce58-4723-9699-b7cb2f1567e9`),
owned by Raghav Kothari. The project name is historical — the Laika files in it
contain no Skynet branding.

**These are static mockups. They are a target, not code to copy.** No file here is
imported, bundled, or executed by the application. UI tasks implement functional
React against the real API and match this *style*; they do not lift this markup.

## Which file is canonical

**`Laika Prototype.dc.html` — use this one.** It is the newest, the most
complete, and the only file using the correct `LAI-` task prefix.

| File | Screens | Prefix | Use |
| --- | --- | --- | --- |
| **`Laika Prototype.dc.html`** | all 13, with working nav | **`LAI-`** ✅ | **canonical** |
| `Laika - All Screens.dc.html` | 10 (no Timeline, Sprints, Calendar) | `LK-` ⚠️ | superseded |
| `Laika 01 - Kanban Board.dc.html` | 1 | `LK-` ⚠️ | superseded |
| `Laika 02-04 - Task, Capacity, Dashboard.dc.html` | 3 | `LK-` ⚠️ | superseded |
| **`Laika 05-07 - Auth, Setup, Projects.dc.html`** | 3 | `LK-` ⚠️ | **superseded, but the only detailed source for login / first boot / project home** |
| `Laika 08-10 - Meeting, Tokens, Org.dc.html` | 3 | `LK-` ⚠️ | superseded |
| `support.js` | — | — | Claude Design's own runtime, **not ours** |

The superseded files are kept because they carry per-screen detail the prototype
compresses. **Where they disagree, the prototype wins.** Anything showing `LK-`
is stale by definition — the key prefix is `LAI-`.

**`Laika 05-07` was missed by the original import on 2026-08-24 and added later
the same day.** That was an oversight, not a decision — the first import listed
four superseded files when the project has five. It matters more than the other
superseded files because the prototype compresses login, first boot and project
home into single nav entries, so **this file is the only place their layout is
specified**: the first-boot dark rail, the invite-accept role card, and the
project-home card anatomy all exist nowhere else.

`support.js` is the generated `dc-runtime` that makes `.dc.html` render in the
Claude Design viewer. It is third-party tooling, marked "do not edit", and has
nothing to do with Laika's own frontend. It is here only so the HTML renders if
opened locally.

Not imported: `screenshots/` (two timeline PNGs), `uploads/` (seven screenshots),
and four legacy `Skynet *.dc.html` files. They remain in the design project.

## Design tokens

Both themes are defined as CSS custom properties on `:root` (light) and `.dk`
(dark). Take these verbatim — they are the contract for LAI-018.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--page` | `#eef0f6` | `#0c0c0f` | app background |
| `--tub` | `#e7e9f1` | `#141418` | recessed / column background |
| `--card` | `#ffffff` | `#1b1b20` | card surface |
| `--bd` / `--bd2` | `rgba(15,23,42,.09)` / `.2` | `rgba(255,255,255,.08)` / `.2` | border, strong border |
| `--tx` / `--tx2` / `--tx3` | `#171a21` / `#5a6070` / `#8d94a4` | `#f3f3f5` / `#a4a4ae` / `#71717d` | text primary / secondary / tertiary |
| `--acc` | `#2f6bff` | `#5b8cff` | accent — in progress, primary action |
| `--pur` | `#8b5cf6` | `#a78bfa` | agent / to-do |
| `--grn` | `#11996a` | `#2fd08a` | done, public, success |
| `--amb` | `#b6740b` | `#f0ac47` | review, warning, stale |
| `--red` | `#d93a45` | `#f4636d` | blocked, error, danger |
| `--shadow` | `0 1px 2px rgba(15,23,42,.07)` | `0 1px 2px rgba(0,0,0,.3)` | card elevation |

Each colour has `s` (subtle fill) and `b` (border) variants — `--accs`, `--accb`,
and so on. Avatar colours `--mk --ta --sv --jd --rb` are per-person and should be
derived from user id at runtime, not hardcoded — the colour is computed from
the id and the active theme, and is **not stored** (SPEC §4.1).

**Type**: `Plus Jakarta Sans` (400–800) for UI, `JetBrains Mono` (500–700) for
keys, hosts, timestamps and counts. Both are Google Fonts in the mockup — the
shipped app **must self-host them**, because a self-hosted board that phones
Google on every page load contradicts SPEC §13.4.

## Sidebar

Four groups, in this order. Taken from the prototype's own nav model:

```
WORK      Board · Timeline · Calendar · Sprints · Capacity
REVIEW    Dashboard · Meeting review
SETTINGS  Tokens · Organisation
SYSTEM    Login & invite · First boot · Projects
```

`SYSTEM` holds screens that are not really nav destinations in the product —
login, first boot and the project picker. They sit in the prototype's sidebar so
every screen is reachable in one file. **Do not ship a SYSTEM group** in the real
app: those are pre-auth or org-level routes. Keep `WORK`, `REVIEW`, `SETTINGS`.

## Artifacts — do NOT reproduce

The prototype contains mistakes and placeholders. Reproducing them is a bug.

| Artifact | Where | Why it is wrong |
| --- | --- | --- |
| **`postgres 16 · connected`** | First boot, system status | Laika is **SQLite only** (D-001). Show SQLite and the WAL/migration state, never Postgres. |
| **"Email me a sign-in link"** | Login | Magic-link auth is not in SPEC §6.1 and needs SMTP. Not built — omit until decided. |
| **"Forgot?"** | Login | No password-reset endpoint exists (SPEC §6.4). Omit until decided. |
| `LK-` task keys | all superseded files | The prefix is `LAI-`. |
| Overlapping labels / floating pills | scattered | Layout artifacts of the mockup tool. Lay out properly; do not pixel-match a collision. |
| **`v0.4.2` version badge** | First boot, sidebar | No endpoint returns a product version. Show it only if one does — otherwise omit rather than invent (LAI-064). |
| **`migrations 41/41 applied`** | First boot, status rail | Laika has single-digit migrations. Render the real count or omit the line (LAI-206). |
| Hardcoded people and counts | everywhere | Mira Kellner, Sana Verma, `laika.kvelld.internal`, "13/34 done" are fixtures. **Never hardcode mockup data** — every number comes from the API. |

## What the design assumes that the spec does not yet define

Tracked as SPEC gaps and resolved in §11.4.2 — listed here so the mismatch is
visible from the design side too: a `repo` per project, an org-level presence
toggle, and a **Calendar** screen that has no decision behind it.
