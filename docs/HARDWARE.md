# Hardware and installation

Margin runs on a Docker host or Docker VM. The browser does not need a GPU. Only the Whisper transcription container uses acceleration; playback, captions and notes work with every configuration.

## Compatibility status

| Hardware / host | Backend | Select with | Verification |
| --- | --- | --- | --- |
| Intel Arc on Linux | Vulkan / Mesa | `sh setup.sh intel` | A310 transcription reported working with GPU activity and accurate captions |
| Other Intel GPUs on Linux | Vulkan / Mesa | `sh setup.sh intel` | Configuration available; driver/model combination needs testing |
| AMD GPU on Linux | Vulkan / Mesa | `sh setup.sh amd` | Experimental; not hardware-tested |
| NVIDIA GPU on Linux x86_64 | CUDA 12.8.1 | `sh setup.sh nvidia` | Native amd64 build checked by the release workflow; GPU inference still unverified |
| CPU on Linux x86_64 / ARM64 | CPU | `sh setup.sh cpu` | amd64 and arm64 builds and sample inference checked by the release workflow |
| macOS Docker Desktop | CPU in the Linux VM | `sh setup.sh cpu` | Configuration available; no Apple Metal acceleration in this package |
| Windows Docker Desktop | CPU in Linux containers | Set `COMPOSE_FILE=compose.prebuilt.cpu.yml` | Configuration available; not tested on Docker Desktop |
| NVIDIA on Windows / WSL2, Jetson, ARM CUDA, ROCm | — | — | Outside the validated setup path for this release |

These are compatibility targets, not a promise that every card works. GPU passthrough, driver support, memory and the chosen model all matter. CPU mode is an explicit alternative if GPU setup fails; the installer does not silently switch backends. Tagged releases publish prebuilt images through GitHub Actions. The small installation ZIP uses these images; see [Install from prebuilt containers](INSTALL.md). Full source archives retain the source-build option.

## New installation

1. Install Docker Engine and its Compose plugin. Extract the entire `margin` folder. Work inside that folder for all commands.
2. Select your hardware with one of the commands in the table. `sh setup.sh` also offers a prompt and defaults to CPU. It creates `.env` only if missing, updates `COMPOSE_FILE`, and sets `RENDER_GID` for Intel/AMD. Existing credentials stay intact. It does not install drivers or modify the Docker daemon.
3. Edit `.env`: set `ABS_URL`, `ABS_TOKEN`, `MARGIN_PASSWORD`, and `BIND_ADDRESS`. Use the VM LAN IP or `0.0.0.0` for LAN access. `127.0.0.1` allows access only from the Docker host. The Audiobookshelf address must be reachable from the container. Use the token for the account whose listening progress you want to sync.
4. Complete the NVIDIA or Vulkan prerequisites below when applicable.
5. Start both services:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose logs -f whisper
   ```

6. Open `http://YOUR-HOST-IP:8787`, sign in, and transcribe a short book first. Run `sh doctor.sh` to check service readiness and device visibility.

Prebuilt installation downloads container images and needs no compiler. Optional source builds download compiler dependencies and Whisper source. The first worker start downloads a model from the official whisper.cpp model repository on Hugging Face. Later inference runs locally. CUDA compilation can be slow and require several GB of disk and RAM; low-memory builders may need swap. Build parallelism defaults to two jobs. CPU's conservative instruction set improves VM/older-CPU compatibility at the cost of speed.

### Manual selection

If you prefer not to run a helper, copy `.env.example` to `.env` for a new installation, then choose one line:

```dotenv
COMPOSE_FILE=compose.prebuilt.cpu.yml
# or COMPOSE_FILE=compose.prebuilt.nvidia.yml
# or COMPOSE_FILE=compose.prebuilt.yml
```

The copied example defaults to CPU. Existing Intel deployments that have no `COMPOSE_FILE` continue to use the source-build `compose.yml` until setup.sh is run. Set `MARGIN_INSTALL_MODE=source` when running setup.sh to explicitly retain source builds. All three are **complete configurations**: do not combine them with multiple `-f` flags or merge NVIDIA over the Intel file. That can leave both GPU mappings active. An explicit `-f` argument overrides the saved choice.

For Portainer or another stack manager, choose the matching complete Compose file and supply its environment values. Local `build` contexts and `.env` behavior depend on the manager; this release's documented installation uses Docker Compose from the extracted folder. `setup.sh` is intended for a Linux Docker host, not a remote Docker context.

## NVIDIA CUDA

1. Install a driver compatible with CUDA 12.8 and your GPU **inside the Docker host/VM**. Confirm `nvidia-smi` works there. A driver on the hypervisor alone is insufficient for a passthrough VM.
2. Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) for the host distribution. Follow its Docker runtime configuration instructions. Configuring/restarting the Docker daemon can interrupt other containers, so use the host's normal maintenance procedure.
3. Run `sh setup.sh nvidia`. Optionally set `NVIDIA_GPU_ID` to an index or GPU UUID from `nvidia-smi`. It defaults to `0` and exposes one GPU to Whisper.
4. Start with `docker compose pull` and `docker compose up -d`. Check:

   ```sh
   docker compose exec whisper nvidia-smi
   docker compose logs --tail=100 whisper
   ```

The configuration uses [Docker's NVIDIA GPU reservation](https://docs.docker.com/compose/how-tos/gpu-support/), with `driver: nvidia`, one device ID and `capabilities: [gpu]`. It has no `/dev/dri` mapping and no `RENDER_GID` requirement. The CUDA image uses official `nvidia/cuda:12.8.1-devel-ubuntu24.04` / `12.8.1-runtime-ubuntu24.04` bases and whisper.cpp v1.8.2. `GGML_NATIVE=OFF` uses the upstream portable CUDA architecture selection; no GPU is required during the Docker image build. Older cards remain dependent on upstream CUDA/kernel support and a driver that can run this toolkit.

Device visibility is only a prerequisite. During a short transcription, check that `whisper-server` appears in `nvidia-smi`, that utilization/memory changes, and that the engine logs select CUDA. This package has not yet been run on an NVIDIA card; do not describe it as NVIDIA-certified.

## Intel and AMD Vulkan

The host/VM must already expose a GPU with a usable Linux driver. Select the render node on that host:

```sh
ls -l /dev/dri
sh setup.sh intel /dev/dri/renderD128
# For AMD: sh setup.sh amd /dev/dri/renderD128
```

The helper reads the render-node group ID automatically. The container receives `/dev/dri` and that group. Mesa and the Vulkan loader are included in the image. On a machine with multiple GPUs, pass the appropriate node; the current worker exposes `/dev/dri` and uses Whisper's normal device selection, so verify which GPU is used.

```sh
docker compose exec whisper vulkaninfo --summary
docker compose logs --tail=100 whisper
```

Look for the actual GPU. `llvmpipe` is a software device and does not establish acceleration. Intel Arc A310 has been reported working; AMD and other Intel devices still need testing. Intel's setup is preserved from earlier Margin releases.

## CPU and model choices

CPU mode needs no GPU, GPU group or NVIDIA runtime. It starts Whisper with `--no-gpu`. It is slower; for constrained machines, try `WHISPER_MODEL=tiny.en` or `base.en` before processing long books. GPU users can also use smaller models when memory is tight. The default remains `small.en` across backends so switching hardware can reuse the same downloaded model.

`WHISPER_THREADS` defaults to 4 and accepts 1–256. It controls CPU threads used by Whisper, including supporting work in GPU mode. More threads do not always mean faster transcription. Multilingual audio needs a multilingual model (for example `small`) and `WHISPER_LANGUAGE=auto` or the language code. Sentence segmentation currently uses English punctuation conventions.

## Upgrades and changing hardware

Keep the same deployment folder, Compose project name, `.env` and named volumes. Copy the new application files into that folder, retaining any Compose customizations. For prebuilt updates, change `MARGIN_VERSION` to the chosen release tag first:

```sh
docker compose pull
docker compose up -d
```

After pulling, use `docker compose up -d --no-deps margin` for an app-only update, or `docker compose up -d --no-deps whisper` for a worker-only update. Source builds instead use `--build`. Neither requires `docker compose down`.

To change hardware, pause transcription and wait for its current section to finish, run `sh setup.sh nvidia` (or another backend), then `docker compose pull` and `docker compose up -d`. Resume any interrupted transcription in Margin. All configurations use the same `margin-data` and `whisper-models` volume keys. Captions and notes do not need regeneration. Do not use `down -v`; it removes the stored data. Running under another project name creates different volumes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `could not select device driver ... capabilities: [[gpu]]` | NVIDIA Container Toolkit and Docker runtime configuration on the Docker host |
| `nvidia-smi` fails inside the VM | Driver installation and VM passthrough before Docker |
| CUDA driver/version or unsupported GPU error | Driver/toolkit/card compatibility; use CPU mode if needed |
| GPU out-of-memory | Smaller Whisper model and other processes using the card |
| Intel/AMD device permission error | Correct render-node group in `.env`; rerun the helper for that node |
| Worker stopped after an update | `down` stopped both services; run `docker compose up -d` to bring both back |
| GPU visible but transcription slow | Actual backend/device selection, CPU fallback, model size and CPU threads |
| Health check fails during first start | Watch model-download progress in worker logs |
| Old version still in the header | Copy the updated source into the actual build folder, rebuild Margin, then force-refresh |

`doctor.sh` checks the saved Compose selection without printing configuration secrets. It does not install packages, restart services, collect book data or upload logs. Health and device checks are not a transcription benchmark.
