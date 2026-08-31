"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRealtimeClient, isDrawEvent, roomChannelName, type DrawEvent, type DrawPoint, type OutgoingDrawEvent, type RealtimeChannel } from "../lib/realtime";
import { applyRoundScores, Game, JudgingMode, makeId, PROMPTS, rankArtworks } from "../lib/game";

const STORAGE = "art-battle:game";
type Setup = { name: string; mode: JudgingMode; roundSeconds: 10 | 30 | 90 | 180 };

function loadGame(): Game | null { try { const raw = localStorage.getItem(STORAGE); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function persist(game: Game) { localStorage.setItem(STORAGE, JSON.stringify(game)); }
function makeRoomCode() { const value = new Uint32Array(1); crypto.getRandomValues(value); return String(10000 + (value[0] % 90000)); }
function makeRoundSchedule(seconds: number) { const start = Date.now() + 3500; return { roundStartsAt: new Date(start).toISOString(), roundEndsAt: new Date(start + seconds * 1000).toISOString() }; }
async function fetchRoom(id: string): Promise<Game | null> { const response = await fetch(`/api/game?id=${encodeURIComponent(id)}`, { cache: "no-store" }); if (!response.ok) return null; return (await response.json()).game as Game; }

function useLiveDrawings(game: Game | null, me: string) {
  const [events, setEvents] = useState<DrawEvent[]>([]);
  const [status, setStatus] = useState<"ready" | "connecting" | "unavailable">("unavailable");
  const channel = useRef<RealtimeChannel | null>(null);
  const roomId = game?.id;
  const roundNumber = game?.rounds.at(-1)?.number;
  const participants = game?.players.filter(player => player.active).map(player => player.id).join(",") ?? "";

  useEffect(() => {
    setEvents([]);
    channel.current = null;
    if (!roomId || !roundNumber || game?.phase !== "drawing") { setStatus("unavailable"); return; }
    const supabase = getRealtimeClient();
    if (!supabase) { setStatus("unavailable"); return; }
    const allowedPlayers = new Set(participants.split(",").filter(Boolean));
    setStatus("connecting");
    const nextChannel = supabase.channel(roomChannelName(roomId, roundNumber), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "draw" }, ({ payload }) => {
        if (!isDrawEvent(payload) || payload.playerId === me || !allowedPlayers.has(payload.playerId)) return;
        setEvents(previous => [...previous, payload]);
      })
      .subscribe(subscriptionStatus => setStatus(subscriptionStatus === "SUBSCRIBED" ? "ready" : "connecting"));
    channel.current = nextChannel;
    return () => { channel.current = null; void supabase.removeChannel(nextChannel); };
  }, [game?.phase, me, participants, roomId, roundNumber]);

  const send = useCallback((event: OutgoingDrawEvent) => {
    if (!channel.current) return;
    void channel.current.send({ type: "broadcast", event: "draw", payload: { ...event, playerId: me } });
  }, [me]);

  return { events, send, status };
}

function drawSegment(context: CanvasRenderingContext2D, from: DrawPoint, to: DrawPoint, color: string, size: number) {
  context.strokeStyle = color; context.lineWidth = size; context.lineCap = "round"; context.lineJoin = "round";
  context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
}

function Canvas({ onSubmit, onDraw, expired }: { onSubmit: (image: string) => void; onDraw: (event: OutgoingDrawEvent) => void; expired: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const lastPoint = useRef<DrawPoint | null>(null);
  const submitted = useRef(false);
  const [color, setColor] = useState("#2D1965"); const [size, setSize] = useState(8); const [eraser, setEraser] = useState(false);
  const point = (event: React.PointerEvent<HTMLCanvasElement>): DrawPoint => { const box = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - box.left) * (event.currentTarget.width / box.width), y: (event.clientY - box.top) * (event.currentTarget.height / box.height) }; };
  const paint = (event: React.PointerEvent<HTMLCanvasElement>, start = false) => {
    const canvas = canvasRef.current; if (!canvas || expired || (!drawing.current && !start)) return;
    const nextPoint = point(event);
    if (start) { lastPoint.current = nextPoint; return; }
    const previousPoint = lastPoint.current; if (!previousPoint) { lastPoint.current = nextPoint; return; }
    const strokeColor = eraser ? "#fffdf8" : color; const strokeSize = eraser ? size * 3 : size;
    drawSegment(canvas.getContext("2d")!, previousPoint, nextPoint, strokeColor, strokeSize);
    onDraw({ type: "stroke", from: previousPoint, to: nextPoint, color: strokeColor, size: strokeSize });
    lastPoint.current = nextPoint;
  };
  const clear = () => { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height); onDraw({ type: "clear" }); };
  const reset = () => { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  useEffect(() => { reset(); }, []);
  const submit = () => { if (submitted.current || !canvasRef.current) return; submitted.current = true; onSubmit(canvasRef.current.toDataURL("image/png")); };
  useEffect(() => { if (expired) submit(); }, [expired]);
  const stopDrawing = () => { drawing.current = false; lastPoint.current = null; };
  return <div className="canvas-wrap"><div className="toolbox"><label>色 <input aria-label="ペンの色" type="color" value={color} onChange={e => { setColor(e.target.value); setEraser(false); }} /></label><label>太さ <input aria-label="ペンの太さ" type="range" min="2" max="24" value={size} onChange={e => setSize(+e.target.value)} /></label><button className={eraser ? "active" : ""} onClick={() => setEraser(!eraser)}>消しゴム</button><button onClick={clear}>全部消す</button></div><canvas ref={canvasRef} width={900} height={620} onPointerDown={e => { if (expired) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e, true); }} onPointerMove={e => paint(e)} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} onPointerLeave={stopDrawing} /><button className="submit" onClick={submit}>この絵で提出する →</button></div>;
}

function LivePreview({ name, events }: { name: string; events: DrawEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const applied = useRef(0);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height); }, []);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d")!;
    for (const event of events.slice(applied.current)) {
      if (event.type === "clear") { ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      else drawSegment(ctx, event.from, event.to, event.color, event.size);
    }
    applied.current = events.length;
  }, [events]);
  return <article className="live-card"><div><b>{name}</b><span>● 描いている…</span></div><canvas ref={canvasRef} width={900} height={620} aria-label={`${name}のライブお絵描き`} /></article>;
}

function LivePreviewGrid({ game, me, events, status }: { game: Game; me: string; events: DrawEvent[]; status: "ready" | "connecting" | "unavailable" }) {
  const opponents = game.players.filter(player => player.active && player.id !== me);
  if (opponents.length === 0) return null;
  return <section className="live-previews"><div className="live-heading"><h2>👀 みんなの絵をのぞき見！</h2><span className={status === "ready" ? "live-status ready" : "live-status"}>{status === "ready" ? "● ライブ接続中" : status === "connecting" ? "接続中…" : "ライブ接続を設定してください"}</span></div><div className="live-grid">{opponents.map(player => <LivePreview key={player.id} name={player.name} events={events.filter(event => event.playerId === player.id)} />)}</div></section>;
}

function SetupScreen({ onCreate, onJoin }: { onCreate: (setup: Setup) => void; onJoin: (id: string, name: string) => void }) {
  const [name, setName] = useState(""); const [mode, setMode] = useState<JudgingMode>("player_vote"); const [roundSeconds, setRoundSeconds] = useState<10 | 30 | 90 | 180>(90); const [room, setRoom] = useState("");
  return <main className="landing"><div className="logo">🎨 おえかき<br/><span>バトル!</span></div><p className="tagline">好きな時間で描いて、いちばんを決めよう。</p><section className="panel setup"><label>あなたのニックネーム<input maxLength={16} placeholder="例：みんじゅ" value={name} onChange={e => setName(e.target.value)} /></label><p className="eyebrow">採点方法をえらぶ</p><div className="mode-grid"><button className={mode === "player_vote" ? "mode chosen" : "mode"} onClick={() => setMode("player_vote")}><span>🗳️</span><strong>みんなで投票</strong><small>無料・自分以外の絵に1票！</small></button><button className={mode === "ai" ? "mode chosen" : "mode"} onClick={() => setMode("ai")}><span>🤖</span><strong>AI採点</strong><small>お題らしさと完成度を判定</small></button></div><p className="eyebrow">1ラウンドの時間</p><div className="time-grid">{([10, 30, 90, 180] as const).map(seconds => <button key={seconds} className={roundSeconds === seconds ? "time chosen" : "time"} onClick={() => setRoundSeconds(seconds)}>{seconds}秒</button>)}</div><button className="primary" disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), mode, roundSeconds })}>ルームをつくる</button><div className="divider">または</div><div className="join"><input placeholder="ルームID" value={room} onChange={e => setRoom(e.target.value)} /><button disabled={!name.trim() || !room.trim()} onClick={() => onJoin(room.trim(), name.trim())}>参加する</button></div></section><p className="hint">1〜8人 / 5ラウンド / 10・30・90・180秒から選択</p></main>;
}

export default function Home() {
  const [game, setGame] = useState<Game | null>(null); const [me, setMe] = useState<string>(""); const [clock, setClock] = useState(() => Date.now()); const [notice, setNotice] = useState(""); const [voteMessage, setVoteMessage] = useState("");
  const { events: liveEvents, send: sendDrawEvent, status: liveStatus } = useLiveDrawings(game, me);
  const save = useCallback((next: Game) => { setGame(next); persist(next); void fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }); }, []);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("room");
    // The root URL is always a fresh start. Restore a game only when the user
    // intentionally opens its invite URL (/?room=ART-...).
    if (!fromUrl) return;
    const existing = loadGame();
    if (existing?.id === fromUrl) { setGame(existing); setMe(localStorage.getItem("art-battle:me") || existing.hostId); }
    void fetchRoom(fromUrl).then(remote => { if (remote) { setGame(remote); setMe(localStorage.getItem("art-battle:me") || remote.hostId); } });
  }, []);
  useEffect(() => { if (!game) return; const timer = window.setInterval(() => void fetchRoom(game.id).then(remote => { if (remote && JSON.stringify(remote) !== JSON.stringify(game)) setGame(remote); }), 500); return () => clearInterval(timer); }, [game]);
  useEffect(() => { if (!game || game.phase !== "drawing") return; const timer = window.setInterval(() => setClock(Date.now()), 250); return () => clearInterval(timer); }, [game?.phase]);
  const waitingToStart = game?.phase === "drawing" && !!game.roundStartsAt && clock < new Date(game.roundStartsAt).getTime();
  const seconds = game?.phase === "drawing" && game.roundEndsAt ? (waitingToStart ? game.roundSeconds : Math.max(0, Math.ceil((new Date(game.roundEndsAt).getTime() - clock) / 1000))) : 0;
  const create = (setup: Setup) => { const id = makeRoomCode(); const playerId = makeId("p-"); const next: Game = { id, hostId: playerId, judgingMode: setup.mode, roundSeconds: setup.roundSeconds, phase: "lobby", players: [{ id: playerId, name: setup.name, score: 0, active: true }], rounds: [], promptIndex: 0, createdAt: new Date().toISOString() }; localStorage.setItem("art-battle:me", playerId); setMe(playerId); save(next); };
  const join = async (id: string, name: string) => { const current = await fetchRoom(id) ?? loadGame(); if (!current || current.id !== id) { setNotice("ルームが見つかりません。URLかルームIDを確認してください。"); return; } if (current.phase !== "lobby" || current.players.length >= 8) { setNotice("このルームには今は参加できません。"); return; } const playerId = makeId("p-"); const next = { ...current, players: [...current.players, { id: playerId, name, score: 0, active: true }] }; localStorage.setItem("art-battle:me", playerId); setMe(playerId); save(next); };
  const start = () => { if (!game) return; const next = { ...game, roundSeconds: game.roundSeconds ?? 90, phase: "drawing" as const, rounds: [{ number: 1, prompt: PROMPTS[game.promptIndex], artworks: [] }], ...makeRoundSchedule(game.roundSeconds ?? 90) }; save(next); };
  const submit = (image: string) => { if (!game) return; const round = game.rounds.at(-1)!; if (round.artworks.some(a => a.playerId === me)) return; const updated = { ...game, rounds: [...game.rounds.slice(0, -1), { ...round, artworks: [...round.artworks, { playerId: me, image }] }] }; if (updated.rounds.at(-1)!.artworks.length === updated.players.filter(p => p.active).length) { save({ ...updated, phase: updated.judgingMode === "ai" ? "results" : "voting" }); if (updated.judgingMode === "ai") void judge(updated); } else save(updated); };
  useEffect(() => {
    if (!game || game.phase !== "drawing" || seconds > 0) return;
    const round = game.rounds.at(-1)!;
    // Canvas submits the local artwork first. On the following state update,
    // players who did not submit before the bell receive a blank entry so a
    // round can never remain stuck at 00:00.
    if (round.artworks.length === 0) return;
    const missing = game.players.filter(player => player.active && !round.artworks.some(art => art.playerId === player.id));
    if (missing.length === 0) return;
    const blank = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='620'/%3E";
    const expired = { ...game, rounds: [...game.rounds.slice(0, -1), { ...round, artworks: [...round.artworks, ...missing.map(player => ({ playerId: player.id, image: blank }))] }] };
    save({ ...expired, phase: expired.judgingMode === "ai" ? "results" : "voting" });
    if (expired.judgingMode === "ai") void judge(expired);
  }, [game, seconds]);
  const judge = async (pending: Game) => { try { const round = pending.rounds.at(-1)!; const response = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: round.prompt, artworks: round.artworks }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); const ranked = rankArtworks(round.artworks.map(a => ({ ...a, aiScore: body.scores.find((s: { playerId: string }) => s.playerId === a.playerId)?.score ?? 0, comment: body.scores.find((s: { playerId: string }) => s.playerId === a.playerId)?.comment ?? "" })), a => a.aiScore ?? 0); save(applyRoundScores(pending, ranked)); } catch (error) { setNotice(error instanceof Error ? error.message : "AI採点に失敗しました。"); } };
  const vote = (targetId: string | null) => { if (!game) return; const round = game.rounds.at(-1)!; const mine = round.artworks.find(a => a.playerId === me); if (!mine || targetId === me || (mine as typeof mine & { voter?: boolean }).voter) return; const voted = { ...round, artworks: round.artworks.map(a => a.playerId === me ? { ...a, voter: true, votes: targetId && a.playerId === targetId ? (a.votes ?? 0) + 1 : (a.votes ?? 0) } : { ...a, votes: targetId && a.playerId === targetId ? (a.votes ?? 0) + 1 : (a.votes ?? 0) }) }; const targetName = targetId ? game.players.find(player => player.id === targetId)?.name : null; setVoteMessage(targetName ? `${targetName}に投票しました！` : "今回は誰にも投票しませんでした！"); const pending = { ...game, rounds: [...game.rounds.slice(0, -1), voted] }; save(pending); };
  const nextRound = () => { if (!game) return; const number = game.rounds.length + 1; save({ ...game, phase: "drawing", promptIndex: (game.promptIndex + 1) % PROMPTS.length, rounds: [...game.rounds, { number, prompt: PROMPTS[(game.promptIndex + 1) % PROMPTS.length], artworks: [] }], ...makeRoundSchedule(game.roundSeconds ?? 90) }); };
  const playAgain = () => { if (!game) return; const promptIndex = (game.promptIndex + 1) % PROMPTS.length; const next = { ...game, phase: "drawing" as const, promptIndex, players: game.players.map(player => ({ ...player, score: 0, active: true })), rounds: [{ number: 1, prompt: PROMPTS[promptIndex], artworks: [] }], ...makeRoundSchedule(game.roundSeconds ?? 90) }; save(next); };
  const finishGame = () => { localStorage.removeItem(STORAGE); localStorage.removeItem("art-battle:me"); history.replaceState(null, "", window.location.pathname); setGame(null); setMe(""); };
  const addDemoFriend = () => { if (!game || game.players.length >= 8) return; save({ ...game, players: [...game.players, { id: makeId("demo-"), name: `お友だち${game.players.length}`, score: 0, active: true }] }); };
  if (!game) return <><SetupScreen onCreate={create} onJoin={join} />{notice && <div className="toast">{notice}</div>}</>;
  const round = game.rounds.at(-1); const isHost = me === game.hostId; const active = game.players.filter(p => p.active); const player = game.players.find(p => p.id === me);
  return <main className="game"><header><a className="brand" href="/">🎨 おえかきバトル</a><div className="room">ROOM <b>{game.id}</b></div><div className="score-pill">🏅 {player?.score ?? 0} pt</div></header>{notice && <div className="toast">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    {game.phase === "lobby" && <section className="lobby panel"><p className="eyebrow">{game.judgingMode === "ai" ? "🤖 AI採点モード" : "🗳️ みんなで投票モード"}</p><h1>みんなを待っています！</h1><p>この5桁のルームIDを友だちに伝えてください。</p><div className="room-code"><strong>{game.id}</strong><span>参加する人は初期画面で入力</span></div><div className="players">{game.players.map((p, i) => <div className="player" key={p.id}><span className={`avatar a${i % 5}`}>{p.name.slice(0, 1)}</span>{p.name}{p.id === game.hostId && <b>ホスト</b>}</div>)}</div>{isHost && <><button className="secondary" onClick={addDemoFriend}>＋ デモ参加者を追加</button><button className="primary huge" onClick={start}>バトル開始！</button></>} {!isHost && <p className="waiting">ホストが開始するのを待っています…</p>}</section>}
    {game.phase === "drawing" && round && <section><div className="round-head"><div><span>ROUND {round.number} / 5</span><h1>お題: <em>{round.prompt}</em></h1></div><div className={`timer ${seconds <= 10 ? "urgent" : ""}`}>⏱ {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</div></div><div className="drawing-layout"><div>{waitingToStart ? <div className="start-countdown panel"><h2>まもなくスタート！</h2><p>全員の画面が切り替わるまで少し待ってね。</p></div> : round.artworks.some(a => a.playerId === me) ? <div className="submitted panel"><h2>提出しました！</h2><p>{round.artworks.length} / {active.length} 人が提出済みです。</p></div> : <Canvas onSubmit={submit} onDraw={sendDrawEvent} expired={seconds <= 0} />}</div><LivePreviewGrid game={game} me={me} events={liveEvents} status={liveStatus} /></div></section>}
    {game.phase === "voting" && round && <section className="vote"><div className="round-head"><div><span>ROUND {round.number} / 5</span><h1>好きな絵に <em>1票</em>！</h1></div><p>自分の絵には投票できません</p></div><ArtworkGrid game={game} round={round} me={me} onVote={vote} /><button className="secondary abstain" onClick={() => vote(null)}>今回は投票しない</button>{round.artworks.find(art => art.playerId === me && (art as typeof art & { voter?: boolean }).voter) && <p className="vote-waiting">{voteMessage || "投票しました！"}<br/><span>みんなの投票を待っています・・・</span></p>}</section>}
    {(game.phase === "results" || game.phase === "finished") && round && <section className="results"><div className="round-head"><div><span>{game.phase === "finished" ? "FINAL RESULT" : `ROUND ${round.number} RESULT`}</span><h1>{game.phase === "finished" ? "🎉 優勝者の発表！" : "結果発表！"}</h1></div></div><div className="ranking panel"><h2>🏆 総合ランキング</h2>{[...game.players].sort((a,b) => b.score-a.score).map((p, i) => <div key={p.id} className="rank-row"><strong>{i + 1}</strong><span>{p.name}</span><b>{p.score} pt</b></div>)}</div><ArtworkGrid game={game} round={round} me={me} />{game.phase === "results" && isHost && <button className="primary huge" onClick={nextRound}>つぎのラウンドへ →</button>}{game.phase === "finished" && isHost && <div className="final-actions"><button className="primary" onClick={playAgain}>同じメンバーでもう一度遊ぶ</button><button className="secondary" onClick={finishGame}>終了する</button></div>}</section>}
  </main>;
}

function ArtworkGrid({ game, round, me, onVote }: { game: Game; round: Game["rounds"][number]; me: string; onVote?: (id: string | null) => void }) {
  const artworks = new Map(round.artworks.map(art => [art.playerId, art]));
  return <div className="art-grid">{game.players.filter(player => player.active).map(player => {
    const art = artworks.get(player.id); if (!art) return null;
    return <article className="art-card" key={art.playerId}><div className="art-meta">{art.rank && <b>#{art.rank}</b>}<span>{player.name}</span>{art.points !== undefined && <strong>+{art.points}pt</strong>}</div><img src={art.image} alt={`${player.name}の提出作品`} />{game.phase === "voting" && onVote && <button disabled={art.playerId === me} onClick={() => onVote(art.playerId)}>{player.name}に投票</button>}{game.phase !== "voting" && <div className="comment">{game.judgingMode === "ai" && <><b>{art.aiScore} 点</b><p>{art.comment}</p></>}{game.judgingMode === "player_vote" && <b>🗳️ {art.votes ?? 0} 票</b>}</div>}</article>;
  })}</div>;
}