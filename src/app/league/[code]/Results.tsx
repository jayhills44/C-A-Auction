"use client";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { positionColor } from "@/lib/utils";
import type { League, Team, Player } from "@/lib/types";

export default function Results({ league }: { league: League }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    const db = firestore();
    const unsubT = onSnapshot(query(collection(db, "leagues", league.id, "teams"), orderBy("createdAt")),
      (snap) => setTeams(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Team[]));
    const unsubP = onSnapshot(collection(db, "leagues", league.id, "players"),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Player[]));
    return () => { unsubT(); unsubP(); };
  }, [league.id]);

  function exportCsv() {
    const rows = [["Team", "Player", "Position", "NFL Team", "Price"]];
    for (const t of teams) {
      const won = players.filter((p) => p.soldTo === t.id);
      for (const p of won) rows.push([t.name, p.name, p.position, p.nflTeam || "", String(p.soldPrice ?? 0)]);
    }
    const csv = rows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${league.roomCode}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-10">
      <h1 className="text-2xl font-bold mb-1">Auction Complete</h1>
      <p className="text-zinc-400 text-sm mb-4">{league.name} · Room {league.roomCode}</p>
      <button onClick={exportCsv} className="mb-5 w-full bg-blue-600 hover:bg-blue-500 py-2.5 rounded-lg font-semibold">
        Download Results CSV
      </button>

      <div className="space-y-4">
        {teams.map((t) => {
          const won = players.filter((p) => p.soldTo === t.id);
          const spent = won.reduce((s, p) => s + (p.soldPrice || 0), 0);
          return (
            <div key={t.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
              <div className="flex justify-between items-baseline mb-2">
                <h3 className="font-semibold">{t.name}</h3>
                <div className="text-sm text-zinc-300">
                  Spent <span className="text-white font-bold">${spent}</span>
                  <span className="text-zinc-500"> · {won.length} players</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {won.map((p) => (
                  <span key={p.id} className={`text-xs px-2 py-0.5 rounded ${positionColor(p.position)}`}>
                    {p.name} <span className="opacity-90">${p.soldPrice}</span>
                  </span>
                ))}
                {won.length === 0 && <span className="text-zinc-500 text-sm">No players acquired.</span>}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
