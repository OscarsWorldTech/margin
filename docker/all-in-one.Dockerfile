ARG WORKER_IMAGE=ghcr.io/oscarsworldtech/margin-whisper:v0.1.5-cpu
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Reuse the tested CPU, Vulkan or CUDA worker, including its native runtime libraries.
FROM ${WORKER_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini libatomic1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY server ./server
COPY package.json LICENSE ./
COPY public/demo.json public/demo.wav ./public/
COPY docker/all-in-one.mjs docker/all-in-one-health.mjs ./docker/
COPY docker/whisper-entrypoint.sh /usr/local/bin/start-whisper
RUN sed -i 's/\r$//' /usr/local/bin/start-whisper && chmod 755 /usr/local/bin/start-whisper && mkdir -p /data/cache /models && chown -R 1000:1000 /data /models /app && node --version
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data WHISPER_HOST=127.0.0.1 WHISPER_URL=http://127.0.0.1:8080
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --start-period=10m --retries=3 CMD ["node", "/app/docker/all-in-one-health.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/docker/all-in-one.mjs"]
CMD []
