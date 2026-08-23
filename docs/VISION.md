# Laika — Vision

Status: **captured 2026-08-24** from the original design conversation.
Owner: PM session. This document explains *why* Laika exists. `SPEC.md` says what
to build; `ROADMAP.md` says when; this says what we are betting on and why.

---

## 1. One sentence

**Laika is a self-hosted project board where humans and Claude Code agents share
one source of truth.**

Not "a board with an AI feature bolted on", and not "an agent runner that happens
to keep a list". One database, two first-class front doors: a web UI for people,
an MCP endpoint for agents, over identical data and identical permissions.

---

## 2. The problem

Three separate failures that turn out to be the same failure.

### 2.1 Agents lose context between sessions

A Claude Code session is brilliant and amnesiac. It ends, and everything it
learned — what it tried, what it rejected, what it discovered halfway through
that nobody asked for — evaporates. The next session starts from the repo and the
human's memory, and the human's memory is the weak link.

Teams paper over this with `NOTES.md` files, scrollback, and re-explaining. None
of it is queryable, none of it is shared, and none of it survives the person who
wrote it going on holiday.

### 2.2 Jira and Plane are not agent-native

Existing trackers assume a human with a browser. An agent can reach them only
through a bolted-on API integration that is:

- **Read-mostly** — it can list tickets, but the write path is an afterthought.
- **Permission-blind** — the integration runs as a service account with god
  rights, so "what can this agent do" is unanswerable.
- **Semantically wrong** — the data model has sprints, story points, and epics,
  and lacks the things agents actually need: what is *ready* right now, what
  depends on what, and what did the last session discover.

You can make an agent talk to Jira. You cannot make Jira a place an agent
*lives*.

### 2.3 Managers cannot see where work actually is

This is the failure that makes the other two expensive. When a team runs coding
agents, the board goes stale within hours — work happens in terminals, not in
tickets. A manager looking at the board sees a fiction. Asking "where are we"
means interrupting three people, and the answer is a guess.

The information exists. It is in git branches, in running sessions, in what
people said in standup this morning. It just never reaches the board.

---

## 3. Who it is for

**Small organisations where most engineers are heavy Claude Code users.**

Concretely: 3–30 people, one team or a few, who have already made agents a
routine part of how code gets written and are now feeling the coordination cost.
They self-host by preference or by policy. They do not want another SaaS seat,
and they care where their code context ends up.

**Not for**: enterprises needing SSO/SCIM and audit compliance out of the box,
teams that do not use coding agents (they have working trackers already), or
solo developers (the coordination problem is the product; alone, you do not have
one).

---

## 4. The wedge

Any one of these could be built into an existing tool. **No competitor bundles
all four**, and the bundle is the point.

### (a) The board and the local agent share one source of truth

An agent reads its next task, claims it, comments, and hands it back for review
through MCP — the same records the human sees update live in the browser. No
sync job, no mirror, no "integration". The agent acts as its human, under that
human's permissions, and every action lands in the same activity log.

### (b) Live presence and capacity from heartbeats

Sessions emit a metadata-only heartbeat — repo, branch, timestamp. Branch names
carry task ids, so the server resolves who is working on what **without anyone
updating a ticket**. That produces a capacity view that is true by construction:
who is active, what they are on, what is in progress with nobody behind it.

This is the answer to §2.3, and it is why the board stops being a fiction.

### (c) Meetings diff against the board and update it

A standup transcript goes in; a **proposed diff** against the board comes out —
these tasks are done, this one is dead, this is new, this decision was made. Each
proposal carries the quote that produced it. A human accepts or rejects line by
line. The meeting stops being a thing you have *and then* transcribe into the
tracker.

### (d) Shared per-project context, injected into every teammate's agent

One project context doc, maintained in Laika, served to every agent session on
that project through `get_project_context`. When a decision is made, it lands
there once and every teammate's agent has it — instead of each person
re-explaining the same architecture to their own Claude, differently.

This is the compounding one. (a) makes the board honest, (b) makes it live, (c)
keeps it current, and (d) makes the whole team's agents smarter from the same
source.

---

## 5. Competitive landscape

What we studied, and what each gets right.

| | What it is | What it gets right | Why it is not this |
| --- | --- | --- | --- |
| **Beads** | Git-native memory for agents — issues as files in the repo | Agent-native from the ground up; survives sessions; no server | No humans in it. No presence, no capacity, no manager view, no meetings. It is memory, not coordination. |
| **Plane / Huly** | Open-source, self-hostable Jira alternatives | Self-hosting, data ownership, mature boards | Not agent-native. An agent reaches them as a foreign API client with service-account permissions. The data model has no concept of *ready*, discovery provenance, or a live session. |
| **Vibe Kanban** | Orchestration UI for running coding agents | Understands that agent work needs its own surface | Orchestration only — it runs agents, it is not the team's board. Humans do not plan in it, managers do not read it. |

The gap they leave: **Beads has agents without humans, Plane has humans without
agents, Vibe Kanban has runs without a team.**

### 5.1 The bet

**Laika's bet is the integration, not any single feature.**

Every individual capability here is buildable elsewhere, and some are better
elsewhere. Beads is a better pure agent memory. Plane is a better traditional
tracker. What none of them can do without becoming a different product is hold
*one* record that a human plans in, an agent works from, a heartbeat keeps
honest, and a meeting updates.

If the bet is wrong, it is wrong in one specific way: the integration turns out
to be worth less than the sum of the parts, and teams would rather run Beads
alongside Plane. We will know from whether people use the capacity view — it is
the feature that only exists because everything is in one place.

---

## 6. Principles

These are not slogans; each one has already killed a feature idea.

1. **Agents are users, not integrations.** An agent acts through a real user's
   token, under that user's permissions. There is no service account and no
   elevated mode.
2. **An LLM may propose, a human disposes.** Agents stop at `review`, never
   `done`. Meeting diffs require explicit line-by-line acceptance. Nothing an
   LLM produces enters the record unreviewed. (D-007)
3. **Capacity, not surveillance.** Heartbeats carry repo, branch, timestamp and
   nothing else — never file contents, diffs, or prompts. The richer signal is
   right there and we refuse it on purpose, because the day Laika becomes
   monitoring software is the day nobody runs it. (D-005)
4. **Your data never leaves your infrastructure.** Self-hosted, one SQLite file
   on a volume you own, no telemetry of any kind, and the only outbound calls are
   to an LLM provider *the org configured itself*.
5. **Setup is the product.** One container, one volume, one command. A tool for
   small self-hosting teams that takes an afternoon to stand up does not get
   stood up. (D-002)
6. **Everything is an event.** One append-only activity log feeds audit,
   presence, dashboard, and live updates. One truth, many views.

---

## 7. What success looks like

- A manager answers "where are we" from the capacity screen without interrupting
  anyone.
- A new agent session picks up correct, current work with one `list_ready_tasks`
  call and no human briefing.
- A standup produces board changes in under a minute, reviewed rather than typed.
- Nobody maintains a `NOTES.md` for their agent, because the project context doc
  made it redundant.
- A team's board is still accurate on a Friday afternoon.

## 8. What would falsify it

- Teams use the board but never the MCP endpoint — agents were not the missing
  piece.
- Heartbeats are turned off — presence reads as surveillance despite §6.3.
- Meeting diffs are consistently rejected — the LLM cannot read a standup well
  enough to be worth reviewing.
- People keep their `NOTES.md` anyway — shared context does not survive contact
  with how individuals actually work.

Each of these is cheap to observe early. None of them requires shipping all
seven milestones to find out.
