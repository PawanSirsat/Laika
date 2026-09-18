PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meeting_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`transcript_hash` text NOT NULL,
	`proposals_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meeting_reviews_status_check" CHECK(status IN ('pending', 'applied', 'discarded', 'expired', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_meeting_reviews`("id", "project_id", "source", "transcript_hash", "proposals_json", "status", "reviewed_by", "reviewed_at", "expires_at", "created_at") SELECT "id", "project_id", "source", "transcript_hash", "proposals_json", "status", "reviewed_by", "reviewed_at", "expires_at", "created_at" FROM `meeting_reviews`;--> statement-breakpoint
DROP TABLE `meeting_reviews`;--> statement-breakpoint
ALTER TABLE `__new_meeting_reviews` RENAME TO `meeting_reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `meeting_reviews_project_status_idx` ON `meeting_reviews` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_reviews_reviewed_by_idx` ON `meeting_reviews` (`reviewed_by`);