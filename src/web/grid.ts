export interface GridViewport {
  width: number;
  height: number;
}

export interface AmbientBody {
  x: number;
  y: number;
  radius: number;
  rgb: string;
  alpha: number;
  ring: boolean;
  kind: "cloud" | "ring" | "prism" | "network" | "relay";
  phase: number;
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

  drawDiagonalThreads(ctx, height, diagonal, step, offset, "96, 218, 255", 0.011);
  drawDiagonalThreads(ctx, height, diagonal, step * 1.7, -offset * 0.72, "255, 184, 96", 0.006, -1);
  drawAmbientBodies(ctx, ambientBodiesForBackdrop(viewport, energy), phase);
  drawDistantPoints(ctx, viewport, step, phase);

  ctx.restore();
}

function drawDiagonalThreads(
  ctx: CanvasRenderingContext2D,
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
  const spacing = Math.max(20, Math.round(step * 0.78));
  const pulse = 0.72 + Math.sin(phase * 0.002) * 0.18;

  for (let y = spacing * 0.5; y < viewport.height; y += spacing) {
    for (let x = spacing * 0.5; x < viewport.width; x += spacing) {
      const density = hashUnit(`${Math.round(x)}:${Math.round(y)}`);
      if (density < 0.54) continue;
      const bright = density > 0.92;
      const size = bright ? 1.1 : 0.65;
      const alpha = (bright ? 0.13 : 0.052) * pulse;
      ctx.fillStyle = `rgba(218, 231, 255, ${alpha})`;
      ctx.fillRect(x, y, size, size);
    }
  }
}

function drawAmbientBodies(ctx: CanvasRenderingContext2D, bodies: AmbientBody[], phase: number): void {
  for (const body of bodies) {
    const pulse = 0.82 + Math.sin(phase * 0.0012 + body.phase) * 0.18;
    const radius = body.radius * pulse;
    const glow = ctx.createRadialGradient(body.x, body.y, radius * 0.15, body.x, body.y, radius * 2.8);
    glow.addColorStop(0, `rgba(${body.rgb}, ${body.alpha * 1.35})`);
    glow.addColorStop(0.44, `rgba(${body.rgb}, ${body.alpha * 0.34})`);
    glow.addColorStop(1, `rgba(${body.rgb}, 0)`);

    ctx.beginPath();
    ctx.arc(body.x, body.y, radius * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(body.x, body.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${body.rgb}, ${body.alpha * 0.98})`;
    ctx.fill();

    drawAmbientBodyDetails(ctx, body, radius, phase);
  }
}

function drawAmbientBodyDetails(ctx: CanvasRenderingContext2D, body: AmbientBody, radius: number, phase: number): void {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(phase * 0.00008 + body.phase);
  ctx.strokeStyle = `rgba(${body.rgb}, ${body.alpha * 0.54})`;
  ctx.fillStyle = `rgba(${body.rgb}, ${body.alpha * 0.46})`;
  ctx.lineWidth = 1;

  if (body.ring || body.kind === "ring") {
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 2.15, radius * 0.54, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (body.kind === "prism") {
    for (let i = 0; i < 3; i++) {
      const angle = i * (Math.PI * 2 / 3) + phase * 0.00012;
      const x = Math.cos(angle) * radius * 0.58;
      const y = Math.sin(angle) * radius * 0.58;
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 0.38);
      ctx.lineTo(x + radius * 0.34, y);
      ctx.lineTo(x, y + radius * 0.38);
      ctx.lineTo(x - radius * 0.34, y);
      ctx.closePath();
      ctx.stroke();
    }
  } else if (body.kind === "network") {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = i * 1.31;
      const b = a + 2.08;
      ctx.moveTo(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.54);
      ctx.lineTo(Math.cos(b) * radius * 0.72, Math.sin(b) * radius * 0.62);
    }
    ctx.stroke();
  } else if (body.kind === "relay") {
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * (0.62 + i * 0.26), radius * (0.18 + i * 0.09), i * 0.38, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (body.kind === "cloud") {
    for (let i = 0; i < 3; i++) {
      const x = Math.cos(body.phase + i * 2.4) * radius * 0.36;
      const y = Math.sin(body.phase + i * 1.7) * radius * 0.32;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
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

export function ambientBodiesForBackdrop(viewport: GridViewport, energy: number): AmbientBody[] {
  const energyLevel = backdropEnergyLevel(energy);
  const areaCount = Math.round((viewport.width * viewport.height) / 180_000);
  const energyCount = Number.isFinite(energy) && energy > 0 ? Math.floor(Math.log10(energy + 10) * 0.42) : 0;
  const count = Math.min(12, Math.max(4, areaCount + energyCount));
  const palette = ["128, 180, 255", "255, 176, 80", "126, 224, 168", "197, 140, 255", "110, 231, 249"];
  const kinds: AmbientBody["kind"][] = ["cloud", "ring", "prism", "network", "relay"];
  const viewportSeed = `${Math.round(viewport.width / 80)}:${Math.round(viewport.height / 80)}`;

  return Array.from({ length: count }, (_, index) => {
    const seed = `${viewportSeed}:${index}`;
    const x = hashUnit(`${seed}:x`) * viewport.width;
    const y = hashUnit(`${seed}:y`) * viewport.height;
    const radius = (3.6 + hashUnit(`${seed}:r`) * 8.2) * (0.88 + energyLevel * 0.22);
    const alpha = (0.022 + hashUnit(`${seed}:a`) * 0.036) * (0.92 + energyLevel * 0.24);
    const colorIndex = Math.floor(hashUnit(`${seed}:c`) * palette.length) % palette.length;
    const kindIndex = Math.floor(hashUnit(`${seed}:kind`) * kinds.length) % kinds.length;
    return {
      x,
      y,
      radius,
      rgb: palette[colorIndex]!,
      alpha,
      ring: hashUnit(`${seed}:ring`) > 0.62,
      kind: kinds[kindIndex]!,
      phase: hashUnit(`${seed}:phase`) * Math.PI * 2,
    };
  });
}

function backdropEnergyLevel(energy: number): number {
  if (!Number.isFinite(energy) || energy <= 0) return 0;
  return Math.min(Math.log10(energy + 10) / 8, 1);
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
