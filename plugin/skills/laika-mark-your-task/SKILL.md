---
name: laika-mark-your-task
description: Use when starting, switching or finishing work on a task tracked on a Laika board — before writing code, before creating a branch, and whenever you move to another task. Says how to mark the task you work on and how to name your branch so Laika ties your session's tokens to it.
---

# Mark your task before you start

Laika ties the tokens your session spends to the task you were working on. It
cannot ask you; it reads the marks you leave. So:

1. **Mark the task before anything else** — before reading code for it,
   before creating a branch. Call `start_working` with the task's key and the
   `branch` you work on — also when it is already yours and in progress, as
   when you resume it: that is accepted and keeps the branch. A task assigned
   to you that is not started yet answers `conflict`; move it with
   `update_status` to `in_progress` instead.
2. **Mark again whenever you move to another task**, the same way. Work is
   tied to the last task you marked, from the moment you marked it.
3. **Name the branch after the key**: `<KEY>-short-name`, for example
   `LAI-42-fix-login`. A session that marked nothing still has its tokens tied
   to the task its branch names.
4. **Finish with `finish_task`**, or move the task out of progress with
   `update_status`. Work after that counts for no task until you mark the next
   one.

## Why

The task's Tokens section shows what each task cost, per person, agent and
review round. Work you did before marking, or on a branch with no key in it,
counts for no task: it stays **unattributed**, and Laika says so beside every
figure rather than guessing where it belongs.

Only the key leaves your machine — never the branch name, your session, your
prompts or the notes you pass to these tools.
