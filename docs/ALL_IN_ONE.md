# All-in-one Docker images

These images contain Margin, FFmpeg and Whisper. Audiobookshelf remains a separate server. Run **one Margin container** and publish port **8787**. Whisper listens on loopback inside that container.

Use `:latest-aio-cpu`, `:latest-aio-vulkan`, or `:latest-aio-cuda` to follow the
newest published version after all release checks pass. This includes early
versions marked as GitHub prereleases. Preview builds remain separate. To pin a
release, use `:v0.1.6-aio-cpu`, `:v0.1.6-aio-vulkan`, or `:v0.1.6-aio-cuda`.
The plain `:v0.1.6` tag is app-only.

| Host | Image | Requirements |
| --- | --- | --- |
| Linux amd64 or arm64 | `ghcr.io/oscarsworldtech/margin:latest-aio-cpu` | No GPU required |
| Intel / experimental AMD, Linux amd64 | `ghcr.io/oscarsworldtech/margin:latest-aio-vulkan` | Host driver, `/dev/dri`, render-group permission |
| NVIDIA, Linux amd64 | `ghcr.io/oscarsworldtech/margin:latest-aio-cuda` | Compatible driver and NVIDIA Container Toolkit |

CPU images receive real inference, container recreation and shutdown checks on both architectures. GPU images receive build/library checks; inference needs validation on the target host. See [hardware prerequisites](HARDWARE.md).

## Install with Docker

Follow the [README's pull and run instructions](../README.md#install-the-all-in-one-image). For direct `docker run --env-file margin.env`, use plain values **without surrounding quotes** in `margin.env`. Docker's environment-file format differs from Compose's `.env` quoting rules.

For Intel, use the Vulkan image and add these options **before the image name** in the run command:

```sh
--device /dev/dri --group-add "$(stat -c '%g' /dev/dri/renderD128)"
```

For NVIDIA, use the CUDA image and add:

```sh
--gpus '"device=0"'
```

Substitute the appropriate render node or NVIDIA device on multi-GPU hosts. Drivers and passthrough must already work inside the Docker host or VM. The image cannot install the host GPU driver.

Before network access, configure [HTTPS and proxy trust](HTTPS.md). Version 0.1.6 enforces these defaults; read the migration guide before upgrading older installations.

## Install with Compose

The repository and v0.1.6 installation bundle include three complete, single-container configurations: `compose.aio.cpu.yml`, `compose.aio.intel.yml` (also usable for experimental AMD Vulkan), and `compose.aio.nvidia.yml`.

Create a `.env` alongside the chosen file:

```dotenv
ABS_URL=https://YOUR-AUDIOBOOKSHELF-HOST
ABS_TOKEN='YOUR-API-KEY'
MARGIN_PASSWORD='CHOOSE-A-LONG-UNIQUE-PASSWORD'
BIND_ADDRESS=127.0.0.1
TRUSTED_PROXIES=YOUR_EXACT_PROXY_PEER_IP
COOKIE_SECURE=true
ALLOW_INSECURE_HTTP=false
MARGIN_AIO_VERSION=latest
WHISPER_MODEL=small.en
WHISPER_LANGUAGE=en
# Intel/AMD: add RENDER_GID with the numeric result of stat -c '%g' /dev/dri/renderD128
# NVIDIA: optionally add NVIDIA_GPU_ID=0
```

Compose supports single-quoted values here, which preserve literal `$` characters. Do not reuse this quoted file with `docker run --env-file`.

For CPU:

```sh
docker compose -f compose.aio.cpu.yml pull
docker compose -f compose.aio.cpu.yml up -d
docker compose -f compose.aio.cpu.yml logs -f margin
```

Use the Intel or NVIDIA filename in all three commands when appropriate. No separate `whisper` service or `setup.sh` step is needed. Portainer users can paste the complete chosen file into a stack and supply its environment values.

## First startup and diagnostics

The first startup downloads the selected model into `/models`. The UI can open while that happens; wait for Whisper to load before generating captions. Follow `docker logs -f margin` for direct Docker installs, or the Compose logs command above. Ctrl+C stops following logs without stopping the container.

The health check requires both the web app and Whisper to answer. It allows ten minutes for initial setup before counting readiness failures; slower downloads can take longer. An unhealthy status alone does not trigger Docker's restart policy. If either process exits, the supervisor stops the other and exits, allowing Docker to restart the container. Missing Audiobookshelf settings or password fail startup with a configuration message.

For a direct Docker install:

```sh
docker inspect margin --format '{{.State.Health.Status}}'
docker exec margin node /app/docker/all-in-one-health.mjs
```

The app's Connections & timing dialog can also check the engine. Do not publish port 8080; it is internal. For HTTPS, configure the exact proxy peer in `TRUSTED_PROXIES` and any required `ALLOWED_ORIGINS`; see [HTTPS setup](HTTPS.md).

## Persistent data and updates

Set `MARGIN_AIO_VERSION=latest` in your existing Compose `.env` to follow new
releases. Older installation ZIPs may default to a fixed version; this explicit
setting overrides that default. If your Compose image contains a hard-coded tag,
replace that tag with the appropriate `latest-aio-*` tag instead.
Use `MARGIN_AIO_VERSION=v0.1.6` to stay pinned. `latest` alone does not upgrade a
running container: pull and recreate it when you choose to update.

Keep both mounts: `/data` contains captions, notes and transcription progress; `/models` contains downloaded models. Fresh named volumes are prepared for UID/GID 1000. Bind mounts must be writable by that user. The container does not run as root or change arbitrary host-folder ownership at startup.

Pause transcription and wait for its current section before updating. With Compose, repeat `pull` and `up -d` using the same filename, directory and project name. With direct Docker, pull the chosen tag, stop and remove only the old container, then repeat the original run command with the **same volume names and environment file**. Do not delete the volumes. Models and saved notes survive container recreation.

## Move an existing two-container installation

Back up your data first. Pause transcription and wait for its current section, then inspect the mounts on the old Margin and Whisper containers:

```sh
docker inspect OLD_MARGIN_CONTAINER --format '{{range .Mounts}}{{println .Name .Source .Destination}}{{end}}'
docker inspect OLD_WHISPER_CONTAINER --format '{{range .Mounts}}{{println .Name .Source .Destination}}{{end}}'
```

Stop the old stack without deleting volumes. Mount its existing Margin data volume at `/data` and its existing Whisper models volume at `/models` in the new container. Compose normally prefixes volume names with the project name: fresh volumes named `margin-data` and `whisper-models` do not automatically find old data. For a Compose migration, declare each existing volume explicitly with `external: true` and `name: YOUR_EXISTING_VOLUME_NAME`. Keep only one Margin instance writing to that database.

Open a book and verify its notes and captions before removing the old containers. Interrupted transcription can resume from saved sections. See the [upgrade guide](UPGRADING.md) for general backup guidance.

## Building from source

The Dockerfile reuses a published worker image to avoid compiling Whisper again. A full repository checkout is required:

```sh
docker build -f docker/all-in-one.Dockerfile -t margin-aio:local .
# For Intel/AMD add: --build-arg WORKER_IMAGE=ghcr.io/oscarsworldtech/margin-whisper:v0.1.6-vulkan
# For NVIDIA add: --build-arg WORKER_IMAGE=ghcr.io/oscarsworldtech/margin-whisper:v0.1.6-cuda
```

You may also supply a locally built worker image. See [development](DEVELOPMENT.md) for tests and release workflows.
