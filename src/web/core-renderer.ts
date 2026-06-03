import type { CoreState, ViewportSize } from "./core-state.js";
import { hexToRgb, modelVisual, planetVariant, type ModelVisual, type PlanetClass, type PlanetVariant } from "./model-visuals.js";

const SPHERE_SEGMENTS_SELF = 96;
const SPHERE_SEGMENTS_PEER = 64;

const RING_CFGS = [
  { tiltY: 0.32, speed: 0.007, alpha: 0.45, radiusScale: 1.55 },
  { tiltY: 0.55, speed: -0.010, alpha: 0.28, radiusScale: 1.85 },
] as const;

const BASE_VISUAL_MORPH_SPEED = 0.012;
const ENERGY_VISUAL_MORPH_SPEED = 0.018;
const RECENT_TURN_VISUAL_MORPH_SPEED = 0.014;
const RECENT_TURN_WINDOW_MS = 8_000;

export interface CoreRenderOptions {
  selfId: string;
  viewport: ViewportSize;
  frameScale: number;
  currentZoom: number;
}

interface RenderVisual extends ModelVisual {
  fromPlanetClass: PlanetClass;
  morphProgress: number;
  secondaryPlanetClass: PlanetClass | null;
  secondaryAlpha: number;
}

interface VisualMorphState {
  source: string;
  model: string;
  from: ModelVisual;
  target: ModelVisual;
  progress: number;
}

export class CoreRenderer {
  private readonly visualStates = new Map<string, VisualMorphState>();

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(core: CoreState, options: CoreRenderOptions): void {
    updateCoreMotion(core, options.frameScale);

    const isSelf = core.id === options.selfId;
    const r = displayCoreRadius(core, isSelf, options.viewport);
    const energyLevel = energyVisualLevel(core.energy);
    const rgb = hexToRgb(core.color);
    const alpha = (isSelf ? 0.84 : 0.68) + energyLevel * (isSelf ? 0.12 : 0.16);
    const variant = planetVariant(core.id, isSelf);
    const visual = this.resolveVisual(core, options.frameScale);

    const activityAlpha = coreActivityAlpha(core, isSelf);

    this.ctx.save();
    this.ctx.globalAlpha *= activityAlpha;

    this.drawGlow(core, r, isSelf, visual);

    for (const [i, cfg] of RING_CFGS.entries()) {
      if (i >= visual.ringCount) continue;
      this.drawRingHalf(
        core.x,
        core.y,
        r,
        cfg.radiusScale * variant.ringScale * visual.ringScale,
        cfg.tiltY,
        core.ringAngles[i]!,
        visual.accentRgb,
        cfg.alpha * variant.ringAlpha * visual.ringAlpha * (0.72 + energyLevel * 0.72),
        false,
      );
    }

    this.ctx.save();
    this.ctx.translate(core.x, core.y);
    this.ctx.scale(variant.squashX * visual.squashX, variant.squashY * visual.squashY);
    this.drawNoisySphere(
      0,
      0,
      r,
      core.noisePhase,
      rgb,
      alpha,
      isSelf ? SPHERE_SEGMENTS_SELF : SPHERE_SEGMENTS_PEER,
    );
    this.drawSurfaceDetails(0, 0, r, core.noisePhase, isSelf, variant, visual);
    this.ctx.restore();

    for (const [i, cfg] of RING_CFGS.entries()) {
      if (i >= visual.ringCount) continue;
      this.drawRingHalf(
        core.x,
        core.y,
        r,
        cfg.radiusScale * variant.ringScale * visual.ringScale,
        cfg.tiltY,
        core.ringAngles[i]!,
        visual.accentRgb,
        cfg.alpha * variant.ringAlpha * visual.ringAlpha * (0.72 + energyLevel * 0.72),
        true,
      );
    }

    this.ctx.font = `${(isSelf ? 12 : 10) / options.currentZoom}px monospace`;
    this.ctx.fillStyle = "rgba(255,255,255,0.62)";
    this.ctx.textAlign = "center";
    this.ctx.fillText(isSelf ? "me" : core.nickname, core.x, core.y + r + 18);
    this.ctx.restore();
  }

  private drawGlow(core: CoreState, r: number, isSelf: boolean, visual: ModelVisual): void {
    const auraScale = core.auraScale ?? 1;
    const energyLevel = energyVisualLevel(core.energy);
    const glowRadius = r * (2.45 + energyLevel * 1.25) * auraScale;
    const glow = this.ctx.createRadialGradient(core.x, core.y, r * 0.4, core.x, core.y, glowRadius);
    glow.addColorStop(0, `rgba(${visual.accentRgb}, ${((isSelf ? 0.18 : 0.12) + energyLevel * 0.18) * visual.glowAlpha})`);
    glow.addColorStop(0.42, `rgba(${visual.accentRgb}, ${energyLevel * 0.11 * visual.glowAlpha})`);
    glow.addColorStop(1, `rgba(${visual.accentRgb}, 0)`);
    this.ctx.beginPath();
    this.ctx.arc(core.x, core.y, glowRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = glow;
    this.ctx.fill();
  }

  private drawRingHalf(
    cx: number, cy: number, r: number,
    radiusScale: number, tiltY: number, angle: number,
    rgb: string, alpha: number, front: boolean,
  ): void {
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(angle);
    this.ctx.scale(1, tiltY);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, r * radiusScale, front ? Math.PI : 0, front ? Math.PI * 2 : Math.PI);
    this.ctx.strokeStyle = `rgba(${rgb}, ${front ? alpha : alpha * 0.4})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawNoisySphere(cx: number, cy: number, r: number, noisePhase: number, rgb: string, alpha: number, segments: number): void {
    const amp = r * 0.07;
    this.ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const noise =
        Math.sin(theta * 3 + noisePhase) * Math.sin(theta * 7 + noisePhase * 0.8) * amp +
        Math.sin(theta * 5 + noisePhase * 1.3) * amp * 0.4;
      const rr = r + noise;
      const x = cx + Math.cos(theta) * rr;
      const y = cy + Math.sin(theta) * rr;
      if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
    const grad = this.ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r * 1.2);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(0.5, `rgba(${rgb}, ${alpha * 0.9})`);
    grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.72})`);
    this.ctx.fillStyle = grad;
    this.ctx.fill();
  }

  private drawSurfaceDetails(
    cx: number,
    cy: number,
    r: number,
    noisePhase: number,
    isSelf: boolean,
    variant: PlanetVariant,
    visual: RenderVisual,
  ): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
    this.ctx.clip();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(variant.bandSlant);

    this.drawBands(r, noisePhase, isSelf, variant, visual);

    this.drawMorphedDetails(r, noisePhase, isSelf, variant, visual);

    const shade = this.ctx.createLinearGradient(-r, -r, r, r);
    shade.addColorStop(0, "rgba(255,255,255,0.08)");
    shade.addColorStop(0.45, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.24)");
    this.ctx.fillStyle = shade;
    this.ctx.fillRect(-r, -r, r * 2, r * 2);
    this.ctx.restore();
  }

  private drawBands(r: number, noisePhase: number, isSelf: boolean, variant: PlanetVariant, visual: ModelVisual): void {
    for (let i = 0; i < variant.bandCount; i++) {
      const t = (i + 0.5) / variant.bandCount;
      const y = (t - 0.5) * r * 1.45;
      const wave = Math.sin(noisePhase * 0.7 + i * 1.9) * r * variant.bandWave;
      const width = r * (1.45 - Math.abs(t - 0.5) * 0.7);
      this.ctx.beginPath();
      this.ctx.moveTo(-width * 0.56, y + wave);
      this.ctx.bezierCurveTo(
        -width * 0.18,
        y - r * 0.16 + wave,
        width * 0.18,
        y + r * 0.16 - wave,
        width * 0.56,
        y - wave,
      );
      this.ctx.strokeStyle = `rgba(${visual.accentRgb}, ${(isSelf ? 0.18 : 0.13) * visual.bandAlpha / 0.18})`;
      this.ctx.lineWidth = Math.max(0.8, r * (isSelf ? 0.035 : 0.028) * visual.bandWidth);
      this.ctx.lineCap = "round";
      this.ctx.stroke();
    }
  }

  private drawCloudSpots(r: number, noisePhase: number, isSelf: boolean, variant: PlanetVariant, visual: ModelVisual): void {
    for (let i = 0; i < variant.spotCount; i++) {
      const angle = noisePhase * 0.35 + i * 2.37;
      const px = Math.cos(angle) * r * 0.42;
      const py = Math.sin(angle * 1.3) * r * 0.34;
      const glow = this.ctx.createRadialGradient(px, py, 0, px, py, r * 0.22);
      glow.addColorStop(0, `rgba(255,255,255,${(isSelf ? 0.12 : 0.08) * visual.spotAlpha})`);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      this.ctx.fillStyle = glow;
      this.ctx.beginPath();
      this.ctx.arc(px, py, r * 0.22, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawMorphedDetails(
    r: number,
    noisePhase: number,
    isSelf: boolean,
    variant: PlanetVariant,
    visual: RenderVisual,
  ): void {
    const fromAlpha = visual.fromPlanetClass === visual.planetClass ? 0 : 1 - visual.morphProgress;
    if (fromAlpha > 0.02) {
      this.ctx.save();
      this.ctx.globalAlpha *= fromAlpha;
      this.drawClassDetails(visual.fromPlanetClass, r, noisePhase, isSelf, variant, visual);
      this.ctx.restore();
    }

    this.ctx.save();
    this.ctx.globalAlpha *= visual.fromPlanetClass === visual.planetClass ? 1 : visual.morphProgress;
    this.drawClassDetails(visual.planetClass, r, noisePhase, isSelf, variant, visual);
    this.ctx.restore();

    if (visual.secondaryPlanetClass && visual.secondaryPlanetClass !== visual.planetClass && visual.secondaryAlpha > 0.04) {
      this.ctx.save();
      this.ctx.globalAlpha *= visual.secondaryAlpha;
      this.drawClassDetails(visual.secondaryPlanetClass, r, noisePhase + 1.7, isSelf, variant, visual);
      this.ctx.restore();
    }
  }

  private drawClassDetails(
    planetClass: PlanetClass,
    r: number,
    noisePhase: number,
    isSelf: boolean,
    variant: PlanetVariant,
    visual: ModelVisual,
  ): void {
    if (planetClass === "forge") {
      this.drawCircuitDetails(r, noisePhase, visual);
    } else if (planetClass === "prism") {
      this.drawPrismDetails(r, noisePhase, visual);
    } else if (planetClass === "grove") {
      this.drawNetworkDetails(r, noisePhase, visual);
    } else if (planetClass === "relay") {
      this.drawRelayDetails(r, noisePhase, visual);
    } else {
      this.drawCloudSpots(r, noisePhase, isSelf, variant, visual);
    }
  }

  private drawCircuitDetails(r: number, noisePhase: number, visual: ModelVisual): void {
    this.ctx.strokeStyle = `rgba(${visual.accentRgb}, 0.22)`;
    this.ctx.lineWidth = Math.max(0.8, r * 0.025);
    this.ctx.lineCap = "round";

    for (let i = 0; i < 5; i++) {
      const y = -r * 0.45 + i * r * 0.22;
      const phase = Math.sin(noisePhase * 0.5 + i) * r * 0.08;
      this.ctx.beginPath();
      this.ctx.moveTo(-r * 0.58, y + phase);
      this.ctx.lineTo(-r * 0.22, y + phase);
      this.ctx.lineTo(-r * 0.08, y + phase + r * 0.12);
      this.ctx.lineTo(r * 0.18, y + phase + r * 0.12);
      this.ctx.lineTo(r * 0.52, y + phase - r * 0.04);
      this.ctx.stroke();
    }

    for (let i = 0; i < 4; i++) {
      const angle = noisePhase * 0.2 + i * 1.7;
      const x = Math.cos(angle) * r * 0.42;
      const y = Math.sin(angle * 1.2) * r * 0.36;
      this.ctx.fillStyle = `rgba(${visual.accentRgb}, 0.26)`;
      this.ctx.fillRect(x - r * 0.035, y - r * 0.035, r * 0.07, r * 0.07);
    }
  }

  private drawPrismDetails(r: number, noisePhase: number, visual: ModelVisual): void {
    for (let i = 0; i < 6; i++) {
      const angle = noisePhase * 0.16 + i * (Math.PI * 2 / 6);
      const x = Math.cos(angle) * r * 0.34;
      const y = Math.sin(angle) * r * 0.34;
      const size = r * (0.1 + (i % 3) * 0.025);

      this.ctx.beginPath();
      this.ctx.moveTo(x, y - size);
      this.ctx.lineTo(x + size * 0.85, y);
      this.ctx.lineTo(x, y + size);
      this.ctx.lineTo(x - size * 0.85, y);
      this.ctx.closePath();
      this.ctx.fillStyle = `rgba(${visual.accentRgb}, 0.16)`;
      this.ctx.fill();
      this.ctx.strokeStyle = "rgba(255,255,255,0.16)";
      this.ctx.lineWidth = Math.max(0.7, r * 0.012);
      this.ctx.stroke();
    }
  }

  private drawNetworkDetails(r: number, noisePhase: number, visual: ModelVisual): void {
    const points = Array.from({ length: 7 }, (_, i) => {
      const angle = noisePhase * 0.18 + i * 2.19;
      return {
        x: Math.cos(angle) * r * (0.16 + (i % 3) * 0.13),
        y: Math.sin(angle * 1.4) * r * (0.18 + (i % 2) * 0.16),
      };
    });

    this.ctx.strokeStyle = `rgba(${visual.accentRgb}, 0.2)`;
    this.ctx.lineWidth = Math.max(0.7, r * 0.018);
    this.ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 2) % points.length]!;
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
    }
    this.ctx.stroke();

    for (const point of points) {
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, r * 0.035, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${visual.accentRgb}, 0.28)`;
      this.ctx.fill();
    }
  }

  private drawRelayDetails(r: number, noisePhase: number, visual: ModelVisual): void {
    this.ctx.strokeStyle = `rgba(${visual.accentRgb}, 0.2)`;
    this.ctx.lineWidth = Math.max(0.8, r * 0.018);

    for (let i = 0; i < 4; i++) {
      const radius = r * (0.18 + i * 0.12);
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, radius * 1.55, radius * 0.62, noisePhase * 0.12 + i * 0.7, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    for (let i = 0; i < 5; i++) {
      const angle = noisePhase * 0.24 + i * (Math.PI * 2 / 5);
      this.ctx.beginPath();
      this.ctx.moveTo(Math.cos(angle) * r * 0.1, Math.sin(angle) * r * 0.1);
      this.ctx.lineTo(Math.cos(angle) * r * 0.62, Math.sin(angle) * r * 0.48);
      this.ctx.stroke();
    }
  }

  private resolveVisual(core: CoreState, frameScale: number): RenderVisual {
    const target = modelVisual(core.lastSource, core.lastModel, core.color);
    let state = this.visualStates.get(core.id);

    if (!state) {
      state = {
        source: core.lastSource,
        model: core.lastModel,
        from: target,
        target,
        progress: 1,
      };
      this.visualStates.set(core.id, state);
    } else if (state.source !== core.lastSource || state.model !== core.lastModel) {
      state.from = blendModelVisual(state.from, state.target, state.progress);
      state.target = target;
      state.source = core.lastSource;
      state.model = core.lastModel;
      state.progress = 0;
    }

    state.progress = Math.min(1, state.progress + visualMorphStep(core, frameScale));
    const blended = blendModelVisual(state.from, state.target, smoothStep(state.progress));
    const intensity = visualTurnIntensity(core);
    const boosted = boostActiveVisual(blended, intensity);
    return {
      ...boosted,
      fromPlanetClass: state.from.planetClass,
      planetClass: state.target.planetClass,
      ringCount: state.progress < 1 ? Math.max(state.from.ringCount, state.target.ringCount) as 1 | 2 : state.target.ringCount,
      morphProgress: smoothStep(state.progress),
      secondaryPlanetClass: core.secondaryPlanetClass,
      secondaryAlpha: Math.min((core.secondaryPlanetClass ? core.planetMix[core.secondaryPlanetClass] ?? 0 : 0) * 0.55, 0.34),
    };
  }
}

function blendModelVisual(from: ModelVisual, to: ModelVisual, t: number): ModelVisual {
  return {
    accentRgb: blendRgb(from.accentRgb, to.accentRgb, t),
    bandAlpha: lerp(from.bandAlpha, to.bandAlpha, t),
    bandWidth: lerp(from.bandWidth, to.bandWidth, t),
    glowAlpha: lerp(from.glowAlpha, to.glowAlpha, t),
    planetClass: t < 1 ? from.planetClass : to.planetClass,
    ringCount: t < 0.5 ? from.ringCount : to.ringCount,
    ringAlpha: lerp(from.ringAlpha, to.ringAlpha, t),
    ringScale: lerp(from.ringScale, to.ringScale, t),
    squashX: lerp(from.squashX, to.squashX, t),
    squashY: lerp(from.squashY, to.squashY, t),
    spotAlpha: lerp(from.spotAlpha, to.spotAlpha, t),
  };
}

function blendRgb(from: string, to: string, t: number): string {
  const a = parseRgb(from);
  const b = parseRgb(to);
  return `${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))}`;
}

function parseRgb(rgb: string): [number, number, number] {
  const parts = rgb.split(",").map((part) => Number.parseFloat(part.trim()));
  return [
    Number.isFinite(parts[0]) ? parts[0]! : 200,
    Number.isFinite(parts[1]) ? parts[1]! : 200,
    Number.isFinite(parts[2]) ? parts[2]! : 200,
  ];
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function visualMorphStep(core: CoreState, frameScale: number, now = Date.now()): number {
  const energyGap = Math.min(Math.abs(core.targetEnergy - core.energy) / 180, 1);
  const recentTurn = recentTurnFactor(core.lastTurnAt, now);
  return frameScale * (
    BASE_VISUAL_MORPH_SPEED +
    energyGap * ENERGY_VISUAL_MORPH_SPEED +
    recentTurn * RECENT_TURN_VISUAL_MORPH_SPEED
  );
}

export function visualTurnIntensity(core: CoreState, now = Date.now()): number {
  const energyGap = Math.min(Math.abs(core.targetEnergy - core.energy) / 240, 1);
  const recentTurn = recentTurnFactor(core.lastTurnAt, now);
  return Math.min(1, energyGap * 0.55 + recentTurn * 0.42 + energyVisualLevel(core.energy) * 0.38);
}

function boostActiveVisual(visual: ModelVisual, intensity: number): ModelVisual {
  if (intensity <= 0) return visual;
  return {
    ...visual,
    bandAlpha: visual.bandAlpha * (1 + intensity * 0.25),
    glowAlpha: visual.glowAlpha * (1 + intensity * 0.32),
    ringAlpha: visual.ringAlpha * (1 + intensity * 0.22),
    spotAlpha: visual.spotAlpha * (1 + intensity * 0.18),
  };
}

function recentTurnFactor(lastTurnAt: number, now: number): number {
  if (lastTurnAt <= 0 || now < lastTurnAt) return 0;
  return Math.max(0, 1 - (now - lastTurnAt) / RECENT_TURN_WINDOW_MS);
}

export function updateCoreMotion(core: CoreState, frameScale: number): void {
  const positionEase = 1 - Math.pow(0.92, frameScale);
  const energyEase = 1 - Math.pow(0.94, frameScale);
  const energyLevel = energyVisualLevel(core.energy);
  const motionScale = 0.72 + energyLevel * 2.35;
  core.x += (core.tx - core.x) * positionEase;
  core.y += (core.ty - core.y) * positionEase;
  core.energy += (core.targetEnergy - core.energy) * energyEase;
  core.pulse += (0.028 + energyLevel * 0.062) * frameScale;
  core.noisePhase += (0.012 + energyLevel * 0.034) * frameScale;
  core.ringAngles[0] += RING_CFGS[0].speed * motionScale * frameScale;
  core.ringAngles[1] += RING_CFGS[1].speed * motionScale * frameScale;
}

export function rawCoreRadius(core: CoreState, isSelf: boolean, includePulse = true): number {
  const base = isSelf ? 25 : 14;
  const energyLevel = energyVisualLevel(core.energy);
  const growth = (
    Math.sqrt(Math.max(0, core.energy)) * (isSelf ? 0.55 : 0.28) +
    energyLevel * (isSelf ? 7 : 3.2)
  ) * (core.growthScale ?? 1);
  const pulse = includePulse ? Math.sin(core.pulse) * (1.5 + energyLevel * 3.2) : 0;
  return base + growth + pulse;
}

export function energyVisualLevel(energy: number): number {
  if (!Number.isFinite(energy) || energy <= 0) return 0;
  return Math.min(Math.log1p(energy) / Math.log1p(5_000), 1);
}

export function displayCoreRadius(core: CoreState, isSelf: boolean, viewport: ViewportSize, includePulse = true): number {
  const raw = rawCoreRadius(core, isSelf, includePulse);
  const cap = Math.min(viewport.width, viewport.height) * (isSelf ? 0.16 : 0.07);
  return Math.min(raw, cap);
}

export function coreActivityAlpha(core: CoreState, isSelf: boolean, now = Date.now()): number {
  if (isSelf || core.lastTurnAt <= 0) return 1;
  const idleMs = now - core.lastTurnAt;
  if (idleMs <= 20_000) return 1;
  return Math.max(0.42, 1 - (idleMs - 20_000) / 20_000);
}
