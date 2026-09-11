# Switching assistants without starting over

The repository is the shared memory. Chat histories, assistant permissions, and
account connections are separate; changing tools does not transfer them.

Codex reads the root [AGENTS.md](../AGENTS.md). Claude Code reads
[CLAUDE.md](../CLAUDE.md), which imports that same file. Both are directed to the
short [handoff](HANDOFF.md), then only the files relevant to the task. This follows
the documented [Codex instructions](https://developers.openai.com/codex/guides/agents-md)
and [Claude Code imports](https://code.claude.com/docs/en/memory).

## A practical low-usage workflow

1. Pick one small result with observable acceptance criteria. Use routine settings
   for straightforward edits; reserve deeper reasoning for playback races,
   authentication, migration design, and final review of complex changes.
2. Let one assistant implement it. Switch at a commit or a clearly documented
   checkpoint, not in the middle of overlapping edits.
3. Run relevant checks once. Read CI results instead of having both assistants
   repeat the same setup, tests, and repository-wide analysis.
4. Update the handoff and commit the code and notes together. Push the working
   branch if the next environment is on another computer. A local uncommitted
   change is not available to a cloud worker.
5. Use the second assistant for a specific remaining task or focused review. Do
   not ask it to independently rebuild already working features.

These habits aim to reduce repeated context and work; they do not guarantee a
particular percentage reduction in plan usage. Keep long build logs and old chat
transcripts out of startup instructions. Documentation-only edits need no Docker
image build. Publish images when a tested application update is wanted.

## Starting in Codex or Claude Code

Open a checkout of the **Margin repository root**, containing `package.json` and
`AGENTS.md`. If using another machine, authenticate to GitHub separately and fetch
the handoff branch. Check `git status --short` and `git log -1 --oneline` before
editing. Preserve dirty work; do not reset it or blindly switch branches.

Use this prompt, replacing the final sentence with one concrete task:

> Read AGENTS.md and docs/HANDOFF.md. Confirm the current branch and working-tree
> state, then read only files relevant to this task. Preserve existing behavior,
> run proportionate checks, and update the handoff when finished. Task: [one result
> and its acceptance criteria].

Do not keep both assistants editing the same checkout concurrently. For deliberate
parallel work, use separate branches/worktrees and non-overlapping tasks.

## Using ordinary ChatGPT or Claude chat

Automatic file loading above applies to the coding agents. In a regular chat,
attach `AGENTS.md`, `docs/HANDOFF.md`, and only the source/tests needed for the task,
or provide repository access supported by that environment. Attach the architecture
map if you need help choosing files. State the branch and commit explicitly.

An assistant without repository/write access should return a review or patch; it
cannot claim to have edited, tested, or published the code. Apply and check that
patch in your development environment. Do not assume a GitHub connection in one
assistant grants access to another, especially for a private repository.

Personal notes can go in ignored `CLAUDE.local.md` or `docs/LOCAL.md`; neither is
part of the portable handoff. Keep shared decisions in the tracked documents.
