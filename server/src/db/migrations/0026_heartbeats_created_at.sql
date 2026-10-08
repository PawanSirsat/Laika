-- LAI-722: Presence and Capacity read "every heartbeat in the last five
-- minutes" by `created_at` alone, which `(user_id, created_at)` cannot serve.
--
-- A plain CREATE INDEX: no table rebuild, so nothing cascades (the migrator
-- runs each file inside BEGIN, where `PRAGMA foreign_keys` is ignored).
CREATE INDEX `heartbeats_created_at_idx` ON `heartbeats` (`created_at`);
