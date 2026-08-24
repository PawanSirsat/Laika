# What the design shows that the product cannot yet back

**Every row here is a thing in `docs/design/` that would have to be invented to
render today.** CLAUDE.md §5.1 forbids that: *"Never hardcode mockup data. A
hardcoded value is a defect even when it looks right."* So these are absent from
the UI on purpose, and each one is either filed or deliberately dropped.

Kept as one table because fifteen scattered task files do not answer the question
*"why does our board look thinner than the mockup?"* — this does.

Last verified against `master` on 2026-08-25.

**Rows marked `demo`** are fed by `src/demo/` under **D-032**: visible in
development so the design can be evaluated, and **incapable of reaching a
production build** — every module returns early on `import.meta.env.PROD` and a
test fails if any fixture string survives into the bundle. `grep -rl "src/demo"
server/web/src/` lists every screen still leaning on one.

## Task detail

| Design element | Backed by | Status |
| --- | --- | --- |
| Tag chips (`agent`, `core`) | **demo** (`src/demo/tags.ts`) — decided in **D-027** | **LAI-079** builds the real one |
| `BLOCKS` half of dependencies | data and index exist; API returns one direction | **LAI-091** (p1) |
| **Acceptance** section | nothing — only `description_md` | **LAI-092** |
| `created via agent · mira-cli` | `created_via` enum, no client name | **LAI-093** |
| **Watch** button | nothing | **LAI-094** |
| Comment count on cards | not on `TaskView` | **LAI-072** |
| PR panel · branch · CI · commits | `external_ref` only (one string) | **LAI-095** — shape undecided |
| Agent log / agent session | nothing until tokens | M3/M4 |

## Board

| Design element | Backed by | Status |
| --- | --- | --- |
| Sprint rail + active-sprint banner | sprints API exists | **LAI-069** |
| `LIVE · SSE` pill | `GET /events` exists, UI does not consume it | **LAI-070** |
| `WORKING NOW` presence strip | **demo** (`src/demo/presence.ts`) — real presence is M5 | M5 / **LAI-207** |
| Agent sessions panel | nothing until tokens | M3/M4 |
| `Stale · no movement` panel | `stale_flagged_at` not exposed | **LAI-208** |
| `WIP 3/4` limits | **demo** (`src/demo/wip.ts`) — no column exists | needs a spec decision |
| `Agent work 5` filter | no `created_via`/`actor_kind` filtering | not filed |

## Projects home

| Design element | Backed by | Status |
| --- | --- | --- |
| Progress bar, counts, blocked count, last activity | **`GET /projects`** (LAI-053) | **shipped** (LAI-046) |
| Repo line under the name | `projects.repo` exists (LAI-108) | ready |

## Deliberately dropped, not missing

These are **mockup artifacts**. Reproducing them is a defect, and they are also
listed in `README.md`:

- `postgres 16 · connected` — Laika is SQLite (D-001)
- `migrations 41/41` — Laika has single digits
- `v0.4.2` — no endpoint returns a product version; the real one is rendered
- `Forgot?`, `OR`, `Email me a sign-in link` — no reset, no SMTP, not specified
- `Mira Kellner`, `Sana Verma`, `laika.kvelld.internal`, `13/34` — fixtures
- **`WIP 3/4`** — no WIP-limit column exists, so the denominator would be
  invented. Needs a spec decision before it is a feature.
- The prototype's **`SYSTEM` sidebar group** — login, first boot and the project
  picker are pre-auth or org-level routes, not nav destinations.
- **Per-task dates on the Timeline** — D-014 keeps dates on sprints only. The
  prototype's task spans are fiction and LAI-084 has a test that fails if anyone
  adds them.

## Additions the design does not contain

- **`@mentions` in comments** — the owner's request. Checked every design file:
  the only `@` occurrences are email addresses and CSS `@keyframes`. Filed with
  Watch as **LAI-094**, because both need one substrate.

## How to use this

**If a screen looks thinner than the mockup, look here first.** If the row says
*filed*, the gap is known and sequenced. If a design element is missing from this
table entirely, that is the bug — tell PM.
