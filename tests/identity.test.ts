import { afterEach, describe, expect, it, vi } from "vitest";
import { getPresenceIdentityResult } from "../src/web/identity.js";
import type { Identity } from "../src/shared/nickname.js";

const originalFetch = globalThis.fetch;
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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("presence identity", () => {
  it("uses the local bridge identity from a normal browser page", async () => {
    setBrowserUrl("http://192.168.0.38:5175/");
    const bridgeIdentity: Identity = { userId: "app-user", nickname: "desktop-app", color: "#80b4ff" };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => bridgeIdentity,
    }));
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });

    await expect(getPresenceIdentityResult()).resolves.toEqual({
      identity: bridgeIdentity,
      mode: "local-bridge",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3001/identity", expect.any(Object));
  });

  it("falls back to browser-only identity when the local bridge is missing", async () => {
    setBrowserUrl("http://192.168.0.38:5175/");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error("bridge missing");
      }),
    });

    const result = await getPresenceIdentityResult();

    expect(result.mode).toBe("browser-only");
    expect(result.identity.userId).toBeTruthy();
  });
});
