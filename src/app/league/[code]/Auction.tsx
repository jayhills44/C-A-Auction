"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player, Bid } from "@/lib/types";

export default function Auction({ league }: { league: League }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [now, setNow] = useState(Date.now());
  const [myBid, setMyBid] = useState("");
  const [bidErr, setBidErr] = useState("");
  const [bidding, setBidding] = useState(false);
  const advancedRef = useRef<string | null>(null);

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
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // ---------- auto-advance when timer hits 0 ----------
  useEffect(() => {
    if (!league.timerEndsAt) return;
    const ends = new Date(league.timerEndsAt).getTime();
    if (now >= ends && league.currentPlayer && advancedRef.current !== league.currentPlayer) {
      advancedRef.current = league.currentPlayer;
      fetch("/api/advance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: league.roomCode }),
      }).catch(() => {});
    }
  }, [now, league.timerEndsAt, league.currentPlayer, league.roomCode]);

  // ---------- derived ----------
  const currentPlayer = players.find((p) => p.id === league.currentPlayer) || null;
  const soldPlayers = players.filter((p) => p.status === "sold");
  const totalPlayers = players.length;
  const teamById = (id: string | null) => teams.find((t) => t.id === id) || null;
  const secsLeft = league.timerEndsAt
    ? Math.max(0, Math.ceil((new Date(league.timerEndsAt).getTime() - now) / 1000))
    : 0;
  const minNextBid = (league.currentBid || 0) + 1;

  async function placeBid(amount: number) {
    setBidErr("");
    if (!me || !myTeam) return setBidErr("You haven't joined as a team.");
    if (!Number.isInteger(amount) || amount < 1) return setBidErr("Enter a whole number.");
    setBidding(true);
    const res = await fetch("/api/bid", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode: league.roomCode, teamId: me.teamId, token: me.token, amount,
      }),
    });
    setBidding(false);
    if (!res.ok) {
      const j = await res.json();
      setBidErr(j.error || "Bid failed");
      return;
    }
    setMyBid("");
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
              <div className="text-2xl font-bold">${league.currentBid}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {league.currentWinner ? teamById(league.currentWinner)?.name : "—"}
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
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 py-3 rounded-lg font-semibold">
                  Bid ${minNextBid}
                </button>
                <button onClick={() => placeBid(Math.max(minNextBid, league.currentBid + 5))} disabled={bidding}
                  className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-700 py-3 rounded-lg font-semibold">
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
