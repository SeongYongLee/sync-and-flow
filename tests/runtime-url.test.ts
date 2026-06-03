import { afterEach, describe, expect, it } from "vitest";
import {
  buildLanViewerUrlFromHost,
  hasBridgeCredentials,
  isLocalHost,
  resolveBridgeUrl,
  resolveOptionalWorkerWatchUrl,
  resolveOptionalWorkerUrl,
  resolveWorkerUrl,
} from "../src/web/runtime-url.js";

const originalLocation = globalThis.location;
const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;

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

  it("requires remote presence for LAN viewer URLs", () => {
    setBrowserUrl("http://localhost:5173/");

    expect(() => buildLanViewerUrlFromHost("192.168.0.10")).toThrow("Mobile viewing requires remote presence");
  });

  it("builds LAN viewer URLs with bridge paused and localhost worker rewritten", () => {
    setBrowserUrl("http://localhost:5173/?worker=ws://127.0.0.1:8787?token=secret");

    expect(buildLanViewerUrlFromHost("192.168.0.10")).toBe("http://192.168.0.10:5173/?worker=ws%3A%2F%2F192.168.0.10%3A8787%2F&bridgePaused=1");
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
