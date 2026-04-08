-- AlterTable: add progressNote column so the worker can publish a
-- human-readable status string to the dashboard.
ALTER TABLE `MeetingJob` ADD COLUMN `progressNote` TEXT NULL;
