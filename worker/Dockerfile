FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install
RUN apt-get update && apt-get install -y ffmpeg pulseaudio xvfb && rm -rf /var/lib/apt/lists/*
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADLESS=false

CMD ["bash", "-lc", "Xvfb :99 -screen 0 1440x960x24 & pulseaudio --start && npm run worker:dev"]

