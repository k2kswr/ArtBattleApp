import { NextRequest, NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = () => ({ apikey: key!, authorization: `Bearer ${key!}`, "content-type": "application/json" });

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!url || !key) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const response = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}&select=state`, { headers: headers(), cache: "no-store" });
  if (!response.ok) return NextResponse.json({ error: "Unable to load room" }, { status: response.status });
  const rows = await response.json() as { state: unknown }[];
  return rows[0] ? NextResponse.json({ game: rows[0].state }) : NextResponse.json({ error: "Room not found" }, { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!url || !key) return NextResponse.json({ localOnly: true });
  const game = await request.json();
  if (!game?.id || !game?.hostId || !game?.judgingMode) return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  const row = { id: game.id, host_token: game.hostId, judging_mode: game.judgingMode, phase: game.phase, current_round: game.rounds?.length ?? 0, prompts: game.rounds?.map((round: { prompt: string }) => round.prompt) ?? [], state: game };
  const response = await fetch(`${url}/rest/v1/rooms?on_conflict=id`, { method: "POST", headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
  if (!response.ok) return NextResponse.json({ error: "Unable to save room" }, { status: response.status });
  return NextResponse.json({ ok: true });
}
