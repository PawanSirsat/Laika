CREATE TABLE `recognised_agent_devices` (
	`owner_user_id` text NOT NULL,
	`label_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `label_key`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- runMigrations registers the same Unicode key function used by requests.
-- This runs once, in the migration transaction; later labels stay unrecognised.
INSERT INTO `recognised_agent_devices` (`owner_user_id`, `label_key`, `created_at`)
SELECT `owner_user_id`, laika_device_label_key(`device_label`), MIN(`created_at`)
FROM `agents`
GROUP BY `owner_user_id`, laika_device_label_key(`device_label`);
