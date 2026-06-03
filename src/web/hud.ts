import { PLANET_META, type PlanetClass } from "./model-visuals.js";

export type PresenceStatus = "disabled" | "connecting" | "open" | "closed" | "fallback" | "unreachable";
export type StreamStatus = "idle" | "connecting" | "open" | "error";

export interface StatusView {
  text: string;
  color: string;
}

export class HudController {
  private readonly model = document.getElementById("model")!;
  private readonly planet = document.getElementById("planet")!;
  private readonly planetMix = document.getElementById("planet-mix")!;
  private readonly viewers = document.getElementById("viewers")!;
  private readonly turns = document.getElementById("turns")!;
  private readonly output = document.getElementById("output-tokens")!;
  private readonly energy = document.getElementById("energy")!;
  private readonly status = document.getElementById("status")!;
  private presenceState: PresenceStatus = "disabled";
  private streamState: StreamStatus = "idle";

  updatePresence(state: PresenceStatus, detail = ""): void {
    this.presenceState = state;
    this.renderStatus(detail);
  }

  updateStream(state: StreamStatus, detail = ""): void {
    this.streamState = state;
    this.renderStatus(detail);
  }

  updateTurn(source: string, model: string, turns: number, outputTokens: number, energy: number, planetClass: PlanetClass = "drift", mixLabel = ""): void {
    const meta = PLANET_META[planetClass];
    this.model.textContent = formatModelLabel(source, model);
    this.planet.textContent = `${meta.label} · ${meta.role}`;
    this.planet.title = meta.description;
    this.planetMix.textContent = mixLabel || meta.label;
    this.turns.textContent = compactCount(turns);
    this.output.textContent = compactCount(outputTokens);
    this.energy.textContent = `${Math.round(energy).toLocaleString()} flow`;
  }

  updateViewerCount(count: number): void {
    this.viewers.textContent = compactCount(count);
  }

  private renderStatus(detail: string): void {
    const view = resolveStatusView(this.presenceState, this.streamState);
    this.status.textContent = view.text;
    this.status.style.color = view.color;
    this.status.title = detail;
  }
}

export function formatModelLabel(source: string, model: string): string {
  return source && model ? `${source} / ${model}` : "—";
}

export function compactCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 10_000) return rounded.toLocaleString();
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: rounded < 1_000_000 ? 1 : 0,
  }).format(rounded);
}

export function resolveStatusView(presenceState: PresenceStatus, streamState: StreamStatus): StatusView {
  if (presenceState === "open") return { text: "● MULTI LIVE", color: "#80ff80" };
  if (streamState === "open") return { text: "● SSE LIVE", color: "#80ff80" };
  if (presenceState === "fallback") return { text: "● SSE FALLBACK", color: "#ffb050" };
  if (presenceState === "unreachable") return { text: "● WORKER UNREACHABLE", color: "#ffb050" };
  if (presenceState === "disabled" && streamState === "idle") return { text: "● LOCAL ONLY", color: "rgba(255,255,255,0.45)" };
  return { text: "● CONNECTING", color: "rgba(255,255,255,0.45)" };
}
