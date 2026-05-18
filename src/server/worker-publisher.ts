import type { Identity } from "../shared/nickname.js";
import type { PublishMessage } from "../shared/protocol.js";

export class WorkerPublisher {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retryMs = 500;
  private closed = false;
  private latest: PublishMessage | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly identity: Identity,
  ) {}

  start(): void {
    this.connect();
  }

  publish(message: Omit<PublishMessage, "kind" | "userId" | "nickname" | "color">): void {
    const payload: PublishMessage = { kind: "publish", ...this.identity, ...message };
    this.latest = payload;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect(): void {
    if (this.closed) return;

    const url = `${this.baseUrl.replace(/\/$/, "")}/publish`;
    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      this.scheduleReconnect(error);
      return;
    }

    this.ws.addEventListener("open", () => {
      this.retryMs = 500;
      console.log(`[bridge] Worker publisher connected: ${url}`);
      if (this.latest) this.ws?.send(JSON.stringify(this.latest));
    });

    this.ws.addEventListener("close", () => this.scheduleReconnect());
    this.ws.addEventListener("error", () => this.scheduleReconnect());
  }

  private scheduleReconnect(error?: unknown): void {
    if (this.closed || this.reconnectTimer) return;
    if (error instanceof Error) {
      console.warn(`[bridge] Worker publisher unavailable: ${error.message}`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.retryMs = Math.min(this.retryMs * 1.8, 8_000);
    }, this.retryMs);
  }
}
