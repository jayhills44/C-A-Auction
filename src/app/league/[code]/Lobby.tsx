"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
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
        <div className="inline-block ring-4 ring-amber-500/40 rounded-full p-1 bg-white shadow-lg mb-3">
          <Image src="/crown-anchor-logo.jpg" alt="C&A" width={80} height={80} className="rounded-full" priority />
        </div>
        <h1 className="pub-display text-xl font-bold text-stone-900">Crown &amp; Anchor Veterans League</h1>
        <div className="text-stone-500 text-sm mt-3">Room Code</div>
        <div className="pub-display text-5xl font-mono tracking-widest font-bold mt-1 text-amber-800">{league.roomCode}</div>
        <div className="text-stone-500 text-sm mt-2">Share this code with your league members.</div>
      </div>

      <div className="bg-white rounded-2xl border-2 border-amber-500/30 p-4 shadow-lg">
        <h2 className="pub-display font-bold text-stone-900 mb-3">Teams ({teams.length}/12)</h2>
        <div className="space-y-2">
          {teams.map((t, i) => (
            <div key={t.id} className="flex items-center bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-amber-700 text-white grid place-content-center text-xs font-semibold">{i + 1}</div>
              <div className="ml-3 font-medium text-stone-900">{t.name}</div>
              <div className="ml-auto text-xs text-stone-600 font-mono">${league.budget}</div>
            </div>
          ))}
          {teams.length === 0 && <div className="text-stone-500 text-sm">Waiting for teams to join…</div>}
        </div>
      </div>

      {isCommish ? (
        <div className="mt-6">
          <button
            onClick={startAuction}
            disabled={starting || teams.length === 0}
            className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-400 text-white font-semibold py-3 rounded-lg shadow-md"
          >
            {starting ? "Starting…" : `Start Auction`}
          </button>
          {err && <div className="text-red-700 text-sm mt-2">{err}</div>}
          <p className="text-xs text-stone-500 mt-3 text-center">Only you (the commissioner) see this button.</p>
        </div>
      ) : (
        <p className="text-center text-stone-600 mt-6 text-sm">Waiting for the commissioner to start the auction…</p>
      )}
    </main>
  );
}
