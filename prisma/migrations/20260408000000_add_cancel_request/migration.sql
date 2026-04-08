-- AlterTable: add cancelRequestedAt column.
ALTER TABLE `MeetingJob` ADD COLUMN `cancelRequestedAt` DATETIME(3) NULL;

-- AlterTable: extend MeetingEndReason enum with CANCELLED.
ALTER TABLE `MeetingJob` MODIFY COLUMN `endReason` ENUM(
  'HOST_NEVER_ADMITTED',
  'BOT_KICKED',
  'ROOM_ENDED',
  'LAST_PARTICIPANT_LEFT',
  'JOIN_TIMEOUT',
  'CANCELLED',
  'UNKNOWN'
) NULL;
