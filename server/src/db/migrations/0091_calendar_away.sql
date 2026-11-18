CREATE TABLE `calendar_away` (
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`retired_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `event_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_away_span_check" CHECK(ends_at > starts_at),
	CONSTRAINT "calendar_away_event_id_check" CHECK(length(event_id) BETWEEN 1 AND 512)
);
