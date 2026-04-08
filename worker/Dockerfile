FROM node:22-bookworm AS build

WORKDIR /app

ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY lib ./lib
COPY worker ./worker
COPY tsconfig.worker.json ./

RUN npm ci
# whisper.cpp is no longer compiled at build time — transcription now uses
# Groq's free hosted Whisper API via LLM_API_KEY. The build is 10+ min
# faster without compiling it. If you want local whisper.cpp, install it
# in your own derived image and set WHISPER_CPP_BINARY / WHISPER_MODEL_PATH.
RUN mkdir -p /ms-playwright
RUN npx playwright install --no-shell chromium
RUN npx prisma generate
RUN npm run worker:build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/node
ENV DISPLAY=:99
ENV XDG_RUNTIME_DIR=/tmp/runtime-node
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_HEADLESS=false
ENV WORKER_PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  ffmpeg \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libu2f-udev \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrender1 \
  libxkbcommon0 \
  libxrandr2 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  pulseaudio \
  xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/worker/start-worker.sh ./worker/start-worker.sh
COPY --from=build /app/worker/scripts ./worker/scripts
COPY --from=build /ms-playwright /ms-playwright

RUN mkdir -p /tmp/runtime-node /app/worker/output \
  && chmod +x worker/start-worker.sh worker/scripts/start-recording.sh \
  && chown -R node:node /app /ms-playwright /tmp/runtime-node

USER node

EXPOSE 8080

CMD ["bash", "worker/start-worker.sh"]
