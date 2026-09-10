# Upgrading Margin

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
