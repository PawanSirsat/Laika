# Agent identity model: one agent per harness per device, and the selected agent owns the claim

Status: **proposed** — D-118 and D-119 below. Owner direction given in chat on
2026-10-29 (Pawan, via the polly manager session). Like D-114 – D-116, these
count as approved only once recorded from Pawan's own account: a comment from
his signed-in browser on LAIKA-785, or an Approved review on this PR.

## Why we are building this

People run many agents: a harness opened by hand, a manager such as polly that
starts its own workers, the same harness on a second laptop, a cloud runner.
Laika has to answer three questions about any piece of work, at a glance and
without a manual:

1. **Who is accountable?** The human assignee.
2. **Which agent is doing it?** One name a person recognises.
3. **What exactly ran?** The underlying harness and model, for the record.

The model below keeps question 2 short and puts question 3 one click away.

## D-118 — An agent is one harness on one device; the vendor and model it runs belong to the session (proposed)

**In one line:** register what you would point at — "polly on Belka",
"Claude Code on Strelka", "Codex in the cloud" — and let each session say which
model it used.

**Decision.**
- A registered agent is **one harness on one device**. Its name is
  `<harness> · <device>`, e.g. `Polly · Belka`, `Claude Code · Belka`,
  `Claude Code · Strelka`, `Codex · Cloud`.
- **A manager is a harness.** polly (Omnigent) on Belka is one agent,
  `Polly · Belka`. Every worker it starts — Claude Code, Codex, anything else —
  is a **session of Polly · Belka**, not a separate agent.
- **A harness used directly is a different agent.** Claude Code opened by hand
  on Belka is `Claude Code · Belka`, even though polly's workers also run
  Claude Code on the same laptop.
- **A different device is a different agent**, even for the same harness:
  `Polly · Strelka` is not `Polly · Belka`. A cloud runner is a device.
- **Each session records what actually ran**, self-reported and labelled as
  such: the underlying harness (e.g. Codex), its version, and the model (e.g.
  `gpt-5.5`, `claude-opus-5-5`). Changing a model never creates a new agent.
- **The UI shows one short line** — `Polly · Belka` on cards; `Polly · Belka ·
  Codex · gpt-5.5` in the drawer and in activity; full session details
  (versions, session id, claim generation) behind an expandable *Details*.
  Colour is never the only signal.

**Consequences.** One credential per agent (D-114), so a laptop or harness is
revoked without touching the others. Agents on two machines can never share a
claim by accident. The board stays readable: the person sees a handful of
agents, not one per model.

## D-119 — The selected agent owns the claim (proposed)

**In one line:** once a task names its agent, only that agent can start it.

**Decision.**
- When a task has a **selected agent**, only sessions of **that agent** may
  claim it. Any other agent gets `409 conflict` with reason
  `selected_for_another_agent`, naming the selected agent if the caller may see
  it.
- With **no selected agent**, any eligible agent may claim, as today.
- A person can change or clear the selected agent at any time (a work request
  is re-issued), but not while another agent holds a live claim — that stays a
  hand-off, as D-114 says.
- Claims stay **per task**. A parent's claim does not reserve its children:
  SPEC keeps children independent. To give a manager a whole programme, select
  that manager's agent on each child.
- Reads and comments are never blocked (unchanged).

**Consequences.** Fixes the case found on 2026-10-29: an agent could claim a
task selected for another agent, leaving the other agent's request open beside
the claim. A standalone harness can no longer pick up work a manager has been
given.

## Rollout

1. CORE: D-119's claim rule and the session's self-reported harness / version /
   model fields, with REST + MCP tests.
2. SHELL: the one-line agent name, the session line in the drawer and activity,
   the Details disclosure; both themes, 390 px.
3. Belka: register `Polly · Belka`; polly's workers use its credential; your
   direct Claude Code and Codex keep `Claude Code · Belka` / `Codex · Belka`.
4. Board: `Polly · Belka` selected on LAIKA-785 and on Belka's open children.
   Strelka's cards get Strelka's own agent when Strelka registers one.
