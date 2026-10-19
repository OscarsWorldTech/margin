# Obsidian annotation sync (opt in)

Margin can export each new or changed annotation as Markdown at `Margin Imports/<book-id>/<note-id>.md` in a configured vault. It is **off by default**, and enabling it starts in dry run unless `OBSIDIAN_SYNC_DRY_RUN=false` is explicit. Export jobs are stored in Margin's SQLite database in the same transaction as each note change, then processed asynchronously. Notes saved while sync is off are not backfilled; edit a note after enabling it to queue that note.

Margin owns only the section between `<!-- margin:managed:begin -->` and `<!-- margin:managed:end -->`. Text outside that section stays in the file. If the note is deleted in Margin, its export is marked archived and retained. An existing file without valid markers, a symlink, or an invalid path stops that job; Margin does not overwrite it. Failed jobs remain in SQLite with delayed retries of up to one hour. Check server logs for `Obsidian sync:` entries. The sync is one way; edits in Obsidian do not change Margin.

The context section uses up to about 90 seconds of aligned EPUB text near the annotation, or captions when aligned text is unavailable. It respects a known chapter boundary and labels this as nearby context, never a full chapter. The optional AI request sends the quote, note, book title, author, and nearby text to the configured OpenAI compatible chat endpoint. Without AI, Markdown export still works. HTTPS is required unless the endpoint is loopback inside the Margin process's network namespace. API tokens are sent as bearer headers, and redirects are refused.

## Isolated development run

Use the separate Compose project, its `18787` loopback port, and its own data and vault volumes. It starts in sample mode, with sync disabled and dry run enabled. The Node base image is pinned by digest in `Dockerfile.obsidian.dev`. This configuration has no CrowdSec service and does not mount a real Obsidian vault or the production Margin volumes.

```sh
cp .env.obsidian.dev.example .env.obsidian.dev
chmod 600 .env.obsidian.dev
docker compose --env-file .env.obsidian.dev -f compose.obsidian.dev.yml config
docker compose --env-file .env.obsidian.dev -f compose.obsidian.dev.yml up --build -d
```

The container listens on its internal interface for Docker routing; the published **host** address is only `127.0.0.1:18787`. Open that address locally. To stage the feature, set `OBSIDIAN_SYNC_ENABLED=true` and leave `OBSIDIAN_SYNC_DRY_RUN=true`, restart this dev service, then save a sample annotation. Logs report `would-export` without writing the vault or draining the job. Once those paths are reviewed, set `OBSIDIAN_SYNC_DRY_RUN=false` and restart the dev service. Inspect the export with `docker compose --env-file .env.obsidian.dev -f compose.obsidian.dev.yml exec margin ls -R /obsidian-vault` and `cat` the reported file. A simple rollback is to set `OBSIDIAN_SYNC_ENABLED=false`; existing Markdown and SQLite data remain.

For a real Audiobookshelf test, set `DEMO_MODE=false` and enter a **test** server URL, token, and a long unique Margin password in `.env.obsidian.dev`. Keep that file private with mode `0600`. Set `OBSIDIAN_AI_ENDPOINT` and `OBSIDIAN_AI_MODEL` together only when testing a trusted local model or HTTPS proxy; `OBSIDIAN_AI_API_KEY` is optional. Plain HTTP to another LAN host is rejected. Do not point `OBSIDIAN_VAULT_DIR` or a Docker mount at an existing Obsidian vault until a dry run and backup have been reviewed. Never use volume deletion flags for this staged setup.

For a non Docker install, set `OBSIDIAN_SYNC_ENABLED=true`, `OBSIDIAN_VAULT_DIR` to an existing absolute test vault directory, and optionally `OBSIDIAN_SYNC_DRY_RUN=true` in a private `.env` file. Restart Margin. The server process needs write permission only to the dedicated `Margin Imports` subdirectory when leaving dry run.
