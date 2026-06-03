export interface ParticleTarget {
  id: string;
  x: number;
  y: number;
  absorbRadius?: number;
}

export interface ParticleSpawnOptions {
  speed?: number;
  spread?: number;
  life?: number;
  pull?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
  life: number;
  decay: number;
  pull: number;
  targetId: string;
}

const MIN_ABSORB_RADIUS = 12;
const ABSORB_RADIUS_SCALE = 0.72;
const ABSORB_OVERSHOOT_SCALE = 1.45;
const SLOWDOWN_SCALE = 3.2;

export class ParticleSystem {
  private particles: Particle[] = [];

  constructor(private readonly cap = 520) {}

  get size(): number {
    return this.particles.length;
  }

  spawn(
    target: ParticleTarget,
    count: number,
    color: string,
    viewport: { width: number; height: number },
    isSelf: boolean,
    options: ParticleSpawnOptions = {},
  ): void {
    const spawnRadius = Math.min(viewport.width, viewport.height) * (isSelf ? 0.42 : 0.18);
    const speedScale = options.speed ?? 1;
    const spreadScale = options.spread ?? 1;
    const lifeScale = options.life ?? 1;
    const pullScale = options.pull ?? 1;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = spawnRadius + Math.random() * 50;
      const x = target.x + Math.cos(angle) * dist;
      const y = target.y + Math.sin(angle) * dist;
      const toCore = Math.atan2(target.y - y, target.x - x);
      const speed = (1.2 + Math.random() * 2) * speedScale;
      const spread = (Math.random() - 0.5) * 0.7 * spreadScale;

      this.particles.push({
        x,
        y,
        vx: Math.cos(toCore + spread) * speed,
        vy: Math.sin(toCore + spread) * speed,
        radius: 0.9 + Math.random() * 1.8,
        alpha: 0.36 + Math.random() * 0.28,
        color,
        life: 1,
        decay: (0.008 + Math.random() * 0.012) / lifeScale,
        pull: pullScale,
        targetId: target.id,
      });
    }

    if (this.particles.length > this.cap) this.particles.splice(0, this.particles.length - this.cap);
  }

  draw(ctx: CanvasRenderingContext2D, targets: Map<string, ParticleTarget>, frameScale: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      const target = targets.get(p.targetId);
      if (!target) {
        this.particles.splice(i, 1);
        continue;
      }

      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const absorbRadius = particleAbsorbRadius(target);
      const slowdownRadius = Math.max(42, absorbRadius * SLOWDOWN_SCALE);
      if (dist > 1) {
        p.vx += (dx / dist) * 0.08 * p.pull * frameScale;
        p.vy += (dy / dist) * 0.08 * p.pull * frameScale;
      }

      if (dist < slowdownRadius) {
        const damping = Math.max(0.46, dist / slowdownRadius);
        p.vx *= damping;
        p.vy *= damping;
      }

      const nextX = p.x + p.vx * frameScale;
      const nextY = p.y + p.vy * frameScale;
      const nextDist = Math.hypot(target.x - nextX, target.y - nextY);
      p.life -= p.decay * frameScale;

      if (p.life <= 0 || shouldAbsorbParticle(dist, nextDist, absorbRadius)) {
        this.particles.splice(i, 1);
        continue;
      }

      p.x = nextX;
      p.y = nextY;

      const trail = Math.max(1.4, p.radius * 1.5);
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * trail, p.y - p.vy * trail);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = `rgba(${p.color}, ${p.alpha * p.life * 0.78})`;
      ctx.lineWidth = Math.max(0.8, p.radius * p.life);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}

export function shouldAbsorbParticle(currentDist: number, nextDist: number, absorbRadius = 30): boolean {
  if (!Number.isFinite(currentDist) || !Number.isFinite(nextDist)) return true;
  return shouldAbsorbParticleAtRadius(currentDist, nextDist, absorbRadius);
}

export function shouldAbsorbParticleAtRadius(currentDist: number, nextDist: number, absorbRadius: number): boolean {
  if (!Number.isFinite(currentDist) || !Number.isFinite(nextDist) || !Number.isFinite(absorbRadius)) return true;
  const radius = Math.max(MIN_ABSORB_RADIUS, absorbRadius);
  if (currentDist <= radius || nextDist <= radius) return true;
  return currentDist < radius * ABSORB_OVERSHOOT_SCALE && nextDist > currentDist;
}

export function particleAbsorbRadius(target: ParticleTarget): number {
  return Math.max(MIN_ABSORB_RADIUS, (target.absorbRadius ?? 30) * ABSORB_RADIUS_SCALE);
}
