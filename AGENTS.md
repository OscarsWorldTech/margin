# Shared contributor instructions

These instructions apply to Codex, Claude Code, and other contributors. Keep this
as the shared source; `CLAUDE.md` imports it. The user's current task takes precedence.

## Start with minimal context

- Read `docs/HANDOFF.md`, then inspect the branch, working tree, and recent commits.
  Handoff notes describe a checkpoint; Git and current code determine actual state.
- Use the task map in `docs/ARCHITECTURE.md` to read only relevant files. Read
  `docs/DEVELOPMENT.md` when setup or checks are needed. Do not load every document,
  old conversation, generated artifact, dependency, or lockfile by default.
- Use one focused task and one active editor per branch. Do not start subagents,
  broad audits, framework migrations, or unrelated cleanup unless requested.
- Continue within the authorized task. Ask only for information that actually
  blocks it. Keep progress and final reports short and concrete.

## Preserve product behavior

- Margin is a self-hosted, single-user Audiobookshelf companion. Keep credentials
  on the server and existing notes, captions, positions, and model volumes intact.
- Audiobookshelf owns book metadata. Margin reads titles as supplied and writes
  listening progress, not titles. Do not strip suffixes to conceal upstream changes.
- Preserve continuous playback across library navigation, track offsets, and the
  ordering/conflict protections in progress sync. Volume/speed changes must not seek.
- Caption generation stays on the Docker host. Native mobile development is only
  proposed; `docs/MOBILE.md` is not authorization to implement the entire roadmap.
- Use sample mode and separate data for previews. Never commit credentials,
  personal host addresses, databases, private book content, or machine-local notes.

## Validate proportionately

- Use Node 24+ and the committed npm lockfile. Standard setup/checks are in
  `docs/DEVELOPMENT.md`; do not reinstall unchanged dependencies each turn.
- For code changes, run the production build and relevant existing tests. Add tests
  for meaningful behavior or regressions, not implementation details.
- Full integration verification needs FFmpeg; deployment configuration tests need
  Docker Compose. Report missing prerequisites and skipped checks accurately.
- For visual changes, inspect the actual UI. For documentation-only changes,
  check paths, commands against source, and `git diff --check`; no app rebuild needed.
- Do not repeat passed checks unless subsequent changes or failures justify it.
  Do not publish Docker images merely to validate a change. Use CI results instead
  of repeatedly polling; inspect completion once when practical.

## Finish with a portable checkpoint

- Update `docs/HANDOFF.md` with completed work, branch/base, validation, open issues,
  and the next bounded step. Replace stale status rather than appending a transcript.
- Record durable design decisions in the relevant document. Distinguish proposed,
  implemented, tested, published, merged, and user-deployed states.
- Use focused commits/PRs in the existing review workflow. Do not merge, deploy to
  a user's host, change repository visibility, or publish a release without scope
  authorization. Existing authorization need not be requested again.
- Include the commit/branch and exact uncommitted file list in a handoff when work
  is incomplete. Never discard another contributor's changes to switch tools.
