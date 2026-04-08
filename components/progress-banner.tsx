import { MeetingStatus } from "@prisma/client";

type ProgressBannerProps = {
  status: MeetingStatus;
  progressNote: string | null;
  isActive: boolean;
};

// Fallback copy when the worker hasn't published a progress note yet.
// The progressNote column is populated by the worker at each stage; if
// it's null we still want to show a sensible description of the phase.
const STATUS_FALLBACK: Record<MeetingStatus, string> = {
  [MeetingStatus.QUEUED]:
    "Waiting for a worker to pick up this job...",
  [MeetingStatus.CLAIMED]:
    "A worker has claimed the job and is starting up the browser...",
  [MeetingStatus.JOINING]:
    "Starting browser and joining the meeting...",
  [MeetingStatus.LIVE]:
    "In meeting — recording is running.",
  [MeetingStatus.PROCESSING]:
    "Meeting ended. Uploading recording, transcribing audio, and generating summary...",
  [MeetingStatus.COMPLETED]: "",
  [MeetingStatus.FAILED]: "",
  [MeetingStatus.KICKED]: "",
  [MeetingStatus.ENDED_EMPTY]: "",
  [MeetingStatus.ENDED_ROOM_CLOSED]: ""
};

export function ProgressBanner({ status, progressNote, isActive }: ProgressBannerProps) {
  // For terminal statuses we only show the note if the worker wrote one
  // (e.g. the final "recording uploaded · transcript ready · summary
  // generated" summary line).
  const note =
    progressNote?.trim() || (isActive ? STATUS_FALLBACK[status] : "");

  if (!note) {
    return null;
  }

  return (
    <div
      className={`progress-banner ${isActive ? "progress-banner--active" : "progress-banner--done"}`}
      role="status"
      aria-live="polite"
    >
      {isActive ? (
        <div className="progress-bar" aria-hidden="true">
          <div className="progress-bar-fill" />
        </div>
      ) : null}
      <p className="progress-banner-note">{note}</p>
    </div>
  );
}
