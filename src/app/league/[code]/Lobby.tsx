"use client";
import { useEffect, useState } from "react";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import type { League, Team } from "@/lib/types";

export default function Lobby({ league }: { league: League }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);

  const isCommish =
    typeof window !== "undefined" &&
    localStorage.getItem(`commish:${league.roomCode}`) === league.commissionerId;

  useEffect(() => {
    const db = firestore();
    const q = query(collection(db, "leagues", league.id, "teams"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setTeams(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Team[]);
    });
    return () => unsub();
  }, [league.id]);

  async function startAuction() {
    setErr("");
    setStarting(true);
    const commissionerId = localStorage.getItem(`commish:${league.roomCode}`);
    const res = await fetch("/api/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: league.roomCode, commissionerId }),
    });
    setStarting(false);
    const json = await res.json();
    if (!res.ok) setErr(json.error || "Could not start");
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="text-center mb-6">
        <div className="text-zinc-400 text-sm">Room Code</div>
        <div className="text-5xl font-mono tracking-widest font-bold mt-1">{league.roomCode}</div>
        <div className="text-zinc-500 text-sm mt-2">Share this code with your league members.</div>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
        <h2 className="font-semibold mb-3">Teams ({teams.length}/12)</h2>
        <div className="space-y-2">
          {teams.map((t, i) => (
            <div key={t.id} className="flex items-center bg-zinc-800 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-zinc-700 grid place-content-center text-xs">{i + 1}</div>
              <div className="ml-3 font-medium">{t.name}</div>
              <div className="ml-auto text-xs text-zinc-400">${league.budget}</div>
            </div>
          ))}
          {teams.length === 0 && <div className="text-zinc-500 text-sm">Waiting for teams to join…</div>}
        </div>
      </div>

      {isCommish ? (
        <div className="mt-6">
          <button
            onClick={startAuction}
            disabled={starting || teams.length === 0}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 text-white font-semibold py-3 rounded-lg"
          >
            {starting ? "Starting…" : `Start Auction`}
          </button>
          {err && <div className="text-red-400 text-sm mt-2">{err}</div>}
          <p className="text-xs text-zinc-500 mt-3 text-center">Only you (the commissioner) see this button.</p>
        </div>
      ) : (
        <p className="text-center text-zinc-400 mt-6 text-sm">Waiting for the commissioner to start the auction…</p>
      )}
    </main>
  );
}
