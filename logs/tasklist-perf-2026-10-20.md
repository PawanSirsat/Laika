## 2026-10-19T22:52:00Z — LAI-786

**What changed**
- .tasks/review/LAI-786-production-task-list-is-slow.md — filed, claimed and
  moved to review. It holds the investigation: production split into server
  time and transfer, the reproduction's counts and plans, the sweep, and the
  gate.
- No application code. The seed, measure, plan and sweep scripts lived in the
  session scratchpad and are not committed.

**Decisions**
- Stopped at the diagnosis, as the brief said to if the server was fine. The
  page costs 11 statements at any size, every plan is an index `SEARCH`, and
  it runs in ~8 ms at 200 tasks on more data than production holds. A
  "batching" change would have had nothing to batch.
- Measured production with read-only GETs from this Mac rather than infer it,
  because TTFB versus total is the only thing that separates server work from
  transfer. Kept the 200-task plain request to one run, since it is the
  heaviest. The one production body downloaded, to measure the share of
  description text, was deleted right after.
- Did not file the two discoveries below. The orchestrator is filing LAI-787+
  on `master` in the same block right now, and an id taken from this branch
  could collide (§3's "lowest unused number is not a lock").

**Discovered**
- The 71.7 s was the path, not the server. The owner's three timings scale
  with bytes at ~6–13 KB/s, and the identical request took 3.0 s at 22:30Z
  with ~0 s of server time. I saw SYN retransmits while measuring.
- "96 KB → 501 KB" compared LAI-722's gzip figure with a plain `curl` body.
  The page has not grown.
- `description_md` + `acceptance_md` are 83% of the gzip 200-task page
  (127 KB → 21 KB without them). This is `?fields=`, which LAI-722 and LAI-724
  deferred. For CHIEF to file; it changes §6.4. Not filed here.
- Production is plain `http://` on a public IP, so tokens and cookies cross
  the internet unencrypted. No task mentions TLS. For CHIEF to file; not filed
  here.
- `migrate.test.ts`'s 0030 and 0031 cases time out at 5 s under full-gate
  load (6.8 s and 8.6 s). They pass alone, and the second full run passed.
  This is the known load timeout, recorded rather than refiled.

**State**
In review. The card (LAIKA-589) carries the same evidence as a comment.
Nothing pushed. The local server on :3786 is stopped and nothing is left
running.
