import { MeetingStatus } from "@prisma/client";

import { formatMeetingStatus } from "@/lib/meetings";

const STYLE_MAP: Record<MeetingStatus, string> = {
  [MeetingStatus.QUEUED]: "status-pending",
  [MeetingStatus.CLAIMED]: "status-pending",
  [MeetingStatus.JOINING]: "status-pending",
  [MeetingStatus.LIVE]: "status-live",
  [MeetingStatus.PROCESSING]: "status-pending",
  [MeetingStatus.COMPLETED]: "status-completed",
  [MeetingStatus.FAILED]: "status-error",
  [MeetingStatus.KICKED]: "status-error",
  [MeetingStatus.ENDED_EMPTY]: "status-neutral",
  [MeetingStatus.ENDED_ROOM_CLOSED]: "status-neutral"
};

export function StatusPill({ status }: { status: MeetingStatus }) {
  return <span className={`status-pill ${STYLE_MAP[status]}`}>{formatMeetingStatus(status)}</span>;
}

