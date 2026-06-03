import { ensureCore, layoutCores, type CoreState, type ViewportSize } from "./core-state.js";
import type { TurnEvent } from "./stream-client.js";

export const DEMO_CORE_ID = "demo-flow-core";

interface DemoModel {
  source: string;
  provider: string;
  model: string;
  outputMin: number;
  outputMax: number;
}

export interface DemoFlowState {
  nextTurnAt: number;
  turns: number;
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  energy: number;
  modelIndex: number;
}

const DEMO_MODELS: DemoModel[] = [
  { source: "codex", provider: "openai", model: "gpt-5-codex", outputMin: 720, outputMax: 2_700 },
  { source: "claude", provider: "anthropic", model: "claude-sonnet-4-6", outputMin: 560, outputMax: 2_100 },
  { source: "gemini-cli", provider: "google", model: "gemini-pro", outputMin: 460, outputMax: 1_850 },
  { source: "copilot", provider: "github", model: "gpt-4.1", outputMin: 380, outputMax: 1_450 },
  { source: "cursor", provider: "cursor", model: "cursor-agent", outputMin: 420, outputMax: 1_650 },
];

export function createDemoFlowState(now = 0): DemoFlowState {
  return {
    nextTurnAt: now + 900,
    turns: 0,
    outputTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    energy: 0,
    modelIndex: 0,
  };
}

export function shouldShowDemoFlow(mode: "local-bridge" | "browser-only", cores: Map<string, CoreState>): boolean {
  if (mode !== "browser-only") return false;
  return [...cores.keys()].every((id) => id === DEMO_CORE_ID);
}

export function ensureDemoFlowCore(cores: Map<string, CoreState>, viewport: ViewportSize): CoreState {
  const core = ensureCore(cores, { id: DEMO_CORE_ID, nickname: "demo", color: "#80b4ff" }, viewport, () => 0.42);
  layoutCores(cores, DEMO_CORE_ID, viewport);
  return core;
}

export function nextDemoTurn(state: DemoFlowState, now: number, random = Math.random): TurnEvent | null {
  if (now < state.nextTurnAt) return null;

  const model = pickDemoModel(state, random);
  const outputTokens = randomInt(model.outputMin, model.outputMax, random);
  const inputTokens = randomInt(outputTokens * 2.2, outputTokens * 5.4, random);
  const cacheReadTokens = random() > 0.46 ? randomInt(outputTokens * 1.4, outputTokens * 8, random) : 0;
  state.turns += 1;
  state.outputTokens += outputTokens;
  state.inputTokens += inputTokens;
  state.cacheReadTokens += cacheReadTokens;
  state.energy += outputTokens + cacheReadTokens * 0.1;
  state.nextTurnAt = now + randomInt(2_400, 4_800, random);

  return {
    type: "turn",
    source: model.source,
    provider: model.provider,
    model: model.model,
    delta: { inputTokens, outputTokens, cacheReadTokens },
    totals: {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      cacheReadTokens: state.cacheReadTokens,
      turns: state.turns,
      totalUsd: 0,
    },
    sourceTotals: {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      cacheReadTokens: state.cacheReadTokens,
      turns: state.turns,
      totalUsd: 0,
    },
    energy: state.energy,
    timestamp: new Date(now).toISOString(),
  };
}

export function removeDemoFlowCore(cores: Map<string, CoreState>): void {
  cores.delete(DEMO_CORE_ID);
}

function pickDemoModel(state: DemoFlowState, random: () => number): DemoModel {
  if (state.turns === 0 || random() > 0.56) {
    state.modelIndex = (state.modelIndex + 1 + Math.floor(random() * (DEMO_MODELS.length - 1))) % DEMO_MODELS.length;
  }
  return DEMO_MODELS[state.modelIndex]!;
}

function randomInt(min: number, max: number, random: () => number): number {
  return Math.round(min + random() * (max - min));
}
