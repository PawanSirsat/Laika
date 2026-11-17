# UX opportunity map

**Proposal, built from Phase A evidence.** Each row is one opportunity: the
problem it removes (with its finding ids), who feels it, the impact, a rough
effort, whether it needs the server, and the phase it belongs to. It is the
input to sequencing, not a commitment; the roadmap is
[`../roadmap/implementation-roadmap.md`](../roadmap/implementation-roadmap.md).

**Users.** **IC** individual contributor (a person, or the person behind an
agent) · **Mgr** project / tech manager, space admin · **Exec** executive, org
owner · **Admin** org admin · **Agent** a coding agent acting through MCP.

**Impact.** *High*: removes a P1, or unlocks a surface the product promises.
*Medium*: removes a P2 or a recurring cost. *Low*: polish.

**Effort.** *S* ≤ 1 PR of a few files · *M* 1–3 PRs · *L* several PRs or a
cross-owner merge. Backend effort uses the same scale and is sized separately
in the roadmap §4.

**Kind.** **UI** UI-only (SHELL) · **UI+dep** UI-only but needs a
dependency task · **BE** needs CORE work · **UI→BE** UI-only first slice, full
version needs CORE · **3-owner** a new activity verb (CLAUDE.md §4.4).

**Phase.** C, D, E, F, G as in the roadmap; **FF** = the proposed Foundation
fixes track (an open question for the owner).

## 1. Fix what is broken

| # | Opportunity | Problem (ids) | Users | Impact | Effort | Kind | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| O1 | One drawer host in `SpaceLayout` renders task content on every space view | Empty drawer (B1/V1); Create jumps to Board (B19) | IC, Mgr | High | M | UI | C |
| O2 | Drawer as a real dialog: focus trap, labelled, Escape layering, safe Detach | B3/B22, B4 | IC (keyboard, SR) | High | S | UI | C |
| O3 | Correct task links everywhere (`useOpenTask`, real `href`) | B2, B18, B9 cmd-click | IC, Mgr | High | S | UI | C |
| O4 | Accept with undo toast; Send back with required reason | B9 | Mgr | High | S | UI | C |
| O5 | Error never shown as empty; retry keeps last data | B5, B6, B7 | all | High | M | UI | FF |
| O6 | My Day works without time tracking: assigned, due and overdue tasks | V2 | IC | High | M | UI (overdue list complete only with BE due filter) | FF |
| O7 | One space-header layout for every tab; filters in one row below the tabs; collapsed filter button at narrow widths | V3, V4 | IC, Mgr | High | M | UI | FF |
| O8 | Board scope honesty: visible default sprint scope, same as List; sprint badge distinct from size | V5 | IC, Mgr | Medium | S | UI | FF |
| O9 | Board toolbar: labelled stats, overflow at narrow widths | V6 | IC | Medium | S | UI | FF |
| O10 | Settings drafts survive tab switch; "Saved" feedback | B11 | Mgr | Medium | S | UI | FF |
| O11 | Inline confirms take focus; one `InlineConfirm` | B12 | Mgr, Admin | Medium | S | UI | FF |
| O12 | Disabled controls say why (v3 Reconnect / Disconnect) | B10 | IC | Medium | S | UI | FF |
| O13 | Insights badge lands on Usage; correct SR wording | B8 | Mgr, Exec | Medium | S | UI | FF |
| O14 | First-space path: SPACES section and Board empty state offer Create | B21 | Admin (new org) | Medium | S | UI | FF |
| O15 | List rows: valid selection model, keyboard open | B20 | IC (keyboard, SR) | Medium | S | UI | FF |
| O16 | Retire `/members` (redirect to Space settings › Members) | B13 | Mgr | Low | S | UI | FF |
| O17 | Unlisted promote: space picker, Enter submits | B15 | Admin | Low | S | UI | FF |
| O18 | Terminology pass: Space, Space admin, Organisation, Agent / Coding tool, Access token, Audit log; no slugs | V10, interaction inventory §3 | all | Medium | M | UI | FF |
| O19 | Empty states not styled as errors; red only for real problems | V12 | all | Medium | S | UI | FF |
| O20 | Stale comments and dead fetches (B23, B24, B25), DayTabs keys (B26) | B23–B26 | maintainers, keyboard | Low | S | UI | FF |

## 2. Foundation: one implementation per interaction

| # | Opportunity | Problem | Users | Impact | Effort | Kind | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| O21 | Layer, motion, breakpoint, radius, spacing and elevation tokens with guard tests | B16; 22 z-indexes; 29 breakpoints; 232 radius literals; 19 reduced-motion blocks | all (indirect) | High | M | UI | FF (prerequisite for C) |
| O22 | Route-level code splitting; main JS ≤ 200 KB gzip | 533 KB gzip single bundle | all | High | M | UI | FF |
| O23 | Shared `ToastProvider` + `SaveStatus` + undo | 2 private toasts; silent saves | all | High | S | UI | C (needed by O4) |
| O24 | `Popover` / `Menu` / `Tooltip` on one positioning layer | 8 popovers, 4 tooltips, 384 `title=` | all | Medium | M | UI+dep (Floating UI) | C |
| O25 | `Tabs` (roving), `Dialog` base, `usePolled`, `useOpenTask`, `Icon`, `StatusBadge`, `Identity` | 2–7 copies each | all | Medium | M | UI | C (as the Workroom needs them) |
| O26 | CSP enforced in the browser test harness | a runtime `<style>` would pass CI today | maintainers | High | S | UI (test infra) | before any new UI dependency |
| O27 | Glass design system as tokens + primitives, with guard | no surface language for floating chrome | all | Medium | M | UI | C (tokens) → E/F (use) |

## 3. New surfaces

| # | Opportunity | Problem | Users | Impact | Effort | Kind | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| O28 | Task Workroom `/task/:key`: three resizable panels, area nav, focus mode, same tree as the drawer | 1,257-line scroll; no execution view | IC, Mgr | High | L | UI (key lookup may be BE S) | C |
| O29 | Four agent lanes (Accountable · Requested · Executing · Outcome) | "assigned to an agent" confusion; V7 | IC, Mgr | High | S | UI | C |
| O30 | Execution timeline from activity + checkpoints + rounds + offers | no run history | IC, Mgr | High | M | UI→BE (claims history, S) | C |
| O31 | Decisions and open questions surfaced from checkpoint summaries, labelled agent-reported | unread free text | Mgr | High | S | UI→BE (structured entity, M) | C |
| O32 | Evidence while in progress, labelled "latest save, not proof" | evidence hidden until first finish | Mgr | Medium | S | UI | C |
| O33 | **Deliverable design trial** on three Markdown fixtures (renderer, TOC, highlighting, Mermaid, tables, diff, comments, full-screen, PDF) | no document reading surface | Mgr, Exec | High | M | UI+dep (trial-only, local) | alongside C |
| O34 | Deliverable engine: text deliverables, immutable versions, review, anchored comments, `submit_deliverable` | deliverables are a checklist only | Agent, Mgr, Exec | High | L | BE + 3-owner + UI | D |
| O35 | Management Review Studio: project dashboard, review page, technical / executive lens, presentation mode, print pack | no place for management | Mgr, Exec | High | L | UI→BE | E |
| O36 | Agent Operations v1 ("Your agents") | session history only inside disconnect dialogs | IC, Mgr | Medium | M | UI→BE (org fleet, M) | E |
| O37 | One org-wide `EventSource` with project fan-out; retire redundant pollers | per-space streams; B14 | all | High | M | UI | F |
| O38 | Command Center `/home` | no "what needs me" view | all | High | M | UI→BE (due filter, notifications) | F |
| O39 | Command palette (⌘K) with permission-filtered destinations | navigation by sidebar only | IC, Mgr | Medium | M | UI+dep (cmdk) | F |
| O40 | Notification centre + tiers | badges are polled counts | all | High | L | BE + 3-owner + UI | F |
| O41 | AI summaries, governed per the AI policy | no executive summary | Exec, Mgr | Medium | M | BE + SPEC decision + UI | F (after policy) |
| O42 | Global search (FTS5) | client-cache search only | all | Medium | M | BE + UI | F |
| O43 | Mobile IA: bottom bar, List default, task as full-screen sheet | phone is a shrunk desktop | IC | Medium | M | UI | G |
| O44 | Roles & permissions as grouped, searchable summary | V8 | Admin | Medium | M | UI | later |
| O45 | Touch + keyboard board drag | B17 | IC (touch) | Medium | M | UI+dep (dnd-kit evaluation) | later |

## 4. Reading the map

- The **P1 cluster** (O1–O7) is UI-only and small-to-medium. Every one of them
  is a reason the later surfaces would feel broken if built first.
- **O21, O22 and O26 are force multipliers**: tokens, splitting and in-browser
  CSP make every later PR cheaper and safer.
- The **highest-value new surface that needs no server change** is the
  Workroom (O28–O32). The deliverable trial (O33) de-risks Phase D's renderer
  and library choices before any table or endpoint exists.
- Everything in §3 marked BE or 3-owner waits for a CORE task (and, for
  O34 and O41, a SPEC decision). Their UI-only first slices are specified so
  they degrade honestly without it.
