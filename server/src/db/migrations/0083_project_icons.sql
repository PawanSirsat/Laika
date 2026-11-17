-- LAI-1311, D-152: a space's icon — an emoji, or an image in the operator's
-- store (D-150) with its verified type and when it last changed.
--
-- **Additive only**, for 0052's reason: drizzle-kit generated a rebuild of
-- `projects`, because a table-level CHECK is a new constraint to it, and its
-- copy step selected the four new columns from the old table, which does not
-- have them. Hand-edited to `ALTER TABLE … ADD` with each CHECK as a column
-- constraint: every new column is nullable, so no existing row can fail it,
-- and `projects` — which every task, membership and activity row references —
-- is never dropped and copied. The snapshot beside this file is drizzle-kit's,
-- unedited.
ALTER TABLE `projects` ADD `icon_emoji` text CONSTRAINT "projects_icon_emoji_check" CHECK(icon_emoji IS NULL OR length(icon_emoji) BETWEEN 1 AND 32);--> statement-breakpoint
ALTER TABLE `projects` ADD `icon_key` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `icon_type` text CONSTRAINT "projects_icon_type_check" CHECK(icon_type IS NULL OR icon_type IN ('image/png', 'image/jpeg', 'image/webp'));--> statement-breakpoint
ALTER TABLE `projects` ADD `icon_updated_at` integer;
