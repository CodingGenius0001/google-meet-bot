import Link from "next/link";
import { MeetingStatus } from "@prisma/client";
import { notFound } from "next/navigation";

import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusPill } from "@/components/status-pill";
import { StopSessionButton } from "@/components/stop-session-button";
import { getDashboardSession } from "@/lib/auth-server";
import { getMeetingJob } from "@/lib/meetings";

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

const ACTIVE_STATUSES = new Set<MeetingStatus>([
  MeetingStatus.QUEUED,
  MeetingStatus.CLAIMED,
  MeetingStatus.JOINING,
  MeetingStatus.LIVE,
  MeetingStatus.PROCESSING
]);

export default async function MeetingDetailPage({ params }: PageProps) {
  const session = await getDashboardSession();
  if (!session) {
    redirect("/signin" as never);
  }

  const { id } = await params;
  const meeting = await getMeetingJob(id);

  if (!meeting) {
    notFound();
  }

  const transcript = Array.isArray(meeting.transcriptJson)
    ? (meeting.transcriptJson as TranscriptSegment[])
    : [];
  const hasTranscript = transcript.length > 0 || Boolean(meeting.transcriptText?.trim());
  const hasSummary = Boolean(meeting.aiSummary?.trim());
  const hasRecording = Boolean(meeting.recordingUrl);
  const recordingUrl = meeting.recordingUrl ?? undefined;
  const isActive = ACTIVE_STATUSES.has(meeting.status);

  return (
    <main className="shell">
      <AutoRefresh enabled={isActive} />
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          MeetMate
        </div>
        <div className="actions">
          <Link className="ghost-button" href="/">
            Back to dashboard
          </Link>
          {hasTranscript ? (
            <a
              className="ghost-button"
              href={`/api/meetings/${meeting.id}/downloads?kind=transcript`}
              download
            >
              Download transcript
            </a>
          ) : null}
          {hasSummary ? (
            <a
              className="ghost-button"
              href={`/api/meetings/${meeting.id}/downloads?kind=summary`}
              download
            >
              Download summary
            </a>
          ) : null}
          {hasRecording ? (
            <a
              className="primary-button"
              href={`/api/meetings/${meeting.id}/downloads?kind=recording`}
              download
            >
              Download recording
            </a>
          ) : null}
          {hasRecording ? (
            <a className="ghost-button" href={recordingUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          ) : null}
          {isActive ? (
            <StopSessionButton
              meetingId={meeting.id}
              alreadyRequested={Boolean(meeting.cancelRequestedAt)}
            />
          ) : null}
          {!isActive ? (
            <DeleteSessionButton meetingId={meeting.id} redirectTo="/" variant="primary" />
          ) : null}
        </div>
      </div>

      <header className="page-header">
        <div>
          <span className="eyebrow">Meeting session</span>
          <h1 className="page-title">{meeting.title || meeting.meetCode}</h1>
          <p className="subtle">{meeting.meetUrl}</p>
        </div>
        <div className="status-cluster">
          <StatusPill status={meeting.status} />
          {meeting.status === MeetingStatus.LIVE ? (
            <span className="rec-indicator" aria-label="Recording in progress">
              <span className="rec-dot" />
              REC
            </span>
          ) : null}
        </div>
      </header>

      <section className="page-columns">
        <div className="grid">
          <div className="panel content-panel">
            <h2 className="section-title">Session details</h2>
            {isActive ? (
              <p className="subtle">
                This page refreshes automatically while the worker is still handling the meeting.
              </p>
            ) : null}
            {meeting.status === MeetingStatus.QUEUED && !meeting.lastHeartbeatAt ? (
              <p className="empty-state">
                This job has not been claimed by any worker yet. If it stays queued, check that your Railway worker is deployed,
                healthy, and using the same `DATABASE_URL` as Vercel.
              </p>
            ) : null}
            <div className="detail-grid">
              <div className="metadata">
                <span className="metadata-label">Queued</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.createdAt} />
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Worker heartbeat</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.lastHeartbeatAt} emptyLabel="No heartbeat yet" />
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Joined</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.joinedAt} />
                </span>
              </div>
              <div className="metadata">
                <span className="metadata-label">Ended</span>
                <span className="metadata-value">
                  <LocalDateTime value={meeting.endedAt} />
                </span>
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
              <div className="metadata">
                <span className="metadata-label">Worker id</span>
                <span className="metadata-value">{meeting.workerId ?? "Not claimed yet"}</span>
              </div>
            </div>
            {meeting.cancelRequestedAt && isActive ? (
              <p className="empty-state">
                Stop requested at <LocalDateTime value={meeting.cancelRequestedAt} />. The
                bot will leave on its next heartbeat tick.
              </p>
            ) : null}
            {meeting.errorMessage ? <p className="empty-state">{meeting.errorMessage}</p> : null}
          </div>

          <div className="panel content-panel">
            <h2 className="section-title">Recording</h2>
            {meeting.recordingUrl ? (
              <div className="recording">
                <video controls preload="metadata" src={meeting.recordingUrl} />
                <div className="recording-actions">
                  <a
                    className="primary-button"
                    href={`/api/meetings/${meeting.id}/downloads?kind=recording`}
                    download
                  >
                    Download recording
                  </a>
                  <a
                    className="ghost-button"
                    href={recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in new tab
                  </a>
                </div>
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
                    <time>
                      <LocalDateTime value={segment.capturedAt} timeOnly emptyLabel="Unknown time" />
                    </time>
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
