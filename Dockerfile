# Ladas with everything the render pipeline needs: Node, Chromium (page capture + frame drawing) and ffmpeg.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The host gives this service one CPU. Chromium and ffmpeg run at low priority so the web server itself still
# gets time to answer requests (and the host's health checks) while a reel is rendering.
RUN printf '#!/bin/sh\nexec nice -n 15 /usr/bin/chromium "$@"\n' > /usr/local/bin/chromium-low \
 && printf '#!/bin/sh\nexec nice -n 15 /usr/bin/ffmpeg "$@"\n' > /usr/local/bin/ffmpeg-low \
 && chmod +x /usr/local/bin/chromium-low /usr/local/bin/ffmpeg-low

WORKDIR /app

# The build needs the dev dependencies (tsx, vite, typescript), and `npm start` runs through tsx.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    CHROME_PATH=/usr/local/bin/chromium-low \
    FFMPEG_PATH=/usr/local/bin/ffmpeg-low \
    DATA_DIR=/app/data \
    KOKORO_THREADS=2

RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Render sets PORT (10000 by default); locally: docker run -p 5173:5173 -e PORT=5173 ...
EXPOSE 10000
# Run node directly (not through npm) so it is PID 1 and receives the host's shutdown signal, which lets it save pending data.
CMD ["node", "--import", "tsx", "server/index.ts", "--prod"]
