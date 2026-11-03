---
id: LAI-1117
title: 'Task detail redesign, desktop: delivers panel, state hero with Approve / Send back, grouped activity, estimate rail'
area: web
assignee: strelka
priority: p1
depends-on: [LAI-1115, LAI-1116]
discovered-from: []
status: review
finished: 2026-11-03T20:56:50Z
started: 2026-11-03T20:18:07Z
---

## Goal

Rebuild the task detail (`TaskDetailPanel`, `TaskMeta`) to the owner's
2026-11-04 design, as style and layout: every feature the panel has today
stays (hand-off and recovery panel, token budgets, effort override, inline
editing, subtasks and linked tasks, the Changes tab, reporter and
discovered-from, error and read-only states), placed where the design has a
slot or folded where it has none.

## Acceptance criteria

- [x] Drawer width `min(1280px, 94vw)`; rail about 380px; fact grids four
      columns, two under 1000px; the ≤900px stacking still works and 390px
      has no sideways scroll with the hero and the popover open.
- [x] Header: key, outside-id chip, watch with count, share (copies the link,
      a `role=status` says "Copied"), `⋯`, close. Breadcrumb for a subtask
      stays.
- [x] "What this delivers": Ships with done / in-progress / pending marks and
      the progress line ("2 of 4 built · <item> in progress", "4 of 4 built ·
      waiting for approval" in review), Solves, Unlocks, and "Blocks no other
      tasks" or the blocked tasks; inline editing PATCHes only the list that
      changed; a Viewer gets no editor; nothing is drawn when the server does
      not send the field (D-032).
- [x] State hero: review (pill, "Round n · finished by <person> [agent]
      <time>", Approve / Send back for the assignee or a lead using the
      Review screen's dialog and endpoints, fact grid Pull request / CI /
      Tests / Commits, commits, test runs with "Show all N runs", a confirmed
      sentence that counts confirmed, claimed and failed items and says "from
      GitHub's signed deliveries"); in progress ("Working now · for <t>",
      Ping, Session / Model / Connection / Progress bar vs the frozen
      estimate; Connection lost on the page clock); sent back (pill, reason,
      "Round n · working now", previous round folded); waiting ("Waiting for
      <harness · device> to accept", "Work request sent <t> ago", Ping,
      Change agent focuses the picker); done (accepted by, rounds folded).
      Escape inside the Send back dialog closes the dialog, not the drawer.
      After a decision the task, rounds and the Review badge refresh.
- [x] Acceptance: `- [ ]` / `- [x]` lines render as a checklist with "n of m";
      prose renders as today; the editor is unchanged.
- [x] Activity: All / Comments / History / Changes; runs grouped by actor and
      session with a rail; the actor row names the person and the agent as
      `<harness> · <device>` (`display_name` only to its owner;
      `agent_redacted` rows say "an agent" and show no device or model); the
      chip opens "Who did this" on click, focus or hover (Person, Agent ·
      owned by, Device, Tool with version, Model, and the self-reported note),
      closes on Escape and returns focus. The finish comment of a round is a
      collapsible "Finish summary · round n"; a send-back reason is a reason
      card; "Edited" is shown.
- [ ] Rail: status button with the sub-line ("In review for <t> · round n",
      "Claimed <t> ago", "Sent back <t> ago · round n", "Not started"); Details
      in the design's order with every existing editor; Development (branch,
      pull request, outside id, commits); Estimate (effort with override and
      "Why <level>?", similar tasks with durations, actual, tokens
      "<total> of <p80> (<pct>)" and the cost line, budget bar when set);
      foot; the execution and hand-off panel as today.
- [x] Colours only from `theme.css` tokens in both themes; the pulse honours
      reduced motion; the hero and sub-line are `role=status`; the progress
      bar is a `progressbar`.
- [x] Existing pins updated, not deleted: `task-drawer.test.ts` widths,
      `task-panel.test.ts` Details order and feed selectors,
      `agent-field.test.ts`, `agent-line.test.ts`; `review.test.ts` passes
      unchanged. New browser tests: hero per state including approve and send
      back from the panel, delivers, feed and popover, acceptance checklist,
      layout at 1600 / 1000 / 390 in both themes.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

- Eight commits, each green alone: pure helpers and shared reads
  (`use-task-rounds`, `use-task-estimate`, `hero-derive`, `feed-groups`,
  `comment-kinds`, `rail-derive`, `acceptance-derive`, `delivers-derive`, the
  client types that turn LAI-1115's `view-type-drift` red green); split
  without redesign; frame and rail; grouped feed and popover; hero review /
  sent back / done; hero progress / waiting; acceptance checklist; delivers
  panel.
- Reuse as-is: `ExecutionPanel`, `HandoffSection`, `HandoffOfferDialog`,
  `AgentPicker` (+ `triggerRef`), `PingButton`, `SubtasksSection`,
  `DependenciesSection`, `SendBackDialog`, `InlineEdit`, `LazyRichEditor`,
  `CopyButton`'s `copyText`. `EvidenceSection` takes pre-read rounds;
  `ForecastSection` / `TokensSection` take a `compact` prop and a pre-read
  estimate.
- The finish-summary comment is the one whose `body_md`, `created_at` and
  author equal the round's (`finishTask` writes both with one `now`).
- Working duration: the `task.updated field:claim` row of the live
  generation, else `started_at`. Work request time: the open `work_request`
  offer in `/tasks/:id/handoff-offers`.
- Token names map: `--canvas→--bg-canvas`, `--line→--border-subtle`,
  `--line2→--border-default`, `--muted→--text-secondary`,
  `--faint→--text-muted`, `--accentSoft→--accent-bg`, `--ok/--warn/--danger/
  --info→--chip-*`, `--agent→--chip-pink`, `--skel→--bg-column`.

## Review notes (builder)

- The **Rail** criterion is left unticked: the status sub-line, the
  Development card and the foot are done, but the Estimate card and the
  Details rows in the design's order are not. Filed as LAI-1121.
- Proof detail stays in its own section under the state panel, not inside it.
