-- D-093 / LAI-822: UPDATE only; never rebuild the referenced tasks table.
-- Categories in activity are historical facts, independent of today's columns.
-- A Done-to-Done column drag is not a new completion (LAI-738).
UPDATE `tasks`
SET `completed_at` = COALESCE(
  (
    SELECT MAX(`activity`.`created_at`)
    FROM `activity`
    WHERE `activity`.`task_id` = `tasks`.`id`
      AND `activity`.`type` = 'task.status_changed'
      AND CASE WHEN json_valid(`activity`.`payload_json`) THEN
        json_extract(`activity`.`payload_json`, '$.to') = 'done'
        AND json_extract(`activity`.`payload_json`, '$.from') IS NOT 'done'
      ELSE 0 END
  ),
  `created_at`
)
WHERE `status` = 'done' AND `completed_at` IS NULL;
