"use client";
import { useEffect, useMemo, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player, Bid } from "@/lib/types";

interface Props {
  league: League;
  players: Player[];
  teams: Team[];
  onClose: () => void;
}

// Full-screen commissioner tools modal with two sections:
//   1. Queue Next Player (pick a specific available player to be drafted next)
//   2. Bid History (search any player, see the full bid trail)
export default function CommissionerTools({ league, players, teams, onClose }: Props) {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [queueSearch, setQueueSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [allBids, setAllBids] = useState<Bid[]>([]);

  // Fetch ALL bids for history (unbounded — 75 players × ~5-10 bids each is small).
  useEffect(() => {
    const db = firestore();
    const q = query(collection(db, "leagues", league.id, "bids"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setAllBids(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Bid[]);
    });
    return () => unsub();
  }, [league.id]);

  const availablePlayers = useMemo(
    () => players.filter((p) => p.status === "available"),
    [players]
  );

  const filteredAvail = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return availablePlayers.slice(0, 100);
    return availablePlayers.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 100);
  }, [availablePlayers, queueSearch]);

  const historyMatches = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return players.filter((p) => allBids.some((b) => b.playerId === p.id));
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) &&
        allBids.some((b) => b.playerId === p.id)
    );
  }, [players, allBids, historySearch]);

  const currentlyQueued = players.find((p) => p.id === league.queuedPlayerId);

  async function queueThis(playerId: string | null) {
    setSaving(true);
    setMsg("");
    const commissionerId = localStorage.getItem(`commish:${league.roomCode}`);
    const res = await fetch("/api/queue-player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, commissionerId, playerId }),
    });
    setSaving(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(j.error || "Could not queue player");
    else setMsg(playerId ? "Player queued" : "Queue cleared");
    setTimeout(() => setMsg(""), 2000);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-start md:items-center justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl border-2 border-amber-500/50 shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <h2 className="pub-display text-xl font-bold text-stone-900">Commissioner Tools</h2>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-stone-200 bg-stone-50">
          <button
            onClick={() => setTab("queue")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold ${
              tab === "queue" ? "bg-amber-700 text-white" : "text-stone-700 hover:bg-stone-200"
            }`}
          >
            Queue Next Player
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold ${
              tab === "history" ? "bg-amber-700 text-white" : "text-stone-700 hover:bg-stone-200"
            }`}
          >
            Bid History
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {tab === "queue" ? (
            <div>
              <p className="text-sm text-stone-600 mb-3">
                Pick an available player to be the <strong>next</strong> one auctioned. This
                overrides the random draw for the next player only. Use this after undoing a
                sale to put that player right back up for bid.
              </p>

              {currentlyQueued && (
                <div className="mb-3 bg-amber-100 border border-amber-500 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-amber-800 font-semibold uppercase tracking-wider">Currently queued</div>
                    <div className="text-lg font-semibold text-stone-900">{currentlyQueued.name}</div>
                    <div className="text-xs text-stone-600">{currentlyQueued.position} {currentlyQueued.nflTeam || ""}</div>
                  </div>
                  <button
                    onClick={() => queueThis(null)}
                    disabled={saving}
                    className="text-sm bg-stone-200 hover:bg-stone-300 text-stone-900 px-3 py-1.5 rounded font-medium"
                  >
                    Clear
                  </button>
                </div>
              )}

              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search available players…"
                className="w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-3 py-2 outline-none focus:border-amber-600 text-stone-900 text-sm"
              />

              <div className="mt-3 max-h-96 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                {filteredAvail.length === 0 && (
                  <div className="p-4 text-sm text-stone-500 text-center">No matching available players.</div>
                )}
                {filteredAvail.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 p-2 hover:bg-amber-50">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${positionColor(p.position)}`}>
                      {p.position}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900 truncate">{p.name}</div>
                      {p.nflTeam && <div className="text-[11px] text-stone-500">{p.nflTeam}</div>}
                    </div>
                    <button
                      onClick={() => queueThis(p.id)}
                      disabled={saving}
                      className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded font-semibold"
                    >
                      Queue
                    </button>
                  </div>
                ))}
              </div>

              {msg && <div className="mt-3 text-sm text-emerald-700 font-medium">{msg}</div>}
            </div>
          ) : (
            <div>
              <p className="text-sm text-stone-600 mb-3">
                Search any player to see their full bid history — who bid, how much, and when.
              </p>
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search player name…"
                className="w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-3 py-2 outline-none focus:border-amber-600 text-stone-900 text-sm"
              />

              <div className="mt-3 max-h-96 overflow-y-auto space-y-3">
                {historyMatches.length === 0 && (
                  <div className="p-4 text-sm text-stone-500 text-center">
                    {historySearch ? "No players match your search." : "No bids yet."}
                  </div>
                )}
                {historyMatches.map((p) => {
                  const playerBids = allBids
                    .filter((b) => b.playerId === p.id)
                    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                  return (
                    <div key={p.id} className="border border-stone-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 p-2 bg-stone-50 border-b border-stone-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${positionColor(p.position)}`}>
                          {p.position}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-stone-900 truncate">{p.name}</div>
                          <div className="text-[11px] text-stone-500">
                            {p.status === "sold"
                              ? `Sold to ${teams.find((t) => t.id === p.soldTo)?.name || "?"} for $${p.soldPrice}`
                              : p.status === "current"
                              ? "Currently being auctioned"
                              : "Available"}
                          </div>
                        </div>
                        <div className="text-xs text-stone-500">{playerBids.length} bid{playerBids.length === 1 ? "" : "s"}</div>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {playerBids.map((b, i) => {
                            const t = teams.find((tt) => tt.id === b.teamId);
                            const time = new Date(b.createdAt);
                            return (
                              <tr key={b.id} className={i % 2 ? "bg-stone-50" : ""}>
                                <td className="p-2 text-stone-500 tabular-nums text-xs w-8">{i + 1}.</td>
                                <td className="p-2 text-stone-900">{t?.name || "?"}</td>
                                <td className="p-2 text-right font-mono font-semibold text-emerald-700">${b.amount}</td>
                                <td className="p-2 text-right text-xs text-stone-500 tabular-nums">
                                  {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
