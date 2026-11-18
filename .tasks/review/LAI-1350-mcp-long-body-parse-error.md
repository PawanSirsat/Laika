---
id: LAI-1350
title: 'MCP: long add_comment and finish_task bodies fail with -32700; log the cause and fix it'
area: server
assignee: core
priority: p1
depends-on: []
status: review
finished: 2026-11-18T21:27:05Z
started: 2026-11-18T21:09:35Z
---

## Goal

Agents' `add_comment` and `finish_task` calls with bodies over about 2–3.5 KB sometimes fail with JSON-RPC `-32700 Parse error: Invalid JSON`. The workaround in use is posting about 1.5 KB numbered pieces.

- It isn't the 1 MiB body limit, which answers 413.
- It isn't a zod cap, which gives a tool error.
- The leading hypothesis is unconfirmed: a proxy counts `Content-Length` in characters rather than bytes, so bodies with non-ASCII text (`—`, `’`, `→`) are cut short, and `@hono/node-server` then can't parse them.

LAI-1302 makes these bodies longer (outputs with captions), so this goes first.

## Acceptance criteria

- [x] **Log it:** the MCP transport sets `onerror`, and a `-32700` is logged with the body's declared versus received length and the client. The body itself is never logged.
- [x] **Reproduce it** against Ksage through its real proxy (Coolify/Traefik): a `finish_task` of 8 KB or more containing `—`, `’`, `→` and emoji. Record the root cause, with evidence, in the task log.
- [ ] **Fix the cause,** wherever it is: server, proxy configuration, or client bridge (`cli/src/agent-mcp-bridge.ts`). If the fix is outside this repo, write the exact change for CHIEF to apply.
- [x] **Regression test:** a route test sends a large multi-byte `/mcp` body and gets a normal tool result.
- [ ] **Live check:** after release, a 10 KB non-ASCII `finish_task` succeeds on Ksage.

## Notes / context

- The MCP SDK sends `-32700` from `webStandardStreamableHttp.js` (:489-493, :507-508, :698).
- The server doesn't log the cause today: `transport.onerror` is unset, and `logger.ts` logs only path, status and duration.
- Ksage's routing for `/api`, `/mcp` and `/webhooks` lives in KvellDynamics/ksage-2.0 and Coolify, not here.
- Memory note: "Laika MCP long body parse error".

## Builder notes (core, review)

- **Reproduce it:** done. The attempt didn't fail on Ksage at any size. There
  were 8–47 KB `finish_task` calls with — ’ → and emoji, through Node fetch,
  through the bridge and through Claude Code's own client. The evidence is in
  `logs/core-2026-11-18-LAI-1350.md`.
- **Fix the cause:** left unticked. The hypothesis is refuted by measurement:
  Claude Code, the bridge and the legacy polly bridge all send `Content-Length`
  in bytes, and Traefik passes every body whole. The reported failures were on
  the old AWS board (plain HTTP straight to Node), which is retired and whose
  11-17 logs are gone. There is no proxy or bridge change to make. What ships
  is the server side: the body is read and measured before the SDK sees it, and
  every refusal is logged with both lengths, the client and a `reason`. If it
  happens again, the first occurrence names its cause.
- **Live check:** left unticked. It runs after release.

