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
- Extracts audio from the recording and sends it to OpenAI transcription models.
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
   npm run worker:start
   ```

8. Check health endpoints:

   - Web: `http://localhost:3000/api/health`
   - Worker: `http://localhost:8080/healthz`

## Environment variables

| Variable | Required | Used by | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Web + worker | Shared Postgres database for meeting jobs |
| `OPENAI_API_KEY` | For transcripts/summaries | Web + worker | Enables transcription and summary generation |
| `OPENAI_MODEL` | No | Web + worker | Summary model, defaults to `gpt-4.1-mini` |
| `OPENAI_TRANSCRIPTION_MODEL` | No | Worker | Recording transcription model, defaults to `gpt-4o-mini-transcribe` |
| `OPENAI_TRANSCRIPTION_LANGUAGE` | No | Worker | Hint language for transcription |
| `BLOB_READ_WRITE_TOKEN` | For hosted recordings | Web + worker | Upload recordings to Vercel Blob |
| `GOOGLE_MEET_STORAGE_STATE_PATH` | Yes for reliable joins | Worker | Logged-in Google session used by Playwright |
| `WORKER_POLL_INTERVAL_MS` | No | Worker | Queue polling interval |
| `SOLO_GRACE_PERIOD_MS` | No | Worker | How long to stay after the bot is alone |
| `JOIN_TIMEOUT_MS` | No | Worker | Admission timeout before failure |
| `TRANSCRIPTION_SEGMENT_SECONDS` | No | Worker | Audio chunk size before sending to OpenAI |
| `WORKER_PORT` | No | Worker | Enables `/healthz` for worker deployment platforms |
| `DISPLAY` | No | Worker | X virtual display name |
| `PULSE_SOURCE` | No | Worker | Audio input source for FFmpeg |

## Deployment

### Vercel

- Deploy the root app to Vercel.
- Add the shared environment variables from the table above.
- Use a managed Postgres database like Neon, Supabase, or Vercel Postgres.
- `vercel.json` is included so Vercel builds the Next.js app from the repo root.

### Railway worker

1. Create a new Railway service from this GitHub repo.
2. Set the service to build with the included `railway.json`, which points Railway at `worker/Dockerfile`.
3. Add the worker environment variables from the table above.
4. Mount or bake in the auth state file referenced by `GOOGLE_MEET_STORAGE_STATE_PATH`.
5. Keep `PLAYWRIGHT_HEADLESS=false` because the recorder captures the virtual display.
6. Use `WORKER_PORT=8080` so Railway can probe `GET /healthz`.

### Other worker hosts

- Build from `worker/Dockerfile`.
- The container starts through `worker/start-worker.sh`, which brings up Xvfb, PulseAudio, and the worker loop.
- Expose `WORKER_PORT` if your platform expects an HTTP health check.

## GitHub Actions

The repo now includes CI in `.github/workflows/ci.yml` and production deploy automation in `.github/workflows/deploy.yml`.

### Required GitHub secrets

| Secret | Required for | Purpose |
| --- | --- | --- |
| `VERCEL_TOKEN` | Vercel deploy | Auth for the Vercel CLI |
| `VERCEL_ORG_ID` | Vercel deploy | Target Vercel org |
| `VERCEL_PROJECT_ID` | Vercel deploy | Target Vercel project |
| `RAILWAY_TOKEN` | Railway deploy | Auth for Railway CLI, ideally a project token |
| `RAILWAY_SERVICE` | Railway deploy | Service name or service id for the worker |
| `RAILWAY_ENVIRONMENT` | Optional Railway deploy | Railway environment name or id |
| `RAILWAY_PROJECT_ID` | Optional Railway deploy | Needed only if you are using an account token instead of a scoped project token |

### Workflow behavior

- Every pull request and push to `main` runs CI.
- A successful CI run on `main` triggers production deploys.
- The Vercel deploy job is skipped unless all three Vercel secrets are set.
- The Railway deploy job is skipped unless `RAILWAY_TOKEN` and `RAILWAY_SERVICE` are set.

### Avoid duplicate deploys

- If you use this GitHub Actions setup for Vercel, disable Vercel's automatic Git-based production deploys for the same branch.
- If Railway is already auto-deploying from GitHub, disable that integration or remove the Railway deploy job here.

## Known constraints

- Google Meet DOM selectors change. The Playwright bot is intentionally structured for maintenance, but you should expect to update selectors over time.
- Automatic joining with a consumer Google account is brittle and may hit anti-automation checks.
- Live captions are still best-effort. The worker now prefers post-call transcription from the saved recording when OpenAI and FFmpeg are available.
- Very long recordings are chunked into audio segments before transcription.
- Recording people in calls can trigger legal and policy requirements. Make sure your workflow and notices comply with the jurisdictions you operate in.
