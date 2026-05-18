import { afterEach, describe, expect, it } from "vitest";
import { hasBridgeCredentials, isLocalHost, resolveBridgeUrl, resolveWorkerUrl } from "../src/web/runtime-url.js";

const originalLocation = globalThis.location;
const originalSessionStorage = globalThis.sessionStorage;

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
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

  it("resolves LAN worker URL from the current host", () => {
    setBrowserUrl("http://192.168.0.10:5173/");

    expect(resolveWorkerUrl()).toBe("ws://192.168.0.10:8787");
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
