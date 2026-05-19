# AI Handoff

This repository uses an external Obsidian vault for project memory.

## Obsidian

- Vault root: `/Users/iseong-yong/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Obsidian`
- Project index: `/Users/iseong-yong/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Obsidian/Projects/Sync and Flow/00_Index.md`
- Obsidian URI: `obsidian://open?vault=Obsidian&file=Projects%2FSync%20and%20Flow%2F00_Index`

Read the Obsidian project index first when resuming work. It records current architecture, operations, git state, and in-progress work that may not be committed yet.

## Startup Checklist

1. Run `git status --short` before editing.
2. Treat existing uncommitted changes as user work unless explicitly told otherwise.
3. Read the current-state Obsidian note before choosing the next task.
4. Prefer existing repo patterns over new abstractions.
5. Run focused tests after code changes; for broad changes run `./node_modules/.bin/vitest run` and `./node_modules/.bin/vite build`.

## Local Notes

- Package manager is declared as `pnpm@9.15.9`, but local verification has been reliable through `./node_modules/.bin/...` commands when Corepack/pnpm is unavailable.
- Git index writes may require elevated permission in this environment.
- Desktop app work lives under `apps/flow-link`.
- Cloudflare Worker presence room lives under `worker/src`.
