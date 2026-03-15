import Link from "next/link";
import type { MeetingJob } from "@prisma/client";

import { formatDateTime } from "@/lib/meetings";
import { StatusPill } from "@/components/status-pill";

export function MeetingList({ meetings }: { meetings: MeetingJob[] }) {
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
                <span className="metadata-value">{formatDateTime(meeting.createdAt)}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Ended</span>
                <span className="metadata-value">{formatDateTime(meeting.endedAt)}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Recording</span>
                <span className="metadata-value">{meeting.recordingUrl ? "Available" : "Pending"}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">AI summary</span>
                <span className="metadata-value">{meeting.aiSummary ? "Ready" : "Pending"}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

