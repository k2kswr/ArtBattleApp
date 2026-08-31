import { NextRequest, NextResponse } from "next/server";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({ apikey: key!, authorization: `Bearer ${key!}`, "content-type": "application/json" });

type Artwork = { playerId: string; image: string; [key: string]: unknown };
type Round = { number: number; prompt: string; artworks: Artwork[]; [key: string]: unknown };
type GameState = { id: string; hostId: string; judgingMode: "ai" | "player_vote"; phase: string; players: Array<{ id: string; active?: boolean }>; rounds: Round[]; updatedAt?: string; [key: string]: unknown };

async function findRoom(id: string) {
  const response = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}&select=state`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error("load failed");
  const rows = await response.json() as { state: GameState }[];
  return rows[0]?.state ?? null;
}

function toRow(game: GameState) {
  return { id: game.id, host_token: game.hostId, judging_mode: game.judgingMode, phase: game.phase, current_round: game.rounds.length, prompts: game.rounds.map(round => round.prompt), state: game };
}

export async function POST(request: NextRequest) {
  if (!url || !key) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { roomId, playerId, image } = await request.json() as { roomId?: string; playerId?: string; image?: string };
  if (!roomId || !playerId || !image || image.length > 2_500_000) return NextResponse.json({ error: "提出データが不正です。" }, { status: 400 });
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const game = await findRoom(roomId);
      if (!game || game.phase !== "drawing") return NextResponse.json({ error: "このラウンドはすでに終了しています。" }, { status: 409 });
      const round = game.rounds.at(-1); const player = game.players.find(item => item.id === playerId && item.active !== false);
      if (!round || !player) return NextResponse.json({ error: "参加者を確認できませんでした。" }, { status: 403 });
      if (round.artworks.some(art => art.playerId === playerId)) return NextResponse.json({ ok: true, alreadySubmitted: true, phase: game.phase });
      const artworks = [...round.artworks, { playerId, image }];
      const everyoneSubmitted = game.players.filter(item => item.active !== false).every(item => artworks.some(art => art.playerId === item.id));
      const next: GameState = { ...game, phase: everyoneSubmitted ? (game.judgingMode === "ai" ? "results" : "voting") : game.phase, rounds: [...game.rounds.slice(0, -1), { ...round, artworks }], updatedAt: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const versionFilter = game.updatedAt ? `&state->>updatedAt=eq.${encodeURIComponent(game.updatedAt)}` : "";
      const response = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}${versionFilter}`, { method: "PATCH", headers: { ...headers(), Prefer: "return=representation" }, body: JSON.stringify(toRow(next)) });
      if (!response.ok) throw new Error("save failed");
      const rows = await response.json() as unknown[];
      if (rows.length > 0) return NextResponse.json({ ok: true, phase: next.phase, shouldJudge: everyoneSubmitted && next.judgingMode === "ai" });
    }
    return NextResponse.json({ error: "同時提出のため保存を完了できませんでした。もう一度提出してください。" }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "作品を保存できませんでした。通信状況を確認して、もう一度提出してください。" }, { status: 502 });
  }
}