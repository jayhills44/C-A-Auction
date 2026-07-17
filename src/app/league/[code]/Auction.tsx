"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player, Bid } from "@/lib/types";

// -------- Web Audio beep helpers (no files needed) --------
let audioCtx: AudioContext | null = null;
function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function beep(freq: number, durMs = 180, vol = 0.35) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durMs / 1000 + 0.02);
}
function playSoldTone() {
  // Two-tone "ding": higher note then lower.
  beep(1200, 140, 0.4);
  setTimeout(() => beep(900, 260, 0.4), 130);
}

export default function Auction({ league }: { league: League }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [now, setNow] = useState(Date.now());
  const [myBid, setMyBid] = useState("");
  const [bidErr, setBidErr] = useState("");
  const [bidding, setBidding] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [flash, setFlash] = useState<{ text: string; color: string; key: number } | null>(null);

  // Optimistic overlays so we don't wait on Firestore for the tapper's screen.
  const [optCurrentBid, setOptCurrentBid] = useState<number | null>(null);
  const [optWinner, setOptWinner] = useState<string | null>(null);
  const [optPlayerId, setOptPlayerId] = useState<string | null>(null);

  const advancedRef = useRef<string | null>(null);
  const flashedAtRef = useRef<{ [playerId: string]: Set<number> }>({});
  const lastSoldRef = useRef<string | null>(null);

  const isCommish =
    typeof window !== "undefined" &&
    localStorage.getItem(`commish:${league.roomCode}`) === league.commissionerId;

  const me = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(`team:${league.roomCode}`);
    return stored ? (JSON.parse(stored) as { teamId: string; token: string }) : null;
  }, [league.roomCode]);
  const myTeam = teams.find((t) => t.id === me?.teamId) || null;

  useEffect(() => {
    const db = firestore();
    const unsubT = onSnapshot(query(collection(db, "leagues", league.id, "teams"), orderBy("createdAt")),
      (snap) => setTeams(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Team[]));
    const unsubP = onSnapshot(collection(db, "leagues", league.id, "players"),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Player[]));
    const unsubB = onSnapshot(query(collection(db, "leagues", league.id, "bids"), orderBy("createdAt", "desc"), limit(20)),
      (snap) => setBids(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Bid[]));
    return () => { unsubT(); unsubP(); unsubB(); };
  }, [league.id]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Clear optimistic overlay when the server catches up
  useEffect(() => {
    if (optPlayerId && optPlayerId === league.currentPlayer) {
      if (
        optCurrentBid !== null &&
        league.currentBid >= optCurrentBid &&
        (optWinner ? league.currentWinner === optWinner : true)
      ) {
        setOptCurrentBid(null);
        setOptWinner(null);
      }
    } else {
      setOptCurrentBid(null);
      setOptWinner(null);
      setOptPlayerId(null);
    }
  }, [league.currentPlayer, league.currentBid, league.currentWinner, optPlayerId, optCurrentBid, optWinner]);

  const currentPlayer = players.find((p) => p.id === league.currentPlayer) || null;
  const displayedBid =
    optCurrentBid !== null && optPlayerId === league.currentPlayer
      ? Math.max(optCurrentBid, league.currentBid || 0)
      : league.currentBid || 0;
  const displayedWinner =
    optWinner && optPlayerId === league.currentPlayer && (optCurrentBid || 0) > (league.currentBid || 0)
      ? optWinner
      : league.currentWinner;
  const soldPlayers = players.filter((p) => p.status === "sold");
  const totalPlayers = players.length;
  const teamById = (id: string | null) => teams.find((t) => t.id === id) || null;

  // Timer freezes at pausedAt while league is paused.
  const effectiveNow =
    league.paused && league.pausedAt ? new Date(league.pausedAt).getTime() : now;
  const secsLeft = league.timerEndsAt
    ? Math.max(0, Math.ceil((new Date(league.timerEndsAt).getTime() - effectiveNow) / 1000))
    : 0;
  const timerExpired = !!league.timerEndsAt && new Date(league.timerEndsAt).getTime() <= now;
  const minNextBid = displayedBid + 1;

  // -------- Visual flash + beep at 3, 2, 1, and sold --------
  useEffect(() => {
    if (!currentPlayer || !league.timerEndsAt) return;
    if (league.status !== "active" || league.paused) return;
    const pid = currentPlayer.id;
    const already = flashedAtRef.current[pid] || new Set<number>();

    const showFlash = (text: string, color: string) => {
      setFlash({ text, color, key: Date.now() });
      window.setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), 900);
    };

    if (secsLeft === 3 && !already.has(3)) {
      already.add(3);
      showFlash("GOING ONCE", "bg-amber-500");
      if (soundOn) beep(880, 220, 0.35);
    }
    if (secsLeft === 2 && !already.has(2)) {
      already.add(2);
      showFlash("GOING TWICE", "bg-orange-500");
      if (soundOn) beep(1050, 220, 0.4);
    }
    if (secsLeft === 1 && !already.has(1)) {
      already.add(1);
      showFlash("LAST CHANCE", "bg-red-600");
      if (soundOn) beep(1240, 260, 0.4);
    }
    flashedAtRef.current[pid] = already;
  }, [secsLeft, currentPlayer, league.timerEndsAt, league.status, league.paused, soundOn]);

  // "SOLD to Team for $X" flash + tone when a player finalizes
  const soldSignature = players.map((p) => `${p.id}:${p.status}`).join(",");
  useEffect(() => {
    for (const p of players) {
      if (p.status === "sold" && lastSoldRef.current !== p.id) {
        if (lastSoldRef.current === null) {
          lastSoldRef.current = p.id;
          continue;
        }
        lastSoldRef.current = p.id;
        const t = teams.find((tt) => tt.id === p.soldTo);
        if (t && p.soldPrice && p.soldPrice > 0) {
          setFlash({ text: `SOLD! ${t.name} — $${p.soldPrice}`, color: "bg-green-600", key: Date.now() });
        } else {
          setFlash({ text: `${p.name} — UNSOLD`, color: "bg-zinc-600", key: Date.now() });
        }
        window.setTimeout(() => setFlash(null), 1400);
        if (soundOn) playSoldTone();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldSignature]);

  // Auto-advance when timer hits 0
  useEffect(() => {
    if (!league.timerEndsAt) return;
    if (league.status !== "active" || league.paused) return;
    const ends = new Date(league.timerEndsAt).getTime();
    if (now >= ends && league.currentPlayer && advancedRef.current !== league.currentPlayer) {
      advancedRef.current = league.currentPlayer;
      fetch("/api/advance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: league.roomCode }),
      }).catch(() => {});
    }
  }, [now, league.timerEndsAt, league.currentPlayer, league.roomCode, league.status, league.paused]);

  // Safety net: if we've been stuck at 0 for >2s, try again
  useEffect(() => {
    if (!league.timerEndsAt || league.status !== "active" || league.paused || !league.currentPlayer) return;
    const ends = new Date(league.timerEndsAt).getTime();
    if (now < ends + 2000) return;
    advancedRef.current = null;
  }, [now, league.timerEndsAt, league.currentPlayer, league.status, league.paused]);

  // -------- Bid submission with auto-retry --------
  async function placeBid(amount: number, retriesLeft = 3): Promise<void> {
    setBidErr("");
    if (league.paused) { setBidErr("Auction is paused"); return; }
    if (!me || !myTeam) { setBidErr("You haven't joined as a team."); return; }
    if (!Number.isInteger(amount) || amount < 1) { setBidErr("Enter a whole number."); return; }
    if (amount > myTeam.budgetLeft) { setBidErr(`Over budget ($${myTeam.budgetLeft})`); return; }

    setBidding(true);
    setOptPlayerId(league.currentPlayer);
    setOptCurrentBid(amount);
    setOptWinner(me.teamId);

    // Any user tap unlocks audio for the session
    ensureCtx();

    const res = await fetch("/api/bid", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode: league.roomCode, teamId: me.teamId, token: me.token, amount,
      }),
    });

    if (res.ok) {
      setBidding(false);
      setMyBid("");
      return;
    }

    const j = await res.json().catch(() => ({}));
    const msg: string = j.error || "Bid failed";

    const m = msg.match(/higher than current \(\$?(\d+)\)/i);
    if (m && retriesLeft > 0) {
      const newAmount = parseInt(m[1], 10) + 1;
      if (myTeam && newAmount <= myTeam.budgetLeft) {
        return placeBid(newAmount, retriesLeft - 1);
      }
    }

    setOptCurrentBid(null);
    setOptWinner(null);
    setBidding(false);
    setBidErr(msg);
  }

  // -------- Commissioner actions --------
  async function forceNext() {
    setAdvancing(true);
    const commissionerId = localStorage.getItem(`commish:${league.roomCode}`);
    const res = await fetch("/api/advance", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, force: true, commissionerId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setBidErr(j.error || "Could not draw next");
    }
    setAdvancing(false);
  }

  async function togglePause() {
    setPausing(true);
    const commissionerId = localStorage.getItem(`commish:${league.roomCode}`);
    await fetch("/api/pause", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, commissionerId, pause: !league.paused }),
    }).catch(() => {});
    setPausing(false);
  }

  async function undoSale(playerId: string) {
    const commissionerId = localStorage.getItem(`commish:${league.roomCode}`);
    if (!confirm("Return this player to the available pool and refund the team?")) return;
    await fetch("/api/undo-sale", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, commissionerId, playerId }),
    }).catch(() => {});
  }

  // Only enable "Draw Next Player" when timer expired OR no player is up
  const canForceDrawNext = !league.currentPlayer || timerExpired;

  return (
    <main className="mx-auto max-w-md p-4 pb-32 relative">
      {/* Flash overlay */}
      {flash && (
        <div key={flash.key} className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none animate-pulse">
          <div className={`${flash.color} text-white text-3xl md:text-5xl font-black px-8 py-6 rounded-2xl shadow-2xl border-4 border-white/30 -rotate-3`}>
            {flash.text}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
        <div>Room <span className="font-mono text-zinc-200">{league.roomCode}</span></div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSoundOn((v) => !v); ensureCtx(); }}
            className="text-zinc-400 hover:text-zinc-200"
            title="Toggle sound"
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <span>{soldPlayers.length}/{totalPlayers} sold</span>
        </div>
      </div>

      {league.paused && (
        <div className="mb-3 bg-yellow-900/60 border border-yellow-700 rounded-lg px-3 py-2 text-center text-yellow-200 text-sm font-semibold">
          ⏸ Auction paused by commissioner
        </div>
      )}

      {currentPlayer ? (
        <div className="bg-zinc-900 rounded-3xl border border-zinc-800 p-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${positionColor(currentPlayer.position)}`}>
              {currentPlayer.position}
            </span>
            {currentPlayer.nflTeam && <span className="text-xs text-zinc-400">{currentPlayer.nflTeam}</span>}
          </div>
          <h2 className="text-3xl font-bold leading-tight">{currentPlayer.name}</h2>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-zinc-800 rounded-xl py-3">
              <div className="text-xs text-zinc-400">Current bid</div>
              <div className="text-2xl font-bold">${displayedBid}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {displayedWinner ? teamById(displayedWinner)?.name : "—"}
              </div>
            </div>
            <div className={`rounded-xl py-3 ${league.paused ? "bg-yellow-900/40" : secsLeft <= 3 ? "bg-red-900/60" : "bg-zinc-800"}`}>
              <div className="text-xs text-zinc-400">Timer</div>
              <div className="text-2xl font-bold">{secsLeft}s</div>
            </div>
          </div>

          {myTeam ? (
            <div className="mt-5">
              <div className="text-xs text-zinc-400">Your budget: <span className="text-white font-bold">${myTeam.budgetLeft}</span></div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => placeBid(minNextBid)} disabled={bidding || league.paused}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[.98] transition disabled:bg-zinc-700 py-4 rounded-lg font-semibold text-lg">
                  Bid ${minNextBid}
                </button>
                <button onClick={() => placeBid(Math.max(minNextBid, displayedBid + 5))} disabled={bidding || league.paused}
                  className="flex-1 bg-blue-700 hover:bg-blue-600 active:scale-[.98] transition disabled:bg-zinc-700 py-4 rounded-lg font-semibold text-lg">
                  +$5
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="number" min={minNextBid} value={myBid}
                  onChange={(e) => setMyBid(e.target.value)}
                  placeholder={`Custom (min $${minNextBid})`}
                  className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-3 outline-none focus:border-blue-500"
                />
                <button onClick={() => placeBid(Number(myBid))} disabled={bidding || !myBid || league.paused}
                  className="px-4 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 rounded-lg font-semibold">
                  Bid
                </button>
              </div>
              {bidErr && <div className="mt-2 text-red-400 text-sm">{bidErr}</div>}
            </div>
          ) : (
            <p className="mt-5 text-zinc-400 text-sm">Spectating — you haven't joined as a team on this device.</p>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-3xl border border-zinc-800 p-6 text-center">
          <p>Drawing next player…</p>
        </div>
      )}

      {/* Commissioner controls */}
      {isCommish && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={togglePause}
              disabled={pausing}
              className={`flex-1 py-3 rounded-lg font-semibold ${
                league.paused
                  ? "bg-green-600 hover:bg-green-500"
                  : "bg-yellow-600 hover:bg-yellow-500"
              } disabled:bg-zinc-700`}
            >
              {league.paused ? "▶ Resume Draft" : "⏸ Pause Draft"}
            </button>
            <button
              onClick={forceNext}
              disabled={advancing || !canForceDrawNext || league.paused}
              title={
                !canForceDrawNext
                  ? "Wait for the current bid to finish (or pause first)"
                  : ""
              }
              className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 py-3 rounded-lg font-semibold"
            >
              {advancing ? "Advancing…" : "Draw Next Player"}
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 text-center">
            Commissioner controls · Pause blocks new bids · Draw Next only after timer expires
          </p>
        </div>
      )}

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Recent bids</h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {bids.slice(0, 12).map((b) => {
            const t = teamById(b.teamId);
            const p = players.find((x) => x.id === b.playerId);
            return (
              <div key={b.id} className="text-sm flex justify-between bg-zinc-900/60 rounded px-3 py-1.5">
                <span className="truncate">{t?.name || "?"} <span className="text-zinc-500">→</span> {p?.name || "?"}</span>
                <span className="font-mono text-green-400">${b.amount}</span>
              </div>
            );
          })}
          {bids.length === 0 && <div className="text-zinc-500 text-sm">No bids yet.</div>}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Teams</h3>
        <div className="grid grid-cols-1 gap-2">
          {teams.map((t) => {
            const won = soldPlayers.filter((p) => p.soldTo === t.id);
            return (
              <div key={t.id} className="bg-zinc-900 rounded-xl border border-zinc-800 px-3 py-2">
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-sm text-zinc-300">
                    ${t.budgetLeft} <span className="text-zinc-500">/ {won.length} players</span>
                  </span>
                </div>
                {won.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {won.map((p) => (
                      <span key={p.id} className={`text-[10px] pl-1.5 py-0.5 rounded ${positionColor(p.position)} inline-flex items-center gap-1`}>
                        <span>{p.name} ${p.soldPrice}</span>
                        {isCommish && (
                          <button
                            onClick={() => undoSale(p.id)}
                            title="Undo sale (return to pool + refund team)"
                            className="ml-1 pr-1.5 opacity-80 hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
