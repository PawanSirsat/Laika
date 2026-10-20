## 2026-10-20T19:18:43Z — LAI-817

**What changed**
- `server/web/src/routes/screens/dashboard/contributors-derive.ts` (new):
  D-092 item 1, built from the range's `task.status_changed` rows. It ranks
  Delivered (distinct tasks moved into review, or into done without review),
  then Reviewed, with self-closes counted. Credit goes to `actor_id`, which is
  the token's owner on an agent's row.
- `Contributors.tsx` (was `WorkByPerson.tsx`): the card is titled
  Contributors, with two tabs, Delivered and Open work now. Open work now has
  no range, puts review on its own line per person, and draws all review as
  one share.
- `summary-derive.ts`: `touched` replaces `updated`; `open`/`dated` and
  `fewDated` are new; `workloadByPerson` splits review out; `staleTasks`
  reads `stale_flagged_at`; `waitingForReview` and `splitBlocked` are new;
  `MAX_PEOPLE` is 4.
- `card-filters.ts`: the people card never follows the range; `wp_range`
  and `wp_status` are gone; `blockedIdsOf` uses the committed rule.
- `NeedsAttention.tsx` (Blocked counts committed work, backlog shown apart;
  Stale is the server's flag; Waiting for review > 5 days is new),
  `StatCards.tsx` (touched, the due caveat), `StatusOverview.tsx` ("done
  of touched"), `DashboardScreen.tsx` (wiring), `dashboard.css`,
  `screen-copy.ts`.
- Tests: `contributors-derive.test.ts` (new), `summary-derive.test.ts`,
  `card-filters.test.ts`, `reachable.test.ts`, and in `browser/`:
  `dashboard-contributors.test.ts` (new), `onroute-dashboard.ts` (new
  fixture), `dashboard-summary`, `dashboard-card-filters` and
  `member-profile`.
- `.tasks/review/LAI-817-dashboard-shows-contributors.md`.

**Decisions**
- The people donut shows all open work rather than a labelled sample. D-092
  says open work is "now", and a workload chart of what was touched this week
  is wrong however it is labelled.
- The people card's Range and Include done fields are removed, not kept
  inert. Open work has no range, and done work is Delivered's.
- The status centre keeps the ring's own share and says "done of touched".
  A project-wide figure inside a ring that draws a sample would be a second
  mismatch.
- The reviewer of a task whose delivery predates the range is judged against
  the assignee. That is a stand-in, said so in the docblock.
- LAI-823 is left room, not built: `contributors()` counts the events it is
  given, so a bulk-move rule filters them first.

**Discovered**
- The truncation of the review split was found by screenshot. Every test
  passed, because `textContent` reads clipped text.
- My first clipping guard could not fail: an inline span's `clientWidth` is
  0. M4 survived it. It is now measured against the column's edge, and M4
  goes red.
- `pnpm --filter laika` matches the **root** package, so it ran the whole
  recursive gate a second time.
- `pnpm test` under load: three member-profile minute assertions and server
  timeouts. pnpm kills the other workspaces on the first failure. Every
  failing file passed alone.
- I filed LAI-829 ("`create_task` refused with *taken* the card it had
  just made") and withdrew it within the hour. LAIKA-617's description is the
  orchestrator mirror's, not mine, so the card was made between my lookup and
  my create, and the refusal was right. **A lookup's `not_found` is a moment,
  not a fact**: the §2 claim race, met on the board.
- SPEC (around line 4111) still says "*Work by person* row". That is CHIEF's
  to reword.
- Ports: none used. The browser tests use the harness's own server; no
  instance was started.
