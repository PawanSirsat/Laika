# strelka — LAI-846 builder — 2026-10-21

## 2026-10-21T17:05:00Z — LAI-846

**What changed**
- server/web/test/browser/my-day-v2.test.ts — `layOut()` replaces the three
  sidebar setup loops: it waits until the width has been heard, then clicks,
  then asserts the named state at its final width. `relabelled()` waits out
  FitLabel's re-pick.
- .tasks/review/LAI-846-my-day-browser-sidebar-state.md — claimed, finished,
  builder notes with the reproduction and mutation evidence.

**Decisions**
- Wait on our own `NARROW_QUERY` listener rather than on 2–3 stable frames.
  The media change reaches every listener before that frame's animation
  callbacks, so "heard" means the shell has heard it too. A stable-frames
  check passes while the change is still pending.
- The 1440 wider-font cut was treated as its own race (FitLabel re-pick after
  the 1280→1440 resize), not as the sidebar race. Holding the observer
  reproduced the exact CI text, so `relabelled()` waits on that step (two
  frames, then a posted task behind React's).
- The reproduction stays a scratch file. The task's scope is this file's
  setup, and the gates patch browser prototypes.

**Discovered**
- `FitLabel` re-picks only on a box resize or `fonts.loadingdone`. The
  wider-font cases therefore depend on their first `setViewportSize` actually
  changing the width (1280→1440). Started at 1440, the style tag would never
  re-pick and the case would fail every time. Noted, not filed: this is test
  setup, not a product path.
- The first `git push` (claim) failed `could not read Password`. It was the
  network drop that interrupted this session, not auth: the same push,
  credentials untouched, succeeded once the network was back. Not a finding.
- The hand-off comment named branch `LAI-846-my-day-sidebar-state`; the
  worktree was created as `LAI-846-my-day-browser-sidebar-state`, which is
  the one used.

**State**
In review; branch pushed, PR open against master.
