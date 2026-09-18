# Upgrading Margin

To follow automatically published all-in-one builds from `main`, set `MARGIN_AIO_VERSION=latest`
in your existing `.env`, then pull and recreate with your usual Compose file and
project options. Each merge publishes images after application and container
checks pass; changes may arrive before a versioned release. Preview builds are
separate. Updates to your running container are manual unless you configure an
update service.
Keep `MARGIN_AIO_VERSION=v0.1.6` (or another compatible version) when you want a
fixed release. See [all-in-one updates](ALL_IN_ONE.md#persistent-data-and-updates).

## Upgrade to v0.1.6

This release adds built-in EPUB alignment, Storyteller import and HTTPS/password
hardening. Configure [HTTPS and a unique password](HTTPS.md) before restarting.
Back up your data and preserve your existing Compose files, project name and volumes.

- All-in-one: set `MARGIN_AIO_VERSION=v0.1.6` in `.env` (or change a hard-coded
  image to `v0.1.6-aio-cpu`, `v0.1.6-aio-vulkan` or `v0.1.6-aio-cuda`, matching
  your current backend). Keep using your existing all-in-one Compose filename.
- Separate containers: set `MARGIN_VERSION=v0.1.6` in `.env`.
- Pull and recreate the services with your usual Compose command. If you use
  `compose.ebooks.yml`, retain both `-f` arguments for pull and up.
- Verify v0.1.6 in the app header. Existing notes/captions remain available; resume
  paused jobs if needed. Follow [ebook folder setup](EBOOKS.md) to enable pairing.

## General upgrade procedure

When upgrading to an image containing the security-hardening changes, first follow
[the HTTPS/password migration guide](HTTPS.md). Existing network HTTP installations
will receive 426 until configured for HTTPS or explicitly allowed private HTTP.

For an all-in-one container, follow [its update and migration instructions](ALL_IN_ONE.md#persistent-data-and-updates). The commands below refer to the separate app and worker installation.

Pause active transcription before replacing its worker. Back up `margin-data` while Margin is stopped, or use a SQLite-aware backup.

1. Read the target release's notes and download its installation ZIP.
2. Copy the files into your **existing deployment folder**, retaining `.env` and any Compose customizations. Keep the same Compose project name. Do not rename the folder unless you explicitly preserve the project name.
3. When switching from source builds, run `sh setup.sh intel`, `nvidia`, `amd`, or `cpu` once to select the matching prebuilt configuration. The helper preserves credentials.
4. Set `MARGIN_VERSION` in `.env` to the exact published release tag. Development branch changes are not included in an older image tag.
5. Run:

   ```sh
   docker compose pull
   docker compose up -d
   sh doctor.sh
   ```

Refresh the browser and check the version in the header. Resume an interrupted caption job if needed. Neither an upgrade nor a hardware change requires regenerating saved captions.

The same `margin-data` and `whisper-models` volumes are used by all hardware configurations. **Do not run `down -v`**; it deletes data. A different project name creates different volumes and can look like data loss.

For an app-only restart after pulling, use `docker compose up -d --no-deps margin`. For source builds, use `docker compose up -d --build` instead of pulling. Check schema compatibility before attempting a downgrade; there is no automatic rollback migration.
