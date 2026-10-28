/**
 * The closed vocabularies from SPEC §4, in one place.
 *
 * Each is a `const` tuple so it serves three purposes at once: Drizzle's `enum`
 * option (which produces the TypeScript union), the SQL `CHECK` constraint that
 * enforces it in the database, and a runtime list for validation. Declaring them
 * once is what stops the three from drifting apart.
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * The org roles an owner grants capabilities to (D-102 rule 6, LAI-958) —
 * every role but `owner`, which holds them all and cannot lose one.
 */
export const GRANTABLE_ROLES = ['admin', 'member', 'viewer'] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

/**
 * What an owner may switch on or off per grantable role (§3, §4.58,
 * LAI-958). Which §3.1 actions each one carries is `policy/grants.ts`'s; this
 * is only the vocabulary `org_role_grants.capability`'s CHECK holds.
 */
export const CAPABILITIES = [
  'see_people_analytics',
  'see_org_activity',
  'open_all_projects',
  // *Manage people* split in two by D-104 item 6 (LAI-985); migration 0055
  // maps a stored `manage_people` onto both.
  'invite_people',
  'deactivate_people',
  'create_archive_projects',
  'manage_any_tokens',
  'change_org_settings',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Which of a person's analytics an owner or admin looked at (§4.59, D-102
 * rule 3, LAI-957): My day, their shared local activity, the profile's
 * heatmap, their tokens. One per read, never a count.
 */
export const ANALYTICS_VIEW_KINDS = ['time', 'local_activity', 'activity', 'usage'] as const;
export type AnalyticsViewKind = (typeof ANALYTICS_VIEW_KINDS)[number];

export const PROJECT_ROLES = ['lead', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_VISIBILITIES = ['public', 'private'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/**
 * A space's colour, the design's fixed palette (D-103 item 4, LAI-976): names,
 * not hex — the web app owns what each looks like in either theme.
 */
export const PROJECT_COLORS = [
  'black',
  'violet',
  'teal',
  'blue',
  'amber',
  'magenta',
  'red',
  'green',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/**
 * Who may create tasks in a space (D-103 item 6): its members, or its space
 * admins (`lead`) only. Viewers never may, so there is no `viewer` here.
 */
export const TASK_CREATE_MIN_ROLES = ['member', 'lead'] as const;
export type TaskCreateMinRole = (typeof TASK_CREATE_MIN_ROLES)[number];

/** SPEC §4.5 and §5. `backlog` is unrefined; `todo` is groomed. */
export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** How a row came to exist — the same enum on `tasks` and `comments` (§4.5, §4.7). */
export const CREATED_VIA = ['web', 'mcp', 'api', 'webhook', 'meeting'] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

/**
 * §4.8 and D-022. `user` = session cookie, `agent` = token-authenticated,
 * `system` = no human at all — cron (§11.6) or an inbound webhook (§10).
 *
 * `system` exists so that a null `actor_id` means "no person did this" rather
 * than "somebody forgot to set it". The `activity` check constraint ties the two
 * together in both directions; see the table definition.
 */
export const ACTOR_KINDS = ['user', 'agent', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * §4.8. Adding a type here is a schema change, deliberately — it rebuilds the
 * `activity` table's CHECK constraint.
 *
 * `project.updated`, `project.archived` and `member.removed` were added by
 * LAI-010; `task.dependency_removed` by LAI-011; `comment.edited` and
 * `comment.deleted` by LAI-110. Each task needs a verb for every mutation it
 * performs (§4.8: this table is the audit trail).
 */
export const ACTIVITY_TYPES = [
  'org.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.dependency_added',
  'task.dependency_removed',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
  'token.created',
  'token.revoked',
  'heartbeat.session',
  'webhook.commit',
  'webhook.received',
  'meeting.applied',
  // **Not `meeting.applied` with a flag, and not `meeting_review.expired`**
  // (LAI-454). A discard is a human reading a proposal set and saying no; an
  // expiry is nobody looking for seven days. §11.6's sweep writes the second,
  // so sharing a verb would make a rejected set look swept — opposite facts
  // about the same row, distinguishable only by a payload nobody filters on.
  //
  // §4.8's own test: could a reader answer "when did this happen?" without
  // inspecting a payload? "When was that meeting thrown away, and by whom?"
  // could not. The `unlisted.dismissed` precedent is the identical shape.
  //
  // **Ahead of §4.8's list**, carried by one `ACTIVITY_TYPE_EXEMPTIONS` entry
  // that LAI-168 retires (CLAUDE.md §4.4).
  'meeting_review.discarded',
  'unlisted.logged',
  // ## Growing this list never rewrites what is already written
  //
  // `activity` is append-only **in both directions**. Rows written before a verb
  // existed keep the verb they were written with, and a reader of old history
  // needs `payload.action` to interpret them.
  //
  // **The instinct to backfill — so that a `type` filter returns complete
  // history — is reasonable and wrong.** A partial history genuinely looks like
  // a bug, which is exactly why the temptation is worth naming here. But
  // rewriting rows to hide that the vocabulary was once wrong would break the
  // one property this table exists to have, and an audit trail that edits its
  // own past is not one. The honest cost of a late verb is that old rows keep
  // the old one.
  //
  // LAI-113. Three features filed their audit trail under a verb that did not
  // name them: sprints and the context document rode `project.updated`,
  // promotion and dismissal rode `unlisted.logged`. An audit reader filtering on
  // `type` — the obvious query, and what the §4.13 indexes are for — could not
  // see any of them.
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.tasks_changed',
  'project.context_updated',
  'unlisted.promoted',
  'unlisted.dismissed',
  // LAI-222. Deactivation is none of the `member.*` verbs: the user is not
  // removed and the row stays. `user.` rather than `member.` because `member.*`
  // is already written by both `invites.ts` and `projects.ts`, and these are
  // org-level rather than project membership.
  //
  // Two verbs, not one with a direction in the payload — unlike
  // `sprint.tasks_changed`, whose two directions answer the same reader
  // question. "Who was locked out, and when" and "who was let back in" are
  // different questions people actually ask separately.
  'user.deactivated',
  'user.reactivated',
  // D-104 item 3 (LAI-981): every session of a person ended without
  // deactivating them. Its own verb because "who was signed out, by whom" is
  // neither a lock-out nor a token being revoked.
  'user.signed_out',
  // D-104 item 2 (LAI-982): the one owner handed the organisation to somebody
  // else. One event for the three writes it makes, because "who owns this,
  // since when, and who handed it over" is one question.
  'org.ownership_transferred',
  // LAI-431. §4.8's own D-022 note already named these four as things the
  // in-process cron writes — "heartbeat pruning, stale-task flagging, invite and
  // meeting-review expiry" — while the list below had a verb for none of them.
  // The nullability rule was justified by rows the vocabulary made impossible.
  //
  // The nightly snapshot and the weekly vacuum are deliberately absent: that
  // note enumerates the cron's writers and does not include them, which is
  // right. A backup is not a change to the product's history.
  'heartbeat.pruned',
  'task.stale_flagged',
  'invite.expired',
  'meeting_review.expired',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TOKEN_SCOPES = ['full', 'read_only'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/**
 * A registered agent's status (§4.63, D-114). `revoked` is terminal: a revoked
 * agent's tokens are refused before any handler runs, and nothing reactivates it.
 */
export const AGENT_STATUSES = ['active', 'revoked'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * An agent's grant on one project (§4.64, D-114): the same two words a token's
 * scope uses, because it narrows the same way — `read_only` keeps the reads.
 */
export const AGENT_GRANT_SCOPES = TOKEN_SCOPES;
export type AgentGrantScope = TokenScope;

export const AI_PROVIDERS = ['anthropic', 'openai_compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * §4.12's statuses, **plus `discarded`** (LAI-454).
 *
 * §4.12 lists three; §6.4 specifies `POST /meeting-reviews/:id/discard`
 * — *"reject the whole set without applying anything"* — and there is no state
 * for the result. `expired` is the tempting home and the wrong one: it is what
 * §11.6's sweep writes when nobody looked, and a set a human rejected would
 * become indistinguishable from one nobody opened.
 *
 * **This value is ahead of §4.12 and nothing guards the gap.**
 * `schema-spec-drift.test.ts` compares column names and nullability, not the
 * values inside an enum column's prose. LAI-168 carries the §4.12 row and is
 * the only thing recording that this is owed.
 */
export const MEETING_REVIEW_STATUSES = [
  'pending',
  'applied',
  'discarded',
  // **A submission the provider was paid for and that produced nothing usable**
  // (D-057). Not `pending` with an empty proposal set: `{"proposals": []}` is a
  // legitimate answer — a meeting the model considered and had nothing to
  // propose about — so an empty row would make "the provider misbehaved" read
  // as "the meeting was unproductive". The status is the distinguisher, not the
  // emptiness.
  //
  // In §4.12's order, which is the order LAI-173's guard will compare.
  'expired',
  'failed',
] as const;
export type MeetingReviewStatus = (typeof MEETING_REVIEW_STATUSES)[number];

export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

/**
 * §4.1's `profile_kind` (D-078, LAI-743): what a member's profile shows, and
 * **nothing** about what they may do. `can()` never reads it.
 *
 * Not named for agents or tools: `users.test.ts` refuses any `users` column
 * that reads like a non-human account (`/bot|service|machine|agent|system/`),
 * and a person's kind of work is not one.
 */
export const PROFILE_KINDS = ['builder', 'manager'] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/**
 * §4.1's `local_activity_scope` (D-079, LAI-751): which repositories a
 * developer's collector counts in. `agent-repos` is every repository where
 * they run a connected agent on that machine; `laika-repos` narrows it to the
 * ones set up for Laika. The server cannot see a repository, so it stores the
 * choice and the collector honours it.
 */
export const LOCAL_ACTIVITY_SCOPES = ['agent-repos', 'laika-repos'] as const;
export type LocalActivityScope = (typeof LOCAL_ACTIVITY_SCOPES)[number];

/**
 * §4.26's `kind` (D-082, LAI-758): what one piece of an agent's proof is. The
 * branch and the pull request are items like a commit is, so each carries a
 * `state` of its own and step 2 (LAIKA-477) can confirm one without the rest.
 */
export const EVIDENCE_KINDS = ['commit', 'branch', 'pull_request', 'test_run'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * §4.26's `state` (D-082): `claimed` is what the agent said; `confirmed` and
 * `failed` are what something other than the agent found. Every item is
 * `claimed` today. The other two exist now so that the first confirmation
 * changes a row rather than the schema.
 */
export const EVIDENCE_STATES = ['claimed', 'confirmed', 'failed'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/**
 * §4.30's `kind` (D-083, LAI-766): the three GitHub events that report CI.
 * A GitHub Actions run sends all three for one commit, so the CI line counts
 * one kind per commit — the finest one seen — never the three added together.
 */
export const GITHUB_CHECK_KINDS = ['check_run', 'workflow_run', 'check_suite'] as const;
export type GithubCheckKind = (typeof GITHUB_CHECK_KINDS)[number];

/**
 * §4.30's `outcome` (D-083): GitHub's `status` and `conclusion` folded to the
 * three answers the proof needs. `pending` is everything not yet completed.
 */
export const CHECK_OUTCOMES = ['pending', 'passed', 'failed'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** §4.27's `decision` (D-082): what a person did with work waiting in review. */
export const REVIEW_DECISIONS = ['accepted', 'sent_back'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * §4.32's `level` (D-085, LAI-771): a task's size relative to its project's
 * typical task. Each level is double the last — weights 0.25 / 0.5 / 1 / 2 / 4
 * — because the honest error of a forecast here is about ×1.7, and a finer
 * scale would claim a precision the model does not have.
 */
export const SIZE_LEVELS = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type SizeLevel = (typeof SIZE_LEVELS)[number];

/**
 * §4.32's `source` (D-085): `model` is what Laika computed; `person` is a
 * size somebody set, or cleared, by hand.
 */
export const ESTIMATE_SOURCES = ['model', 'person'] as const;
export type EstimateSource = (typeof ESTIMATE_SOURCES)[number];

/**
 * §4.34's `confidence` (D-085 item 4, LAI-772): how sure the agent claiming a
 * task is that it will land as asked — the R&D's idea 15, Devin's green,
 * yellow and red. Scored against send-backs, per project, never per person.
 */
export const CLAIM_CONFIDENCES = ['green', 'yellow', 'red'] as const;
export type ClaimConfidence = (typeof CLAIM_CONFIDENCES)[number];

/**
 * §4.36's `scope` (LAI-773): what a token budget is for — one task, a
 * sprint's tasks over the sprint's days, or a project's tasks over a calendar
 * month. Set by a lead; soft, so nothing is ever refused for it.
 */
export const BUDGET_SCOPES = ['task', 'sprint', 'project'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/**
 * §4.37's `kind` (LAI-773): a budget crossed at 80% or 100%, or an agent that
 * kept spending past its task's p95 with nothing landing (`runaway`).
 */
export const TOKEN_ALERT_KINDS = ['budget', 'runaway'] as const;
export type TokenAlertKind = (typeof TOKEN_ALERT_KINDS)[number];

/**
 * §4.38's `source` (LAI-773): per-session token totals from the session
 * files a collector read, or from the OpenTelemetry metrics Claude Code sent
 * — the two are matched by session to fill the gap without counting twice.
 */
export const TOKEN_SESSION_SOURCES = ['files', 'telemetry'] as const;
export type TokenSessionSource = (typeof TOKEN_SESSION_SOURCES)[number];

/**
 * §4.41's `plan` (LAI-773, D-087): the subscription a developer says they are
 * on — a label for their own page. **No plan carries a token figure**: the
 * vendors state these limits as sessions and weeks, not tokens, so the limit
 * is always the developer's own number.
 */
export const PLAN_KINDS = ['claude-pro', 'claude-max-5x', 'claude-max-20x', 'other'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** §4.41's `window` (LAI-773): the stretch the developer's limit applies to. */
export const PLAN_WINDOWS = ['5h', 'day', 'week'] as const;
export type PlanWindow = (typeof PLAN_WINDOWS)[number];

/**
 * §4.45's `mode` (D-088 item 5, LAI-787): the organisation's *Time* setting.
 * `off` — no time is kept; `manual` — people type their own entries; `drafts`
 * — their collectors may also draft their day, for those who turned on
 * *Draft my time* themselves.
 */
export const TIME_MODES = ['off', 'manual', 'drafts'] as const;
export type TimeMode = (typeof TIME_MODES)[number];

/**
 * §4.47's `source` (LAI-787): a block a person's own collector drafted, or an
 * entry an agent proposed (D-088 item 13) — both private drafts until the
 * person confirms them.
 */
export const TIME_DRAFT_SOURCES = ['collector', 'agent'] as const;
export type TimeDraftSource = (typeof TIME_DRAFT_SOURCES)[number];

/**
 * §4.47's `state` (LAI-787): waiting for the person, confirmed into an entry,
 * or put away. A confirmed or dismissed draft stays until retention as a
 * tombstone, so the collector's next upload of that day cannot bring it back.
 */
export const TIME_DRAFT_STATES = ['pending', 'confirmed', 'dismissed'] as const;
export type TimeDraftState = (typeof TIME_DRAFT_STATES)[number];

/**
 * §4.48's `source` (D-088 item 2, LAI-787): what a confirmed entry came
 * from — a draft the person confirmed, one they typed, or one imported from
 * the billing record (LAI-788).
 */
export const TIME_ENTRY_SOURCES = ['draft', 'manual', 'import'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

/**
 * §4.48's `kind` (D-108, LAI-897; the design's eight since LAI-516): what a
 * typed entry was — building, a meeting, thinking — chosen by the person;
 * null for a confirmed draft, an import, or an entry nobody typed a kind
 * for. The Timeline colours a block by it. `work` is what the design calls
 * *Building*. Migration 0060 mapped the first list onto this one: call →
 * meeting, planning → thinking, learning → research, other → work.
 */
export const TIME_ENTRY_KINDS = [
  'work',
  'meeting',
  'thinking',
  'research',
  'pairing',
  'review',
  'support',
  'admin',
] as const;
export type TimeEntryKind = (typeof TIME_ENTRY_KINDS)[number];

/** §4.49's `change` (LAI-787): what a revision of an entry recorded. */
export const TIME_REVISION_CHANGES = ['created', 'edited', 'deleted'] as const;
export type TimeRevisionChange = (typeof TIME_REVISION_CHANGES)[number];

/**
 * §4.50's `kind` (D-088 item 8, LAI-787): Claude Code's `active_time` split —
 * `user` is time at the keyboard in Claude Code, `cli` the agent working.
 * Shown as agent minutes, never as hours.
 */
export const AGENT_TIME_KINDS = ['user', 'cli'] as const;
export type AgentTimeKind = (typeof AGENT_TIME_KINDS)[number];
