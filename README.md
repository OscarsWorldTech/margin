# Margin

A self-hosted Audiobookshelf companion for listening with generated captions, saving sentence highlights, and taking notes. Runs with Intel/AMD Vulkan, NVIDIA CUDA, or CPU-only transcription configurations.

**Status: early release, v0.1.5.** Download versioned prebuilt containers instead of compiling locally. The release workflow builds Linux amd64/arm64 app and CPU images, plus amd64 Vulkan and CUDA images. Intel Arc A310 transcription is user-tested; NVIDIA and AMD inference still require hardware validation. [Releases and installation downloads](https://github.com/OscarsWorldTech/margin/releases) appear after the publishing workflow completes.

## What it does

- Connects to an existing Audiobookshelf server using a server-side API token.
- Browses audiobook libraries, with pagination and search of loaded books.
- Streams audio through Margin, including seeking and multiple audio tracks.
- Resumes from Audiobookshelf and writes listening position every 15 seconds while playing, on pause, and on paused seeks. Checks for another device’s position before resuming, when returning to a visible tab, and every 15 seconds while paused.
- Keeps the player running when returning to the library through the Library button or Margin logo. Click the player’s book title to return to its captions. Library selection displays the library name.
- Generates captions with local whisper.cpp, independently of the interface.
- Processes one book at a time in three-minute sections, with one second of context around internal boundaries. Saves completed sections and supports pause/resume. Interrupted jobs become paused after restart.
- Displays captions in sync, follows the active sentence, supports caption search and chapter navigation. Renders 80 passages at a time to keep long audiobooks responsive; use Earlier/Later passages to browse manually.
- Selects sentences with checkboxes or by selecting text. Press **H** to select the currently playing sentence; **Space** toggles playback outside inputs.
- Saves the quote, book timestamp, your note, and highlight color in SQLite. Notes remain attached to their saved quote if captions are replaced.
- Edits/removes notes and exports them as Markdown or JSON.
- Imports existing SRT/VTT captions and allows a session-specific timing adjustment.

## Install or upgrade

Download the installation ZIP from [Releases](https://github.com/OscarsWorldTech/margin/releases), extract its `margin` folder, and follow [Install from prebuilt containers](docs/INSTALL.md). Existing users should copy the updated files into their **existing deployment folder**, preserving `.env`, Compose customizations and the same named volumes/project name.

```sh
sh setup.sh intel
# Or: sh setup.sh nvidia / sh setup.sh cpu / sh setup.sh amd
```

Fill in the Audiobookshelf address/token, Margin password and LAN bind address in `.env`, then:

```sh
docker compose pull
docker compose up -d
sh doctor.sh
```

`setup.sh` now defaults to the prebuilt configurations and preserves credentials. Existing Intel users must run it once to switch from their old source-build Compose file. For later upgrades, set `MARGIN_VERSION` in `.env` to the desired release tag, then pull/start again. The header shows the installed version. No `latest` tag is used and no caption regeneration is needed when retaining existing volumes.

### Playback speed

Click the speed button in the player to open a compact adjustment panel. Choose a preset (0.5×, 1×, 1.2×, 1.5×, or 2×), or use minus/plus to fine-tune in 0.05× or 0.1× steps. The default step is 0.05×; select the 1× preset to reset. The control supports 0.5×–10×, subject to the browser's audio support. Changes apply without seeking, pausing, or reloading the track. Pitch preservation is requested from the browser. Very high speeds can be muted or sound poor in some browsers; choose a lower rate if that happens.

Speed and step size are remembered on this browser across page reloads and book changes. They are device-local preferences, independent of Audiobookshelf's own speed setting. Browser storage restrictions may prevent remembering preferences, but the controls still work during the session. Caption timestamps and synced listening positions continue to use the original book timeline.

### Listening-position sync

The library dropdown switches between the audiobook libraries your configured Audiobookshelf account can access. Progress is shared with the **account that owns `ABS_TOKEN`**, so use that same account in the Audiobookshelf app. A token from a different account synchronizes that other account’s position.

Pause in one app before continuing in the other. Margin reads the current position before starting playback and polls while paused; it does not jump to another device’s position during active playback. Local seeks and listening progress take precedence over a delayed remote read. Sync failures remain visible in the player and retry; switching books or signing out waits for unsaved progress to sync. Settings also offers **Sync progress now**.

Navigating to the library keeps the same audio player alive. Opening the currently playing book restores its reader without reloading audio. Opening a different book saves the old position and loads the new book paused. Closing or reloading the browser still stops playback; a final save is attempted when the page is hidden or closed, but abrupt browser/network termination can lose changes since the last successful sync. Failed progress writes are held in the open page, not persisted as an offline queue. Audiobookshelf listening-session statistics are not included.

## Hardware and source builds

NVIDIA requires a compatible driver and [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the Docker host. Intel/AMD requires working GPU passthrough and a render device. CPU mode needs neither. GPU, model, memory and platform details are in [Hardware and installation](docs/HARDWARE.md).

Developers can use the full repository and opt into source builds:

```sh
MARGIN_INSTALL_MODE=source sh setup.sh cpu
# Substitute intel, amd or nvidia as needed.
docker compose up -d --build
```

Source configurations remain `compose.yml`, `compose.cpu.yml`, and `compose.nvidia.yml`. Prebuilt configurations have `compose.prebuilt` in their filenames. All use the same data-volume names. Never merge two hardware configurations with multiple `-f` arguments.

## Sample mode

To review listening and annotation without your library or GPU:

```sh
docker compose -f compose.demo.yml up --build
```

Open `http://localhost:8787` on the machine running Docker. This mode has no login and binds only to loopback. It uses a short public-domain JFK speech excerpt and prepared, approximate captions. It does not demonstrate automatic transcription. Demo notes have a separate volume.

## Storage and privacy

The `margin-data` volume holds `margin.sqlite` and its journal files, plus an audio cache. The `whisper-models` volume holds model weights. Back up `margin-data` while Margin is stopped, or use a SQLite-aware backup tool. Do not delete these volumes during an upgrade.

The backend downloads each audio track needed for transcription, then deletes it once that track is fully processed. A failed/paused job may leave its current source track cached so it can resume. Allow disk space for the largest source track plus captions and notes. Playback is streamed rather than stored in the browser.

This first version is **single-user**. Everyone with the Margin password sees the same library and annotations, and writes progress to the same Audiobookshelf account. API tokens never appear in the browser's audio URLs or API responses. Sessions expire after seven days and are invalidated by a server restart. Original audio and ebooks are not modified; notes are stored in Margin, not Audiobookshelf.

For remote access, use your existing VPN or HTTPS reverse proxy. Set `COOKIE_SECURE=true` for HTTPS. When the proxy changes the Host header, add your external origin to `ALLOWED_ORIGINS`. The transcription worker has no published host port. This is an initial personal app, not a reviewed multi-tenant public service.

## Known limitations

- **The v0.1.3 speed control is locally built and rendered, but not yet verified in live browser playback on the VM.** The user reports successful A310 transcription and confirms the v0.1.2 update works. Integration tests emulate Audiobookshelf and the transcription response, while running real FFmpeg conversion. Browser interaction tests were not run.
- Captions can mishear names or omit words. Sentence boundaries split inside a recognition segment use estimated proportional timing; this is not word-level forced alignment. Import corrected SRT/VTT captions when needed.
- Caption offset is session-local. Playback speed and its adjustment step are remembered in browser storage. Notes are durable and available when the book is reopened on another device; there is no live multi-device note merge UI.
- Changes to the source audio after transcription require a new caption import or manual reset of that book's stored transcript/job. Automatic audio fingerprinting and retranscription are not implemented yet.
- Multi-track playback can have a short gap at track boundaries. Browser support for an audio codec varies; no fallback HLS transcoder, offline download mode or native mobile app is included.
- Progress sync is implemented, but Audiobookshelf listening-session statistics are not reported. Simultaneous playback on multiple clients can overwrite position with the latest update.
- A source download or inference call can take time to stop. Failed jobs show an error and require an explicit Resume; they are not retried forever in the background.
- Removing a note has no undo. Export before bulk cleanup. There is no bulk delete feature.
- Docker currently builds the frontend from the retained Sites starter dependency lockfile. `npm audit` reports advisories in that starter/build-tool dependency tree. The final runtime image contains static browser assets and the Node standard-library server; it does not include `node_modules`, Vinext, or React Server Components. Review/update build dependencies before a broader deployment.

## Development and checks

The validation workflow checks the app and deployment configurations on pushes and pull requests. Pushing a version tag matching package.json runs the publishing workflow: tests first, native builds for each architecture, application/CPU smoke checks, then version manifests and an installation ZIP. CUDA/Vulkan builds check linking but do not run GPU inference on hosted CPU runners. See `.github/workflows/publish.yml` and `docs/RELEASE.md`.

Node 24+ is recommended. The server uses Node's built-in SQLite and has no runtime npm dependencies. The interface is React + Vite with the starter's Shadcn primitives. The app is deliberately packaged for self-hosting, with no Sites cloud deployment or hosted storage dependency.

```sh
npm ci
npm run build
npm test
```

To also exercise successful conversion and interrupted/resumed transcription in the integration test, set `FFMPEG_PATH` to a local FFmpeg executable before running `npm test`. The inference response remains simulated; this test verifies request format, chunk persistence and multi-track offsets, not speech-recognition accuracy.

For local development, run the server with environment variables (`DEMO_MODE=true` for the sample) and `npm run dev` in another terminal. Allow `http://127.0.0.1:5173` via `ALLOWED_ORIGINS` when using the development proxy. Production is a single Node process on port 8787 plus the worker.

A feature-detected, read-only WebMCP tool exposes the current book, position and notes to a compatible browser agent. Registration was not runtime-tested in a supported WebMCP browser; unsupported browsers simply ignore it.

## Sources and credits

- Speed-control behavior follows the preset/stepper pattern in [Audiobookshelf’s playback speed control](https://github.com/advplyr/audiobookshelf/blob/master/client/components/controls/PlaybackSpeedControl.vue); Margin uses its own React implementation.

- [Audiobookshelf](https://github.com/advplyr/audiobookshelf), its [current progress controller](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/MeController.js), and its [API reference](https://api.audiobookshelf.org/). The reference labels itself outdated; integration should be tested against your server version.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp), including its [Vulkan and Intel backend documentation](https://github.com/ggml-org/whisper.cpp#vulkan-gpu-support).
- Sample audio: [JFK excerpt distributed in whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/samples/jfk.wav), from the 1961 US presidential inaugural address. Prepared sample captions are approximate.
- UI uses React, Base UI/Shadcn and Lucide. Their respective licenses apply.
