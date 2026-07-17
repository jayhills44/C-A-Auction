"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player, Bid } from "@/lib/types";

// -------- Web Audio helpers --------
let audioCtx: AudioContext | null = null;
function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC() as AudioContext;
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
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
  beep(1200, 140, 0.4);
  setTimeout(() => beep(900, 260, 0.4), 130);
}
// Brass-ish fanfare using square+sawtooth mix, ascending arpeggio.
function playFanfare() {
  const ctx = ensureCtx();
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((f, i) => {
    const start = ctx.currentTime + i * 0.14;
    // Two oscillators for a fuller brass tone
    ["sawtooth", "square"].forEach((type, k) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type as OscillatorType;
      osc.frequency.value = f * (k === 1 ? 1.005 : 1); // slight detune
      const dur = i === notes.length - 1 ? 0.6 : 0.2;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(k === 0 ? 0.28 : 0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  });
}

// -------- Roster slot organizer --------
type RosterSlots = {
  QB: (Player | null)[];
  RB: (Player | null)[];
  WR: (Player | null)[];
  TE: (Player | null)[];
  FLEX: (Player | null)[];
  BENCH: Player[];
};
function organizeRoster(won: Player[]): RosterSlots {
  const qbs = won.filter((p) => p.position === "QB");
  const rbs = won.filter((p) => p.position === "RB");
  const wrs = won.filter((p) => p.position === "WR");
  const tes = won.filter((p) => p.position === "TE");
  const others = won.filter((p) => !["QB", "RB", "WR", "TE"].includes(p.position));

  const qbSlots: (Player | null)[] = [qbs[0] || null, qbs[1] || null];
  const rbSlots: (Player | null)[] = [rbs[0] || null, rbs[1] || null];
  const wrSlots: (Player | null)[] = [wrs[0] || null, wrs[1] || null];
  const teSlot: (Player | null)[] = [tes[0] || null];

  const flexPool = [...rbs.slice(2), ...wrs.slice(2), ...tes.slice(1)];
  const flexSlot: (Player | null)[] = [flexPool[0] || null];

  const bench: Player[] = [
    ...qbs.slice(2),
    ...flexPool.slice(1),
    ...others,
  ];

  return { QB: qbSlots, RB: rbSlots, WR: wrSlots, TE: teSlot, FLEX: flexSlot, BENCH: bench };
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
  const [flash, setFlash] = useState<{ text: string; color: string; key: number; size?: "big" } | null>(null);

  const [optCurrentBid, setOptCurrentBid] = useState<number | null>(null);
  const [optWinner, setOptWinner] = useState<string | null>(null);
  const [optPlayerId, setOptPlayerId] = useState<string | null>(null);
  const [optTimerEndsAt, setOptTimerEndsAt] = useState<string | null>(null);

  const advancedRef = useRef<string | null>(null);
  // Track every player ID we've already announced a SOLD flash for — a Set
  // (not a single ref) so unpredictable Firestore iteration order can't
  // resurrect an old sale as if it were new.
  const announcedSoldRef = useRef<Set<string>>(new Set());
  const soldInitializedRef = useRef(false);
  const nextUpFiredRef = useRef<string | null>(null);
  const readyGoFiredRef = useRef<string | null>(null);
  const [serverOffset, setServerOffset] = useState(0);

  const isCommish =
    typeof window !== "undefined" &&
    localStorage.getItem(`commish:${league.roomCode}`) === league.commissionerId;

  const me = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(`team:${league.roomCode}`);
    return stored ? (JSON.parse(stored) as { teamId: string; token: string }) : null;
  }, [league.roomCode]);
  const myTeam = teams.find((t) => t.id === me?.teamId) || null;

  // Live subs
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

  // Server-time sync
  useEffect(() => {
    let cancelled = false;
    let bestRt = Infinity;
    async function sample() {
      const t1 = Date.now();
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const t3 = Date.now();
        const { serverTime } = await res.json();
        const rt = t3 - t1;
        const offset = serverTime + rt / 2 - t3;
        if (rt < bestRt) {
          bestRt = rt;
          if (!cancelled) setServerOffset(offset);
        }
      } catch {}
    }
    (async () => {
      for (let i = 0; i < 4 && !cancelled; i++) {
        await sample();
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Optimistic overlay cleanup
  useEffect(() => {
    if (optPlayerId && optPlayerId === league.currentPlayer) {
      if (
        optCurrentBid !== null &&
        league.currentBid >= optCurrentBid &&
        (optWinner ? league.currentWinner === optWinner : true)
      ) {
        setOptCurrentBid(null);
        setOptWinner(null);
        setOptTimerEndsAt(null);
      }
    } else {
      setOptCurrentBid(null);
      setOptWinner(null);
      setOptPlayerId(null);
      setOptTimerEndsAt(null);
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

  const serverNow = now + serverOffset;
  const effectiveNow =
    league.paused && league.pausedAt ? new Date(league.pausedAt).getTime() : serverNow;
  const effectiveEndsAt = (() => {
    const server = league.timerEndsAt ? new Date(league.timerEndsAt).getTime() : 0;
    const opt =
      optTimerEndsAt && optPlayerId === league.currentPlayer
        ? new Date(optTimerEndsAt).getTime() + serverOffset
        : 0;
    const chosen = Math.max(server, opt);
    return chosen > 0 ? chosen : null;
  })();
  const secsLeft = effectiveEndsAt
    ? Math.max(0, Math.ceil((effectiveEndsAt - effectiveNow) / 1000))
    : 0;
  const timerExpired = !!league.timerEndsAt && new Date(league.timerEndsAt).getTime() <= serverNow;
  const minNextBid = displayedBid + 1;

  // Derive current phase
  const nextPlayerAt = league.nextPlayerAt ? new Date(league.nextPlayerAt).getTime() : null;
  const bidStartsAt = league.bidStartsAt ? new Date(league.bidStartsAt).getTime() : null;
  const phase: "pause" | "reveal" | "bidding" | "idle" =
    !currentPlayer && nextPlayerAt && nextPlayerAt > serverNow ? "pause"
    : currentPlayer && bidStartsAt && bidStartsAt > serverNow ? "reveal"
    : currentPlayer && league.timerEndsAt ? "bidding"
    : "idle";

  const pauseSecsLeft = nextPlayerAt ? Math.max(0, Math.ceil((nextPlayerAt - serverNow) / 1000)) : 0;

  // "NEXT PLAYER UP" flash + fanfare at start of pause phase
  useEffect(() => {
    if (phase !== "pause" || !league.nextPlayerAt) return;
    const key = league.nextPlayerAt;
    if (nextUpFiredRef.current === key) return;
    nextUpFiredRef.current = key;
    setFlash({ text: "NEXT PLAYER UP", color: "bg-fuchsia-700", key: Date.now(), size: "big" });
    window.setTimeout(() => setFlash((f) => (f && f.text === "NEXT PLAYER UP" ? null : f)), 2200);
    if (soundOn) playFanfare();
  }, [phase, league.nextPlayerAt, soundOn]);

  // "READY, GO!" flash at start of reveal phase
  useEffect(() => {
    if (phase !== "reveal" || !currentPlayer || !league.bidStartsAt) return;
    const key = league.bidStartsAt;
    if (readyGoFiredRef.current === key) return;
    readyGoFiredRef.current = key;
    setFlash({ text: "READY, GO!", color: "bg-emerald-600", key: Date.now(), size: "big" });
    window.setTimeout(() => setFlash((f) => (f && f.text === "READY, GO!" ? null : f)), 1500);
    if (soundOn) {
      beep(880, 120, 0.35);
      setTimeout(() => beep(1320, 220, 0.4), 130);
    }
  }, [phase, currentPlayer, league.bidStartsAt, soundOn]);

  // Precise scheduling of Going Once/Twice/Last Chance
  useEffect(() => {
    if (phase !== "bidding" || !currentPlayer || league.paused) return;
    const endsAt = effectiveEndsAt;
    if (!endsAt) return;

    const timeouts: number[] = [];
    const showFlash = (text: string, color: string) => {
      setFlash({ text, color, key: Date.now() });
      window.setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), 900);
    };
    const schedule = (secondsBefore: number, text: string, color: string, freq: number, vol: number) => {
      const fireAt = endsAt - secondsBefore * 1000;
      const delay = fireAt - (Date.now() + serverOffset);
      if (delay < -300) return;
      timeouts.push(
        window.setTimeout(() => {
          if (soundOn) beep(freq, 220, vol);
          showFlash(text, color);
        }, Math.max(0, delay))
      );
    };
    schedule(3, "GOING ONCE", "bg-amber-500", 880, 0.4);
    schedule(2, "GOING TWICE", "bg-orange-500", 1050, 0.45);
    schedule(1, "LAST CHANCE", "bg-red-600", 1240, 0.5);
    return () => timeouts.forEach((t) => clearTimeout(t));
  }, [effectiveEndsAt, currentPlayer, phase, league.paused, soundOn, serverOffset]);

  // SOLD flash + tone when a player finalizes.
  // On first render, mark every already-sold player as "already announced" so
  // we don't fire retroactive flashes for the whole history.
  const soldSignature = players.filter((p) => p.status === "sold").map((p) => p.id).sort().join(",");
  useEffect(() => {
    const soldNow = players.filter((p) => p.status === "sold");

    if (!soldInitializedRef.current) {
      soldInitializedRef.current = true;
      soldNow.forEach((p) => announcedSoldRef.current.add(p.id));
      return;
    }

    // If a previously-sold player has been undone (status flipped back to
    // "available"), forget them so a re-sale re-announces correctly.
    const soldIdsNow = new Set(soldNow.map((p) => p.id));
    for (const id of Array.from(announcedSoldRef.current)) {
      if (!soldIdsNow.has(id)) announcedSoldRef.current.delete(id);
    }

    // Announce only players we haven't seen sold before.
    const brandNew = soldNow.filter((p) => !announcedSoldRef.current.has(p.id));
    for (const p of brandNew) {
      announcedSoldRef.current.add(p.id);
      const t = teams.find((tt) => tt.id === p.soldTo);
      if (t && p.soldPrice && p.soldPrice > 0) {
        setFlash({ text: `SOLD! ${t.name} — $${p.soldPrice}`, color: "bg-green-600", key: Date.now(), size: "big" });
      } else {
        setFlash({ text: `${p.name} — UNSOLD`, color: "bg-stone-600", key: Date.now(), size: "big" });
      }
      window.setTimeout(() => setFlash(null), 1800);
      if (soundOn) playSoldTone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldSignature]);

  // Auto-advance on any expired phase timestamp (server-time aware)
  useEffect(() => {
    if (league.status !== "active" || league.paused) return;

    let shouldFire = false;
    let key = "";
    if (league.timerEndsAt && new Date(league.timerEndsAt).getTime() <= serverNow && league.currentPlayer) {
      shouldFire = true;
      key = `bid:${league.currentPlayer}`;
    } else if (league.bidStartsAt && new Date(league.bidStartsAt).getTime() <= serverNow && league.currentPlayer && !league.timerEndsAt) {
      shouldFire = true;
      key = `reveal:${league.currentPlayer}`;
    } else if (league.nextPlayerAt && new Date(league.nextPlayerAt).getTime() <= serverNow && !league.currentPlayer) {
      shouldFire = true;
      key = `pause:${league.nextPlayerAt}`;
    }

    if (shouldFire && advancedRef.current !== key) {
      advancedRef.current = key;
      fetch("/api/advance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: league.roomCode }),
      }).catch(() => {});
    }
  }, [
    serverNow, league.status, league.paused, league.roomCode,
    league.timerEndsAt, league.bidStartsAt, league.nextPlayerAt, league.currentPlayer,
  ]);

  // Safety net: if 2s past any expected transition and nothing happened, retry
  useEffect(() => {
    if (league.status !== "active" || league.paused) return;
    const guards = [
      league.timerEndsAt ? new Date(league.timerEndsAt).getTime() + 2000 : Infinity,
      league.bidStartsAt ? new Date(league.bidStartsAt).getTime() + 2000 : Infinity,
      league.nextPlayerAt ? new Date(league.nextPlayerAt).getTime() + 2000 : Infinity,
    ];
    const anyOverdue = guards.some((g) => g !== Infinity && serverNow > g);
    if (anyOverdue) advancedRef.current = null;
  }, [serverNow, league.status, league.paused, league.timerEndsAt, league.bidStartsAt, league.nextPlayerAt]);

  // -------- Bid submission --------
  async function placeBid(amount: number, retriesLeft = 3): Promise<void> {
    setBidErr("");
    if (phase !== "bidding") { setBidErr("Bidding hasn't started yet"); return; }
    if (league.paused) { setBidErr("Auction is paused"); return; }
    if (!me || !myTeam) { setBidErr("You haven't joined as a team."); return; }
    if (!Number.isInteger(amount) || amount < 1) { setBidErr("Enter a whole number."); return; }
    if (amount > myTeam.budgetLeft) { setBidErr(`Over budget ($${myTeam.budgetLeft})`); return; }

    setBidding(true);
    setOptPlayerId(league.currentPlayer);
    setOptCurrentBid(amount);
    setOptWinner(me.teamId);
    setOptTimerEndsAt(new Date(Date.now() + (league.bidTimerSecs || 15) * 1000).toISOString());
    ensureCtx();

    const res = await fetch("/api/bid", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode: league.roomCode, teamId: me.teamId, token: me.token, amount,
      }),
    });

    if (res.ok) { setBidding(false); setMyBid(""); return; }

    const j = await res.json().catch(() => ({}));
    const msg: string = j.error || "Bid failed";

    const m = msg.match(/higher than current \(\$?(\d+)\)/i);
    if (m && retriesLeft > 0) {
      const newAmount = parseInt(m[1], 10) + 1;
      if (myTeam && newAmount <= myTeam.budgetLeft) return placeBid(newAmount, retriesLeft - 1);
    }
    setOptCurrentBid(null);
    setOptWinner(null);
    setOptTimerEndsAt(null);
    setBidding(false);
    setBidErr(msg);
  }

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

  const canForceDrawNext = !league.currentPlayer || timerExpired;

  // -------- Render --------
  const flashClasses = flash?.size === "big"
    ? "text-4xl md:text-6xl px-10 py-8"
    : "text-3xl md:text-5xl px-8 py-6";

  return (
    <main className="mx-auto max-w-7xl p-4 pb-16 relative">
      {/* Full-screen flash overlay */}
      {flash && (
        <div key={flash.key} className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className={`${flash.color} ${flashClasses} text-white font-black rounded-2xl shadow-2xl border-4 border-white/40 -rotate-3 animate-pulse`}>
            {flash.text}
          </div>
        </div>
      )}

      <header className="flex items-center gap-3 mb-4">
        <div className="w-14 h-14 rounded-full bg-white p-0.5 ring-4 ring-amber-500/40 shadow-md shrink-0">
          <Image src="/crown-anchor-logo.jpg" alt="C&A" width={54} height={54} className="rounded-full" priority />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="pub-display text-lg md:text-xl font-bold text-stone-900 truncate">Crown &amp; Anchor Veterans League</h1>
          <div className="text-xs text-stone-500">
            Room <span className="font-mono text-stone-900">{league.roomCode}</span>
            <span className="mx-1.5">·</span>
            {soldPlayers.length}/{totalPlayers} sold
          </div>
        </div>
        <button
          onClick={() => { setSoundOn((v) => !v); ensureCtx(); }}
          className="text-stone-500 hover:text-stone-800 text-xl shrink-0"
          title="Toggle sound"
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </header>

      {league.paused && (
        <div className="mb-3 bg-amber-100 border-2 border-amber-500 rounded-lg px-3 py-2 text-center text-amber-900 text-sm font-semibold">
          ⏸ Auction paused by commissioner
        </div>
      )}

      {/* Split screen: left = auction, right = team rosters */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: auction machine */}
        <div>
          {phase === "pause" ? (
            <div className="bg-amber-100 rounded-3xl border-2 border-amber-500 p-6 text-center min-h-[220px] flex flex-col justify-center shadow-md">
              <div className="text-xs text-amber-800 uppercase tracking-widest font-semibold">Get ready</div>
              <div className="pub-display text-3xl md:text-4xl font-black mt-2 text-stone-900">Next player coming up</div>
              <div className="text-sm text-stone-600 mt-3">{pauseSecsLeft}s…</div>
            </div>
          ) : phase === "reveal" && currentPlayer ? (
            <div className="bg-emerald-100 rounded-3xl border-2 border-emerald-600 p-6 text-center shadow-md">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${positionColor(currentPlayer.position)}`}>
                  {currentPlayer.position}
                </span>
                {currentPlayer.nflTeam && <span className="text-xs text-emerald-900 font-semibold">{currentPlayer.nflTeam}</span>}
              </div>
              <h2 className="pub-display text-4xl font-black leading-tight text-stone-900">{currentPlayer.name}</h2>
              <div className="text-xs text-emerald-800 uppercase tracking-widest mt-4 font-semibold">Ready…</div>
            </div>
          ) : currentPlayer ? (
            <div className="bg-white rounded-3xl border-2 border-amber-500/40 p-5 text-center shadow-lg">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${positionColor(currentPlayer.position)}`}>
                  {currentPlayer.position}
                </span>
                {currentPlayer.nflTeam && <span className="text-xs text-stone-500 font-medium">{currentPlayer.nflTeam}</span>}
              </div>
              <h2 className="pub-display text-3xl font-bold leading-tight text-stone-900">{currentPlayer.name}</h2>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl py-3">
                  <div className="text-xs text-stone-600">Current bid</div>
                  <div className="text-3xl font-bold text-stone-900">${displayedBid}</div>
                  <div className="text-xs text-stone-500 mt-1">
                    {displayedWinner ? teamById(displayedWinner)?.name : "—"}
                  </div>
                </div>
                <div className={`rounded-xl py-3 border ${league.paused ? "bg-amber-100 border-amber-400" : secsLeft <= 3 ? "bg-red-100 border-red-400" : "bg-stone-100 border-stone-300"}`}>
                  <div className="text-xs text-stone-600">Timer</div>
                  <div className={`text-3xl font-bold ${secsLeft <= 3 ? "text-red-700" : "text-stone-900"}`}>{secsLeft}s</div>
                </div>
              </div>

              {myTeam ? (
                <div className="mt-5">
                  <div className="text-xs text-stone-600">Your budget: <span className="text-stone-900 font-bold">${myTeam.budgetLeft}</span></div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => placeBid(minNextBid)} disabled={bidding || league.paused}
                      className="flex-1 bg-amber-700 hover:bg-amber-600 active:scale-[.98] transition disabled:bg-stone-400 text-white py-4 rounded-lg font-semibold text-lg shadow">
                      Bid ${minNextBid}
                    </button>
                    <button onClick={() => placeBid(Math.max(minNextBid, displayedBid + 5))} disabled={bidding || league.paused}
                      className="flex-1 bg-amber-800 hover:bg-amber-700 active:scale-[.98] transition disabled:bg-stone-400 text-white py-4 rounded-lg font-semibold text-lg shadow">
                      +$5
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="number" min={minNextBid} value={myBid}
                      onChange={(e) => setMyBid(e.target.value)}
                      placeholder={`Custom (min $${minNextBid})`}
                      className="flex-1 rounded-lg bg-stone-50 border-2 border-stone-300 px-3 py-3 outline-none focus:border-amber-600 text-stone-900"
                    />
                    <button onClick={() => placeBid(Number(myBid))} disabled={bidding || !myBid || league.paused}
                      className="px-4 bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-400 text-white rounded-lg font-semibold shadow">
                      Bid
                    </button>
                  </div>
                  {bidErr && <div className="mt-2 text-red-700 text-sm font-medium">{bidErr}</div>}
                </div>
              ) : (
                <p className="mt-5 text-stone-500 text-sm">Spectating — you haven't joined as a team on this device.</p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border-2 border-amber-500/40 p-6 text-center min-h-[220px] flex items-center justify-center shadow-lg">
              <p className="text-stone-600">Drawing next player…</p>
            </div>
          )}

          {isCommish && (
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <button onClick={togglePause} disabled={pausing}
                  className={`flex-1 py-3 rounded-lg font-semibold ${
                    league.paused ? "bg-green-600 hover:bg-green-500" : "bg-yellow-600 hover:bg-yellow-500"
                  } disabled:bg-zinc-700`}>
                  {league.paused ? "▶ Resume Draft" : "⏸ Pause Draft"}
                </button>
                <button onClick={forceNext} disabled={advancing || !canForceDrawNext || league.paused}
                  title={!canForceDrawNext ? "Wait for the current bid to finish (or pause first)" : ""}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 py-3 rounded-lg font-semibold">
                  {advancing ? "Advancing…" : "Draw Next Player"}
                </button>
              </div>
              <p className="text-[10px] text-stone-500 text-center">
                Commissioner controls · Pause blocks new bids · Draw Next only after timer expires
              </p>
            </div>
          )}

          <section className="mt-6">
            <h3 className="pub-display text-base font-bold text-stone-800 mb-2">Recent bids</h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {bids.slice(0, 12).map((b) => {
                const t = teamById(b.teamId);
                const p = players.find((x) => x.id === b.playerId);
                return (
                  <div key={b.id} className="text-sm flex justify-between bg-white/70 border border-stone-200 rounded px-3 py-1.5">
                    <span className="truncate text-stone-800">{t?.name || "?"} <span className="text-stone-400">→</span> {p?.name || "?"}</span>
                    <span className="font-mono text-emerald-700 font-semibold">${b.amount}</span>
                  </div>
                );
              })}
              {bids.length === 0 && <div className="text-stone-500 text-sm">No bids yet.</div>}
            </div>
          </section>
        </div>

        {/* Right: team rosters (dark panel) */}
        <div className="bg-zinc-950 -mx-4 lg:mx-0 lg:rounded-2xl p-4 text-zinc-100 shadow-xl border-2 border-amber-500/20">
          <h3 className="pub-display text-base font-bold text-amber-400 mb-3">Team Rosters</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {teams.map((t) => {
              const won = soldPlayers.filter((p) => p.soldTo === t.id);
              const slots = organizeRoster(won);
              return (
                <div key={t.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-2.5">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="font-semibold text-sm truncate">{t.name}</span>
                    <span className="text-xs font-mono text-green-400">${t.budgetLeft}</span>
                  </div>
                  <RosterSlotList label="QB" slots={slots.QB} isCommish={isCommish} onUndo={undoSale} />
                  <RosterSlotList label="RB" slots={slots.RB} isCommish={isCommish} onUndo={undoSale} />
                  <RosterSlotList label="WR" slots={slots.WR} isCommish={isCommish} onUndo={undoSale} />
                  <RosterSlotList label="TE" slots={slots.TE} isCommish={isCommish} onUndo={undoSale} />
                  <RosterSlotList label="FLEX" slots={slots.FLEX} isCommish={isCommish} onUndo={undoSale} />
                  {slots.BENCH.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-zinc-800">
                      <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Bench</div>
                      <div className="flex flex-wrap gap-0.5">
                        {slots.BENCH.map((p) => (
                          <BenchPill key={p.id} player={p} isCommish={isCommish} onUndo={undoSale} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}

function RosterSlotList({
  label, slots, isCommish, onUndo,
}: { label: string; slots: (Player | null)[]; isCommish: boolean; onUndo: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1 text-[11px] mb-0.5">
      <span className="w-9 text-zinc-500 font-semibold shrink-0">{label}</span>
      <div className="flex flex-wrap gap-0.5 flex-1">
        {slots.map((p, i) =>
          p ? (
            <span key={p.id} className={`px-1.5 py-0.5 rounded ${positionColor(p.position)} inline-flex items-center gap-1`}>
              <span className="truncate max-w-[80px]" title={p.name}>{p.name}</span>
              <span className="opacity-80">${p.soldPrice}</span>
              {isCommish && (
                <button onClick={() => onUndo(p.id)} title="Undo (return + refund)" className="opacity-70 hover:opacity-100 pl-0.5">
                  ×
                </button>
              )}
            </span>
          ) : (
            <span key={`empty-${label}-${i}`} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600">—</span>
          )
        )}
      </div>
    </div>
  );
}

function BenchPill({ player, isCommish, onUndo }: { player: Player; isCommish: boolean; onUndo: (id: string) => void }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${positionColor(player.position)} inline-flex items-center gap-1`}>
      <span className="truncate max-w-[80px]">{player.name}</span>
      <span className="opacity-80">${player.soldPrice}</span>
      {isCommish && (
        <button onClick={() => onUndo(player.id)} title="Undo" className="opacity-70 hover:opacity-100">×</button>
      )}
    </span>
  );
}
