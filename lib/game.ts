export type JudgingMode = "ai" | "player_vote";
export type Phase = "lobby" | "drawing" | "voting" | "results" | "finished";
export type Player = { id: string; name: string; score: number; active: boolean };
export type Artwork = { playerId: string; image: string; aiScore?: number; comment?: string; votes?: number; rank?: number; points?: number };
export type Round = { number: number; prompt: string; artworks: Artwork[] };
export type Game = { id: string; judgingMode: JudgingMode; roundSeconds: 10 | 30 | 90 | 180; hostId: string; phase: Phase; players: Player[]; rounds: Round[]; promptIndex: number; createdAt: string; roundEndsAt?: string };

export const PROMPTS = ["ドラゴン", "宇宙を旅するねこ", "虹色のペンギン", "お菓子の家", "空飛ぶくじら", "ロボットのお花屋さん", "雲の上の遊園地", "魔法のきのこ", "海底のお城", "月でピクニック"];
export const POINTS: Record<number, number> = { 1: 5, 2: 3, 3: 1 };
export function makeId(prefix = ""): string { return `${prefix}${crypto.randomUUID().slice(0, 8)}`; }
export function rankArtworks(artworks: Artwork[], value: (art: Artwork) => number): Artwork[] {
  const sorted = [...artworks].sort((a, b) => value(b) - value(a));
  let previous: number | undefined; let rank = 0;
  return sorted.map((art, index) => {
    const current = value(art); if (current !== previous) rank = index + 1; previous = current;
    return { ...art, rank, points: POINTS[rank] ?? 0 };
  });
}
export function applyRoundScores(game: Game, ranked: Artwork[]): Game {
  const round = game.rounds.at(-1)!;
  const players = game.players.map(player => ({ ...player, score: player.score + (ranked.find(a => a.playerId === player.id)?.points ?? 0) }));
  return { ...game, players, rounds: [...game.rounds.slice(0, -1), { ...round, artworks: ranked }], phase: round.number === 5 ? "finished" : "results" };
}
