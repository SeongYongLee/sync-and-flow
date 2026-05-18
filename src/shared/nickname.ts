const ADJECTIVES = ["calm", "bright", "swift", "quiet", "brave", "warm", "clear", "lucky"];
const ANIMALS = ["fox", "otter", "hawk", "panda", "lynx", "seal", "tiger", "whale"];
const COLORS = ["#80b4ff", "#ffb050", "#7ee0a8", "#c58cff", "#ff7f9f", "#6ee7f9", "#f4d35e", "#b8f2e6"];

export interface Identity {
  userId: string;
  nickname: string;
  color: string;
}

export function makeNickname(seed = Math.random()): string {
  const n = Math.floor(seed * 10_000);
  const adjective = ADJECTIVES[n % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(n / ADJECTIVES.length) % ANIMALS.length]!;
  return `${adjective}-${animal}-${String(n % 1000).padStart(3, "0")}`;
}

export function colorForId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

export function createIdentity(randomUUID: () => string): Identity {
  const userId = randomUUID();
  return {
    userId,
    nickname: makeNickname(Math.random()),
    color: colorForId(userId),
  };
}
