/**
 * The client's types must not fall behind the server's (LAI-213).
 *
 * ## Why this exists
 *
 * **Six times now the server has sent a field the client could not see**, and
 * every one was found by accident while building something else:
 *
 * | field | served since | found while doing |
 * | --- | --- | --- |
 * | `Task.sprint_id` | LAI-011 | LAI-089 |
 * | `TaskFilter.sprint` | LAI-011 | LAI-089 |
 * | `Project.repo` | LAI-108 | LAI-076 |
 * | `Project.task_counts` + 4 more | LAI-053 | LAI-046 |
 * | `Task.tags` | LAI-079 | LAI-066 |
 * | `Task.comment_count` | LAI-072 | LAI-066 |
 *
 * **Nothing failed in any of them.** No error, no test, no type complaint — the
 * data arrived and was invisible, which looks exactly like the feature not
 * existing. That is the worst shape of defect available: it is indistinguishable
 * from "not built yet", so nobody investigates.
 *
 * The existing drift checks do not cover this. LAI-051 and LAI-080 compare
 * SPEC §4 to `schema.ts`; LAI-211 pins one function's contract. Nothing compared
 * the server's **view types** to the client's **declarations** until now.
 *
 * ## Where it lives, and why
 *
 * In `web/test/`, reading `server/src/services/`. That is the consumer guarding
 * its own dependency — D-030's rule, which CLAUDE.md keeps past its original
 * example: *a cross-ownership dependency is allowed, an unguarded one is not.*
 * The web client depends on shapes Builder-A owns under D-016, so the guard
 * belongs with the side that breaks.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { fieldsOf } from '../helpers/interfaces.ts';

interface Pair {
  /** The server's view type, and the module that declares it. */
  readonly server: string;
  readonly serverFile: string;
  /** The client's interface, and its module. Names differ where they differ. */
  readonly client: string;
  readonly clientFile: string;
  /**
   * Fields the client deliberately does not declare, each with a reason.
   *
   * The same shape as `WEB_NO_MIRROR_REQUIRED` in `structure.test.ts`, and for
   * the same reason: **a deliberate omission is fine, a silent one is not.**
   * A list to keep short — an entry here is a field the UI cannot use.
   */
  readonly clientOmits?: Readonly<Record<string, string>>;
}

const PAIRS: readonly Pair[] = [
  {
    // LAI-739, replacing LAI-266's BoardColumn pair: one board column is one
    // project status now. Paired the moment the client type existed, for the
    // reason the old pair gave — the next field hung off a status could be
    // served and never seen.
    server: 'ProjectStatusView',
    serverFile: 'services/project-statuses.ts',
    client: 'ProjectStatus',
    clientFile: 'statuses.ts',
  },
  {
    // Only the `*View`. `ApplyReviewResult` and `ProposalView` are the shapes
    // that matter most on this screen and **neither can be paired here**: the
    // census derives served types from `*View` exports and `c.json<…>`, so a
    // pair naming anything else turns `PAIRS names a server type that no longer
    // exists` red. Same wall as `PresenceEntry` in LAI-439, and the same answer
    // — `meeting-reviews.test.ts` compares those two directly, and checks
    // optionality, which this check cannot see either.
    server: 'MeetingReviewView',
    serverFile: 'services/meeting-reviews.ts',
    client: 'MeetingReview',
    clientFile: 'meeting-reviews.ts',
  },
  {
    // Paired the moment the mirror existed (LAI-439). The census listed both as
    // "no client type exists"; creating the client type is what made that reason
    // false, so the rows came out of `UNPAIRED` in the same change.
    //
    // **Only the envelopes are here, and that is not enough on its own.** These
    // two carry `enabled` and a list — everything that matters about presence is
    // in `PresenceEntry`, which the census does not count as a served type
    // (it is nested, and not a `*View`), so pairing it here turns
    // `PAIRS names a server type that no longer exists` red.
    //
    // `presence.test.ts` covers the entries instead, and goes further than
    // this check can: **`fieldsOf` matches `name\??\s*:`, so optional and
    // required are the same field to it** — and `repo?` versus `repo` is the
    // entire LAI-438 distinction.
    server: 'PresenceView',
    serverFile: 'services/presence.ts',
    client: 'PresenceView',
    clientFile: 'presence.ts',
  },
  {
    server: 'CapacityView',
    serverFile: 'services/presence.ts',
    client: 'CapacityView',
    clientFile: 'presence.ts',
  },
  {
    // Paired the moment the mirror existed (LAI-459), the same way the presence
    // rows were. Both are real `*View` exports, so neither hits the census wall
    // that kept `PresenceEntry` and `ProposalView` out of this table.
    //
    // **`fieldsOf` cannot see optionality**, and `ai?` is the whole of §12's
    // field-level gate — `org.test.ts` checks that separately, because a client
    // declaring `ai` required would typecheck against a Viewer's response and
    // then read `undefined.configured` at runtime.
    server: 'OrgView',
    serverFile: 'services/orgs.ts',
    client: 'Org',
    clientFile: 'org.ts',
  },
  // The organisation's pulse (LAI-986's endpoint, LAI-989's tiles), paired the
  // moment the mirror existed. The server's census listed it in UNPAIRED until
  // then; that entry is stale from this commit (CLAUDE.md §4.4).
  {
    server: 'OrgOverviewView',
    serverFile: 'services/org-overview.ts',
    client: 'OrgOverview',
    clientFile: 'org.ts',
  },
  // What a transfer of ownership answers (LAI-982), paired by LAI-999 when the
  // People tab's Transfer ownership started reading it. The server's census
  // listed it in UNPAIRED until then; that entry goes in the same change.
  {
    server: 'OwnershipTransferView',
    serverFile: 'services/users.ts',
    client: 'OwnershipTransfer',
    clientFile: 'org.ts',
  },
  {
    server: 'OrgAiView',
    serverFile: 'services/orgs.ts',
    client: 'OrgAi',
    clientFile: 'org.ts',
  },
  // The GitHub webhook block and the one answer that carries the secret
  // (LAI-753), paired the moment the client existed.
  {
    server: 'OrgGithubWebhookView',
    serverFile: 'services/orgs.ts',
    client: 'OrgGithubWebhook',
    clientFile: 'org.ts',
  },
  {
    server: 'GithubWebhookSecretView',
    serverFile: 'services/orgs.ts',
    client: 'GithubWebhookSecret',
    clientFile: 'org.ts',
  },
  {
    server: 'AcceptedInviteBody',
    serverFile: 'http/routes/invites.ts',
    client: 'AcceptedInvite',
    clientFile: 'invites.ts',
  },
  {
    server: 'CreatedInviteBody',
    serverFile: 'http/routes/invites.ts',
    client: 'CreatedInvite',
    clientFile: 'invites.ts',
  },
  {
    server: 'CreatedTokenBody',
    serverFile: 'http/routes/tokens.ts',
    client: 'CreatedToken',
    clientFile: 'tokens.ts',
  },
  {
    server: 'HealthBody',
    serverFile: 'http/routes/health.ts',
    client: 'Health',
    clientFile: 'health.ts',
  },
  {
    server: 'InvitePreview',
    serverFile: 'services/invites.ts',
    client: 'InvitePreview',
    clientFile: 'invites.ts',
  },
  {
    server: 'InviteView',
    serverFile: 'services/invites.ts',
    client: 'PendingInvite',
    clientFile: 'invites.ts',
  },
  {
    server: 'MeProfile',
    serverFile: 'services/me.ts',
    client: 'MeProfile',
    clientFile: 'me.ts',
  },
  {
    server: 'ProjectContextView',
    serverFile: 'services/projects.ts',
    client: 'ProjectContext',
    clientFile: 'project-context.ts',
  },
  // The context document's history (§4.68, LAI-555), as LAI-556 reads it.
  // Their `no client type exists` exemptions in
  // `server/test/tooling/response-type-coverage.test.ts` left in the same
  // commit (a named crossing CHIEF authorised).
  {
    server: 'ContextRevisionSummaryView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextRevisionSummary',
    clientFile: 'project-context.ts',
  },
  {
    server: 'ContextRevisionView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextRevision',
    clientFile: 'project-context.ts',
  },
  {
    server: 'ContextDiffView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextDiff',
    clientFile: 'project-context.ts',
  },
  // Who each revision was delivered to (LAI-1003), as History's *Delivered
  // to* reads it (LAI-1004). Their self-expiring `no client type exists`
  // entries in `server/test/tooling/response-type-coverage.test.ts` leave in
  // the same commit (§4.4 step 2).
  {
    server: 'ContextDeliveriesView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextDeliveries',
    clientFile: 'project-context.ts',
  },
  {
    server: 'ContextDeliveryView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextDelivery',
    clientFile: 'project-context.ts',
  },
  {
    server: 'ContextDeliveryAgentView',
    serverFile: 'services/context-revisions.ts',
    client: 'ContextDeliveryAgent',
    clientFile: 'project-context.ts',
  },
  {
    server: 'SetupResultBody',
    serverFile: 'http/routes/setup.ts',
    client: 'SetupResult',
    clientFile: 'setup.ts',
  },
  {
    server: 'SetupStatusBody',
    serverFile: 'http/routes/setup.ts',
    client: 'SetupStatus',
    clientFile: 'setup.ts',
  },
  {
    server: 'TagView',
    serverFile: 'services/tags.ts',
    client: 'ProjectTag',
    clientFile: 'tags.ts',
  },
  {
    server: 'TokenView',
    serverFile: 'services/tokens.ts',
    client: 'TokenView',
    clientFile: 'tokens.ts',
  },
  {
    server: 'UnlistedView',
    serverFile: 'services/unlisted.ts',
    client: 'UnlistedWork',
    clientFile: 'unlisted.ts',
  },
  {
    server: 'TaskView',
    serverFile: 'services/tasks.ts',
    client: 'Task',
    clientFile: 'tasks.ts',
  },
  // LAI-795: the slim list's shape, which every list in the app holds. Paired
  // on its own, because the pair above compares both sides with the texts
  // folded in and cannot see a field on one side's summary that the other has
  // in its full half.
  {
    server: 'TaskSummaryView',
    serverFile: 'services/tasks.ts',
    client: 'TaskSummary',
    clientFile: 'tasks.ts',
  },
  // LAI-593: the live claim nested in both task views (LAI-568). The task
  // pairs above see `claim` and nothing inside it, so a field added to the
  // claim — the session's harness, version and model — was served unseen.
  {
    server: 'TaskLiveClaimView',
    serverFile: 'services/claims.ts',
    client: 'TaskLiveClaim',
    clientFile: 'tasks.ts',
  },
  // LAI-1005: the saves-and-hand-off summary nested in both task views. The
  // task pairs see `handoff` and nothing inside it (LAI-1006).
  {
    server: 'TaskHandoffView',
    serverFile: 'services/task-handoff.ts',
    client: 'TaskHandoff',
    clientFile: 'tasks.ts',
  },
  // LAI-549: a task's saves and hand-off offers, as the drawer reads them
  // (LAI-545, LAI-546). The ref is paired on its own because the checkpoint
  // pair sees `refs` and nothing inside it.
  {
    server: 'CheckpointView',
    serverFile: 'services/checkpoints.ts',
    client: 'Checkpoint',
    clientFile: 'handoffs.ts',
  },
  {
    server: 'CheckpointRefView',
    serverFile: 'services/checkpoints.ts',
    client: 'CheckpointRef',
    clientFile: 'handoffs.ts',
  },
  {
    server: 'HandoffOfferView',
    serverFile: 'services/handoffs.ts',
    client: 'HandoffOffer',
    clientFile: 'handoffs.ts',
  },
  // LAI-550: the Inbox's Hand-offs tab (LAI-1009's person inbox) and the
  // Access tab's hand-off policy.
  {
    server: 'PersonHandoffView',
    serverFile: 'services/handoffs.ts',
    client: 'PersonHandoffView',
    clientFile: 'handoffs.ts',
  },
  {
    server: 'PersonHandoffInbox',
    serverFile: 'services/handoffs.ts',
    client: 'PersonHandoffInbox',
    clientFile: 'handoffs.ts',
  },
  {
    server: 'HandoffPolicyView',
    serverFile: 'services/handoffs.ts',
    client: 'HandoffPolicyWire',
    clientFile: 'handoffs.ts',
  },
  // LAI-975: `GET /tasks/summary`'s figures (LAI-974), which the Work page's
  // strip draws.
  {
    server: 'TaskCountsView',
    serverFile: 'services/tasks.ts',
    client: 'TasksSummary',
    clientFile: 'tasks.ts',
  },
  // D-085, LAI-771: sizes and forecasts — the size on every task, the task
  // panel's estimate, and the project's accuracy.
  {
    server: 'SizeView',
    serverFile: 'services/estimates.ts',
    client: 'TaskSize',
    clientFile: 'estimates.ts',
  },
  {
    server: 'TaskEstimateView',
    serverFile: 'services/estimates.ts',
    client: 'TaskEstimate',
    clientFile: 'estimates.ts',
  },
  {
    server: 'EstimateAccuracyView',
    serverFile: 'services/estimates.ts',
    client: 'EstimateAccuracy',
    clientFile: 'estimates.ts',
  },
  // LAI-772: the token forecast, what a claimant said, and the sprint forecast.
  {
    server: 'TokenForecastView',
    serverFile: 'services/estimates.ts',
    client: 'TokenForecast',
    clientFile: 'estimates.ts',
  },
  {
    server: 'ClaimEstimateView',
    serverFile: 'services/estimates.ts',
    client: 'ClaimEstimate',
    clientFile: 'estimates.ts',
  },
  {
    server: 'SprintForecastView',
    serverFile: 'services/sprint-forecast.ts',
    client: 'SprintForecast',
    clientFile: 'sprints.ts',
  },
  {
    // `ProjectSummary extends ProjectView` — the list endpoint serves the
    // derived shape, which is what the client mirrors.
    //
    // **This entry covers `ProjectView` too, and there must not be a second one
    // for it** (LAI-160). `fieldsOf` resolves `extends`, so every `ProjectView`
    // field is already compared here. Pairing `ProjectView` → `Project`
    // separately asserts that the *base* type sends `task_counts`,
    // `member_count`, `blocked_count`, `members` and `last_activity_at` — which
    // it does not and must not; they are the five the summary derives.
    //
    // LAI-444's census listed `ProjectView` as unpaired because it looks for the
    // literal name in this table. **Coverage here is transitive and the census
    // cannot see that**, which is worth knowing before trusting its count.
    server: 'ProjectSummary',
    serverFile: 'services/projects.ts',
    client: 'Project',
    clientFile: 'projects.ts',
  },
  {
    // The list item, not the bare view (LAI-721): the client's `Sprint`
    // declares `task_counts`, which only the list sends — so pairing it with
    // `SprintView` would call the field undeclared on the server side.
    // `SprintListView extends SprintView`, so every view field is still here.
    // Its `task_counts` object is not paired on its own, as `ProjectSummary`'s
    // is not: the server census counts served `*View` types, and the nested
    // shape is not one.
    server: 'SprintListView',
    serverFile: 'services/sprints.ts',
    client: 'Sprint',
    clientFile: 'sprints.ts',
  },

  {
    server: 'MemberView',
    serverFile: 'services/projects.ts',
    client: 'Member',
    clientFile: 'tasks.ts',
  },
  {
    server: 'UserView',
    serverFile: 'services/users.ts',
    client: 'OrgUser',
    clientFile: 'users.ts',
  },
  // The person admin panel's reads and writes (D-104, LAI-988).
  {
    server: 'MembershipView',
    serverFile: 'services/users.ts',
    client: 'PersonMembership',
    clientFile: 'users.ts',
  },
  {
    server: 'SignOutView',
    serverFile: 'services/users.ts',
    client: 'SignOutView',
    clientFile: 'users.ts',
  },
  {
    server: 'ResetLinkView',
    serverFile: 'http/routes/users.ts',
    client: 'ResetLinkView',
    clientFile: 'users.ts',
  },
  {
    server: 'PasswordResetView',
    serverFile: 'services/password-resets.ts',
    client: 'PasswordResetView',
    clientFile: 'password-resets.ts',
  },
  {
    server: 'CommentView',
    serverFile: 'services/comments.ts',
    client: 'Comment',
    clientFile: 'comments.ts',
  },
  {
    server: 'EventView',
    serverFile: 'services/events.ts',
    client: 'ActivityEvent',
    clientFile: 'activity.ts',
  },
  /*
   * The member profile (LAI-743), paired the moment the client existed.
   * `ProfileView`'s three builder-only blocks are optional on both sides;
   * `fieldsOf` cannot see that, and `member-profile.test.ts` renders a manager
   * without them.
   */
  {
    server: 'ProfileView',
    serverFile: 'services/profiles.ts',
    client: 'MemberProfile',
    clientFile: 'profiles.ts',
  },
  {
    server: 'RatingView',
    serverFile: 'services/profiles.ts',
    client: 'MemberRating',
    clientFile: 'profiles.ts',
  },
  /*
   * The heatmap and the developer's side of D-079 (LAI-751), paired the
   * moment the client existed.
   */
  {
    server: 'PeopleActivityView',
    serverFile: 'services/people-activity.ts',
    client: 'PeopleActivity',
    clientFile: 'people-activity.ts',
  },
  {
    server: 'ActivitySharingView',
    serverFile: 'services/local-activity.ts',
    client: 'ActivitySharing',
    clientFile: 'local-activity.ts',
    clientOmits: {
      usage_days_elsewhere:
        'Sent only to a collector that names its collector_id (LAI-769 review 1); the web app never asks with one.',
      task_prefixes:
        'Sent only to a collector that names its collector_id (LAI-770), for the keys in a branch; the web app never asks with one.',
    },
  },
  {
    server: 'OwnLocalActivityView',
    serverFile: 'services/local-activity.ts',
    client: 'OwnLocalActivity',
    clientFile: 'local-activity.ts',
  },
  {
    // Who looked at a person's analytics (D-102 rule 3, LAI-957), paired the
    // moment My day listed it (LAI-959).
    server: 'WhoLookedView',
    serverFile: 'services/analytics-views.ts',
    client: 'WhoLooked',
    clientFile: 'people-analytics.ts',
  },
  /*
   * The review gate (D-082, LAI-758), paired the moment the client existed.
   * `ReviewQueueView.tasks` and `TaskRoundsView.rounds` hold the nested
   * shapes paired through the table below, for the profile's reason.
   */
  {
    server: 'TaskRoundsView',
    serverFile: 'services/rounds.ts',
    client: 'TaskRounds',
    clientFile: 'review.ts',
  },
  {
    server: 'RoundView',
    serverFile: 'services/rounds.ts',
    client: 'Round',
    clientFile: 'review.ts',
  },
  {
    server: 'RoundAgentView',
    serverFile: 'services/rounds.ts',
    client: 'RoundAgent',
    clientFile: 'review.ts',
  },
  {
    server: 'SendBackView',
    serverFile: 'services/rounds.ts',
    client: 'SendBack',
    clientFile: 'review.ts',
  },
  {
    server: 'ReviewQueueView',
    serverFile: 'services/review.ts',
    client: 'ReviewQueue',
    clientFile: 'review.ts',
  },
  ...(
    [
      ['ReviewQueueItem', 'services/review.ts'],
      ['EvidenceItem', 'services/rounds.ts'],
      ['CommitEvidence', 'services/rounds.ts'],
      ['BranchEvidence', 'services/rounds.ts'],
      ['PullRequestEvidence', 'services/rounds.ts'],
      ['TestEvidence', 'services/rounds.ts'],
      // GitHub's CI line on a round (D-083, LAI-766).
      ['RoundCi', 'services/github-proof.ts'],
    ] as const
  ).map(([name, serverFile]) => ({
    server: name,
    serverFile,
    client: name,
    clientFile: 'review.ts',
  })),
  /*
   * Token usage (D-084, LAI-769), paired the moment the client existed: the
   * Usage page and the profile card.
   */
  {
    server: 'UsageView',
    serverFile: 'services/token-usage.ts',
    client: 'Usage',
    clientFile: 'usage.ts',
  },
  {
    server: 'PersonUsageView',
    serverFile: 'services/token-usage.ts',
    client: 'PersonUsage',
    clientFile: 'usage.ts',
  },
  // The task panel's Tokens section (LAI-770).
  {
    server: 'TaskUsageView',
    serverFile: 'services/token-usage.ts',
    client: 'TaskUsage',
    clientFile: 'usage.ts',
  },
  /*
   * Token usage, phase 3 (LAI-773), paired the moment each client existed:
   * budgets and the runaway banner, a person's alerts, their plan limit, and
   * the API-equivalent price table.
   */
  {
    server: 'BudgetView',
    serverFile: 'services/token-budgets.ts',
    client: 'Budget',
    clientFile: 'budgets.ts',
  },
  {
    server: 'RunawayView',
    serverFile: 'services/token-budgets.ts',
    client: 'Runaway',
    clientFile: 'budgets.ts',
  },
  {
    server: 'TokenAlertView',
    serverFile: 'services/token-budgets.ts',
    client: 'TokenAlert',
    clientFile: 'token-alerts.ts',
  },
  {
    server: 'PlanLimitView',
    serverFile: 'services/plan-limit.ts',
    client: 'PlanLimit',
    clientFile: 'plan-limit.ts',
  },
  {
    server: 'ModelPricesView',
    serverFile: 'services/org-model-prices.ts',
    client: 'ModelPrices',
    clientFile: 'model-prices.ts',
  },
  // Who can do what (LAI-958's endpoint, LAI-960's grid), paired the moment the
  // mirror existed. The server's census listed all three in UNPAIRED until
  // then; those three entries are stale from this commit (CLAUDE.md §4.4).
  {
    server: 'OrgPermissionsView',
    serverFile: 'services/org-permissions.ts',
    client: 'OrgPermissions',
    clientFile: 'permissions.ts',
  },
  {
    server: 'CapabilityView',
    serverFile: 'services/org-permissions.ts',
    client: 'Capability',
    clientFile: 'permissions.ts',
  },
  {
    server: 'OwnerLockedView',
    serverFile: 'services/org-permissions.ts',
    client: 'OwnerLocked',
    clientFile: 'permissions.ts',
  },
  // A person's own time (LAI-787, D-088), paired the moment the mirror existed.
  {
    server: 'TimeSettingsView',
    serverFile: 'services/time-settings.ts',
    client: 'TimeSettings',
    clientFile: 'time.ts',
  },
  {
    server: 'TimeDraftView',
    serverFile: 'services/time-drafts.ts',
    client: 'TimeDraft',
    clientFile: 'time.ts',
  },
  {
    server: 'TimeEntryView',
    serverFile: 'services/time-entries.ts',
    client: 'TimeEntry',
    clientFile: 'time.ts',
  },
  {
    server: 'TimeRevisionView',
    serverFile: 'services/time-entries.ts',
    client: 'TimeRevision',
    clientFile: 'time.ts',
  },
  {
    server: 'MyDayView',
    serverFile: 'services/my-day.ts',
    client: 'MyDay',
    clientFile: 'time.ts',
  },
  {
    server: 'SignalTimesView',
    serverFile: 'services/time-drafts.ts',
    client: 'SignalTimes',
    clientFile: 'time.ts',
  },
  // Its two nested shapes, which the server's census counts as served views.
  {
    server: 'AgentDayView',
    serverFile: 'services/agent-time.ts',
    client: 'MyDayAgent',
    clientFile: 'time.ts',
  },
  {
    server: 'WeekDayView',
    serverFile: 'services/my-day.ts',
    client: 'MyDayWeekDay',
    clientFile: 'time.ts',
  },
  // Overview over a stretch of days (LAI-526).
  {
    server: 'TimeSummaryView',
    serverFile: 'services/time-summary.ts',
    client: 'TimeSummary',
    clientFile: 'time.ts',
  },
  {
    server: 'SummaryDayView',
    serverFile: 'services/time-summary.ts',
    client: 'SummaryDay',
    clientFile: 'time.ts',
  },
  {
    server: 'SummaryProjectView',
    serverFile: 'services/time-summary.ts',
    client: 'SummaryProject',
    clientFile: 'time.ts',
  },
  {
    server: 'SummaryTaskView',
    serverFile: 'services/time-summary.ts',
    client: 'SummaryTask',
    clientFile: 'time.ts',
  },
  {
    server: 'SummaryKindView',
    serverFile: 'services/time-summary.ts',
    client: 'SummaryKind',
    clientFile: 'time.ts',
  },
  // The day's note (LAI-501), served in the day and by `PUT /me/time/days/:day/note`.
  {
    server: 'DayNoteView',
    serverFile: 'services/time-day-notes.ts',
    client: 'DayNote',
    clientFile: 'time.ts',
  },
  // The running timer (LAI-500), served in the day and by `POST /me/time/timer`.
  {
    server: 'TimerView',
    serverFile: 'services/time-timer.ts',
    client: 'Timer',
    clientFile: 'time.ts',
  },
  // A gap waved away (LAI-831), served in the day and by `POST /me/time-breaks`.
  {
    server: 'TimeBreakView',
    serverFile: 'services/time-breaks.ts',
    client: 'TimeBreak',
    clientFile: 'time.ts',
  },
  // LAI-564: the registered agents LAI-537's Agents tab mirrors (D-114).
  {
    server: 'AgentView',
    serverFile: 'services/agents.ts',
    client: 'RegisteredAgent',
    clientFile: 'agents.ts',
  },
  {
    server: 'AgentGrantView',
    serverFile: 'services/agents.ts',
    client: 'AgentGrant',
    clientFile: 'agents.ts',
  },
  {
    server: 'CreatedAgentToken',
    serverFile: 'services/agents.ts',
    client: 'CreatedAgentToken',
    clientFile: 'agents.ts',
  },
  // Nested, through a table for the reason given below the profile's.
  ...(
    [
      ['ActivitySeries', 'services/people-activity.ts', 'people-activity.ts'],
      ['OwnLocalDay', 'services/local-activity.ts', 'local-activity.ts'],
      ['UsageFigures', 'services/token-usage.ts', 'usage.ts'],
      ['UsageSlice', 'services/token-usage.ts', 'usage.ts'],
      ['UsageDayPoint', 'services/token-usage.ts', 'usage.ts'],
      ['UsageDeveloper', 'services/token-usage.ts', 'usage.ts'],
      ['UsageAgentSlice', 'services/token-usage.ts', 'usage.ts'],
      ['UsageModelSlice', 'services/token-usage.ts', 'usage.ts'],
      ['UsageTaskSlice', 'services/token-usage.ts', 'usage.ts'],
      ['UsageWeek', 'services/token-usage.ts', 'usage.ts'],
      ['UsageCounts', 'services/token-usage.ts', 'usage.ts'],
      ['TaskUsagePerson', 'services/token-usage.ts', 'usage.ts'],
      ['TaskUsageRound', 'services/token-usage.ts', 'usage.ts'],
      // LAI-773: the cost on every figure, cache efficiency, accepted-task cost.
      ['UsageCost', 'services/model-prices.ts', 'usage.ts'],
      ['UsageCacheProject', 'services/token-usage.ts', 'usage.ts'],
      ['UsageAccepted', 'services/token-usage.ts', 'usage.ts'],
      // LAI-814: each space's tokens and cost on the organisation view.
      ['UsageProjectTotal', 'services/token-usage.ts', 'usage.ts'],
      ['ProjectBudgets', 'services/token-budgets.ts', 'budgets.ts'],
      ['ModelPrice', 'services/model-prices.ts', 'model-prices.ts'],
    ] as const
  ).map(([name, serverFile, clientFile]) => ({
    server: name,
    serverFile,
    client: name,
    clientFile,
  })),
  /*
   * **And every named shape inside the profile**, because `fieldsOf` reads one
   * interface's own fields and a nested block is otherwise compared by nothing.
   *
   * Through a table rather than literal entries, on purpose: the server's
   * `response-type-coverage.test.ts` counts *served* types by reading
   * `server: '…'` literals here, and these are only ever served inside
   * `ProfileView`. Listed literally, each would read to it as a served type
   * that does not exist. This leaves them outside its count and inside this
   * comparison, which is the coverage they need.
   */
  ...(
    [
      ['ProfileUser', 'services/profiles.ts'],
      ['ProfileWindow', 'services/profiles.ts'],
      ['ProfileProject', 'services/profiles.ts'],
      ['ProfileTask', 'services/profiles.ts'],
      ['ProfileCurrentWork', 'services/profiles.ts'],
      ['WeekCount', 'services/profiles.ts'],
      ['ProfileCycleTime', 'services/profiles.ts'],
      ['ProfileDelivery', 'services/profiles.ts'],
      ['ReviewDecision', 'services/profiles.ts'],
      ['ProfileReview', 'services/profiles.ts'],
      ['ReviewWeek', 'services/profiles.ts'],
      ['ProfileDecideTime', 'services/profiles.ts'],
      ['ProfileQueue', 'services/profiles.ts'],
      ['QueueProject', 'services/profiles.ts'],
      ['ProfileAgentToken', 'services/profiles.ts'],
      ['ProfileAgents', 'services/profiles.ts'],
      ['AgentWrites', 'services/profiles.ts'],
      ['AgentPresence', 'services/presence.ts'],
      ['ProfileActivitySharing', 'services/profiles.ts'],
    ] as const
  ).map(([name, serverFile]) => ({
    server: name,
    serverFile,
    client: name,
    clientFile: 'profiles.ts',
  })),
];

const SERVER = new URL('../../../src/', import.meta.url);
const CLIENT = new URL('../../src/api/', import.meta.url);

const sources = new Map<string, string>();
const read = async (base: URL, rel: string): Promise<string> => {
  const path = fileURLToPath(new URL(rel, base));
  const cached = sources.get(path);
  if (cached !== undefined) return cached;
  const text = await readFile(path, 'utf8');
  sources.set(path, text);
  return text;
};

interface Resolved {
  readonly pair: Pair;
  readonly serverFields: readonly string[];
  readonly clientFields: readonly string[];
}

let resolved: Resolved[] = [];

before(async () => {
  resolved = [];
  for (const pair of PAIRS) {
    const serverSource = await read(SERVER, pair.serverFile);
    const clientSource = await read(CLIENT, pair.clientFile);

    const serverFields = fieldsOf(serverSource, pair.server);
    const clientFields = fieldsOf(clientSource, pair.client);

    // A rename must fail loudly. Comparing an empty set would pass silently and
    // leave the pair unguarded for ever, which is the failure this whole file
    // exists to prevent.
    assert.ok(serverFields, `${pair.server} not found in src/${pair.serverFile}`);
    assert.ok(clientFields, `${pair.client} not found in web/src/api/${pair.clientFile}`);

    resolved.push({ pair, serverFields, clientFields });
  }
});

void describe('every server field is visible to the client', () => {
  void test('the guard has pairs to check', () => {
    // Without this the suite passes by finding nothing — the same way
    // `not-in-bundle.test.ts` went quiet when its needles stopped matching.
    assert.equal(resolved.length, PAIRS.length);
    assert.ok(PAIRS.length >= 7, 'the pair list has shrunk');
  });

  void test('no server field is missing from its client type', () => {
    const problems: string[] = [];

    for (const { pair, serverFields, clientFields } of resolved) {
      for (const field of serverFields) {
        if (clientFields.includes(field)) continue;
        const reason = pair.clientOmits?.[field];
        if (reason !== undefined) continue;
        problems.push(
          `${pair.server}.${field} is served and ${pair.client} does not declare it ` +
            `— add it, or list it in clientOmits with a reason`,
        );
      }
    }

    assert.deepEqual(problems, [], problems.join('\n'));
  });

  void test('the client declares nothing the server does not send', () => {
    // The other direction, and it fails later and worse: a field the server
    // never sends is `undefined` at runtime, on a type that promised it was
    // there. TypeScript cannot catch it — the shape is asserted, not checked.
    const problems: string[] = [];

    for (const { pair, serverFields, clientFields } of resolved) {
      for (const field of clientFields) {
        if (serverFields.includes(field)) continue;
        problems.push(
          `${pair.client}.${field} is declared and ${pair.server} does not send it ` +
            `— it will be undefined at runtime`,
        );
      }
    }

    assert.deepEqual(problems, [], problems.join('\n'));
  });

  void test('every omission carries a reason, and names a real field', () => {
    // An exemption for a field that no longer exists is a stale note that will
    // hide the next real drift on the same name.
    for (const { pair, serverFields } of resolved) {
      for (const [field, reason] of Object.entries(pair.clientOmits ?? {})) {
        assert.ok(reason.length > 10, `${pair.client}.${field} is omitted without a real reason`);
        assert.ok(
          serverFields.includes(field),
          `${pair.client} omits ${field}, which ${pair.server} does not have — stale exemption`,
        );
      }
    }
  });
});
