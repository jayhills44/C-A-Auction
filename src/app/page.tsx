"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [team, setTeam] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function join() {
    setError("");
    if (!code.trim() || !team.trim()) {
      setError("Enter a room code and team name");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: code.trim().toUpperCase(), teamName: team.trim() }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error || "Could not join");
      return;
    }
    localStorage.setItem(`team:${json.roomCode}`, JSON.stringify({ teamId: json.teamId, token: json.token }));
    router.push(`/league/${json.roomCode}`);
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-10">
      <div className="text-center mb-6">
        <div className="inline-block ring-4 ring-amber-500/40 rounded-full p-1 bg-white shadow-lg">
          <Image src="/crown-anchor-logo.jpg" alt="Crown & Anchor" width={110} height={110} className="rounded-full" priority />
        </div>
        <h1 className="pub-display text-3xl font-bold mt-4 text-stone-900">Crown &amp; Anchor</h1>
        <p className="pub-display text-lg text-amber-800 tracking-wide">Veterans League</p>
        <p className="text-stone-600 text-sm mt-1">Fantasy football live auction</p>
      </div>

      <div className="bg-white rounded-2xl p-6 space-y-4 border-2 border-amber-500/30 shadow-lg">
        <h2 className="pub-display text-xl font-bold text-stone-900">Join the auction</h2>
        <label className="block">
          <span className="text-sm text-stone-700 font-medium">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="mt-1 w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-4 py-3 text-2xl tracking-widest text-center font-mono uppercase outline-none focus:border-amber-600 text-stone-900"
          />
        </label>
        <label className="block">
          <span className="text-sm text-stone-700 font-medium">Your team name</span>
          <input
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="Jay's Juggernauts"
            maxLength={40}
            className="mt-1 w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-4 py-3 outline-none focus:border-amber-600 text-stone-900"
          />
        </label>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button
          onClick={join}
          disabled={loading}
          className="w-full bg-amber-700 hover:bg-amber-600 disabled:bg-stone-400 text-white font-semibold py-3 rounded-lg shadow-md"
        >
          {loading ? "Joining…" : "Join League"}
        </button>
      </div>

      <div className="mt-6 text-center">
        <Link href="/create" className="text-amber-800 hover:text-amber-900 hover:underline font-medium">
          Commissioner? Create a league →
        </Link>
      </div>
    </main>
  );
}
