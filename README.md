# MeetMate

MeetMate is a starter for a Google Meet note-taking bot with a Vercel-hosted dashboard and a separate browser worker that actually joins meetings.

## What this repo does

- Accepts a Google Meet link from a web dashboard.
- Stores meeting jobs in TiDB through Prisma's MySQL connector.
- Runs a long-lived Playwright worker that claims queued jobs, joins the meeting, and stays until:
  - the call ends,
  - everyone else leaves, or
  - the bot gets removed.
- Captures best-effort live captions for transcript snippets.
- Records the session inside the Linux worker container.
- Extracts audio from the recording and transcribes it locally with `whisper.cpp`.
- Uploads recordings to Vercel Blob when configured.
- Generates a free automatic summary from the transcript, with optional Ollama support if you want a self-hosted LLM later.

## Architecture

- `app/`: Next.js App Router dashboard and API routes. This is the part you deploy to Vercel.
- `prisma/`: shared schema for the dashboard and the worker.
- `worker/`: Playwright + FFmpeg worker. This must run on a long-lived host like Railway, Fly.io, Render, or your own VM.

Vercel cannot run the browser bot itself. It can host the website and API, but the Meet automation requires a persistent process and a browser environment.

## Local setup

1. Copy `.env.example` to `.env`.
2. Point `DATABASE_URL` at a TiDB database.
3. Install dependencies with `npm install`.
4. Generate the Prisma client and apply migrations:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Optional: save Google auth state for meetings that do not allow guest access:

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
| `DATABASE_URL` | Yes | Web + worker | Shared TiDB database for meeting jobs |
| `OLLAMA_HOST` | Optional | Web + worker | Local Ollama host for a better self-hosted summary model |
| `OLLAMA_MODEL` | Optional | Web + worker | Ollama model name to use for summaries |
| `BLOB_READ_WRITE_TOKEN` | For hosted recordings | Web + worker | Upload recordings to Vercel Blob |
| `GOOGLE_MEET_STORAGE_STATE_PATH` | Optional | Worker | Path to a saved Playwright Google session file |
| `GOOGLE_MEET_STORAGE_STATE_BASE64` | Optional | Worker | Base64-encoded contents of the saved Playwright Google session |
| `GOOGLE_MEET_GUEST_NAME` | Recommended for hosted guest mode | Worker | Name the bot uses when joining without a Google account |
| `WORKER_SUMMON_URL` | Optional | Web | Public worker URL that the dashboard calls to wake a serverless worker immediately |
| `WORKER_SUMMON_TOKEN` | Optional | Web + worker | Shared secret that protects the worker `/summon` endpoint |
| `WORKER_POLL_INTERVAL_MS` | Optional | Worker | Poll interval for always-on VM workers like Oracle; leave `0` for summon-only serverless setups |
| `SOLO_GRACE_PERIOD_MS` | No | Worker | How long to stay after the bot is alone |
| `JOIN_TIMEOUT_MS` | No | Worker | Admission timeout before failure |
| `TRANSCRIPTION_SEGMENT_SECONDS` | No | Worker | Audio chunk size before feeding `whisper.cpp` |
| `WHISPER_CPP_BINARY` | No | Worker | Path to the `whisper.cpp` CLI binary |
| `WHISPER_MODEL_PATH` | No | Worker | Path to the local Whisper model file |
| `WHISPER_LANGUAGE` | No | Worker | Language hint passed to `whisper.cpp` |
| `WHISPER_THREADS` | No | Worker | CPU thread count for local transcription |
| `WORKER_PORT` | No | Worker | Enables `/healthz` for worker deployment platforms |
| `DISPLAY` | No | Worker | X virtual display name |
| `PULSE_SOURCE` | No | Worker | Audio input source for FFmpeg |

## Deployment

### Vercel

- Deploy the root app to Vercel.
- Add the shared environment variables from the table above.
- Use a TiDB Cloud database and paste its Prisma/MySQL connection string into `DATABASE_URL`.
- The included `vercel.json` runs `prisma migrate deploy` before `next build`, so the initial schema can be created during Vercel deployment without a local setup step.
- `vercel.json` is included so Vercel builds the Next.js app from the repo root.

### Railway worker

1. Create a new Railway service from this GitHub repo.
2. Set the service to build with the included `railway.json`, which points Railway at `worker/Dockerfile`.
3. Add the worker environment variables from the table above.
4. Set `WORKER_SUMMON_URL` in Vercel to your Railway worker URL, for example `https://your-worker.up.railway.app`.
5. Set the same `WORKER_SUMMON_TOKEN` in both Vercel and Railway so only your dashboard can wake the worker.
6. Enable Railway `Serverless` for the worker service so it sleeps when idle and wakes on the next summon request.
7. For the simplest hosted setup, leave Google auth unset and set `GOOGLE_MEET_GUEST_NAME` so the bot joins as a guest.
8. If you need signed-in meetings later, set `GOOGLE_MEET_STORAGE_STATE_BASE64` to the base64-encoded contents of your saved Playwright auth file instead.
9. Keep `PLAYWRIGHT_HEADLESS=false` because the recorder captures the virtual display.
10. The Docker image already builds `whisper.cpp` and downloads the `tiny.en` model for free local transcription.
11. Railway injects `PORT` automatically; the worker now respects that and only needs `WORKER_PORT` if you run it somewhere else manually.

### Oracle Cloud Always Free worker

1. Create an Ubuntu VM on Oracle Cloud Always Free.
2. For this workload, prefer an Ampere A1 Flex shape so the worker has enough CPU and memory for Chromium, FFmpeg, and local transcription.
3. SSH into the VM, clone this repo, and run:

   ```bash
   bash deploy/oracle/install-docker.sh
   ```

4. Sign out and back in once so your shell picks up the Docker group.
5. Copy `deploy/oracle/.env.worker.example` to `deploy/oracle/.env.worker` and fill in the worker secrets.
6. Keep `WORKER_POLL_INTERVAL_MS=15000` so the Oracle worker polls TiDB directly and does not need to be reachable from the public internet.
7. Start or update the worker:

   ```bash
   bash deploy/oracle/run-worker.sh
   ```

8. Check local health on the VM:

   ```bash
   curl http://127.0.0.1:8080/healthz
   ```

9. Leave `WORKER_SUMMON_URL` unset in Vercel if you are using Oracle polling mode. The dashboard will still queue jobs in TiDB, and the Oracle worker will pick them up automatically on its next poll.
10. If you later want instant wake behavior as well, expose the worker behind HTTPS and point `WORKER_SUMMON_URL` at that URL, but it is not required for Oracle.

### Other worker hosts

- Build from `worker/Dockerfile`.
- The container starts through `worker/start-worker.sh`, which brings up Xvfb, PulseAudio, and the worker loop.
- Expose `WORKER_PORT` if your platform expects an HTTP health check.
- Set `WORKER_POLL_INTERVAL_MS` on always-on VM hosts that should poll TiDB directly instead of waiting for `/summon`.
- The container also includes `whisper.cpp`, so you do not need an external transcription API.

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

## TiDB Notes

- Set `DATABASE_URL` to the exact Prisma connection string TiDB Cloud gives you in its Connect dialog.
- This repo now uses Prisma's `mysql` datasource because TiDB is MySQL-compatible at the Prisma layer.
- For public TiDB Cloud endpoints, TiDB's docs require TLS parameters in the connection string. Do not guess them; copy the Prisma connection string TiDB generates for your cluster.

## Google Auth Export

After you run `npm run worker:auth`, the default saved auth file is `worker/.auth/google-user.json`.

To convert it into the Railway-friendly `GOOGLE_MEET_STORAGE_STATE_BASE64` value on Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("worker/.auth/google-user.json"))
```

## Known constraints

- Google Meet DOM selectors change. The Playwright bot is intentionally structured for maintenance, but you should expect to update selectors over time.
- Google may block automated Google-account sign-ins, so hosted guest-mode joining is the simplest path.
- Guest-mode joining only works when the meeting allows guests or allows them to ask to join and be admitted.
- Live captions are still best-effort. The worker now prefers post-call transcription from the saved recording when `whisper.cpp` is available.
- Very long recordings are chunked into audio segments before transcription.
- The default free summary is extractive, not a large hosted model. If you want a stronger local summary, point the app at a self-hosted Ollama instance.
- Recording people in calls can trigger legal and policy requirements. Make sure your workflow and notices comply with the jurisdictions you operate in.
