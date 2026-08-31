export type JudgingMode = "ai" | "player_vote";
export type Phase = "lobby" | "drawing" | "voting" | "results" | "finished";
export type Player = { id: string; name: string; score: number; active: boolean };
export type Artwork = { playerId: string; image: string; aiScore?: number; comment?: string; votes?: number; rank?: number; points?: number };
export type Round = { number: number; prompt: string; artworks: Artwork[] };
export type Game = { id: string; judgingMode: JudgingMode; roundSeconds: 10 | 30 | 90 | 180; totalRounds: 1 | 3 | 5 | 10; promptDeck: string[]; hostId: string; phase: Phase; players: Player[]; rounds: Round[]; promptIndex: number; createdAt: string; roundStartsAt?: string; roundEndsAt?: string; updatedAt?: string };

export const PROMPTS = ["ドラゴン", "トナカイ", "ペンギン", "ライオン", "キリン", "パンダ", "ネコ", "イヌ", "ウサギ", "ゾウ", "ゴリラ", "カメ", "クジラ", "サメ", "タコ", "クラゲ", "ロボット", "宇宙船", "お城", "火山", "虹", "太陽", "月", "星", "雲", "花", "きのこ", "ケーキ", "アイス", "ギター", "ピアノ", "サッカー", "王冠", "宝箱", "幽霊", "恐竜", "忍者", "魔女", "海賊", "雪だるま"];
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
  return { ...game, players, rounds: [...game.rounds.slice(0, -1), { ...round, artworks: ranked }], phase: round.number === game.totalRounds ? "finished" : "results" };
}
