# Sync and Flow

Sync and Flow turns local AI coding activity into a visual flow layer. The current product shape is local-first: Flow Link reads local Claude Code, Codex CLI, and Pi session logs through a Tauri native bridge, then the web viewer reacts through a localhost SSE stream.

Remote spectators and mobile viewing are optional presence features. They require the Cloudflare Worker room to be enabled explicitly.

## Quick Start

```bash
pnpm install
pnpm dev:phase2
```

`pnpm dev:phase2` starts:

- Vite web viewer on `http://127.0.0.1:5175`
- Flow Link Tauri desktop app

Generate a Claude, Codex, or Pi turn after the app opens. The viewer should update the model, planet, token, and flow energy UI. Open `DIAGNOSTICS` to inspect local progress and bridge status.

If Tauri cannot find `cargo`, make sure Rust is on your shell path:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

## Local Progress

Progress is saved per identity in browser `localStorage`.

Saved:

- total turns and token totals
- source/provider/model totals
- last source and model
- energy
- planet mix and recent planet history

Not saved:

- prompts
- responses
- raw JSONL
- full local file contents

Use `DIAGNOSTICS` > `Reset Progress` to clear the current identity's local progress.

## Local Sources

Flow Link scans explicit local roots only:

- Claude Code: `~/.claude/projects`
- Codex CLI: `~/.codex/sessions`
- Pi: `~/.pi/agent/sessions`

Pi overrides:

```bash
PI_CODING_AGENT_DIR=/path/to/pi/agent
PI_CODING_AGENT_SESSION_DIR=/path/to/pi/sessions
```

Broad system folders such as `~/Library/Application Support` are not auto-scanned.

## Development Commands

Local app development:

```bash
pnpm dev:phase2
```

Separate terminals:

```bash
pnpm dev:desktop-web
pnpm flow-link:desktop:dev
```

Verification:

```bash
pnpm test
pnpm typecheck
pnpm typecheck:worker
pnpm build
cargo test --manifest-path apps/flow-link/src-tauri/Cargo.toml -- --test-threads=1
```

The native bridge tests use local TCP listeners. In restricted environments, run them outside the sandbox or with serialized test threads.

## Optional Remote Presence

Remote presence lets other browsers watch a publisher through the Cloudflare Worker room. It is off by default.

Local Worker:

```bash
pnpm dev:phase2:presence
```

LAN Worker:

```bash
VITE_SYNC_FLOW_WORKER_URL=ws://<lan-ip>:8787 pnpm dev:phase2:lan
```

Viewer URL:

```text
http://<lan-ip>:5175/?worker=ws://<lan-ip>:8787
```

Mobile QR only works when remote presence is enabled. In local-only mode, the desktop bridge is bound to localhost and cannot be reached by a phone.

For a public Worker deployment, configure a publish token and give the token only to publishers:

```bash
wrangler secret put SYNC_FLOW_PUBLISH_TOKEN --config worker/wrangler.toml
pnpm release:worker:deploy
pnpm e2e:worker-publish 'wss://<worker-host>?token=<publish-token>'
```

Browser viewer and QR URLs strip the publish token before subscribing.

## Deployment

Recommended hosting:

- Cloudflare Pages for the static web viewer
- GitHub Releases for Flow Link installers
- Cloudflare Worker only for opt-in remote presence

Cloudflare Pages is deployed by [.github/workflows/pages.yml](.github/workflows/pages.yml).

Required GitHub secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Recommended GitHub repository variables:

```text
VITE_FLOW_LINK_MAC_DOWNLOAD_URL
VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL
VITE_SYNC_FLOW_VIEWER_URL
VITE_SYNC_FLOW_WORKER_URL
```

Leave `VITE_SYNC_FLOW_WORKER_URL` empty for local-only releases.

Do not serve installer binaries from Cloudflare Pages. Publish DMG/EXE/MSI files as GitHub Release assets and point the download variables at those release URLs. Large installer files are not a good fit for the Pages static asset pipeline.

Manual Pages deploy after `pnpm build`:

```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm release:pages:deploy
```

Expected default Pages URL:

```text
https://sync-and-flow.pages.dev
```

## Flow Link Desktop

The desktop app lives in `apps/flow-link`.

Responsibilities:

- start and own the local native bridge
- read Claude/Codex/Pi session logs
- expose local turn events to the web UI over SSE
- publish to Worker only when a Worker URL is configured

Commands:

```bash
pnpm flow-link:desktop:dev
pnpm flow-link:desktop:build:mac
pnpm flow-link:desktop:build:windows
```

Release installers are built by [.github/workflows/flow-link-desktop.yml](.github/workflows/flow-link-desktop.yml).

Public macOS distribution requires Developer ID signing and notarization. Public Windows distribution requires code signing to reduce SmartScreen friction.

## Architecture

```text
apps/flow-link/          Tauri desktop shell and native bridge
src/web/                 Vite browser viewer, HUD, renderer, local progress
src/core/                shared parsing, pricing, aggregation types
src/node/                PoC CLI and Node log adapters
src/shared/              wire protocol and planet state
worker/src/              optional Cloudflare Worker presence room
tests/                   TypeScript regression tests
```

Runtime flow:

```text
Claude/Codex/Pi JSONL
  -> Flow Link native bridge
  -> localhost SSE /events
  -> web viewer
  -> localStorage progress
```

Optional presence flow:

```text
Flow Link publisher
  -> Worker /publish
  -> Worker /watch
  -> remote browser viewers
```

## Security Boundary

- Local prompts and responses are not sent to the Worker.
- Local progress stores summary statistics only.
- The native bridge is localhost-bound by default.
- Remote presence is opt-in and requires an explicit Worker URL.
- Publish tokens are for publishers only; browser viewer URLs should not include them.

## AI Handoff

When resuming AI work, read [AGENTS.md](AGENTS.md) first. The project memory index is maintained in the external Obsidian vault at `Projects/Sync and Flow/00_Index.md`.

## Historical PoC Notes

The original PoC validated JSONL parsing, duplicate handling, aggregation, and model pricing against real Claude session logs. Useful regression points from that phase:

- `msg_id` duplicates are handled with LRU deduplication.
- `iterations` arrays are ignored intentionally.
- `<synthetic>` models are filtered.
- incomplete JSONL lines are buffered by the tail driver.
- session file switching is covered by watcher tests.

Older replay and CLI tools remain available:

```bash
pnpm replay ~/.claude/projects/.../{session}.jsonl
pnpm cli --cwd /your/project
```

Detailed release steps live in [docs/flow-link-release.md](docs/flow-link-release.md).
