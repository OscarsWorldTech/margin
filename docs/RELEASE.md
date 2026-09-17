# Margin v0.1.6

Read along with the original ebook text, with or without Storyteller.

- Pair a DRM-free EPUB from a read-only folder with an Audiobookshelf recording. Reuse completed captions or generate them locally, then review coverage and sample playback before activating the alignment. Timings are approximate; unmatched passages are omitted.
- Import timed passages from aligned Storyteller EPUBs. Original captions and saved notes are preserved.
- Versioned all-in-one Docker images include Margin, FFmpeg and Whisper in one container: `ghcr.io/oscarsworldtech/margin:v0.1.6-aio-cpu`, `:v0.1.6-aio-vulkan` and `:v0.1.6-aio-cuda`.
- CPU images support Linux amd64 and arm64; Intel/experimental AMD Vulkan and NVIDIA CUDA images support Linux amd64. Separate app and worker images remain available.
- Refined playback speed, volume/mute, continuous playback through library navigation and Audiobookshelf progress sync.
- Updated first-install guides, ebook mount overlay, migration instructions and screenshots.

## Before upgrading

Version 0.1.6 enforces HTTPS for network access unless private HTTP is explicitly acknowledged. Configure proxy trust and a unique password of at least 16 characters using the HTTPS guide before upgrading. Existing sessions end on restart.

Pause transcription and back up data. Preserve your existing environment file, Compose project name, mounts and volumes. Set `MARGIN_AIO_VERSION=v0.1.6` for the all-in-one setup or `MARGIN_VERSION=v0.1.6` for separate containers, then pull and recreate with your existing Compose command. Never use `down -v`. Older preview tags are separate; explicitly choose the versioned image to upgrade.

The installation ZIP includes all hardware profiles and `compose.ebooks.yml`. Audiobookshelf still runs separately. Read README.md, docs/UPGRADING.md and docs/EBOOKS.md for complete instructions.

This remains an early release. CPU inference and container smoke checks are automated. Intel Arc A310 transcription has been reported working; NVIDIA/AMD inference needs validation on actual hardware. No production Android APK is included. Native token storage and other remaining security work are documented in docs/SECURITY_HARDENING.md.
