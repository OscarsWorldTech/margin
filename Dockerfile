FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY server ./server
COPY package.json LICENSE ./
COPY public/demo.json public/demo.wav ./public/
RUN mkdir -p /data/cache && chown -R node:node /data /app
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
