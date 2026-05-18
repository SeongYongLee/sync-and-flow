import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { colorForId, createIdentity, type Identity } from "../shared/nickname.js";

const IDENTITY_PATH = join(process.env["HOME"] ?? ".", ".sync-and-flow", "identity.json");

export async function getBridgeIdentity(): Promise<Identity> {
  const existing = await readIdentity();
  if (existing) return existing;

  const identity = createIdentity(() => crypto.randomUUID());
  await mkdir(dirname(IDENTITY_PATH), { recursive: true });
  await writeFile(IDENTITY_PATH, JSON.stringify(identity, null, 2));
  return identity;
}

async function readIdentity(): Promise<Identity | null> {
  try {
    const parsed = JSON.parse(await readFile(IDENTITY_PATH, "utf-8")) as Partial<Identity>;
    if (!parsed.userId || !parsed.nickname) return null;
    return { userId: parsed.userId, nickname: parsed.nickname, color: parsed.color ?? colorForId(parsed.userId) };
  } catch {
    return null;
  }
}
