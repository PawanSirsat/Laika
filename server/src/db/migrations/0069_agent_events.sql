CREATE TABLE `agent_event_deliveries` (
	`activity_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`seq` integer NOT NULL,
	`available_at` integer NOT NULL,
	`received_at` integer,
	`received_session_id` text,
	`presented_at` integer,
	`presented_session_id` text,
	PRIMARY KEY(`activity_id`, `agent_id`),
	FOREIGN KEY (`activity_id`) REFERENCES `agent_events`(`activity_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_event_deliveries_presented_after_received_check" CHECK(presented_at IS NULL OR received_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `agent_event_deliveries_agent_project_seq_idx` ON `agent_event_deliveries` (`agent_id`,`project_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_event_deliveries_agent_project_undelivered_idx` ON `agent_event_deliveries` (`agent_id`,`project_id`,`seq`) WHERE received_at IS NULL;--> statement-breakpoint
CREATE INDEX `agent_event_deliveries_project_id_idx` ON `agent_event_deliveries` (`project_id`);--> statement-breakpoint
CREATE TABLE `agent_events` (
	`activity_id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`offer_id` text,
	`detail_json` text NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_seq_idx` ON `agent_events` (`seq`);--> statement-breakpoint
CREATE INDEX `agent_events_offer_id_idx` ON `agent_events` (`offer_id`);