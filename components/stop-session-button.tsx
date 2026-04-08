"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";

type StopSessionButtonProps = {
  meetingId: string;
  /** Already-pending cancel — button becomes a disabled status indicator. */
  alreadyRequested?: boolean;
};

export function StopSessionButton({
  meetingId,
  alreadyRequested = false
}: StopSessionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(alreadyRequested);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isPending || submitted) {
      return;
    }

    const confirmed = window.confirm(
      "Stop this session now? The bot will leave the meeting and upload whatever it has recorded so far."
    );
    if (!confirmed) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/meetings/${meetingId}/cancel`, {
        method: "POST"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "Failed to stop session.");
        return;
      }

      setSubmitted(true);
      startTransition(() => {
        router.refresh();
      });
    } catch (cause) {
      console.error("Stop session request failed.", cause);
      setError("Network error while stopping.");
    }
  }

  return (
    <span className="delete-session-wrap">
      <button
        type="button"
        className="danger-button"
        onClick={handleClick}
        disabled={isPending || submitted}
      >
        {submitted
          ? "Stopping..."
          : isPending
            ? "Stopping..."
            : "Stop session"}
      </button>
      {error ? <span className="delete-error">{error}</span> : null}
    </span>
  );
}
