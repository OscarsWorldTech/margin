# Install Margin from prebuilt containers

Extract this archive and enter its `margin` folder. Docker Engine with the Compose plugin is required.

1. Select hardware:

   ```sh
   sh setup.sh intel
   # Or: sh setup.sh nvidia
   # Or: sh setup.sh cpu
   # AMD Vulkan (experimental): sh setup.sh amd
   ```

2. Edit `.env`: set `ABS_URL`, `ABS_TOKEN`, `MARGIN_PASSWORD`, and `BIND_ADDRESS`. For LAN access, use the VM's LAN address or `0.0.0.0`. Keep `MARGIN_VERSION` pinned to the release you downloaded. NVIDIA requires a compatible driver and NVIDIA Container Toolkit on the Docker host; Intel/AMD requires `/dev/dri` and a working host driver. The helper can read a different render node when passed as its second argument.

3. Download and start:

   ```sh
   docker compose pull
   docker compose up -d
   sh doctor.sh
   ```

4. Open `http://YOUR-HOST-IP:8787`, sign in, and connect to your library. The first worker start downloads its Whisper model; watch `docker compose logs -f whisper`. No application compilation is needed. Images still take disk space, especially CUDA.

The image source is [OscarsWorldTech/margin](https://github.com/OscarsWorldTech/margin). App and CPU images target Linux amd64 and arm64. Vulkan and CUDA images target Linux amd64. Intel A310 has been hardware-tested by a user. NVIDIA and AMD GPU inference remain unverified; build success is not hardware certification.

## Existing installations

Keep your existing folder, `.env`, Compose project name, `margin-data` and `whisper-models` volumes. Copy these installation files into that folder and run `sh setup.sh intel` (or your backend) to switch from source builds to prebuilt images. Existing credentials remain intact. Then run the pull/start commands above. Do not delete volumes or change the project name; the same data is reused. Pause active transcription before replacing its worker.

## Later upgrades

Read the release notes, then set `MARGIN_VERSION` in `.env` to the exact released tag (for example `v0.1.5`), run `docker compose pull`, and run `docker compose up -d`. Refresh and check the version in Margin's header. There is no automatic `latest` upgrade. Reverting to an older version requires checking that release's data/schema compatibility first.

For troubleshooting and GPU prerequisites see [Hardware and installation](docs/HARDWARE.md). The full source archive includes source-build configurations for developers; this small installation bundle only contains prebuilt configurations. Do not run it with `MARGIN_INSTALL_MODE=source`.
