# Flow Link Release Checklist

## 1. Verify Locally

```bash
pnpm test
pnpm build
cargo test --manifest-path apps/flow-link/src-tauri/Cargo.toml
pnpm smoke:web
```

## 2. Web Viewer

Cloudflare Pages deployment uses the `Cloudflare Pages` GitHub Actions workflow.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Recommended GitHub repository variables:

- `VITE_FLOW_LINK_MAC_DOWNLOAD_URL`
- `VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL`
- `VITE_SYNC_FLOW_VIEWER_URL` - optional canonical viewer URL
- `VITE_SYNC_FLOW_WORKER_URL` - optional, leave empty for local-only releases

Manual local deploy after `pnpm build`:

```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm release:pages:deploy
```

Expected default Pages URL:

```text
https://sync-and-flow.pages.dev
```

## 3. Worker

Dry-run the Cloudflare Worker bundle:

```bash
pnpm release:worker:dry-run
```

Deploy only after Cloudflare auth is configured:

```bash
wrangler secret put SYNC_FLOW_PUBLISH_TOKEN --config worker/wrangler.toml
pnpm release:worker:deploy
pnpm e2e:worker-publish 'wss://<worker-host>?token=<publish-token>'
```

Use the verified `wss://<worker-host>?token=<publish-token>` value as the desktop app default Worker URL only for an opt-in remote presence build. The native publisher keeps the token for `/publish`, while browser watch/QR URLs strip it before subscribing. Local-only builds should leave the Worker URL empty.

## 4. Desktop Installers

Run the `Flow Link Desktop` GitHub Actions workflow with `worker_url` left empty for the default local-only build. Set `worker_url` to the verified Worker URL with publish token only when building a remote presence variant.

Expected artifacts:

- macOS: `apps/flow-link/src-tauri/target/release/bundle/dmg/*.dmg`
- Windows: `apps/flow-link/src-tauri/target/release/bundle/nsis/*.exe`
- Windows: `apps/flow-link/src-tauri/target/release/bundle/msi/*.msi`

Local macOS LAN build:

```bash
pnpm flow-link:desktop:build:mac
```

Windows installers must be built on Windows or in the GitHub Actions `windows-latest` job.

## 5. Signing

macOS public distribution requires Developer ID signing and notarization. Configure these GitHub secrets when available:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- or `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_CONTENT`

Windows public distribution requires code signing to reduce SmartScreen friction. Configure the signing tool/certificate on the Windows runner before publishing artifacts.

## 6. Publish

Upload artifacts to the download host and set:

```text
VITE_FLOW_LINK_MAC_DOWNLOAD_URL
VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL
```

Then verify:

```bash
curl -I <mac-dmg-url>
curl -I <windows-installer-url>
```
