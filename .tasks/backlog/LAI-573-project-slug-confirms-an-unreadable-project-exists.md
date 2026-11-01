---
id: LAI-573
title: 'A project slug the caller cannot read answers forbidden while an unknown slug answers not_found, so the slug confirms the project exists'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-535
status: backlog
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.
**Filed, not implemented** — a decision comes first.

## Goal

Asking about a project the caller cannot read gives the same answer as asking
about one that does not exist.

## Found (Codex review of LAI-535, PR #105, 2026-10-28)

The common shape, `server/src/services/projects.ts:537-541` (`getProject`,
`GET /api/v1/projects/:slug`):

```ts
const row = requireProjectBySlug(db, slug);                                  // 404 not_found if unknown
assertCan(withProject(actor, row.id), 'project.read', { projectId: row.id }); // 403 forbidden if unreadable
```

So a real project the caller cannot read answers `403 forbidden` (for an agent
token, `reason: agent_not_granted`), and a made-up slug answers `404
not_found`. The difference confirms the project exists. Slugs are short and
human-chosen, so they are guessable.

LAI-535 closed this for its own surface only: `GET /agents/me/work-requests?project=`
and the agent path of MCP `list_ready_tasks` resolve the slug inside the
readable set and give one refusal for both cases
(`services/work-requests.ts`, `noSuchProjectForAgent`).

### Every call site with the same shape (census, untruncated)

`grep -rn "requireProjectBySlug(" server/src` at LAI-535 head `fe4ff739`
returns **37** call sites besides the definition. Each looks the slug up
before asking `can()`. **Each needs checking**: some are admin or write paths
whose own refusal comes first, and `joinPublicProject` may disclose a
`public` project deliberately (§3.1 *Join a public project*).

| file:line | function |
| --- | --- |
| `server/src/mcp/read-tools.ts:528` | `get_project_context` (MCP tool) |
| `server/src/http/routes/events.ts:83` | `GET /api/v1/events?project=` |
| `server/src/services/time-solidtime.ts:1236` | `setSolidtimeProjects` |
| `server/src/services/token-budgets.ts:469` | `getProjectBudgets` |
| `server/src/services/token-budgets.ts:588` | `setProjectBudget` |
| `server/src/services/estimates.ts:1710` | `getEstimateAccuracy` |
| `server/src/services/projects.ts:538` | `getProject` |
| `server/src/services/projects.ts:640` | `updateProject` |
| `server/src/services/projects.ts:769` | `getProjectContext` |
| `server/src/services/projects.ts:786` | `updateProjectContext` |
| `server/src/services/projects.ts:853` | `listMembers` |
| `server/src/services/projects.ts:912` | `addMember` |
| `server/src/services/projects.ts:950` | `changeMemberRole` |
| `server/src/services/projects.ts:988` | `removeMember` |
| `server/src/services/projects.ts:1044` | `leaveProject` |
| `server/src/services/projects.ts:1148` | `joinPublicProject` |
| `server/src/services/mentions.ts:117` | `mentionableUsers` |
| `server/src/services/time-entries.ts:141` | `resolveTarget` |
| `server/src/services/activity.ts:94` | `listProjectActivity` |
| `server/src/services/activity.ts:185` | `listOrgHistory` |
| `server/src/services/project-statuses.ts:211` | `listProjectStatuses` |
| `server/src/services/project-statuses.ts:228` | `assertCanEditStatuses` |
| `server/src/services/project-statuses.ts:251` | `createProjectStatus` |
| `server/src/services/project-statuses.ts:321` | `updateProjectStatus` |
| `server/src/services/project-statuses.ts:375` | `reorderProjectStatuses` |
| `server/src/services/project-statuses.ts:425` | `deleteProjectStatus` |
| `server/src/services/token-usage.ts:1088` | `getUsage` |
| `server/src/services/sprints.ts:201` | `listSprints` |
| `server/src/services/sprints.ts:259` | `sprintTaskCounts` |
| `server/src/services/sprints.ts:359` | `createSprint` |
| `server/src/services/tasks.ts:793` | `createTask` |
| `server/src/services/tasks.ts:932` | `listTasks` |
| `server/src/services/tasks.ts:1106` | `allTasksScope` |
| `server/src/services/metrics.ts:103` | `projectMetrics` |
| `server/src/services/tags.ts:144` | `listProjectTags` |
| `server/src/services/tags.ts:273` | `renameTag` |
| `server/src/services/tags.ts:323` | `deleteTag` |

The id-keyed siblings have the same shape: `projectSlugById`
(`server/src/services/projects.ts:183-189`, two callers) answers `404` for an
unknown id and `403` for an unreadable one. A **task** asked for by board key
is the same problem one level down, and is **LAI-856**'s.

## The trade-off, for the owner

**Unifying changes client-visible responses.** Today a member asking for a
project they are not on gets `403 forbidden`. After the change they would get
`404 not_found`, or else an unknown slug would get `403`. Either way:

- The SPA's error states may branch on 403 vs 404, for example "ask to join"
  vs "no such space". `server/web/` (SHELL) needs checking, and may need a
  matching change.
- `joinPublicProject` and the public-project listing exist precisely so a
  member can find a `public` project they are not on. Unifying must not hide
  those, so `public` visibility may be the exception.
- Agents and scripts that read the code would see a different answer for the
  same request.
- §6.3 and SPEC do not say which answer an unreadable project gets. LAI-856
  found the same gap for tasks.

## Acceptance criteria

- [ ] **Decision first.** CHIEF and the owner decide, together with LAI-856,
      what an unreadable project answers asked by slug or id: `not_found`,
      identical to an unknown one, or `forbidden`, kept on purpose. The answer
      covers `public` projects and is written into SPEC §6.3.
- [ ] If unified: every call site above answers a real-but-unreadable and a
      made-up slug identically (status, code and body), with a regression per
      route family that asserts byte-identical bodies for the same caller.
- [ ] Any `server/web/` change the decision needs is filed for SHELL.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
