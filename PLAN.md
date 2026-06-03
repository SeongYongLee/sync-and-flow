# Sync and Flow — Phase 2: 근처 유저 멀티 코어 시각화

## Context

**왜 이 작업을 하는가**: Phase 1 PoC에서 *내 세션의* 토큰 추출 정확도 / 실시간성을 검증했다. 다음 단계는 single-user 시각화를 **passive multiplayer presence**로 확장하는 것. 원래 기획의 "방 번호 기반 페어링"은 능동적인 짝짓기 액션을 요구하는데, 사용자는 그냥 "지금 함께 작업 중인 다른 익명 유저들이 자연스럽게 같은 화면에 떠 있는" 경험을 원한다.

**Phase 2 범위 (확정된 결정)**:
1. 동시 유저: 동적 1~5명 (활성 풀에서 서버가 무작위 샘플링)
2. 식별: 익명 UUID + 자동 생성 닉네임 (예: `calm-fox-321`). 로그인/계정 없음.
3. 배포: **로컬 dev만** (`wrangler dev`). 외부 배포 안 함.
4. 시각화: **멀티 코어** — 내 코어 + 1~4개의 타 유저 코어, 각자 자기 코어로 입자 흘러감.
5. **소스 어댑터 인터페이스 + Claude/Codex 실 구현**: 현재의 Claude-only 파이프라인을 source-agnostic 하게 추상화. Phase 2 인터페이스가 미래에 8개 source 를 수용 가능해야 함:
   - **JSONL append-only (file tail)**: Claude Code, Codex, cursor-agent, Gemini CLI, Antigravity
   - **SQLite (poll + diff)**: Cursor IDE
   - **혼합/workspace storage**: Claude Desktop, GitHub Copilot
   Phase 2 에서 실 구현하는 source: **Claude + Codex (둘 다 jsonl-tail)**. 나머지 6 개는 인터페이스 등록 + stub. 실 구현 우선순위(Phase 2.5 ~): Cursor (대중적) → cursor-agent → GitHub Copilot → Gemini CLI → Antigravity → Claude Desktop.

**Phase 2의 산출물**: 두 개 이상의 Mac에서 동시에 실행했을 때, 서로의 turn event(Claude *및* Codex)가 실시간으로 다른 색의 코어로 시각화되는 데모. + 8 개 source 를 수용 가능한 인터페이스 (Claude/Codex 실 구현, 나머지 6 개 stub).

---

## 사전 결정 사항 (Phase 1 결과 반영)

- Phase 1의 `core/`, `node/`, `web/main.ts` 자산은 그대로 재활용.
- 기존 Node `server/bridge.ts` 경로는 Flow Link Tauri native bridge로 대체되었다.
- Phase 1에서 검증된 turn event 형태(`model`, `delta`, `totals`, `energy`, `timestamp`)를 그대로 wire-format 으로 사용 + `userId`/`nickname`만 attach.

### 8 개 source 사전 조사 결과 (인터페이스 설계용)

reference: `getagentseal/codeburn`. Phase 2 단계에서는 Claude 만 실 구현. 나머지는 인터페이스 등록 + stub.

| Source | 경로 | Access Pattern | 비고 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/{cwd-encoded}/*.jsonl` | **JSONL tail** | Phase 1 에서 검증 완료 |
| Codex (OpenAI) | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | **JSONL tail** | `event_msg.type=token_count` 의 `info.last_token_usage`. cached → input 빼기 |
| Pi | `~/.pi/agent/sessions/**/*.jsonl` | **JSONL tail** | Flow Link 앱 내부 native bridge에서 명시 루트만 감시. `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` 지원 |
| cursor-agent | `~/.cursor/projects/` | **JSONL tail** (추정) | codeburn 의 `providers/cursor-agent.ts` 참조 필요 |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/` | **JSON/JSONL** (조사 필요) | `<project>` 디렉토리 동적, watcher glob 필요 |
| Antigravity | `~/.gemini/antigravity/conversations/` | **JSON snapshot** (추정) | 디렉토리 내 JSON 파일들의 변경 감지 |
| Cursor IDE | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | **SQLite poll** | tail 불가능. better-sqlite3 + 주기 쿼리 + diff |
| Claude Desktop | `~/Library/Application Support/Claude/local-agent-mode-sessions/` | **JSON/JSONL** (조사 필요) | macOS 전용 경로 |
| GitHub Copilot | `~/.copilot/session-state/` + VS Code `workspaceStorage/` | **혼합** | sessionState JSON + VS Code SQLite 양쪽 |

**Claude Code 토큰 필드** (Phase 1 완성):
- 라인: `type: "assistant"` 의 `message.usage`
- 토큰: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_5m,1h}_input_tokens`
- Dedup: `message.id` (fallback `requestId`)
- 함정: `iterations[]` 합산 금지, `<synthetic>` 필터

**Codex CLI 토큰 필드** (Phase 2.5 메모):
- 라인: `event_msg` 의 `type: "token_count"` 안 `info.last_token_usage`
- 모델: `session_meta.payload.model` 또는 `turn_context.payload.model` → 어댑터 인스턴스가 라인 간 currentModel 보유
- 토큰: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`
- Dedup: `codex:{sessionId}:{timestamp}:{cumulativeTotal}`
- Normalize: `input_tokens -= cached_input_tokens` (OpenAI 의미 → Anthropic 의미)

→ **인터페이스가 보장해야 할 것**:
- (a) 단일 source 로부터 normalized `ExtractedTurn` 스트림 produce
- (b) 라인 간 상태 유지 (Codex 의 currentModel, SQLite 의 last seen rowid 등)
- (c) source 별 dedup 키 전략 분리
- (d) 3 가지 access pattern 동시 지원: file-tail / sqlite-poll / json-snapshot
- (e) source 별 활성화 토글 (사용자 환경에 없는 도구는 비활성)

---

## 아키텍처

```
[ Mac A ]                              [ Mac B ]
  Claude session                         Claude session
       │                                      │
   bridge.ts (tsx)                         bridge.ts (tsx)
       │ POST /turn (WS)                     │
       └────────┬─────────────────────┬──────┘
                ▼                     ▼
         ┌────────────────────────────────┐
         │ Cloudflare Worker (wrangler dev)│
         │ ─ Durable Object: PresenceRoom  │
         │   · activeUsers: Map<id, meta>  │
         │   · sockets: Set<WebSocket>     │
         │   · sample(viewerId) → 1~4 ids │
         └────────────────────────────────┘
                ▲                     ▲
       WS /watch │                   │ WS /watch
                │                     │
         Browser (Vite dev)     Browser (Vite dev)
         main.ts: 멀티 코어 캔버스
```

핵심:
- **Bridge → Worker (publisher)**: 노드 프로세스가 자기 turn 데이터를 Worker로 push.
- **Browser → Worker (subscriber)**: 브라우저가 Worker WebSocket 에 붙어서 visible roster 와 turn 이벤트 수신.
- **Worker = single Durable Object**: 단일 글로벌 룸 (Phase 2는 룸 분리 없음).

### 메시지 프로토콜 (JSON over WebSocket)

**bridge → worker (publish):**
```json
{ "kind": "publish", "userId": "...", "nickname": "calm-fox-321",
  "model": "claude-sonnet-4-6", "delta": {...}, "totals": {...},
  "energy": 1234, "timestamp": "2026-05-06T..." }
```

**browser → worker (subscribe):**
```json
{ "kind": "subscribe", "userId": "...", "nickname": "..." }
```

**worker → browser (broadcast):**
```json
{ "kind": "roster", "viewerId": "...", "peers": [{ "id": "...", "nickname": "...", "color": "..." }, ...] }
{ "kind": "turn", "userId": "...", "model": "...", "delta": {...}, "totals": {...}, "energy": ..., "timestamp": "..." }
```

`roster` 는 가시 유저 목록. `turn` 은 그 중 한 명의 활동.

---

## 새 폴더 구조

기존 위에 worker 추가:

```
sync-and-flow/
├── worker/
│   ├── src/
│   │   ├── index.ts          # Worker entry, Durable Object 라우팅
│   │   ├── room.ts           # PresenceRoom Durable Object
│   │   └── sample.ts         # 1~4 peer 샘플링 (viewer 자신 제외)
│   ├── wrangler.toml
│   └── tsconfig.json
│
├── src/
│   ├── core/
│   │   ├── adapters/          # ← 신규: source 별 파서/locator/adapter 묶음
│   │   │   ├── types.ts       # Source / SourceAdapter / SourceTarget / AccessPattern
│   │   │   ├── claude.ts      # ← 실 구현 (Phase 1 parse.ts 로직 이동)
│   │   │   ├── codex.ts       # ← 실 구현 (model 캐싱 + cached normalize)
│   │   │   ├── cursor-agent.ts# ← stub
│   │   │   ├── gemini-cli.ts  # ← stub
│   │   │   ├── antigravity.ts # ← stub
│   │   │   ├── cursor.ts      # ← stub (sqlite-poll)
│   │   │   ├── claude-desktop.ts # ← stub
│   │   │   └── copilot.ts     # ← stub (혼합 access)
│   │   ├── parse.ts           # ← (얇은 위임 레이어, adapters/claude 로 forward)
│   │   ├── dedup.ts           # (그대로, key 는 어댑터가 결정)
│   │   ├── pricing.ts         # ← 수정: provider 분리 (anthropic/openai/google/github)
│   │   ├── pricing-table.json # ← 수정: provider 별 모델 단가 (Claude 외 stub)
│   │   ├── aggregate.ts       # (그대로)
│   │   └── types.ts           # ← 수정: ExtractedTurn 에 source/provider 필드 추가
│   │
│   ├── node/
│   │   ├── tail.ts            # (그대로 — jsonl-tail driver 가 사용)
│   │   ├── watcher.ts         # ← 수정: 3 driver (jsonl-tail / sqlite-poll / json-snapshot) 통합
│   │   ├── sources/           # ← 신규: registry + driver
│   │   │   ├── registry.ts    # SOURCES: Source[] (8 개 등록)
│   │   │   ├── jsonl-tail.ts  # chokidar + FileTail driver
│   │   │   ├── sqlite-poll.ts # ← Phase 2 placeholder (setInterval skeleton)
│   │   │   └── json-snapshot.ts # ← Phase 2 placeholder
│   │   ├── session-resolver.ts # (그대로 — Claude 전용, 어댑터 안으로 흡수해도 OK)
│   │   └── cli.ts             # (그대로)
│   │
│   ├── web/
│   │   ├── main.ts            # ← 수정: 멀티 코어 렌더링
│   │   ├── identity.ts        # ← 신규: localStorage UUID + 닉네임
│   │   ├── ws-client.ts       # ← 신규: Worker WS subscriber
│   │   └── stream-client.ts   # (Phase 1 SSE — 옵셔널 보존)
│   │
│   └── shared/
│       └── nickname.ts        # ← 신규: animal-color-num generator (web/server 공용)
│
└── package.json               # ← scripts 추가: dev:worker, dev:phase2
```

---

## 핵심 모듈 책임 (신규/수정)

### `src/core/adapters/types.ts` (신규)

```ts
export type Provider = "anthropic" | "openai" | "google" | "github";
export type SourceId =
  | "claude" | "codex" | "cursor-agent" | "gemini-cli"
  | "antigravity" | "cursor" | "claude-desktop" | "copilot";
export type AccessPattern = "jsonl-tail" | "sqlite-poll" | "json-snapshot";

// Source 는 한 종류 도구의 *전체* — 디렉토리/파일 패턴 + 파서 + dedup 전략을 캡슐화.
// access pattern 별로 별도의 watcher 가 source 를 구동.
export interface Source {
  readonly id: SourceId;
  readonly provider: Provider;
  readonly access: AccessPattern;

  // 사용자 환경에 이 source 데이터가 존재하는지 (디렉토리/DB 파일 존재 확인).
  // 없으면 watcher 는 이 source 를 활성화하지 않음.
  isAvailable(): Promise<boolean>;

  // 모니터링 타겟 (access pattern 별로 의미 다름)
  // - jsonl-tail: 디렉토리 + 파일 매칭 함수
  // - sqlite-poll: DB 경로 + 쿼리 + 폴링 주기
  // - json-snapshot: 디렉토리 + glob + 폴링 주기
  targets(opts: { cwd?: string }): SourceTarget[];

  // 어댑터: source 가 자기 입력 (line / row / snapshot diff) 을 받아
  // 0~N 개의 normalized ExtractedTurn 으로 변환.
  // 라인 간/주기 간 상태는 인스턴스 내부에 보관.
  createAdapter(): SourceAdapter;
}

export type SourceTarget =
  | { kind: "jsonl-tail"; dir: string; match: (filename: string) => boolean }
  | { kind: "sqlite-poll"; dbPath: string; intervalMs: number }
  | { kind: "json-snapshot"; dir: string; glob: string; intervalMs: number };

export interface SourceAdapter {
  readonly sourceId: SourceId;

  // 입력 형태는 access pattern 에 따라 다름:
  // - jsonl-tail → ingestLine(raw)
  // - sqlite-poll → ingestRows(rows)
  // - json-snapshot → ingestFile(path, content)
  // 어댑터는 자기 access pattern 에 해당하는 메서드만 구현하면 됨 (나머진 옵셔널).
  ingestLine?(raw: string): ExtractedTurn[];
  ingestRows?(rows: unknown[]): ExtractedTurn[];
  ingestFile?(path: string, content: string): ExtractedTurn[];

  dedupKey(turn: ExtractedTurn): string;
}
```

`ExtractedTurn` 에 `source: SourceId`, `provider: Provider` 필드 추가. 토큰 카테고리는 Anthropic 의 5분류를 표준으로 삼고, 다른 provider 는 어댑터 안에서 변환 (Codex `cached_input_tokens` → `cache_read_input_tokens`, `reasoning_output_tokens` → `output_tokens` 합산 등).

### `src/core/adapters/claude.ts` (Phase 1 parse.ts 이전, 실 구현)

- access: `jsonl-tail`
- `targets()` → `~/.claude/projects/{cwd-encoded}` + UUID `*.jsonl`
- `createAdapter().ingestLine(raw)` → 기존 `parse.ts` 로직
- `dedupKey(turn)` → `msg.id` (없으면 `requestId`)
- `isAvailable()` → 디렉토리 존재 + `*.jsonl` 1개 이상

### `src/core/adapters/codex.ts` (실 구현)

- access: `jsonl-tail`, provider: `openai`
- `targets()` → `$CODEX_HOME` (default `~/.codex`) + `sessions/**/rollout-*.jsonl` glob
- `isAvailable()` → 디렉토리 존재 + `rollout-*.jsonl` 1개 이상
- `createAdapter()` 가 반환하는 인스턴스 상태:
  - `currentModel: string | null` — `session_meta.payload.model` / `turn_context.payload.model` 만나면 갱신
  - `lastCumulativeTotal: number` — 동일 cumulative 면 skip
  - `currentSessionId: string | null` — `session_meta.payload.session_id` 캐싱
- `ingestLine(raw)`:
  1. JSON.parse 시도 실패 → `[]`
  2. `entry.type === "session_meta"` → `currentModel`, `currentSessionId` 갱신, `[]` 리턴
  3. `entry.type === "turn_context"` → `currentModel` 갱신, `[]` 리턴
  4. `entry.type === "event_msg"` && `payload.type === "token_count"`:
     - `info.last_token_usage` 추출
     - `cumulativeTotal = info.total_token_usage.total_tokens`
     - 직전 `lastCumulativeTotal` 와 같으면 skip
     - **Normalize**: `input_tokens -= cached_input_tokens` (Anthropic 의미로 환산)
     - 매핑:
       - `input_tokens (normalized)` → `input_tokens`
       - `cached_input_tokens` → `cache_read_input_tokens`
       - `output_tokens + reasoning_output_tokens` → `output_tokens`
       - `cache_creation_input_tokens` = 0 (OpenAI 는 cache write 개념 없음)
     - `currentModel` 없으면 unknown fallback (sonnet pricing 경고와 동일 흐름)
     - `[ExtractedTurn]` 1 개 리턴
  5. 그 외 라인 → `[]`
- `dedupKey(turn)`: `codex:${sessionId}:${timestamp}:${cumulativeTotal}` (cumulativeTotal 은 turn meta 에 별도 보관)

### `src/core/adapters/{cursor-agent,gemini-cli,antigravity,cursor,claude-desktop,copilot}.ts` (stub × 6)

Phase 2 에서는 다음만:
- `Source` skeleton (`id`, `provider`, `access`, `targets()` 경로 명시, `isAvailable()` 디렉토리/파일 존재 확인)
- `createAdapter().ingestX()` 메서드는 `throw new Error("<id> adapter not implemented (Phase 2.5+)")`
- 단위 테스트는 `targets()` 경로 검증 + ingest 호출 시 `toThrow()` 한 줄

각 stub 파일 상단 주석에 Phase 2.5 작업 메모 (필드 매핑, dedup 키, normalize 규칙).

### `src/node/sources/registry.ts` (신규)

- 모든 `Source` 구현체를 한곳에 등록 (`SOURCES: Source[]`).
- `getActiveSources(opts)` → `isAvailable()` 통과한 source 만 반환.
- watcher 는 이 결과를 받아 access pattern 별 적절한 driver 를 선택.

### `src/node/watcher.ts` (수정 — 다중 access pattern)

- `jsonl-tail`: 기존 chokidar + FileTail 그대로 (어댑터의 `ingestLine`).
- `sqlite-poll`: Phase 2 에서는 driver 코드만 placeholder (실 SQLite 접근 없이 setInterval skeleton + 어댑터 throw).
- `json-snapshot`: 동일하게 skeleton.
- driver 별 진입점은 분리하되, 출력은 통일된 `ExtractedTurn[]` 스트림으로 합쳐 aggregate 에 흘림.

### `worker/src/index.ts`
- `/publish` (WS): bridge 가 붙는 채널. 인증 없음 (로컬 dev).
- `/watch` (WS): browser 가 붙는 채널. 첫 메시지가 `subscribe`.
- 라우팅 → `PresenceRoom` Durable Object stub (단일 ID `"global"`).

### `worker/src/room.ts` (Durable Object)
상태:
```ts
activeUsers: Map<userId, { nickname, lastSeen, color }>
publishers:  Map<userId, WebSocket>     // bridge sockets
viewers:     Map<viewerId, { ws, visiblePeers: Set<userId> }>
```
동작:
- bridge `publish` 도착 → `activeUsers` upsert + 해당 turn event 를 *볼 수 있는* viewer 들에게만 broadcast.
- viewer `subscribe` → `sample()` 로 자기 제외 1~4명 선택, `roster` 푸시.
- 30초마다 stale user (lastSeen > 30s) 제거 → 영향 받은 viewer 에게 새 `roster` 푸시.
- Periodic re-sample (예: 60초마다) → 동일 viewer 도 시간이 지나면 다른 유저들이 보이도록.

### `worker/src/sample.ts`
- 입력: viewerId, activeUsers, target=1~4
- 활성 풀 크기에 따라 `min(activeUsers.size - 1, 4)` 만큼 무작위 추출
- 안정성: 동일 viewer 의 직전 roster 와 일정 비율 overlap 유지 (튀어 사라짐 방지) — 단순 구현은 random shuffle, 개선은 후속.

### `src/shared/nickname.ts`
- 형식: `<adjective>-<animal>-<3digit>` (예: `quiet-otter-417`)
- 약 30 형용사 × 30 동물 × 1000 → 90만 조합, 충돌은 무시 (시각화 라벨 용)
- web/server 양쪽에서 import 가능하도록 의존성 없음

### `src/web/identity.ts`
- `getOrCreateIdentity()`: `localStorage["sf:identity"]` 에서 `{userId, nickname}` 읽기, 없으면 `crypto.randomUUID()` + `nickname.ts` 로 생성 후 저장.
- 한 번 만든 identity 는 재방문 시 유지.

### `src/web/ws-client.ts`
- `connectRoom(identity, handlers)`: `ws://localhost:8787/watch` 연결.
- `subscribe` 송신, `roster` / `turn` 수신 → 콜백.
- 자동 재연결 (지수 backoff).

### `src/web/main.ts` (수정)
캔버스 렌더링을 multi-core 로 확장:
- **자기 코어**: 캔버스 중심 (가장 크게).
- **타 유저 코어**: 자기 코어를 중심으로 한 원형 궤도, 코어 수에 따라 등분.
- 각 코어는 독립 `coreEnergy` / `pulsePhase`.
- 입자는 자기 화면 외곽에서 스폰 → **해당 turn 의 owner 코어**로 attract.
- 색상: `userId` 해시 → HSL hue (자기는 보라 고정, 타인은 hue 60~330 분포).
- HUD: 로컬 사용자 정보만 표시. 타 유저는 코어 옆 닉네임 라벨로.

### Flow Link Tauri native bridge
- 시작 시 bridge identity를 `~/.sync-and-flow/identity.json`에 영속화
- 로컬 SSE 브로드캐스트 유지 (local-only 모드 호환)
- 원격 presence가 명시된 경우 Worker HTTP publish 연결. turn event를 publish하고 실패 상태를 diagnostics에 표시
- env: `SYNC_FLOW_WORKER_URL`, `VITE_SYNC_FLOW_WORKER_URL`, 또는 빌드 타임 `FLOW_LINK_DEFAULT_WORKER_URL`

---

## 의존성 / 도구 추가

| 항목 | 추가 |
|---|---|
| 패키지 | `ws` (node), `wrangler` (devDep), `@cloudflare/workers-types` (devDep) |
| script | `"dev:worker": "wrangler dev --local"`, `"dev:desktop-web": "vite --host 0.0.0.0 --port 5175 --strictPort"`, `"dev:phase2": "concurrently \"pnpm dev:worker\" \"pnpm dev:desktop-web\" \"pnpm flow-link:desktop:dev\""` |
| wrangler.toml | `compatibility_date`, `[[durable_objects.bindings]]` PresenceRoom, `[durable_objects.migrations]` |

---

## 작업 순서

1. **어댑터 인터페이스 + Claude 이전**: `core/adapters/types.ts` (Source/SourceAdapter/SourceTarget) + `core/adapters/claude.ts` (Phase 1 로직 이전) + `core/types.ts` 에 source/provider 필드 추가. 기존 25 개 테스트 *그대로* 통과.
2. **6 개 stub 어댑터**: cursor-agent / gemini-cli / antigravity / cursor / claude-desktop / copilot — `targets()` 경로만 정확히 명시, `ingestX()` 는 throw. 각 source 당 단위 테스트 1 개 (`isAvailable()` + `ingestX().toThrow()`).
3. **Codex 어댑터 실 구현**:
   - `core/adapters/codex.ts` — `session_meta`/`turn_context` 모델 캐싱 + `event_msg.token_count` ingest + cached input normalize + cumulative skip + dedup key
   - `core/pricing-table.json` 에 OpenAI 모델 단가 추가 (gpt-5-codex, o3, o4-mini 등 실제 LiteLLM 표 참조)
   - `core/pricing.ts` 가 provider 별로 분기 (anthropic ↔ openai 단가 룩업, 기본 fallback 분리)
   - fixture: 실제 `~/.codex/sessions/.../rollout-*.jsonl` 일부를 마스킹하여 `fixtures/codex-*.jsonl` 5 개 (single-turn / model-switch / cumulative-dup / cached-heavy / synthetic-style)
   - 단위 테스트: parse, dedup, pricing, normalize (input -= cached) 각 1 개 이상
4. **node/sources registry + driver 분리**: `registry.ts` 에 8 개 등록, `jsonl-tail.ts` 는 기존 watcher 로직 이전 (Claude/Codex 모두 사용), `sqlite-poll.ts` / `json-snapshot.ts` 는 setInterval skeleton (실 데이터 접근 없음). watcher.ts 가 source.access 따라 driver 선택.
5. **getActiveSources()**: 사용자 환경에 실제 데이터가 있는 source 만 활성화 (Claude/Codex 둘 다 통과 가능).
6. **Codex replay 검증**: `scripts/replay.ts` 가 `--source codex` 플래그를 받아 codex jsonl 도 통과시킴. ccusage / codeburn 결과와 토큰/비용 1% 이내 일치.
7. `worker/wrangler.toml` + `worker/src/index.ts` skeleton + `wrangler dev --local` 부팅 확인
8. `worker/src/room.ts` Durable Object — 메시지 echo 부터 시작, 단계적으로 publish/subscribe/roster
9. `worker/src/sample.ts` + 단위 테스트
10. `src/shared/nickname.ts` + 테스트
11. `src/web/identity.ts` + `src/web/ws-client.ts`
12. `src/web/main.ts` 멀티 코어 리팩터 (1코어 → N코어). turn event 의 `source` 별 시각 차별화 (예: Claude=원형 입자, Codex=다이아몬드 입자 또는 색조 차이).
13. Flow Link Tauri native bridge Worker publisher + diagnostics 활성 source 표시
14. **2-tab 검증**: 같은 Mac 에서 다른 브라우저 탭 두 개로 다른 identity 띄우고, bridge 가 둘 다에게 broadcast 되는지 확인. Claude / Codex 동시 세션을 띄워 각 source 가 별도 turn event 로 흘러가는지 확인.
15. **2-Mac 검증** (있으면): 다른 머신에서 wrangler dev 미러 어렵 → 한 Mac 의 Worker 에 다른 Mac 의 bridge 가 LAN IP 로 붙도록 시도. 어려우면 시뮬레이션 (로컬 bridge 2개를 다른 identity 로 띄움).
16. 함정 처리 + README Phase 2 섹션 + Phase 2.5+ 우선순위 (Cursor → cursor-agent → Copilot → Gemini → Antigravity → Claude Desktop) 명시

---

## 검증 (End-to-End)

1. `pnpm test` — Phase 1 의 25 개 테스트 통과 + Codex 어댑터 단위 테스트 (parse/dedup/normalize/pricing 각 1 개 이상) 통과 + 6 개 stub 어댑터 placeholder 통과.
2. `pnpm replay <claude jsonl>` 그리고 `pnpm replay --source codex <codex jsonl>` 둘 다 통과. parse error 0, 고유 turn 수 일관, 토큰/비용 ccusage 또는 codeburn 결과와 1% 이내 일치.
3. `pnpm dev:phase2` 실행 → 3개 프로세스(Worker / Vite / Flow Link Tauri app) 정상 부팅. Diagnostics 에서 active source 와 Worker publish 상태 확인.
4. 브라우저에서 `localhost:5173` 접속 → identity 자동 생성, 코어 1개(자기) 표시
5. 다른 탭(시크릿/다른 브라우저)에서 같은 URL 접속 → 자동 생성된 다른 identity, 첫 탭 화면에 새 코어 등장
6. **Claude 세션 진행** → 두 탭 모두에서 입자 효과 발생 (turn event 의 `source` 필드 = `"claude"`)
7. **Codex 세션 진행** (별도 터미널에서 codex CLI 실행 후 한 턴) → 동일하게 입자 효과 발생, source 필드 = `"codex"`, HUD 모델/비용도 정확히 표시
8. Mock publisher 스크립트로 5명 시뮬레이션 → 한 viewer 화면에 자기 + 4명 노출, 5번째는 sample 에서 제외되거나 swap
9. Worker 종료 → 클라이언트 자동 재연결 시도 + 폴백 표시
10. 30초간 turn 없는 유저 → activeUsers 에서 자동 제거, roster 갱신

---

## 잠재적 함정 (Phase 2 신규)

| # | 함정 | 영향 | 대응 |
|---|---|---|---|
| P1 | `wrangler dev --local` Durable Object 영속성 | 재시작 시 상태 소실 | 메모리 상태로 충분 (로컬 dev), 이슈 시 `--persist-to` |
| P2 | 동일 Mac 의 두 브라우저가 동일 identity (localStorage 공유) | 코어 자기-자기 중복 | 다른 브라우저(Chrome/Safari) 또는 시크릿 탭 사용 |
| P3 | bridge 종료 시 activeUsers 잔존 | 유령 유저 | 30s lastSeen TTL + WS close 즉시 삭제 |
| P4 | sample 매 turn 호출 시 코어가 튀어 보임 | UX 혼란 | roster 변경은 별도 cadence (≥60s) — turn broadcast 와 분리 |
| P5 | Worker 미실행 + bridge 가 publish 시도 | bridge 죽음 | publish 실패 catch → SSE 모드로만 동작 (graceful degrade) |
| P6 | localStorage 비활성 (시크릿 strict) | identity 매 새로고침 새로 생성 | sessionStorage fallback + 경고 |
| P7 | userId 해시 → HSL 충돌로 비슷한 색 | 시각적 구분 어려움 | golden-angle 분배 (인덱스 기반) — viewer 입장에서 인덱싱 |
| P8 | 로컬 LAN 2-Mac 시도 시 wrangler `--ip 0.0.0.0` 미기본 | 외부 머신 접속 불가 | wrangler dev `--ip 0.0.0.0 --port 8787` 명시 |
| P9 | 멀티 코어 입자 폭주 (5명 동시 turn) | 프레임 드롭 | 입자 cap 전체 800개 + LRU 폐기 |
| P10 | 닉네임 욕설/혼동 조합 | 미관 | 형용사/동물 사전을 큐레이션, 숫자 0/O 회피 |
| P11 | 어댑터 리팩터 시 Phase 1 회귀 | 토큰 수치 변화 | 리팩터 PR 단위로 기존 fixture 테스트 유지, 라인 → ExtractedTurn 출력 byte-equal 검증 |
| P12 | Codex `input_tokens` 의미 차이 (cached 포함) | 비용 1.5~2배 과대 | 어댑터 안에서 `input -= cached` normalize, 단위 테스트로 고정 (Phase 2 작업) |
| P13 | Codex 모델이 라인 간 상태 (`session_meta` 후의 `turn_context`) | model 분실 시 unknown fallback | 어댑터 인스턴스가 `currentModel` 필드 보유, FileTail 별 1:1 인스턴스 (Phase 2 작업) |
| P18 | Codex `info.total_token_usage` 누적 vs `info.last_token_usage` 델타 혼동 | 토큰 2 배 합산 | Phase 2 어댑터는 **last** 만 사용, cumulative 는 dedup 키용으로만 사용. fixture 1 개를 cumulative-dup 케이스로 명시. |
| P19 | Codex 의 `reasoning_output_tokens` 무시 시 비용 과소 | 추론 모델(o3) 비용 누락 | `output_tokens + reasoning_output_tokens` 합산하여 매핑, pricing-table 의 output 단가에 그대로 적용. |
| P20 | Codex 와 Claude 의 dedup 키 충돌 | 다른 source 의 turn 이 같은 키로 중복 처리 | 모든 dedup 키에 source prefix 강제 (`claude:msgId` / `codex:sessionId:ts:cum`). dedup.ts 가 prefix 안 붙은 키 거부. |
| P14 | SQLite source (Cursor/Copilot) 가 file-tail 가정을 깨뜨림 | 인터페이스 추후 재설계 | Phase 2 인터페이스에서 `AccessPattern` 분기 명시 (`jsonl-tail` / `sqlite-poll` / `json-snapshot`) |
| P15 | source `isAvailable()` 가 권한 오류 throw | bridge crash | 모든 `isAvailable()` 은 try/catch 후 false (오류 로그만) |
| P16 | macOS Library/Application Support 경로 권한 (Cursor/Claude Desktop) | 다른 macOS 보안 정책 | Phase 2 stub 단계에서 경로 존재만 확인, 실 read 는 Phase 2.5 |
| P17 | stub 어댑터가 활성화돼서 throw 폭주 | 매 라인 fail | `ingestX()` 호출 전 watcher 가 `isAvailable()` *과* `ingestX` 정의 여부 체크. 미구현 access pattern 의 driver 는 등록만 하고 호출 안 함 |

---

## Critical Files

## Current State (2026-05-12)

- Flow Link는 기존 `.pkg` helper 없이 Tauri 앱 내부 Rust native bridge가 로컬 브리지 역할을 수행한다.
- 고정 `3001` 포트는 제거했고, 앱 실행 시마다 `127.0.0.1:<random>` 포트와 세션 토큰을 생성한다.
- `/identity`, `/health`, `/events`는 토큰이 없으면 `401 Unauthorized`로 차단한다.
- CORS는 `*`가 아니라 Tauri/dev origin만 허용한다. 허용되지 않은 Origin은 `403 Forbidden`.
- Rust native bridge는 Claude/Codex/Pi JSONL을 스캔하고 로컬 웹뷰에는 bridge event stream으로 turn 이벤트를 전달한다.
- Rust native bridge의 Claude/Codex 파서와 source path 판정 로직은 `native_bridge.rs`로 분리되어 단위 테스트로 검증된다.
- Worker `/publish`는 WebSocket 외에 HTTP `POST /publish`도 수용한다.
- Rust native bridge는 turn 이벤트 발생 시 Worker에도 HTTP publish를 시도한다. `ws://`는 `http://`, `wss://`는 `https://` publish endpoint로 변환한다.
- Worker publish 실패는 로컬 SSE 동작을 막지 않는다.
- Diagnostics 패널이 기본 상태와 Advanced 상태로 분리되어 source root, read/parse, Worker publish 상태를 먼저 보여주고 파일 상세 정보는 접어 둔다.
- Rust native Worker publish는 `reqwest` + `rustls` 기반 TLS HTTP publish를 지원한다.
- Worker publish E2E 스크립트가 추가되었다: `pnpm e2e:worker-publish [worker-url]`.
- 로컬 Worker E2E 검증 통과: `pnpm dev:worker` 실행 후 `pnpm e2e:worker-publish ws://127.0.0.1:8787`에서 HTTP `POST /publish` → WebSocket `/watch` turn broadcast 확인.
- 메뉴바 `Pause Sharing`은 native bridge를 중지하고 웹뷰를 `bridgePaused=1` 상태로 reload한다. `Start Sharing`은 새 랜덤 포트/토큰으로 bridge를 시작하고 웹뷰 URL을 새 bridge config로 replace한다.
- 우측 상단 `DIAGNOSTICS` 버튼은 개발 모드의 Tauri 런타임에서만 표시된다. 운영에서는 메뉴바 `Diagnostics` 항목 또는 `#diagnostics` 진입으로만 패널을 연다.
- 모바일/다른 Mac 관전 E2E 절차가 `README.md`에 문서화되었다. viewer-only 기기는 브라우저만 열고, 자기 활동을 publish하려는 기기만 Flow Link 앱을 실행한다.
- 최근 검증: `cargo test`, `cargo check`, `pnpm build`, `pnpm test`, DMG build/verify 통과.

---

## Next Steps

1. 배포 Worker publish E2E 검증: 실제 `https/wss` Worker URL에서 `pnpm e2e:worker-publish wss://<deployed-worker>`를 실행해 publish/watch 경로를 확인한다.
2. Windows 설치 파일 생성 및 서명 플로우를 macOS DMG와 같은 다운로드 UX에 연결한다.

---

**신규 — 어댑터**:
- `src/core/adapters/types.ts`
- `src/core/adapters/claude.ts` (실 구현, Phase 1 parse.ts 이전)
- `src/core/adapters/codex.ts` (실 구현)
- `src/core/adapters/cursor-agent.ts` (stub)
- `src/core/adapters/gemini-cli.ts` (stub)
- `src/core/adapters/antigravity.ts` (stub)
- `src/core/adapters/cursor.ts` (stub, sqlite-poll)
- `src/core/adapters/claude-desktop.ts` (stub)
- `src/core/adapters/copilot.ts` (stub)

**신규 — Codex fixtures & 테스트**:
- `fixtures/codex-single-turn.jsonl`
- `fixtures/codex-model-switch.jsonl`
- `fixtures/codex-cumulative-dup.jsonl`
- `fixtures/codex-cached-heavy.jsonl`
- `tests/codex-adapter.test.ts`

**신규 — node sources**:
- `src/node/sources/registry.ts`
- `src/node/sources/jsonl-tail.ts`
- `src/node/sources/sqlite-poll.ts` (skeleton)
- `src/node/sources/json-snapshot.ts` (skeleton)
- `worker/wrangler.toml`
- `worker/src/index.ts`
- `worker/src/room.ts`
- `worker/src/sample.ts`
- `src/shared/nickname.ts`
- `src/web/identity.ts`
- `src/web/ws-client.ts`
- `src/web/diagnostics.ts`
- `apps/flow-link/src-tauri/src/lib.rs` (Tauri shell + Rust native bridge)
- `apps/flow-link/src-tauri/src/native_bridge.rs` (Claude/Codex parser + path detection tests)
- `apps/flow-link/src-tauri/tauri.conf.json`
- `apps/flow-link/package.json`
- `scripts/e2e-worker-publish.mjs`

**수정**:
- `src/core/parse.ts` (얇은 위임 레이어로 축소)
- `src/core/types.ts` (`ExtractedTurn.source/provider` 추가)
- `src/core/pricing.ts` (provider 분리)
- `src/core/pricing-table.json` (openai 모델 스텁 단가)
- `src/node/watcher.ts` (multi-source 지원)
- `apps/flow-link/src-tauri/src/lib.rs`
- `src/web/main.ts`
- `src/web/runtime-url.ts`
- `src/web/stream-client.ts`
- `package.json`
- `index.html` (HUD, Flow Link CTA, Mobile QR, Diagnostics UI)

---

## Backlog


---

## Out of Scope (Phase 2에서 명시적으로 제외)

- 외부 배포 (Cloudflare deploy). 후속 Phase 3 에서 인증/abuse 방지 함께.
- 룸 분리 / 친구 그룹. 단일 글로벌 룸만.
- 사용자 간 인터랙션 (채팅, 트로피, 동기화 게임 액션). presence + 시각화만.
- 모바일 디바이스 시각화. 데스크톱 브라우저 전용.
- TURN/STUN 직접 P2P. 모든 메시지는 Worker 경유.
- **8 개 source 중 Claude/Codex 외 6 개의 실 구현**: Phase 2 는 인터페이스 + stub. Phase 2.5+ 우선순위: Cursor → cursor-agent → GitHub Copilot → Gemini CLI → Antigravity → Claude Desktop.
- SQLite/workspaceStorage 실 데이터 접근 (Cursor, Copilot). driver skeleton 만 마련, 실제 better-sqlite3 의존성 추가는 Phase 2.5 에서.
- Google/GitHub provider 단가 정확화. Phase 2 는 placeholder 로 두고 Phase 2.5 에서 LiteLLM 표 import. (OpenAI 단가는 Codex 구현 위해 Phase 2 에서 추가.)
