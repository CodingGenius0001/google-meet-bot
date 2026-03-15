FROM node:22-bookworm

WORKDIR /app

ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json* ./

RUN npm ci
RUN apt-get update && apt-get install -y ffmpeg pulseaudio xvfb && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npx prisma generate
RUN npx playwright install --with-deps chromium
RUN chmod +x worker/start-worker.sh worker/scripts/start-recording.sh

ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADLESS=false
ENV WORKER_PORT=8080

EXPOSE 8080

CMD ["bash", "worker/start-worker.sh"]

