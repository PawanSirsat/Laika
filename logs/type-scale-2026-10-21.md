# type-scale (owner-direct, LAI-828) — 2026-10-21

## 2026-10-20T22:53:28Z — LAI-828

**What changed**
- server/web/src/theme/type-roles.ts — `TYPE_SCALE` (tiny 11/16, small 12/16, body 14/20, reading 16/24, heading-sm 16/20, heading-md 20/24, heading-lg 24/28); roles name a step; dense board tightens leading only; `LEGACY_TEXT_ALIASES` for My day
- server/web/scripts/generate-type-css.ts, server/web/src/styles/type.css — the scale generated as `--text-*`/`--leading-*` at `:root`, roles on the steps
- server/web/src/styles/theme.css — the old type block and LAI-827's interim reading tokens removed (moved into the scale)
- server/web/src/theme/token-list.ts, TokenReference.tsx — `TYPE_TOKENS` derived from the scale; the reference page draws each step with its leading
- 59 stylesheets under server/web/src/components, routes/screens and theme — every font-size onto a step token (907 declarations across them and type.css)
- server/web/src/routes/screens/{organisation/organisation.css, dashboard/dashboard.css, timeline/timeline.css, tokens/tokens.css} — phone layout fixes at 390px
- server/web/src/routes/screens/task/task-panel.css — calc that multiplied two lengths rewritten; linked-task avatar 22px
- server/web/test/theme/type-floor.test.ts — rewritten as the scale's guard (tokens only, 12px floor, exact tiny list, My day exemption that expires itself)
- server/web/test/theme/type-roles.test.ts, test/tokens.test.ts — scale asserted value by value; type tokens no longer looked for in theme.css
- server/web/test/browser/card-anatomy.test.ts (13.5px → 14px), task-panel-editing.test.ts (15px → 16px) — numbers the new sizes made wrong
- docs/SPEC.md — §11.4.4 Type scale (named edit; SPEC had no design-tokens section)
- .tasks/review/LAI-828-larger-type-scale-like-jira.md — census of all 948 declarations, token table, layouts, decision draft

**Decisions**
- Tokens live in `type.css`, generated from `TYPE_SCALE`, not in `theme.css` where the old ones were — the criterion names `type.css`, and generating both the scale and the roles from one object means a role cannot be off the scale.
- Roles chosen by what the text is for, not its old size: inputs, buttons, cells, names, messages went from 11–11.5px to body 14; chips, keys, labels to small 12. Mapping by size alone would have left form fields at 12.
- Avatar initials join a named 11px list instead of keeping LAI-706's blanket exemption — measured: "WM" is 23.8px at 12px heavy, wider than a 22px circle; 21.8px at 11px. Three circles under 22px grew to 22px.
- Legacy token names kept as aliases for My day only, with a test that fails once My day no longer needs them — LAI-831 is rebuilding My day and its stylesheet could not be swept here; deleting the names would have broken it.
- Description headings follow Jira (h1 24, h2 20, h3 16) rather than LAI-827's "stay under the title" — the latter put h2 at the size of the reading text.
- 35 sizes went down ≤1px to land on a step (12.5 → 12 chips, keys, meta; column heads to Jira's 12px); listed in the task file rather than rounded up to 14.

**Discovered**
- The first overflow check read the document's scroll width; the app scrolls `.shell-main`, so it reported "no scroll" while Organisation moved 17px sideways at 390. Measuring `main` found three screens (Organisation, Timeline, Developer access) that already scrolled sideways at 390 before this task; fixed here, since the criterion is about the end state.
- `calc(3 * var(--leading-reading) * var(--text-reading))` (LAI-827) silently becomes invalid once the leading is a length — no test covers it; rewritten.
- `.watch-avatar` and `.comment-avatar` in task-panel.css are drawn by no component → logged as unlisted work on the board, not filed.
- SPEC has no "design-tokens section", which the criterion names → added §11.4.4 and flagged in the task file.

**State**
In review on branch LAI-828-type-scale, not pushed. Gate: `pnpm test` 0, `pnpm lint` 0, `pnpm format` 0 on 97fc95e2 (server 3327 passed / 10 skipped, web 2571/2571, cli 533 passed / 0 failed).
