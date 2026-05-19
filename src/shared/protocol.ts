import type { Provider, SourceId } from "../core/types.js";
import type { WirePlanetState } from "./planet.js";

export interface TurnDelta {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
}

export interface WireTotals {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  turns: number;
  totalUsd: number;
}

export interface PeerMeta {
  id: string;
  nickname: string;
  color: string;
  lastSeen?: number;
}

export interface PublishMessage {
  kind: "publish";
  userId: string;
  nickname: string;
  color: string;
  source: SourceId;
  provider: Provider;
  model: string;
  delta: TurnDelta;
  totals: WireTotals;
  energy: number;
  timestamp: string;
  planetState?: WirePlanetState;
}

export interface SubscribeMessage {
  kind: "subscribe";
  userId: string;
  nickname: string;
  color: string;
}

export interface PingMessage {
  kind: "ping";
  userId: string;
  nickname?: string;
  color?: string;
}

export interface RosterMessage {
  kind: "roster";
  viewerId: string;
  peers: PeerMeta[];
  viewerCount: number;
}

export interface TurnMessage extends Omit<PublishMessage, "kind"> {
  kind: "turn";
}

export interface PresenceSnapshotMessage extends Omit<TurnMessage, "kind" | "delta"> {
  kind: "snapshot";
}

export interface StatusMessage {
  kind: "status";
  state: "connecting" | "open" | "closed" | "fallback";
}

export type ClientToWorkerMessage = PublishMessage | SubscribeMessage | PingMessage;
export type WorkerToBrowserMessage = RosterMessage | TurnMessage | PresenceSnapshotMessage | StatusMessage;
