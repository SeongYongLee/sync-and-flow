# Flow Link

Tauri desktop app for Flow Link.

## Purpose

- Reuse the existing Sync and Flow web UI as the desktop window.
- Provide a path toward a cross-platform tray/menu bar app.
- Own the local bridge that reads Claude/Codex token logs and serves local SSE events to the UI.

## Current State

The Tauri backend starts a native local bridge on app launch. The web UI receives the bridge port and token through the window URL, then connects to `127.0.0.1` for local events. Users only need to run the desktop app.

Implemented shell behavior:

- Closing the main window hides it instead of quitting the app.
- Tray/menu bar item remains available.
- Tray menu includes `Open Flow Link`, `Pause Sharing`, `Privacy: What is shared?`, and `Quit Flow Link`.
- `Start Sharing` and `Pause Sharing` control the Tauri-owned local bridge.
- The native bridge scans local Claude and Codex session logs and publishes token deltas without sending prompts or responses.

## Requirements

- Rust toolchain: <https://rustup.rs>
- Tauri platform prerequisites: <https://tauri.app/start/prerequisites/>

## Commands

```bash
pnpm install
pnpm dev:desktop-web
pnpm flow-link:desktop:dev
pnpm flow-link:desktop:build
pnpm flow-link:desktop:build:windows
```

## Distribution

The browser viewer exposes OS-specific download links when it is running without a local bridge:

```text
VITE_FLOW_LINK_MAC_DOWNLOAD_URL      # default: /downloads/Flow-Link.dmg
VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL  # default: /downloads/Flow-Link-Setup.exe
```

The downloaded artifact should install the desktop app, not a separate bridge helper. The desktop app starts and stops the native bridge itself.

Expected release artifacts:

- macOS: signed and notarized `.dmg`
- Windows: signed `.exe` installer or `.msi`

The repo includes a `Flow Link Desktop` GitHub Actions workflow. Run it manually or push a tag like `flow-link-v0.1.0` to build macOS and Windows artifacts and upload them as workflow artifacts.

## Next Milestones

- Add backend commands for status and logs.
- Add release automation for macOS and Windows installers.
- Add signing, notarization, and update flow for public distribution.
