"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player, Bid } from "@/lib/types";

// ---------- audio helpers ----------
function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.cancel(); // dump any pending speech
    window.speechSynthesis.speak(u);
  } catch {}
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

  // Optimistic overlays so we don't wait on Firestore for the tapper's screen.
  const [optCurrentBid, setOptCurrentBid] = useState<number | null>(null);
  const [optWinner, setOptWinner] = useState<string | null>(null);
  const [optPlayerId, setOptPlayerId] = useState<string | null>(null);

  const advancedRef = useRef<string | null>(null);
  const spokenOnceRef = useRef<string | null>(null);
  const spokenTwiceRef = useRef<string | null>(null);
  const lastSoldRef = useRef<string | null>(null);

  const isCommish =
    typeof window !== "undefined" &&
    localStorage.getItem(`commish:${league.roomCode}`) === league.commissionerId;

  // Who am I on this device?
  const me = useMemo(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(`team:${league.roomCode}`);
    return stored ? (JSON.parse(stored) as { teamId: string; token: string }) : null;
  }, [league.roomCode]);
  const myTeam = teams.find((t) => t.id === me?.teamId) || null;

  // ---------- live subscriptions ----------
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

  // ---------- countdown tick ----------
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100); // finer tick for smoother timer
    return () => clearInterval(id);
  }, []);

  // ---------- clear optimistic overlay when the server catches up ----------
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
      // Player changed on the server — drop any stale overlay.
      setOptCurrentBid(null);
      setOptWinner(null);
      setOptPlayerId(null);
    }
  }, [league.currentPlayer, league.currentBid, league.currentWinner, optPlayerId, optCurrentBid, optWinner]);

  // ---------- derived (with optimistic overlay applied) ----------
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
  const secsLeft = league.timerEndsAt
    ? Math.max(0, Math.ceil((new Date(league.timerEndsAt).getTime() - now) / 1000))
    : 0;
  const minNextBid = displayedBid + 1;

  // ---------- audio: "Going once/twice" as timer runs out ----------
  useEffect(() => {
    if (!currentPlayer || !league.timerEndsAt) return;
    // Only run cues if the auction is really live.
    if (league.status !== "active") return;

    const playerKey = currentPlayer.id;
    if (secsLeft === 3 && spokenOnceRef.current !== playerKey) {
      spokenOnceRef.current = playerKey;
      speak("Going once");
    }
    if (secsLeft === 2 && spokenTwiceRef.current !== playerKey) {
      spokenTwiceRef.current = playerKey;
      speak("Going twice");
    }
  }, [secsLeft, currentPlayer, league.timerEndsAt, league.status]);

  // ---------- audio: "SOLD to Team for $X" when a player finalizes ----------
  const soldSignature = players.map((p) => `${p.id}:${p.status}`).join(",");
  useEffect(() => {
    for (const p of players) {
      if (p.status === "sold" && lastSoldRef.current !== p.id) {
        if (lastSoldRef.current === null) {
          // First render — don't announce prior sales, just record them.
          lastSoldRef.current = p.id;
          continue;
        }
        lastSoldRef.current = p.id;
        const t = teams.find((tt) => tt.id === p.soldTo);
        if (t && p.soldPrice && p.soldPrice > 0) {
          speak(`Sold to ${t.name} for ${p.soldPrice} dollars`);
        } else {
          speak(`${p.name} unsold`);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldSignature]);

  // ---------- auto-advance when timer hits 0 ----------
  useEffect(() => {
    if (!league.timerEndsAt) return;
    if (league.status !== "active") return;
    const ends = new Date(league.timerEndsAt).getTime();
    if (now >= ends && league.currentPlayer && advancedRef.current !== league.currentPlayer) {
      advancedRef.current = league.currentPlayer;
      fetch("/api/advance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: league.roomCode }),
      }).catch(() => {});
    }
  }, [now, league.timerEndsAt, league.currentPlayer, league.roomCode, league.status]);

  // ---------- safety net: if we've been stuck at 0 for >2s, re-poke advance ----------
  useEffect(() => {
    if (!league.timerEndsAt || league.status !== "active" || !league.currentPlayer) return;
    const ends = new Date(league.timerEndsAt).getTime();
    if (now < ends + 2000) return;
    // Reset the ref so we try again.
    advancedRef.current = null;
  }, [now, league.timerEndsAt, league.currentPlayer, league.status]);

  // ---------- bid submission with auto-retry ----------
  async function placeBid(amount: number, retriesLeft = 3) {
    setBidErr("");
    if (!me || !myTeam) return setBidErr("You haven't joined as a team.");
    if (!Number.isInteger(amount) || amount < 1) return setBidErr("Enter a whole number.");
    if (amount > myTeam.budgetLeft) return setBidErr(`Over budget ($${myTeam.budgetLeft})`);

    setBidding(true);

    // Optimistic: show the bid on my screen immediately.
    setOptPlayerId(league.currentPlayer);
    setOptCurrentBid(amount);
    setOptWinner(me.teamId);

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

    // Auto-retry: if the server says a higher bid is needed, jump.
    const m = msg.match(/higher than current \(\$?(\d+)\)/i);
    if (m && retriesLeft > 0) {
      const newAmount = parseInt(m[1], 10) + 1;
      if (myTeam && newAmount <= myTeam.budgetLeft) {
        return placeBid(newAmount, retriesLeft - 1);
      }
    }
    // Same for the race-condition "Someone bid first" message.
    if (/someone bid first|bidding has closed/i.test(msg) && retriesLeft > 0) {
      // Fall through and give up quietly; next Firestore push will show current state.
    }

    // Roll back optimistic overlay
    setOptCurrentBid(null);
    setOptWinner(null);
    setBidding(false);
    setBidErr(msg);
  }

  // ---------- commissioner backup: force draw next ----------
  async function forceNext() {
    setAdvancing(true);
    // Trick: we can't call finalize directly without expiring the timer.
    // So we set timer_ends_at to now via a lightweight endpoint. Easiest: just
    // spam the advance endpoint - server checks timer. If we want a hard
    // override, we hit /api/advance with force flag.
    await fetch("/api/advance", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, force: true, commissionerId: localStorage.getItem(`commish:${league.roomCode}`) }),
    }).catch(() => {});
    setAdvancing(false);
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-32">
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
        <div>Room <span className="font-mono text-zinc-200">{league.roomCode}</span></div>
        <div>{soldPlayers.length}/{totalPlayers} sold</div>
      </div>

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
            <div className={`rounded-xl py-3 ${secsLeft <= 3 ? "bg-red-900/60" : "bg-zinc-800"}`}>
              <div className="text-xs text-zinc-400">Timer</div>
              <div className="text-2xl font-bold">{secsLeft}s</div>
            </div>
          </div>

          {myTeam ? (
            <div className="mt-5">
              <div className="text-xs text-zinc-400">Your budget: <span className="text-white font-bold">${myTeam.budgetLeft}</span></div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => placeBid(minNextBid)} disabled={bidding}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[.98] transition disabled:bg-zinc-700 py-4 rounded-lg font-semibold text-lg">
                  Bid ${minNextBid}
                </button>
                <button onClick={() => placeBid(Math.max(minNextBid, displayedBid + 5))} disabled={bidding}
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
                <button onClick={() => placeBid(Number(myBid))} disabled={bidding || !myBid}
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
        <div className="mt-4">
          <button
            onClick={forceNext}
            disabled={advancing}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 py-3 rounded-lg font-semibold"
          >
            {advancing ? "Advancing…" : "Draw Next Player (commissioner)"}
          </button>
          <p className="text-[10px] text-zinc-500 mt-1 text-center">
            Backup control: use only if the timer ran out and the next player didn't appear.
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
                      <span key={p.id} className={`text-[10px] px-1.5 py-0.5 rounded ${positionColor(p.position)}`}>
                        {p.name} ${p.soldPrice}
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
