"use client";
import { useState } from "react";
import Link from "next/link";
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
    // Save credentials locally so this device is identified as that team.
    localStorage.setItem(`team:${json.roomCode}`, JSON.stringify({ teamId: json.teamId, token: json.token }));
    router.push(`/league/${json.roomCode}`);
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-3xl font-bold mb-2">🏈 Live Auction</h1>
      <p className="text-zinc-400 mb-8">Fantasy football auction draft, in real time.</p>

      <div className="bg-zinc-900 rounded-2xl p-6 space-y-4 border border-zinc-800">
        <h2 className="text-lg font-semibold">Join a league</h2>
        <label className="block">
          <span className="text-sm text-zinc-300">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-2xl tracking-widest text-center font-mono uppercase outline-none focus:border-blue-500"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-300">Your team name</span>
          <input
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="Jay's Juggernauts"
            maxLength={40}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 outline-none focus:border-blue-500"
          />
        </label>
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <button
          onClick={join}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white font-semibold py-3 rounded-lg"
        >
          {loading ? "Joining…" : "Join League"}
        </button>
      </div>

      <div className="mt-8 text-center">
        <Link href="/create" className="text-blue-400 hover:underline">
          Are you the commissioner? Create a league →
        </Link>
      </div>
    </main>
  );
}
