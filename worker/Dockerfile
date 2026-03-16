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
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper.cpp
RUN cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release
RUN cmake --build /tmp/whisper.cpp/build --config Release -j
RUN mkdir -p /opt/whisper.cpp/bin /opt/whisper.cpp/models
RUN cp /tmp/whisper.cpp/build/bin/whisper-cli /opt/whisper.cpp/bin/whisper-cli
RUN bash /tmp/whisper.cpp/models/download-ggml-model.sh tiny.en
RUN cp /tmp/whisper.cpp/models/ggml-tiny.en.bin /opt/whisper.cpp/models/ggml-tiny.en.bin
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
ENV WHISPER_CPP_BINARY=/opt/whisper.cpp/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-tiny.en.bin
ENV WHISPER_LANGUAGE=en
ENV WHISPER_THREADS=4

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
COPY --from=build /opt/whisper.cpp /opt/whisper.cpp

RUN mkdir -p /tmp/runtime-node /app/worker/output \
  && chmod +x worker/start-worker.sh worker/scripts/start-recording.sh \
  && chown -R node:node /app /ms-playwright /tmp/runtime-node

USER node

EXPOSE 8080

CMD ["bash", "worker/start-worker.sh"]
