-- LAI-758, D-082: the review gate's three tables — a round per finish,
-- an evidence item per piece of proof, and a person's review decisions.
--
-- **Additive only**: three CREATE TABLEs and their indexes, and no existing
-- table is altered, rebuilt or copied. drizzle-kit's output, unedited but for
-- this header.
CREATE TABLE `task_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	`detail` text,
	`exit_code` integer,
	`state` text DEFAULT 'claimed' NOT NULL,
	`state_source` text,
	`state_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `task_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_evidence_kind_check" CHECK(kind IN ('commit', 'branch', 'pull_request', 'test_run')),
	CONSTRAINT "task_evidence_state_check" CHECK(state IN ('claimed', 'confirmed', 'failed')),
	CONSTRAINT "task_evidence_exit_code_check" CHECK((kind = 'test_run') = (exit_code IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `task_evidence_round_position_idx` ON `task_evidence` (`round_id`,`position`);--> statement-breakpoint
CREATE INDEX `task_evidence_kind_value_idx` ON `task_evidence` (`kind`,`value`);--> statement-breakpoint
CREATE TABLE `task_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`round_id` text,
	`decision` text NOT NULL,
	`reason_md` text,
	`comment_id` text,
	`decided_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `task_rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_reviews_decision_check" CHECK(decision IN ('accepted', 'sent_back')),
	CONSTRAINT "task_reviews_reason_check" CHECK((decision = 'sent_back') = (reason_md IS NOT NULL AND length(trim(reason_md)) > 0))
);
--> statement-breakpoint
CREATE INDEX `task_reviews_task_created_at_idx` ON `task_reviews` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_reviews_round_id_idx` ON `task_reviews` (`round_id`);--> statement-breakpoint
CREATE INDEX `task_reviews_comment_id_idx` ON `task_reviews` (`comment_id`);--> statement-breakpoint
CREATE INDEX `task_reviews_decided_by_idx` ON `task_reviews` (`decided_by`);--> statement-breakpoint
CREATE TABLE `task_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`number` integer NOT NULL,
	`finished_by` text NOT NULL,
	`token_id` text,
	`client_name` text,
	`summary_md` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finished_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_rounds_number_check" CHECK(number >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_rounds_task_number_idx` ON `task_rounds` (`task_id`,`number`);--> statement-breakpoint
CREATE INDEX `task_rounds_finished_by_idx` ON `task_rounds` (`finished_by`);--> statement-breakpoint
CREATE INDEX `task_rounds_token_id_idx` ON `task_rounds` (`token_id`);