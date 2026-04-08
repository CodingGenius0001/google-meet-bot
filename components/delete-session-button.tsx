"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent } from "react";

type DeleteSessionButtonProps = {
  meetingId: string;
  label?: string;
  /**
   * Where to navigate after a successful delete. If omitted the current
   * route is refreshed in-place (useful when the button is on a list page).
   */
  redirectTo?: string;
  /** Visual style — `primary` for the detail page, `ghost` for list cards. */
  variant?: "primary" | "ghost";
  /**
   * Bypass the server-side active-status guard. Used for "force delete"
   * on sessions that are wedged in PROCESSING because the worker crashed
   * or was replaced mid-run.
   */
  force?: boolean;
};

export function DeleteSessionButton({
  meetingId,
  label = "Delete session",
  redirectTo,
  variant = "ghost",
  force = false
}: DeleteSessionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // The delete button on a list card is rendered inside an anchor that
    // links to the detail page. Stop the click from bubbling up and
    // triggering the navigation.
    event.preventDefault();
    event.stopPropagation();

    if (isPending) {
      return;
    }

    const confirmed = window.confirm(
      force
        ? "Force delete this stuck session? Any running worker will lose ownership on its next heartbeat. This cannot be undone."
        : "Delete this session? The recording, transcript, and summary will be removed. This cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    setError(null);

    try {
      const url = force
        ? `/api/meetings/${meetingId}?force=1`
        : `/api/meetings/${meetingId}`;
      const response = await fetch(url, {
        method: "DELETE"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "Failed to delete session.");
        return;
      }

      startTransition(() => {
        if (redirectTo) {
          // Next.js typedRoutes wants a RouteImpl here, but this prop is a
          // free-form target chosen by the caller — cast to keep the tsc
          // run clean while still passing through the literal path.
          router.push(redirectTo as never);
        } else {
          router.refresh();
        }
      });
    } catch (cause) {
      console.error("Delete session request failed.", cause);
      setError("Network error while deleting.");
    }
  }

  const className = variant === "primary" ? "danger-button" : "ghost-button danger-link";

  return (
    <span className="delete-session-wrap">
      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Deleting..." : label}
      </button>
      {error ? <span className="delete-error">{error}</span> : null}
    </span>
  );
}
