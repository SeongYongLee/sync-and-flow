import { afterEach, describe, expect, it } from "vitest";
import {
  buildViewerUrl,
  hasBridgeCredentials,
  isLocalHost,
  resolveBridgeUrl,
  resolveOptionalWorkerWatchUrl,
  resolveOptionalWorkerUrl,
  resolveWorkerUrl,
  setRuntimeWorkerWatchUrl,
} from "../src/web/runtime-url.js";

const originalLocation = globalThis.location;
const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;
const originalWindow = globalThis.window;

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function setBrowserUrl(url: string): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL(url),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("runtime URL helpers", () => {
  it("uses bridge port 3001 by default on localhost", () => {
    setBrowserUrl("http://localhost:5173/");

    expect(resolveBridgeUrl("/events")).toBe("http://127.0.0.1:3001/events");
  });

  it("persists explicit bridge port from the query string", () => {
    setBrowserUrl("http://localhost:5173/?bridgePort=4545&bridgeToken=abc");

    expect(hasBridgeCredentials()).toBe(true);
    expect(resolveBridgeUrl("/identity")).toBe("http://127.0.0.1:4545/identity?token=abc");
    expect(resolveBridgeUrl("/events")).toBe("http://127.0.0.1:4545/events?token=abc");
  });

  it("keeps remote worker presence disabled unless explicitly configured", () => {
    setBrowserUrl("http://192.168.0.10:5173/");

    expect(resolveOptionalWorkerUrl()).toBeNull();
    expect(resolveWorkerUrl()).toBe("ws://localhost:8787");
  });

  it("resolves an explicit worker URL from the query string", () => {
    setBrowserUrl("http://192.168.0.10:5173/?worker=ws://192.168.0.10:8787");

    expect(resolveOptionalWorkerUrl()).toBe("ws://192.168.0.10:8787");
    expect(resolveOptionalWorkerWatchUrl()).toBe("ws://192.168.0.10:8787/");
    expect(resolveWorkerUrl()).toBe("ws://192.168.0.10:8787");
  });

  it("removes publish tokens from worker watch URLs", () => {
    setBrowserUrl("http://192.168.0.10:5173/?worker=wss://example.com/presence?token=secret");

    expect(resolveOptionalWorkerUrl()).toBe("wss://example.com/presence?token=secret");
    expect(resolveOptionalWorkerWatchUrl()).toBe("wss://example.com/presence");
  });

  it("uses a bridge-provided worker watch URL when no query worker is present", () => {
    setBrowserUrl("http://localhost:5175/");

    setRuntimeWorkerWatchUrl("wss://worker.example.com/presence");

    expect(resolveOptionalWorkerUrl()).toBe("wss://worker.example.com/presence");
    expect(resolveOptionalWorkerWatchUrl()).toBe("wss://worker.example.com/presence");
  });

  it("builds hosted mobile viewer URLs by default from local pages", async () => {
    setBrowserUrl("http://localhost:5175/?worker=wss://worker.example.com?token=secret");

    expect(await buildViewerUrl()).toBe("https://sync-and-flow.pages.dev/?worker=wss%3A%2F%2Fworker.example.com%2F");
  });

  it("builds hosted mobile viewer URLs from desktop app pages", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    setBrowserUrl("http://localhost:5175/?worker=wss://worker.example.com?token=secret");

    expect(await buildViewerUrl()).toBe("https://sync-and-flow.pages.dev/?worker=wss%3A%2F%2Fworker.example.com%2F");
  });

  it("preserves a tokenless worker watch URL in hosted viewer QR URLs", async () => {
    setBrowserUrl("https://sync-and-flow.pages.dev/?worker=wss://worker.example.com?token=secret");

    expect(await buildViewerUrl()).toBe("https://sync-and-flow.pages.dev/?worker=wss%3A%2F%2Fworker.example.com%2F");
  });

  it("builds hosted mobile viewer URLs from local pages when viewer is configured", async () => {
    setBrowserUrl("http://localhost:5175/?viewer=https://sync-and-flow.pages.dev/&worker=wss://worker.example.com?token=secret");

    expect(await buildViewerUrl()).toBe("https://sync-and-flow.pages.dev/?worker=wss%3A%2F%2Fworker.example.com%2F");
  });

  it("keeps the desktop bridge local when the viewer is opened through a LAN URL", () => {
    setBrowserUrl("http://192.168.0.10:5173/");

    expect(hasBridgeCredentials()).toBe(false);
    expect(resolveBridgeUrl("/identity")).toBe("http://127.0.0.1:3001/identity");
  });

  it("identifies localhost aliases", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("192.168.0.10")).toBe(false);
  });
});
