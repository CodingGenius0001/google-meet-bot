import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { formatDateTime, getMeetingJob } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type TranscriptSegment = {
  speaker: string;
  text: string;
  capturedAt: string;
};

export default async function MeetingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    notFound();
  }

  const transcript = Array.isArray(meeting.transcriptJson)
    ? (meeting.transcriptJson as TranscriptSegment[])
    : [];

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          MeetMate
        </div>
        <div className="actions">
          <Link className="ghost-button" href="/">
            Back to dashboard
          </Link>
          {meeting.recordingUrl ? (
            <a className="primary-button" href={meeting.recordingUrl} target="_blank" rel="noreferrer">
              Open recording
            </a>
          ) : null}
        </div>
      </div>

      <header className="page-header">
        <div>
          <span className="eyebrow">Meeting session</span>
          <h1 className="page-title">{meeting.title || meeting.meetCode}</h1>
          <p className="subtle">{meeting.meetUrl}</p>
        </div>
        <StatusPill status={meeting.status} />
      </header>

      <section className="page-columns">
        <div className="grid">
          <div className="panel content-panel">
            <h2 className="section-title">Session details</h2>
            <div className="detail-grid">
              <div className="metadata">
                <span className="metadata-label">Queued</span>
                <span className="metadata-value">{formatDateTime(meeting.createdAt)}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Joined</span>
                <span className="metadata-value">{formatDateTime(meeting.joinedAt)}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Ended</span>
                <span className="metadata-value">{formatDateTime(meeting.endedAt)}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Participants peak</span>
                <span className="metadata-value">{meeting.participantsPeak ?? "Unknown"}</span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Captions</span>
                <span className="metadata-value">
                  {meeting.captionsEnabled ? "Enabled by bot" : "Unavailable or disabled"}
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">End reason</span>
                <span className="metadata-value">{meeting.endReason ?? "Pending"}</span>
              </div>
            </div>
          </div>

          <div className="panel content-panel">
            <h2 className="section-title">Recording</h2>
            {meeting.recordingUrl ? (
              <div className="recording">
                <video controls preload="metadata" src={meeting.recordingUrl} />
              </div>
            ) : (
              <p className="empty-state">
                Recording is not available yet. This stays empty if blob storage is not configured.
              </p>
            )}
          </div>
        </div>

        <div className="grid">
          <div className="panel content-panel">
            <h2 className="section-title">Summary</h2>
            <div className="summary-box">
              {meeting.aiSummary ??
                "Summary pending. The worker writes this after the transcript is available."}
            </div>
          </div>

          <div className="panel content-panel">
            <h2 className="section-title">Transcript</h2>
            {transcript.length ? (
              <div className="transcript-box">
                {transcript.map((segment, index) => (
                  <div className="transcript-line" key={`${segment.capturedAt}-${index}`}>
                    <strong>{segment.speaker || "Unknown"}</strong>
                    <time>{new Date(segment.capturedAt).toLocaleTimeString()}</time>
                    <div>{segment.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="transcript-box">
                {meeting.transcriptText ?? "Transcript pending. Live captions are best-effort in the worker."}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
