import type { PeerMeta } from "../../src/shared/protocol.js";

export const MAX_PEERS = 4;

export function samplePeers(
  viewerId: string,
  activeUsers: Map<string, PeerMeta>,
  previousRoster: Set<string> = new Set(),
): PeerMeta[] {
  const candidates = [...activeUsers.values()].filter((user) => user.id !== viewerId);
  if (candidates.length <= MAX_PEERS) return candidates;

  const byId = new Map(candidates.map((user) => [user.id, user]));
  const selected: PeerMeta[] = [];

  for (const id of previousRoster) {
    const peer = byId.get(id);
    if (peer && selected.length < Math.floor(MAX_PEERS / 2)) {
      selected.push(peer);
      byId.delete(id);
    }
  }

  const rest = [...byId.values()];
  while (selected.length < MAX_PEERS && rest.length) {
    const index = Math.floor(Math.random() * rest.length);
    const [peer] = rest.splice(index, 1);
    if (peer) selected.push(peer);
  }

  return selected;
}
