# Current handoff

Checkpoint: 2026-09-11. Verify the checkout and remote before continuing.

## Current task

Make development portable between ChatGPT/Codex and Claude while conserving usage.
This branch, `docs-agent-handoff`, adds shared instructions, an architecture map,
this checkpoint, switching guidance, and a proposed mobile plan. No runtime changes.
Base: `dbcb49e0a0c146eb4c81c9d52d12cd92b76dcaf6` on `main` (PR #3 merged).
The final commit is discoverable with `git log -1`; do not embed a self-referencing SHA.

## Implemented baseline

- Audiobookshelf library integration, generated/imported captions, highlights,
  notes/exports, chapter seeking, and persistent browser playback.
- Audiobookshelf progress synchronization and fine playback-speed adjustment.
- PR #3 added remembered volume/mute controls and aligned mixed-title library cards.
  Mute restores the prior level; unmuting from zero restores the last audible level.
- A reported `(Unabridged)` title suffix was also present in Audiobookshelf.
  Its cause is unconfirmed. Margin preserves upstream titles.
- All-in-one CPU amd64/arm64, Vulkan amd64, and CUDA amd64 images are published at
  `ghcr.io/oscarsworldtech/margin:preview-aio-{cpu,vulkan,cuda}`.
  At the prior verified publication, all variants contained
  `9d0d7ade4430d5da361aa4e7036679ce50bc27f9` (PR #3 source commit).
  Mutable tags may change; do not confuse source publication with user deployment.

## Evidence and limits

- Baseline CI run [34562536551](https://github.com/OscarsWorldTech/margin/actions/runs/34562536551):
  production build, 20/20 Linux tests, and all four container checks passed.
- Browser checks covered volume controls, reload persistence, library navigation,
  and card alignment. Local Windows tests: 19 passed, one POSIX-only test skipped.
- Intel Arc A310 transcription was reported working by the maintainer. Hosted CI
  verifies GPU library linkage, not actual NVIDIA/AMD GPU inference.
- Documentation validation: 20 relative links resolved, Claude's shared import
  verified, private-note ignore patterns matched, and whitespace checks passed.
  No runtime code changed; no application rebuild or new images are required.

## Next work, not yet started

The maintainer is exploring mobile support. No platform or device has been selected,
no native project exists, and Capacitor is a proposal rather than a settled decision.
The next useful step, when mobile work is requested, is choosing a real test device
and implementing only the bounded playback prototype in [MOBILE.md](MOBILE.md).
Offline downloads and synchronization come later.

## Handoff discipline

Update this file at the end of each task: objective, branch/base, completed changes,
checks with results, unresolved issues, and next action. Record uncommitted files in
the final message when present. Keep secrets and personal deployment details out.
Git, PRs, and the current user's request take precedence over an old checkpoint.
