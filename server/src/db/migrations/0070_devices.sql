CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`label_key` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`public_key` text,
	`key_fingerprint` text,
	`confirmed_at` integer,
	`paired_at` integer,
	`status` text NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "devices_kind_check" CHECK(kind IN ('local', 'cloud')),
	CONSTRAINT "devices_origin_check" CHECK(origin IN ('imported', 'paired')),
	CONSTRAINT "devices_status_check" CHECK(status IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `devices_owner_user_id_idx` ON `devices` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_owner_label_key_active_unique` ON `devices` (`owner_user_id`,`label_key`) WHERE status = 'active';--> statement-breakpoint
ALTER TABLE `agents` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
CREATE INDEX `agents_device_id_idx` ON `agents` (`device_id`);--> statement-breakpoint
-- LAI-1045: one imported device per (owner, label key), exactly as
-- GET /agents/devices groups agents today. runMigrations registers the same
-- Unicode key and name functions requests use; SQLite's trim()/lower() are
-- ASCII-only. The name is the newest agent's trimmed label, the list's rule.
-- A key whose agents are all revoked gets a revoked device, so it holds no
-- name in the partial unique index and its history still links. Nothing is
-- merged, revoked or renamed, and no agent is created.
WITH `keyed` AS (
	SELECT `id`, `org_id`, `owner_user_id`, `device_label`, `status`, `created_at`,
		`revoked_at`, `last_seen_at`,
		laika_device_label_key(`device_label`) AS `label_key`
	FROM `agents`
), `ranked` AS (
	SELECT *, ROW_NUMBER() OVER (
		PARTITION BY `owner_user_id`, `label_key` ORDER BY `created_at` DESC, `id` DESC
	) AS `rn`
	FROM `keyed`
), `grouped` AS (
	SELECT `owner_user_id`, `label_key`,
		SUM(`status` = 'active') AS `active_count`,
		MAX(`revoked_at`) AS `last_revoked_at`,
		MAX(`last_seen_at`) AS `last_seen_at`,
		MIN(`created_at`) AS `first_created_at`
	FROM `keyed`
	GROUP BY `owner_user_id`, `label_key`
)
INSERT INTO `devices` (`id`, `org_id`, `owner_user_id`, `display_name`, `label_key`, `kind`,
	`origin`, `confirmed_at`, `status`, `revoked_at`, `last_seen_at`, `created_at`)
SELECT laika_new_id(), `n`.`org_id`, `g`.`owner_user_id`,
	laika_device_display_name(`n`.`device_label`), `g`.`label_key`,
	CASE WHEN `g`.`label_key` = 'cloud' THEN 'cloud' ELSE 'local' END,
	'imported', `r`.`created_at`,
	CASE WHEN `g`.`active_count` > 0 THEN 'active' ELSE 'revoked' END,
	CASE WHEN `g`.`active_count` > 0 THEN NULL ELSE `g`.`last_revoked_at` END,
	`g`.`last_seen_at`, `g`.`first_created_at`
FROM `grouped` `g`
JOIN `ranked` `n`
	ON `n`.`owner_user_id` = `g`.`owner_user_id` AND `n`.`label_key` = `g`.`label_key` AND `n`.`rn` = 1
LEFT JOIN `recognised_agent_devices` `r`
	ON `r`.`owner_user_id` = `g`.`owner_user_id` AND `r`.`label_key` = `g`.`label_key`
ORDER BY `g`.`owner_user_id`, `g`.`label_key`;
--> statement-breakpoint
-- Exactly one device per (owner, key) exists now, so the link is unambiguous.
UPDATE `agents` SET `device_id` = (
	SELECT `d`.`id` FROM `devices` `d`
	WHERE `d`.`owner_user_id` = `agents`.`owner_user_id`
		AND `d`.`label_key` = laika_device_label_key(`agents`.`device_label`)
);
