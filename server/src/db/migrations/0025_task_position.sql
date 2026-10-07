-- LAI-472 / D-060 / D-070: `tasks.position`, the manual board order.
--
-- Nullable so it can be added to a populated table without a rebuild. The
-- keys are computed (`db/order-key.ts`), so they are filled by
-- `backfillTaskPositions` at boot rather than here; the unique index treats
-- the nulls it meets meanwhile as distinct.
ALTER TABLE `tasks` ADD `position` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_position_unique` ON `tasks` (`project_id`,`position`);