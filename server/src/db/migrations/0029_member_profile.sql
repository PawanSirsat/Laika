-- LAI-743, D-078: the member profile's two additions, and nothing else.
--
-- **Additive only.** drizzle-kit generated a rebuild of `users` here, because a
-- table-level CHECK is a new constraint to it. Hand-edited to `ALTER TABLE …
-- ADD` with the CHECK as a column constraint: SQLite tests it against every
-- existing row as the column is added, the stored DDL then carries
-- `CONSTRAINT "users_profile_kind_check"` exactly as `schema.ts` declares it,
-- and `users` — which most of the schema references — is never dropped and
-- copied. The snapshot beside this file is drizzle-kit's, unedited, so the next
-- generate sees the CHECK as already there.
CREATE TABLE `member_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rated_by` text NOT NULL,
	`score` integer NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "member_ratings_score_check" CHECK(score IN (1, 2, 3, 4, 5)),
	CONSTRAINT "member_ratings_note_check" CHECK(length(trim(note)) > 0 AND length(note) <= 500),
	CONSTRAINT "member_ratings_not_self_check" CHECK(user_id <> rated_by)
);
--> statement-breakpoint
CREATE INDEX `member_ratings_user_created_at_idx` ON `member_ratings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_ratings_rated_by_idx` ON `member_ratings` (`rated_by`);--> statement-breakpoint
ALTER TABLE `users` ADD `profile_kind` text DEFAULT 'builder' NOT NULL CONSTRAINT "users_profile_kind_check" CHECK(profile_kind IN ('builder', 'manager'));--> statement-breakpoint
-- Append-only, as §4.21 says. `runMigrations` re-establishes these on every
-- boot as it does `activity`'s, so a later rebuild cannot silently lose them.
CREATE TRIGGER IF NOT EXISTS `member_ratings_is_append_only_no_update`
BEFORE UPDATE ON `member_ratings`
BEGIN
	SELECT RAISE(ABORT, 'member_ratings is append-only: UPDATE is not permitted (SPEC 4.21)');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `member_ratings_is_append_only_no_delete`
BEFORE DELETE ON `member_ratings`
BEGIN
	SELECT RAISE(ABORT, 'member_ratings is append-only: DELETE is not permitted (SPEC 4.21)');
END;
