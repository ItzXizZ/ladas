# Reel Studio with everything the render pipeline needs: Node, Chromium (page capture + frame drawing) and ffmpeg.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The build needs the dev dependencies (tsx, vite, typescript), and `npm start` runs through tsx.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    CHROME_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    DATA_DIR=/app/data

RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Render sets PORT (10000 by default); locally: docker run -p 5173:5173 -e PORT=5173 ...
EXPOSE 10000
CMD ["npm", "start"]
