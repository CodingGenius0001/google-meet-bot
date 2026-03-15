import { MeetingForm } from "@/components/meeting-form";
import { MeetingList } from "@/components/meeting-list";
import { listMeetingJobs } from "@/lib/meetings";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const meetings = await listMeetingJobs();

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          MeetMate
        </div>
        <span className="subtle">Google Meet capture and recap pipeline</span>
      </div>

      <section className="hero">
        <div className="panel hero-copy">
          <span className="eyebrow">Meeting automation</span>
          <h1>Join the room, capture the call, keep the recap.</h1>
          <p>
            Queue a Google Meet bot from the web app, let it stay for the whole session, and
            review recordings, transcript snippets, and AI-generated summaries after the call.
          </p>
          <div className="hero-grid">
            <div className="metric">
              <strong>1 link</strong>
              <span>Paste a Meet URL and queue the bot.</span>
            </div>
            <div className="metric">
              <strong>Full session</strong>
              <span>Leave when the room ends, empties out, or kicks the bot.</span>
            </div>
            <div className="metric">
              <strong>AI recap</strong>
              <span>Use captions plus summarization to preserve the meeting outcome.</span>
            </div>
          </div>
        </div>

        <div className="panel form-panel">
          <h2>Queue a meeting bot</h2>
          <p className="subtle">
            Vercel hosts the dashboard. A separate worker service runs Playwright and the recorder.
          </p>
          <MeetingForm />
        </div>
      </section>

      <section className="grid">
        <MeetingList meetings={meetings} />
      </section>
    </main>
  );
}
