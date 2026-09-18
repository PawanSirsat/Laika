# docs/ — owned by **PM**

Read in this order if you are new:

1. **`VISION.md`** — why Laika exists, who it is for, the four-part wedge, the
   competitive landscape, and what would prove the bet wrong.
2. **`FEATURES.md`** — the complete feature list, each tagged `[built]`,
   `[planned phase N]`, or `[idea]`.
3. **`SPEC.md`** — the technical source of truth. Phases 1–3 are specified in
   full; 4–7 are outline, expanded just in time.
4. **`ROADMAP.md`** — milestones M1–M7 with an exit criterion each. Phases in
   `FEATURES.md` map 1:1 to these milestones.
5. **`CONVENTIONS.md`** — where code goes, what it is called, which layer may
   import which. Binding for all sessions; read before adding a file.
6. **`DECISIONS.md`** — append-only log, D-001 onward. Every entry carries the
   reasoning, not just the rule.
7. **`OPERATIONS.md`** — for the person **running** an instance, not building
   one. **Every procedure in it is executed by a test**, and it says which; where
   the prose and the test disagree, the test is right and the disagreement is a
   bug.

`design/` is the owner's imported visual reference. **CHIEF may measure it and may
not decide anything in it** (D-020).

Builders do not edit these files. Propose changes by writing a task file with
`area: docs`, or raise it in your log entry and PM will pick it up.
