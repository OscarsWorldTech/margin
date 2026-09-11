# Architecture and task map

Margin serves a React/Vite browser interface from a Node HTTP server. The server
proxies Audiobookshelf access, persists data in SQLite, and queues local whisper.cpp
transcription. There is no ChatGPT or Claude API dependency in the application.

| Work area | Start here |
| --- | --- |
| Library, reader, notes UI, persistent audio element | `app/page.tsx` |
| Layout and responsive styling | `app/globals.css` |
| Speed/volume panels | `components/playback-speed.tsx`, `components/playback-volume.tsx` |
| Playback calculations and preferences | `lib/audio-position.ts`, `lib/playback-speed.ts`, `lib/playback-volume.ts` |
| Listening progress ordering and reconciliation | `lib/progress-sync.ts`, `tests/progress.test.mjs` |
| Authentication, API, SQLite, audio proxy, job queue | `server/index.mjs`, `tests/integration.test.mjs` |
| Caption parsing, timing, exports | `server/captions.mjs`, `tests/captions.test.mjs` |
| Container setup and process supervision | `docker/`, `compose*.yml`, `setup.sh`, `doctor.sh` |
| Container validation/publication | `.github/workflows/`, `scripts/smoke-all-in-one.sh` |

## Decisions to preserve

- The server holds `ABS_TOKEN`; browsers receive proxied media addresses. Current
  authentication uses a Margin password and session cookie, not a native-app token API.
- SQLite stores notes, captions, jobs/checkpoints, and positions under `DATA_DIR`
  (`/data` in containers). Models persist separately under `/models`.
- Player time is a book-wide position; individual tracks have start offsets.
  Caption timestamps and saved notes use that book-wide timeline.
- Progress follows the configured Audiobookshelf account. Paused clients can accept
  remote changes; active playback must not jump due to a stale remote response.
  Offline write queues and multi-user isolation are not implemented.
- Volume and speed are browser-local preferences. Book metadata comes from
  Audiobookshelf; annotations remain in Margin.
- All-in-one containers bundle the app and Whisper worker. Audiobookshelf is still
  a separate service. Preserve both data volumes across migrations and updates.

Refer to [usage limitations](USAGE.md), [hardware evidence](HARDWARE.md), and
[development checks](DEVELOPMENT.md) rather than inferring support from a successful build.
