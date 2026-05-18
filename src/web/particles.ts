export interface ParticleTarget {
  id: string;
  x: number;
  y: number;
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
  targetId: string;
}

export class ParticleSystem {
  private particles: Particle[] = [];

  constructor(private readonly cap = 520) {}

  get size(): number {
    return this.particles.length;
  }

  spawn(target: ParticleTarget, count: number, color: string, viewport: { width: number; height: number }, isSelf: boolean): void {
    const spawnRadius = Math.min(viewport.width, viewport.height) * (isSelf ? 0.42 : 0.18);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = spawnRadius + Math.random() * 50;
      const x = target.x + Math.cos(angle) * dist;
      const y = target.y + Math.sin(angle) * dist;
      const toCore = Math.atan2(target.y - y, target.x - x);
      const speed = 1.2 + Math.random() * 2;
      const spread = (Math.random() - 0.5) * 0.7;

      this.particles.push({
        x,
        y,
        vx: Math.cos(toCore + spread) * speed,
        vy: Math.sin(toCore + spread) * speed,
        radius: 0.9 + Math.random() * 1.8,
        alpha: 0.36 + Math.random() * 0.28,
        color,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
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
      if (dist > 1) {
        p.vx += (dx / dist) * 0.08 * frameScale;
        p.vy += (dy / dist) * 0.08 * frameScale;
      }

      p.x += p.vx * frameScale;
      p.y += p.vy * frameScale;
      p.life -= p.decay * frameScale;

      if (p.life <= 0 || dist < 18) {
        this.particles.splice(i, 1);
        continue;
      }

      const trail = Math.max(2.5, p.radius * 2.8);
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * trail, p.y - p.vy * trail);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = `rgba(${p.color}, ${p.alpha * p.life})`;
      ctx.lineWidth = Math.max(0.8, p.radius * p.life);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}
