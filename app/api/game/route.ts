import { NextRequest, NextResponse } from "next/server";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({ apikey: key!, authorization: `Bearer ${key!}`, "content-type": "application/json" });

type GameState = { id: string; hostId: string; judgingMode: string; phase: string; players: Array<{ id: string; score?: number; active?: boolean }>; rounds: Array<{ number: number; prompt: string; artworks: Array<{ playerId: string; image?: string; votes?: number; [key: string]: unknown }>; [key: string]: unknown }>; promptIndex: number; roundStartsAt?: string; roundEndsAt?: string; updatedAt?: string; [key: string]: unknown };
const phaseOrder: Record<string, number> = { lobby: 0, drawing: 1, voting: 2, results: 3, finished: 4 };
const blankImage = "data:image/svg+xml,%3Csvg";

function isBlank(image?: string) { return !image || image.startsWith(blankImage); }
function mergeArtwork(current: GameState["rounds"][number]["artworks"][number], incoming: GameState["rounds"][number]["artworks"][number]) {
  return { ...current, ...incoming, image: isBlank(incoming.image) && !isBlank(current.image) ? current.image : incoming.image ?? current.image, votes: Math.max(Number(current.votes ?? 0), Number(incoming.votes ?? 0)) };
}
function mergeGame(current: GameState, incoming: GameState): GameState {
  if (current.id !== incoming.id) return incoming;
  const currentRoundCount = current.rounds?.length ?? 0;
  const incomingRoundCount = incoming.rounds?.length ?? 0;
  const playerMap = new Map(current.players.map(player => [player.id, player]));
  for (const player of incoming.players) playerMap.set(player.id, { ...playerMap.get(player.id), ...player, score: Math.max(Number(playerMap.get(player.id)?.score ?? 0), Number(player.score ?? 0)) });
  const rounds = new Map(current.rounds.map(round => [round.number, round]));
  for (const incomingRound of incoming.rounds) {
    const currentRound = rounds.get(incomingRound.number);
    if (!currentRound) { rounds.set(incomingRound.number, incomingRound); continue; }
    const artworks = new Map(currentRound.artworks.map(artwork => [artwork.playerId, artwork]));
    for (const artwork of incomingRound.artworks) artworks.set(artwork.playerId, artworks.has(artwork.playerId) ? mergeArtwork(artworks.get(artwork.playerId)!, artwork) : artwork);
    rounds.set(incomingRound.number, { ...currentRound, ...incomingRound, artworks: [...artworks.values()] });
  }
  const currentPhase = phaseOrder[current.phase] ?? 0;
  const incomingPhase = phaseOrder[incoming.phase] ?? 0;
  const incomingIsNewerRound = incomingRoundCount > currentRoundCount;
  return {
    ...current,
    ...incoming,
    phase: incomingRoundCount > currentRoundCount || (incomingRoundCount === currentRoundCount && incomingPhase >= currentPhase) ? incoming.phase : current.phase,
    players: [...playerMap.values()],
    rounds: [...rounds.values()].sort((a, b) => a.number - b.number),
    promptIndex: incomingIsNewerRound ? incoming.promptIndex : current.promptIndex,
    roundStartsAt: incomingRoundCount >= currentRoundCount && incoming.roundStartsAt ? incoming.roundStartsAt : current.roundStartsAt,
    roundEndsAt: incomingRoundCount >= currentRoundCount && incoming.roundEndsAt ? incoming.roundEndsAt : current.roundEndsAt,
  };
}

function finalizePlayerVote(game: GameState): GameState {
  if (game.phase !== "voting" || game.judgingMode !== "player_vote") return game;
  const round = game.rounds.at(-1); if (!round) return game;
  const activePlayers = game.players.filter(player => player.active !== false);
  if (!activePlayers.length || !activePlayers.every(player => round.artworks.some(art => art.playerId === player.id && art.voter === true))) return game;
  const sorted = [...round.artworks].sort((a, b) => Number(b.votes ?? 0) - Number(a.votes ?? 0));
  let previousVotes: number | undefined; let rank = 0;
  const ranked = sorted.map((art, index) => {
    const votes = Number(art.votes ?? 0); if (votes !== previousVotes) rank = index + 1; previousVotes = votes;
    return { ...art, rank, points: rank === 1 ? 5 : rank === 2 ? 3 : rank === 3 ? 1 : 0 };
  });
  const scoreByPlayer = new Map(ranked.map(art => [art.playerId, Number(art.points ?? 0)]));
  return { ...game, phase: round.number === Number(game.totalRounds ?? 5) ? "finished" : "results", players: game.players.map(player => ({ ...player, score: Number(player.score ?? 0) + (scoreByPlayer.get(player.id) ?? 0) })), rounds: [...game.rounds.slice(0, -1), { ...round, artworks: ranked }] };
}
async function findRoom(id: string) {
  const response = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}&select=state`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const rows = await response.json() as { state: GameState }[];
  return rows[0]?.state ?? null;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!url || !key) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try { const game = await findRoom(id); if (!game) return NextResponse.json({ error: "Room not found" }, { status: 404 }); const since = request.nextUrl.searchParams.get("since"); if (since && game.updatedAt === since) return new NextResponse(null, { status: 204 }); return NextResponse.json({ game }); }
  catch { return NextResponse.json({ error: "Unable to load room" }, { status: 502 }); }
}

export async function POST(request: NextRequest) {
  if (!url || !key) return NextResponse.json({ localOnly: true });
  const incoming = await request.json() as GameState;
  if (!incoming?.id || !incoming?.hostId || !incoming?.judgingMode) return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  try {
    const current = await findRoom(incoming.id);
    const game = { ...finalizePlayerVote(current ? mergeGame(current, incoming) : incoming), updatedAt: new Date().toISOString() };
    const row = { id: game.id, host_token: game.hostId, judging_mode: game.judgingMode, phase: game.phase, current_round: game.rounds?.length ?? 0, prompts: game.rounds?.map(round => round.prompt) ?? [], state: game };
    const response = await fetch(`${url}/rest/v1/rooms?on_conflict=id`, { method: "POST", headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
    if (!response.ok) return NextResponse.json({ error: "Unable to save room" }, { status: response.status });
    return NextResponse.json({ game });
  } catch { return NextResponse.json({ error: "Unable to save room" }, { status: 502 }); }
}
export async function DELETE(request: NextRequest) {
  if (!url || !key) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { id, hostId } = await request.json() as { id?: string; hostId?: string };
  if (!id || !hostId) return NextResponse.json({ error: "id and hostId are required" }, { status: 400 });
  try {
    const game = await findRoom(id);
    if (!game || game.hostId !== hostId || game.phase !== "finished") return NextResponse.json({ error: "Room cannot be deleted" }, { status: 403 });
    const response = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    if (!response.ok) return NextResponse.json({ error: "Unable to delete room" }, { status: response.status });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Unable to delete room" }, { status: 502 }); }
}