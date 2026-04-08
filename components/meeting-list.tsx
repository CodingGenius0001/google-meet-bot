import Link from "next/link";
import { MeetingStatus, type MeetingJob } from "@prisma/client";

import { AutoRefresh } from "@/components/auto-refresh";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { LocalDateTime } from "@/components/local-date-time";
import { ProgressBanner } from "@/components/progress-banner";
import { StatusPill } from "@/components/status-pill";

const ACTIVE_STATUSES = new Set<MeetingStatus>([
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
]);

// A job is considered "stuck" if it's still in an active status but the
// worker hasn't sent a heartbeat in a while. The heartbeat runs every 15s
// so anything > 90s is definitely wedged.
const STALE_HEARTBEAT_MS = 90_000;

function isStuck(meeting: MeetingJob): boolean {
  if (!ACTIVE_STATUSES.has(meeting.status)) return false;
  if (!meeting.lastHeartbeatAt) {
    // QUEUED with no heartbeat yet is not stuck — it's waiting for a worker.
    // Only consider it stuck after 2 minutes of total queue time.
    return Date.now() - new Date(meeting.createdAt).getTime() > 120_000;
  }
  return Date.now() - new Date(meeting.lastHeartbeatAt).getTime() > STALE_HEARTBEAT_MS;
}

export function MeetingList({ meetings }: { meetings: MeetingJob[] }) {
  const hasActiveMeetings = meetings.some((meeting) =>
    ["QUEUED", "CLAIMED", "JOINING", "LIVE", "PROCESSING"].includes(meeting.status)
  );

  if (!meetings.length) {
    return (
      <div className="panel content-panel">
        <h2 className="section-title">Recent sessions</h2>
        <p className="empty-state">No meetings have been queued yet.</p>
      </div>
    );
  }

  return (
    <div className="panel content-panel">
      <AutoRefresh enabled={hasActiveMeetings} />
      <h2 className="section-title">Recent sessions</h2>
      <div className="meeting-list">
        {meetings.map((meeting) => (
          <Link className="meeting-card" href={`/meetings/${meeting.id}`} key={meeting.id}>
            <header>
              <div>
                <h3>{meeting.title || meeting.meetCode}</h3>
                <code>{meeting.meetUrl}</code>
              </div>
              <StatusPill status={meeting.status} />
            </header>
            <div className="meeting-meta">
              <div className="metadata">
                <span className="metadata-label">Queued</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.createdAt} />
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Ended</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.endedAt} />
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Recording</span>
                <span className="metadata-value">{meeting.recordingUrl ? "Available" : "Pending"}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Summary</span>
                <span className="metadata-value">{meeting.aiSummary ? "Ready" : "Pending"}</span>
              </div>
            </div>
            {ACTIVE_STATUSES.has(meeting.status) ? (
              <div className="meeting-card-progress">
                <ProgressBanner
                  status={meeting.status}
                  progressNote={meeting.progressNote}
                  isActive
                />
              </div>
            ) : null}
            {!ACTIVE_STATUSES.has(meeting.status) ? (
              <div className="meeting-card-actions">
                <DeleteSessionButton meetingId={meeting.id} />
              </div>
            ) : isStuck(meeting) ? (
              <div className="meeting-card-actions">
                <DeleteSessionButton
                  meetingId={meeting.id}
                  label="Force delete (stuck)"
                  force
                />
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
