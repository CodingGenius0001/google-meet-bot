# MeetMate

MeetMate is a starter for a Google Meet note-taking bot with a Vercel-hosted dashboard and a separate browser worker that actually joins meetings.

## What this repo does

- Accepts a Google Meet link from a web dashboard.
- Stores meeting jobs in Postgres through Prisma.
- Runs a long-lived Playwright worker that claims queued jobs, joins the meeting, and stays until:
  - the call ends,
  - everyone else leaves, or
  - the bot gets removed.
- Captures best-effort live captions for transcript snippets.
- Records the session inside the Linux worker container.
- Uploads recordings to Vercel Blob when configured.
- Generates an AI summary from the transcript with the OpenAI Responses API.

## Architecture

- `app/`: Next.js App Router dashboard and API routes. This is the part you deploy to Vercel.
- `prisma/`: shared schema for the dashboard and the worker.
- `worker/`: Playwright + FFmpeg worker. This must run on a long-lived host like Railway, Fly.io, Render, or your own VM.

Vercel cannot run the browser bot itself. It can host the website and API, but the Meet automation requires a persistent process and a browser environment.

## Local setup

1. Copy `.env.example` to `.env`.
2. Point `DATABASE_URL` at a Postgres database.
3. Install dependencies with `npm install`.
4. Generate the Prisma client and apply migrations:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Save Google auth state for the worker:

   ```bash
   npm run worker:auth
   ```

6. Start the dashboard:

   ```bash
   npm run dev
   ```

7. Start the worker in a second terminal:

   ```bash
   npm run worker:dev
   ```

## Deployment

### Vercel

- Deploy the root app to Vercel.
- Add `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `BLOB_READ_WRITE_TOKEN`.
- Use a managed Postgres database like Neon, Supabase, or Vercel Postgres.

### Worker host

- Build from `worker/Dockerfile`.
- Provide the same `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `BLOB_READ_WRITE_TOKEN`.
- Mount or bake in the auth state file referenced by `GOOGLE_MEET_STORAGE_STATE_PATH`.
- Keep `PLAYWRIGHT_HEADLESS=false` because the recorder captures the virtual display.

## Known constraints

- Google Meet DOM selectors change. The Playwright bot is intentionally structured for maintenance, but you should expect to update selectors over time.
- Automatic joining with a consumer Google account is brittle and may hit anti-automation checks.
- Transcript capture currently relies on live captions being available and detectable in the page.
- Recording people in calls can trigger legal and policy requirements. Make sure your workflow and notices comply with the jurisdictions you operate in.
