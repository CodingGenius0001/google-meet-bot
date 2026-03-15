FROM node:22-bookworm

WORKDIR /app

ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json* ./

RUN npm ci
RUN apt-get update && apt-get install -y ffmpeg pulseaudio xvfb git cmake build-essential curl && rm -rf /var/lib/apt/lists/*

COPY . .

RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp
RUN cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build
RUN cmake --build /opt/whisper.cpp/build --config Release -j
RUN bash /opt/whisper.cpp/models/download-ggml-model.sh tiny.en
RUN npx prisma generate
RUN npx playwright install --with-deps chromium
RUN chmod +x worker/start-worker.sh worker/scripts/start-recording.sh

ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADLESS=false
ENV WORKER_PORT=8080
ENV WHISPER_CPP_BINARY=/opt/whisper.cpp/build/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-tiny.en.bin
ENV WHISPER_LANGUAGE=en
ENV WHISPER_THREADS=4

EXPOSE 8080

CMD ["bash", "worker/start-worker.sh"]
