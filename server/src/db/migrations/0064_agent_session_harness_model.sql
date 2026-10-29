ALTER TABLE `activity` ADD `agent_session_id` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `session_harness` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `session_harness_version` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `session_model` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `harness` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `harness_version` text;