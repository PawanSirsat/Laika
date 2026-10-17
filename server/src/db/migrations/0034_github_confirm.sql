-- LAI-766, D-083: what GitHub's deliveries said, so the review gate can
-- confirm an agent's proof — the commits, pull requests and CI results seen
-- (kept 30 days), and one summary row per round that outlives them.
--
-- **Additive only**: four CREATE TABLEs and their indexes; no existing table
-- is altered, rebuilt or copied, and `task_evidence` keeps its columns.
-- drizzle-kit's output, unedited but for this header.
CREATE TABLE `github_checks` (
	`repo` text NOT NULL,
	`head_sha` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`outcome` text NOT NULL,
	`conclusion` text,
	`event_at` integer NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `head_sha`, `kind`, `name`),
	CONSTRAINT "github_checks_kind_check" CHECK(kind IN ('check_run', 'workflow_run', 'check_suite')),
	CONSTRAINT "github_checks_outcome_check" CHECK(outcome IN ('pending', 'passed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `github_checks_head_sha_idx` ON `github_checks` (`head_sha`);--> statement-breakpoint
CREATE INDEX `github_checks_seen_at_idx` ON `github_checks` (`seen_at`);--> statement-breakpoint
CREATE TABLE `github_commits` (
	`repo` text NOT NULL,
	`sha` text NOT NULL,
	`branch` text,
	`committed_at` integer,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`repo`, `sha`)
);
--> statement-breakpoint
CREATE INDEX `github_commits_sha_idx` ON `github_commits` (`sha`);--> statement-breakpoint
CREATE INDEX `github_commits_seen_at_idx` ON `github_commits` (`seen_at`);--> statement-breakpoint
CREATE TABLE `github_pull_requests` (
	`key` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`url` text NOT NULL,
	`head_sha` text,
	`head_ref` text,
	`merged` integer DEFAULT 0 NOT NULL,
	`event_at` integer NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `github_pull_requests_head_sha_idx` ON `github_pull_requests` (`head_sha`);--> statement-breakpoint
CREATE INDEX `github_pull_requests_seen_at_idx` ON `github_pull_requests` (`seen_at`);--> statement-breakpoint
CREATE TABLE `task_round_github` (
	`round_id` text PRIMARY KEY NOT NULL,
	`pr_merged` integer,
	`ci_head_sha` text,
	`ci_total` integer DEFAULT 0 NOT NULL,
	`ci_passed` integer DEFAULT 0 NOT NULL,
	`ci_failed` integer DEFAULT 0 NOT NULL,
	`ci_pending` integer DEFAULT 0 NOT NULL,
	`ci_failed_names` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `task_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
