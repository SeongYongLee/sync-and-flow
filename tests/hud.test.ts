import { describe, expect, it } from "vitest";
import { formatModelLabel, resolveStatusView } from "../src/web/hud.js";

describe("resolveStatusView", () => {
  it("prioritizes multi-presence over local stream", () => {
    expect(resolveStatusView("open", "open")).toEqual({ text: "● MULTI LIVE", color: "#80ff80" });
  });

  it("shows SSE live when worker presence is not open", () => {
    expect(resolveStatusView("disabled", "open")).toEqual({ text: "● SSE LIVE", color: "#80ff80" });
  });

  it("surfaces worker fallback and unreachable states", () => {
    expect(resolveStatusView("fallback", "idle")).toEqual({ text: "● SSE FALLBACK", color: "#ffb050" });
    expect(resolveStatusView("unreachable", "idle")).toEqual({ text: "● WORKER UNREACHABLE", color: "#ffb050" });
  });

  it("defaults to connecting", () => {
    expect(resolveStatusView("connecting", "idle")).toEqual({ text: "● CONNECTING", color: "rgba(255,255,255,0.45)" });
  });

  it("shows local-only when remote presence is disabled and no stream is open", () => {
    expect(resolveStatusView("disabled", "idle")).toEqual({ text: "● LOCAL ONLY", color: "rgba(255,255,255,0.45)" });
  });

  it("does not render an empty source/model snapshot as a colon", () => {
    expect(formatModelLabel("", "")).toBe("—");
    expect(formatModelLabel("codex", "gpt-5.5")).toBe("codex:gpt-5.5");
  });
});
