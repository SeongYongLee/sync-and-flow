# Sync and Flow — PoC 기술 검증 결과

> AI 응답 대기 시간을 게임 자원으로 전환하는 멀티디바이스 게임. PoC 단계의 산출물은 코드가 아니라 **결정 문서**다.

---

## 검증 결과 요약

| # | 검증 항목 | 결과 | 비고 |
|---|---|---|---|
| 1 | JSONL 갱신 메커니즘 | ⬜ 미측정 | 라이브 세션으로 검증 필요 |
| 2 | 부분 데이터 vs 완료 후 한 줄 | ⬜ 미측정 | 라이브 세션으로 검증 필요 |
| 3 | 메시지 타입 커버리지 | ✅ 통과 | parse error 0건, 내부 일관성 100% |
| 4 | 모델별 비용 환산 | ✅ 부분 통과 | ccusage cross-check 필요 |

### 검증 3 — 실세션 replay 결과

```
파일: d04f9409 (293 lines, 682KB)
  Parse errors:  0  ✅
  Non-assistant: 194
  Synthetic:     0
  Deduped:       43  (msg_id 기반 중복 제거)
  Unique turns:  56

  claude-sonnet-4-6: 45 turns, $1.594
  claude-opus-4-7:   11 turns, $2.263
  Grand total:       $3.858

파일: 081f66c2 (348 lines, 대형)
  Parse errors:  0  ✅
  Deduped:       39
  Unique turns:  57

  claude-opus-4-6:   33 turns, $4.671
  claude-sonnet-4-6: 20 turns, $0.816
  claude-opus-4-7:    4 turns, $1.050
  Grand total:       $6.537
```

---

## 검증 1·2 실행 방법 (라이브)

```bash
# 터미널 A — 라이브 watcher 실행
pnpm cli --cwd /path/to/your/project

# 터미널 B — 새 Claude 세션에서 작업 진행
# 터미널 A에서 턴 완료 직후 토큰 변화 출력 확인

# 검증 1 (append vs rewrite)
wc -c <session.jsonl>  # 이전 크기
# 한 턴 진행
wc -c <session.jsonl>  # size 증가 여부
stat -f '%i %m' <session.jsonl>  # inode 동일 여부
```

---

## 발견된 함정 체크리스트

- [x] **msg_id 중복** — dedup.ts LRU로 처리 + 테스트
- [x] **iterations 배열** — parse.ts에서 무시 (주석 명시) + 테스트
- [x] `<synthetic>` 모델 — parse.ts 필터
- [x] 불완전 라인 — tail.ts fragment 보관
- [x] 세션 전환(새 jsonl) — watcher `add` 이벤트 + 통합 테스트
- [x] UUID 패턴 필터 — non-session 파일 무시 + 통합 테스트
- [ ] macOS FSEvents 지연 (chokidar 사용으로 완화, 실측 미완)
- [ ] 경로 인코딩 엣지 케이스 (한글 경로 등 미테스트)
- [ ] backfill 폭주 — `--backfill` 플래그로 분리됨, 실측 미완
- [ ] 검증 2 실시간성 결론 → **후속 작업**

---

## 후속 작업 (Phase 2로 넘어가기 전)

검증 2 결과에 따라 분기:

**만약 JSONL이 "완료 후 한 줄"이라면** (예상):
→ 실시간 입자 효과를 위해 **Claude Code CLI hook** 보조 채널 필요
- `PreToolUse`: 도구 호출 시작 시점
- `Stop`: 응답 완료 시점
- hook → 로컬 소켓 → 게임 클라이언트

**만약 스트리밍 중 부분 데이터가 쓰인다면**:
→ JSONL 단독으로도 실시간성 확보 가능

---

## 빠른 시작

```bash
pnpm install
pnpm test                             # 단위 + 통합 테스트 (25개)
pnpm replay ~/.claude/projects/.../{session}.jsonl  # 기존 세션 분석
pnpm cli --cwd /your/project          # 라이브 모니터링
```

## Phase 2 로컬 멀티코어 실행

Flow Link 데스크톱 앱은 자체 Tauri native bridge를 띄워 로컬 Claude/Codex 활동을 읽는다. 사용자는 별도 백그라운드 프로세스를 실행하지 않는다.

개발 중 단독 데스크톱 앱을 확인하려면:

```bash
pnpm dev:desktop-web
pnpm flow-link:desktop:dev
```

`Flow Link` 앱은 개발용 웹 서버를 직접 소유하지 않는다. 앱을 종료해도 `pnpm dev:desktop-web`으로 띄운 viewer는 계속 살아 있어야 한다.

LAN 안의 다른 컴퓨터 활동까지 보려면 한 대에서 Worker를 먼저 실행한다.

```bash
pnpm dev:worker
pnpm flow-link:desktop:dev
```

같은 Mac에서 한 번에 실행:

```bash
pnpm dev:phase2
```

2대 Mac 데모:

```bash
# Worker와 Flow Link 앱을 띄우는 Mac
VITE_SYNC_FLOW_WORKER_URL=ws://<worker-lan-ip>:8787 pnpm dev:phase2:lan

# Claude/Codex 활동을 publish할 Mac마다 Flow Link 앱 실행
VITE_SYNC_FLOW_WORKER_URL=ws://<worker-lan-ip>:8787 pnpm flow-link:desktop:dev

# browser-only viewer Mac
http://<worker-lan-ip>:5175
```

### 모바일/다른 Mac 관전 E2E 체크리스트

목표는 **한 Mac의 Flow Link 앱이 Claude/Codex turn을 Worker에 publish하고, 모바일 또는 다른 Mac 브라우저가 viewer-only로 그 turn을 보는 것**이다. viewer-only 기기에는 Flow Link 앱을 설치하거나 실행하지 않아도 된다.

1. Worker와 웹 서버를 LAN으로 연다.

```bash
pnpm dev:worker:lan
pnpm dev:lan
```

한 터미널로 실행하려면:

```bash
VITE_SYNC_FLOW_WORKER_URL=ws://<worker-lan-ip>:8787 pnpm dev:phase2:lan
```

2. Claude/Codex 활동을 공유할 Mac에서 Flow Link 앱을 Worker URL과 함께 실행한다.

```bash
SYNC_FLOW_WORKER_URL=ws://<worker-lan-ip>:8787 VITE_SYNC_FLOW_WORKER_URL=ws://<worker-lan-ip>:8787 pnpm flow-link:desktop:dev
```

3. viewer 기기에서 아래 URL을 연다.

```text
http://<worker-lan-ip>:5175/?worker=ws://<worker-lan-ip>:8787
```

4. 모바일은 데스크톱 화면의 `MOBILE QR` 버튼을 사용할 수 있다. Tauri 앱에서 처음 누르면 `Mac LAN IP` 입력란이 보이고, 여기에 `<worker-lan-ip>`를 넣으면 위 viewer URL이 QR로 생성된다.

5. 공유 Mac에서 Claude 또는 Codex turn을 하나 발생시킨다. viewer 화면에서 roster가 잡히고 turn 이벤트가 들어오면 다른 코어에 입자 변화가 보여야 한다.

검증 포인트:

- Worker health: `http://<worker-lan-ip>:8787/health`가 `{"ok":true,"service":"sync-and-flow-worker"}`를 반환해야 한다.
- 웹 접속: 다른 Mac/모바일에서 `http://<worker-lan-ip>:5175/`가 열려야 한다. 연결 거부면 `pnpm dev:desktop-web` 또는 `pnpm dev:phase2:lan`이 LAN host로 떠 있지 않은 상태다.
- publish 상태: Flow Link 메뉴바 `Diagnostics`에서 `workerUrl`이 `ws://<worker-lan-ip>:8787`이고, turn 이후 `lastWorkerPublishAt`이 채워져야 한다.
- publish 실패: `lastWorkerError`가 있으면 Worker URL, 방화벽, 같은 Wi-Fi 여부, VPN/프라이빗 릴레이를 먼저 확인한다.
- viewer-only 한계: 모바일/다른 Mac 브라우저만 연 경우 그 기기의 Claude/Codex 활동은 publish되지 않는다. 해당 기기의 활동도 공유하려면 그 기기에도 Flow Link 앱이 필요하다.

모바일에서 Mac 활동을 보려면 데스크톱 화면의 `MOBILE QR` 버튼을 눌러 QR 코드를 표시한 뒤 휴대폰 카메라로 스캔한다. `localhost`로 접속 중이면 버튼을 누를 때 Mac의 LAN IP를 입력해야 한다.

실제 서비스 배포에서는 QR이 현재 HTTPS origin을 그대로 사용한다. 예를 들어 `https://app.example.com`에서 QR을 만들면 모바일도 같은 URL을 열고, Worker URL은 기본적으로 `wss://app.example.com/presence`로 해석한다. 로컬 LAN 개발에서만 `?worker=ws://<lan-ip>:8787` 쿼리를 붙인다.

주의:

- 다른 Mac에서는 `localhost`가 자기 자신을 가리키므로 반드시 Worker를 띄운 Mac의 LAN IP를 쓴다.
- 다른 Mac은 보기만 할 경우 browser만 열면 된다. 그 Mac의 Claude/Codex 활동을 상대에게 보내려면 그 Mac에서도 Flow Link 앱을 실행해야 한다.
- Worker가 꺼져도 Flow Link 앱은 Tauri native bridge를 통해 자기 컴퓨터의 local turn은 계속 표시한다.
- `/health`에서 `workerUrl`, `identity`, `sources`를 확인할 수 있다.

## Flow Link Desktop App

`apps/flow-link` contains the Tauri desktop app.

Current scope:

- Reuse the existing web UI inside a desktop window.
- Start and own the local native bridge inside the Tauri backend.
- Read Claude/Codex session logs locally and expose token events to the web UI.
- Prepare for macOS menu bar and Windows tray support.

Current shell behavior:

- Closing the desktop window hides it instead of quitting.
- Tray/menu bar menu can reopen the window or quit Flow Link.
- `Start Sharing` and `Pause Sharing` control the Tauri-owned bridge.

Commands:

```bash
pnpm flow-link:desktop:dev
pnpm flow-link:desktop:build
pnpm flow-link:desktop:build:windows
```

Browser download URLs:

```text
VITE_FLOW_LINK_MAC_DOWNLOAD_URL      # default: /downloads/Flow-Link.dmg
VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL  # default: /downloads/Flow-Link-Setup.exe
```

When the web viewer cannot find a local bridge, it shows OS-specific Flow Link download links. The downloaded installer should install the desktop app itself; the app owns the local bridge on macOS and Windows.

Release builds:

- Run the `Flow Link Desktop` GitHub Actions workflow manually with `workflow_dispatch`, or push a tag like `flow-link-v0.1.0`.
- macOS artifacts are uploaded from `apps/flow-link/src-tauri/target/release/bundle/dmg/*.dmg`.
- Windows artifacts are uploaded from `apps/flow-link/src-tauri/target/release/bundle/nsis/*.exe` and `apps/flow-link/src-tauri/target/release/bundle/msi/*.msi`.
- Publish those artifacts to the URLs configured by `VITE_FLOW_LINK_MAC_DOWNLOAD_URL` and `VITE_FLOW_LINK_WINDOWS_DOWNLOAD_URL`.

Prerequisites:

- Rust toolchain from `https://rustup.rs`
- Tauri OS prerequisites from `https://tauri.app/start/prerequisites/`
- Windows builds should be produced on Windows, for example with Tauri's NSIS or MSI bundle target.

보안 경계:

- Flow Link는 Claude/Codex 로그를 로컬에서 읽지만 Worker에는 원문 프롬프트/응답을 보내지 않는다.
- 전송 payload는 익명 identity, source/provider/model, token delta/totals, energy, timestamp로 제한한다.
- 네트워크 대상은 앱이 연결한 Worker URL 하나다.
- 공유 중지는 tray/menu bar의 `Pause Sharing`으로 한다.

---

## 아키텍처

```
src/core/        순수 TS (노드/브라우저 공용)
  types.ts       Usage, ExtractedTurn, RunningTotals
  parse.ts       라인 → ExtractedTurn | null
  dedup.ts       msg_id LRU 중복 제거
  pricing.ts     모델별 비용 계산
  aggregate.ts   모델별 누적 + 이벤트 발행
  paths.ts       cwd ↔ 인코딩 경로

src/node/        Node.js 어댑터
  tail.ts        offset 기반 incremental read
  sources/       다중 source registry + jsonl tail driver
  session-resolver.ts  cwd → 최신 jsonl 경로
  cli.ts         PoC CLI
```
