export interface GridViewport {
  width: number;
  height: number;
}

export class GridLayer {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;
  private viewport: GridViewport = { width: 0, height: 0 };
  private renderedStep = 0;

  constructor(private readonly defaultStep = 72) {}

  resize(viewport: GridViewport): void {
    this.viewport = viewport;
    this.canvas.width = viewport.width;
    this.canvas.height = viewport.height;
    this.renderedStep = 0;
    this.render(this.defaultStep);
  }

  drawTo(ctx: CanvasRenderingContext2D, step = this.defaultStep): void {
    this.render(step);
    ctx.drawImage(this.canvas, 0, 0);
  }

  private render(step: number): void {
    const roundedStep = Math.max(12, Math.round(step));
    if (roundedStep === this.renderedStep) return;
    this.renderedStep = roundedStep;
    renderGridPattern(this.ctx, this.viewport, roundedStep);
  }
}

export function drawFlowBackdrop(ctx: CanvasRenderingContext2D, viewport: GridViewport, energy: number, phase: number): void {
  const step = gridStepForEnergy(energy);
  const drift = backdropDriftForEnergy(energy);
  const width = viewport.width;
  const height = viewport.height;
  const diagonal = Math.hypot(width, height);
  const offset = (phase * drift) % (step * 4);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  drawDiagonalThreads(ctx, width, height, diagonal, step, offset, "96, 218, 255", 0.018);
  drawDiagonalThreads(ctx, width, height, diagonal, step * 1.7, -offset * 0.72, "255, 184, 96", 0.012, -1);
  drawDistantPoints(ctx, viewport, step, phase);

  ctx.restore();
}

function drawDiagonalThreads(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  diagonal: number,
  step: number,
  offset: number,
  rgb: string,
  alpha: number,
  direction = 1,
): void {
  ctx.beginPath();
  for (let i = -diagonal; i < diagonal; i += step * 2.4) {
    const x = i + offset;
    ctx.moveTo(x, direction > 0 ? height : 0);
    ctx.lineTo(x + diagonal, direction > 0 ? 0 : height);
  }
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawDistantPoints(ctx: CanvasRenderingContext2D, viewport: GridViewport, step: number, phase: number): void {
  const spacing = Math.max(34, Math.round(step * 1.35));
  const pulse = 0.65 + Math.sin(phase * 0.002) * 0.25;

  ctx.fillStyle = `rgba(210, 226, 255, ${0.024 * pulse})`;
  for (let y = spacing * 0.5; y < viewport.height; y += spacing) {
    for (let x = spacing * 0.5; x < viewport.width; x += spacing) {
      if (hashUnit(`${Math.round(x)}:${Math.round(y)}`) < 0.58) continue;
      const size = 0.7 + hashUnit(`${Math.round(y)}:${Math.round(x)}`) * 1.4;
      ctx.fillRect(x, y, size, size);
    }
  }
}

export function renderGridPattern(ctx: CanvasRenderingContext2D, viewport: GridViewport, step: number): void {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.beginPath();
  for (let x = 0; x < viewport.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewport.height);
  }
  for (let y = 0; y < viewport.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function gridStepForEnergy(energy: number): number {
  if (!Number.isFinite(energy) || energy <= 0) return 72;
  const compression = Math.sqrt(Math.log10(energy + 10));
  return Math.max(18, 82 / compression);
}

export function backdropDriftForEnergy(energy: number): number {
  if (!Number.isFinite(energy) || energy <= 0) return 0.012;
  return 0.012 + Math.log10(energy + 10) * 0.0024;
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
