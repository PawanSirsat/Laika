-- LAI-746: two additions to `member_ratings`, both additive.
--
-- `idempotency_key` lets a retried `POST /users/:id/ratings` answer from the
-- rating it already wrote, so the note is never copied into
-- `idempotency_keys`.
ALTER TABLE `member_ratings` ADD `idempotency_key` text;--> statement-breakpoint
-- `INSERT OR REPLACE` deletes the row it collides with and inserts the new one,
-- and with `recursive_triggers` off — SQLite's default — the delete half fires
-- no `BEFORE DELETE` trigger. So 0029's two triggers let a replace rewrite a
-- rating in place. A `BEFORE INSERT` trigger sees the new row before the
-- conflict is resolved. The id is the table's only uniqueness constraint, so
-- it is the only collision a replace can use. `runMigrations` re-establishes
-- this one at every boot with the other two.
CREATE TRIGGER IF NOT EXISTS `member_ratings_is_append_only_no_replace`
BEFORE INSERT ON `member_ratings`
WHEN EXISTS (SELECT 1 FROM `member_ratings` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'member_ratings is append-only: INSERT OR REPLACE is not permitted (SPEC 4.21)');
END;
