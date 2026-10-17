---
id: LAI-773
title: 'Token usage, phase 3: OpenTelemetry fallback, API-equivalent cost, budgets with soft alerts, runaway-agent alert, plan-limit forecast for the developer'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-772]
discovered-from:
status: backlog
---

## Goal

Close the gaps left by session files and turn usage into something teams can
act on. D-084 items 9–10; research: ~/Documents/laika-strategy/token-usage/REPORT.md and ~/Documents/laika-strategy/task-estimation/REPORT.md §9.

## Acceptance criteria

- [ ] Metrics-only OTLP receiver for Claude Code telemetry (`claude_code.token.usage`) as a fallback source, deduplicated against session-file counts; no outbound calls.
- [ ] API-equivalent cost from a dated per-model price table in code, admin-editable, labelled "API-equivalent, not your bill"; cost per accepted task by project and agent.
- [ ] Budgets per task (p80), sprint or project with soft alerts at 80% and 100%.
- [ ] Runaway-agent alert: a claimed task past p95 tokens with no commit or heartbeat progress notifies the assignee first.
- [ ] Plan-limit forecast visible only to the developer.
- [ ] Cache efficiency per project.
- [ ] Root gate exit 0 on all three.

## Notes / context

- Owner-direct. No new dependencies without naming them here first.
