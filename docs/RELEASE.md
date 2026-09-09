Prebuilt container release for Margin, a self-hosted Audiobookshelf companion with generated captions, sentence highlights and notes.

- App and CPU transcription images: Linux amd64 and arm64.
- Intel/AMD Vulkan and NVIDIA CUDA transcription images: Linux amd64.
- Download the installation ZIP below, select hardware with `sh setup.sh`, fill in `.env`, and run `docker compose pull` followed by `docker compose up -d`.
- Image versions are pinned explicitly. Existing source installations can switch using the same folder and volumes; captions and notes do not require regeneration.

This is an early release. Automated checks build every image and exercise sample app playback endpoints and CPU transcription. Intel Arc A310 transcription has been reported working. NVIDIA and AMD GPU inference have not been hardware-verified. Native Apple Metal, NVIDIA Jetson/ARM CUDA and Windows GPU setups are not covered by this release.

See the repository's installation and hardware guides for prerequisites. Keep existing `.env` values and named volumes when upgrading. Never use `down -v` to update.
