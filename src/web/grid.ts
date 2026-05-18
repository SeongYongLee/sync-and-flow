export interface GridViewport {
  width: number;
  height: number;
}

export class GridLayer {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d")!;

  constructor(private readonly step = 60) {}

  resize(viewport: GridViewport): void {
    this.canvas.width = viewport.width;
    this.canvas.height = viewport.height;
    renderGridPattern(this.ctx, viewport, this.step);
  }

  drawTo(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.canvas, 0, 0);
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
