---
id: LAI-862
title: 'plugin/README and SPEC still say a skipped session keeps only its id; LAI-859 added the `omnigent` word'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-859]
discovered-from: LAI-859
status: backlog
---

## Goal

The two documents that describe the activity hook's `skip-sessions` line say
what the hook writes now.

## Found (LAI-859's builder, 2026-10-21)

LAI-859 made the hook append ` omnigent` to the skip line of a sub-agent an
Omnigent runner dispatched (D-095). `CI`, `LAIKA_ACTIVITY_SKIP`, and
`OMNIGENT=1` with no runner id still write the two-field line. Two documents
still describe the old line:

- `plugin/README.md`, under *Local activity* → *Count a session nobody is
  typing in*, says the hook keeps the session's id. It does not mention the
  word, or that a dispatched builder's card can label the person's untied
  minutes.
- `docs/SPEC.md`, in the collector paragraph, says the hook *"keeps only
  that session's id"*.

## Acceptance criteria

- [ ] `plugin/README.md` says which skipped sessions get the `omnigent` word
      and what it is used for (D-095), and that the line is never sent.
- [ ] SPEC's collector paragraph says the same in one sentence, quoting
      D-095.
- [ ] The gate exits 0.

## Notes

`plugin/README.md` is SHELL's and `docs/SPEC.md` is CHIEF's. A CHIEF builder
can do both on the owner's direct instruction, or file the README half for
SHELL.
