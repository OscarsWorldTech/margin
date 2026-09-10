# Development

Use Node.js **24 or newer** and npm. Install FFmpeg for transcription and integration checks. The server uses Node's built-in SQLite with no runtime npm dependencies; the frontend uses React, Vite and Base UI components.

```sh
npm ci
npm run build
FFMPEG_PATH=/path/to/ffmpeg npm test
```

Without `FFMPEG_PATH`, the integration test reports that its real conversion/resume portion was not run. Audiobookshelf and inference responses are mocked in that test. Docker Compose configuration tests need the Compose CLI; no running daemon is needed for those checks. GPU inference needs a real GPU host.

## Sample mode

Run the built app against a separate sample database:

```sh
DEMO_MODE=true DATA_DIR=./data-demo node server/index.mjs
```

Open http://127.0.0.1:8787. Sample mode has no password, uses prepared captions, and should stay bound to loopback. Demo notes are real persisted records in this separate database. Do not point sample mode at production data. For Docker from a full source checkout:

```sh
docker compose -f compose.demo.yml up --build
```

For frontend hot reload, run the sample server with `ALLOWED_ORIGINS=http://127.0.0.1:5173`, then run `npm run dev` in another terminal. The Vite proxy sends `/api` requests to the server on port 8787. Windows users can set these environment variables in PowerShell before running Node.

## Source installation

With a complete repository checkout:

```sh
MARGIN_INSTALL_MODE=source sh setup.sh cpu
# Substitute intel, amd or nvidia when appropriate.
# Edit .env as described in the README.
docker compose up -d --build
```

Source configurations are complete files, not overlays. Do not combine hardware files with multiple `-f` arguments. The small release installation ZIP has prebuilt configurations only and cannot build from source.

## Releases and checks

Pushes and PRs run `.github/workflows/check.yml`. Version tags matching package.json trigger publishing: app tests, native amd64/arm64 app and CPU builds with smoke tests, and amd64 CUDA/Vulkan linking checks. Release manifests and an installation ZIP follow only after all jobs pass. Hosted runners do not verify GPU inference.

Development work should stay on branches for review. Do not push a version tag or run publishing just to test a change. Existing published image tags remain unchanged until an intentional release. `python scripts/release-bundle.py` creates a local installation archive, not a release.

README screenshots are actual demo-mode captures with synthetic annotations. Keep tokens, private books and personal host addresses out of screenshots. The optional read-only WebMCP tool exposes the current demo/book context on compatible browsers; unsupported browsers ignore it.
