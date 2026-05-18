import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

export function isSessionFile(filename: string): boolean {
  return UUID_RE.test(filename);
}

export class FileTail {
  private position: number;
  private fragment = "";
  private handle: FileHandle | null = null;

  constructor(
    public readonly filePath: string,
    startPosition: number = 0,
  ) {
    this.position = startPosition;
  }

  async open(): Promise<void> {
    this.handle = await open(this.filePath, "r");
  }

  async close(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
  }

  async pull(): Promise<string[]> {
    const lines: string[] = [];

    let fileSize: number;
    try {
      const s = await stat(this.filePath);
      fileSize = s.size;
    } catch {
      return lines;
    }

    if (fileSize < this.position) {
      console.warn(`[tail] ${this.filePath}: size shrank (${fileSize} < ${this.position}), resetting position`);
      this.position = 0;
      this.fragment = "";
    }

    if (fileSize === this.position) return lines;

    const toRead = fileSize - this.position;
    const buf = Buffer.allocUnsafe(toRead);

    if (!this.handle) await this.open();

    const { bytesRead } = await this.handle!.read(buf, 0, toRead, this.position);
    this.position += bytesRead;

    const chunk = this.fragment + buf.toString("utf-8", 0, bytesRead);
    const parts = chunk.split("\n");

    // last element may be incomplete — hold it for next pull
    this.fragment = parts.pop() ?? "";

    for (const part of parts) {
      if (part.trim()) lines.push(part);
    }

    return lines;
  }
}
