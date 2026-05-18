import type { CoreState, ViewportSize } from "./core-state.js";
import { hexToRgb, modelVisual, planetVariant, type ModelVisual, type PlanetVariant } from "./model-visuals.js";

const SPHERE_SEGMENTS_SELF = 96;
const SPHERE_SEGMENTS_PEER = 64;

const RING_CFGS = [
  { tiltY: 0.32, speed: 0.007, alpha: 0.45, radiusScale: 1.55 },
  { tiltY: 0.55, speed: -0.010, alpha: 0.28, radiusScale: 1.85 },
] as const;

export interface CoreRenderOptions {
  selfId: string;
  viewport: ViewportSize;
  frameScale: number;
  currentZoom: number;
}

export class CoreRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(core: CoreState, options: CoreRenderOptions): void {
    updateCoreMotion(core, options.frameScale);

    const isSelf = core.id === options.selfId;
    const r = displayCoreRadius(core, isSelf, options.viewport);
    const rgb = hexToRgb(core.color);
    const alpha = isSelf ? 0.88 : 0.72;
    const variant = planetVariant(core.id, isSelf);
    const visual = modelVisual(core.lastSource, core.lastModel, core.color);

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
        cfg.alpha * variant.ringAlpha * visual.ringAlpha,
        false,
      );
    }

    this.ctx.save();
    this.ctx.translate(core.x, core.y);
    this.ctx.scale(variant.squashX, variant.squashY);
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
        cfg.alpha * variant.ringAlpha * visual.ringAlpha,
        true,
      );
    }

    this.ctx.font = `${(isSelf ? 12 : 10) / options.currentZoom}px monospace`;
    this.ctx.fillStyle = "rgba(255,255,255,0.62)";
    this.ctx.textAlign = "center";
    this.ctx.fillText(isSelf ? "me" : core.nickname, core.x, core.y + r + 18);
  }

  private drawGlow(core: CoreState, r: number, isSelf: boolean, visual: ModelVisual): void {
    const glow = this.ctx.createRadialGradient(core.x, core.y, r * 0.4, core.x, core.y, r * 2.8);
    glow.addColorStop(0, `rgba(${visual.accentRgb}, ${(isSelf ? 0.2 : 0.14) * visual.glowAlpha})`);
    glow.addColorStop(1, `rgba(${visual.accentRgb}, 0)`);
    this.ctx.beginPath();
    this.ctx.arc(core.x, core.y, r * 2.8, 0, Math.PI * 2);
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
    visual: ModelVisual,
  ): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
    this.ctx.clip();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(variant.bandSlant);

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

    const shade = this.ctx.createLinearGradient(-r, -r, r, r);
    shade.addColorStop(0, "rgba(255,255,255,0.08)");
    shade.addColorStop(0.45, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.24)");
    this.ctx.fillStyle = shade;
    this.ctx.fillRect(-r, -r, r * 2, r * 2);
    this.ctx.restore();
  }
}

export function updateCoreMotion(core: CoreState, frameScale: number): void {
  const positionEase = 1 - Math.pow(0.92, frameScale);
  const energyEase = 1 - Math.pow(0.94, frameScale);
  core.x += (core.tx - core.x) * positionEase;
  core.y += (core.ty - core.y) * positionEase;
  core.energy += (core.targetEnergy - core.energy) * energyEase;
  core.pulse += 0.04 * frameScale;
  core.noisePhase += 0.018 * frameScale;
  core.ringAngles[0] += RING_CFGS[0].speed * frameScale;
  core.ringAngles[1] += RING_CFGS[1].speed * frameScale;
}

export function rawCoreRadius(core: CoreState, isSelf: boolean, includePulse = true): number {
  const base = isSelf ? 25 : 14;
  const growth = Math.sqrt(Math.max(0, core.energy)) * (isSelf ? 0.55 : 0.28);
  const pulse = includePulse ? Math.sin(core.pulse) * 2 : 0;
  return base + growth + pulse;
}

export function displayCoreRadius(core: CoreState, isSelf: boolean, viewport: ViewportSize, includePulse = true): number {
  const raw = rawCoreRadius(core, isSelf, includePulse);
  if (isSelf) return raw;
  const cap = Math.min(viewport.width, viewport.height) * 0.07;
  return Math.min(raw, cap);
}
