"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type CreateMeetingResponse = {
  id: string;
};

export function MeetingForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "");
    const meetUrl = String(formData.get("meetUrl") ?? "");

    setError(null);

    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/meetings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title,
            meetUrl
          })
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? "Unable to queue the meeting bot.");
          return;
        }

        const payload = (await response.json()) as CreateMeetingResponse;
        router.push(`/meetings/${payload.id}`);
        router.refresh();
      })();
    });
  }

  return (
    <form className="meeting-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="title">Session label</label>
        <input
          id="title"
          name="title"
          placeholder="Weekly sync, office hours, customer demo..."
          maxLength={120}
        />
      </div>
      <div className="field">
        <label htmlFor="meetUrl">Google Meet link</label>
        <input
          id="meetUrl"
          name="meetUrl"
          type="url"
          placeholder="https://meet.google.com/abc-defg-hij"
          required
        />
      </div>
      <button className="primary-button" type="submit" disabled={isPending}>
        {isPending ? "Queueing bot..." : "Join this meeting"}
      </button>
      <p className="form-note">
        The worker will hold the room until it ends, empties out, or the bot is removed.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
