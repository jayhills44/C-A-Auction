"use client";
import { useState } from "react";
import Papa from "papaparse";
import Image from "next/image";
import { useRouter } from "next/navigation";

type Row = { name: string; position: string; team?: string };

export default function CreatePage() {
  const router = useRouter();
  const [leagueName, setLeagueName] = useState("Crown & Anchor Veterans League");
  const [timerSecs, setTimerSecs] = useState(15);
  const [rows, setRows] = useState<Row[]>([]);
  const [csvError, setCsvError] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function handleFile(f: File) {
    setCsvError("");
    Papa.parse<any>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        const parsed: Row[] = [];
        for (const r of res.data as any[]) {
          const name = r.name || r.player || r["player name"] || r.full_name || "";
          const position = r.position || r.pos || "";
          const team = r.team || r.nfl_team || r["nfl team"] || "";
          if (name && position) parsed.push({ name: String(name).trim(), position: String(position).trim(), team: String(team).trim() });
        }
        if (parsed.length === 0) setCsvError("Couldn't find any rows with Name + Position columns.");
        setRows(parsed);
      },
      error: (e) => setCsvError(e.message),
    });
  }

  async function create() {
    setErr("");
    if (!leagueName.trim()) return setErr("Give your league a name");
    if (rows.length === 0)  return setErr("Upload a player CSV first");
    setBusy(true);
    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: leagueName.trim(), bidTimerSecs: timerSecs, players: rows }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(json.error || "Could not create league");
    localStorage.setItem(`commish:${json.roomCode}`, json.commissionerId);
    router.push(`/league/${json.roomCode}`);
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-10">
      <div className="text-center mb-6">
        <div className="inline-block ring-4 ring-amber-500/40 rounded-full p-1 bg-white shadow-lg">
          <Image src="/crown-anchor-logo.jpg" alt="Crown & Anchor" width={80} height={80} className="rounded-full" priority />
        </div>
        <h1 className="pub-display text-2xl font-bold mt-3 text-stone-900">Create a League</h1>
      </div>

      <div className="bg-white rounded-2xl p-6 space-y-5 border-2 border-amber-500/30 shadow-lg">
        <label className="block">
          <span className="text-sm text-stone-700 font-medium">League name</span>
          <input value={leagueName} onChange={(e) => setLeagueName(e.target.value)}
            placeholder="Crown & Anchor Veterans League"
            className="mt-1 w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-4 py-3 outline-none focus:border-amber-600 text-stone-900" />
        </label>

        <label className="block">
          <span className="text-sm text-stone-700 font-medium">Bid timer (seconds — resets on each new bid)</span>
          <input type="number" min={5} max={120} value={timerSecs}
            onChange={(e) => setTimerSecs(Math.max(5, Math.min(120, Number(e.target.value) || 15)))}
            className="mt-1 w-full rounded-lg bg-stone-50 border-2 border-stone-300 px-4 py-3 outline-none focus:border-amber-600 text-stone-900" />
        </label>

        <div>
          <span className="text-sm text-stone-700 font-medium">Player CSV</span>
          <p className="text-xs text-stone-500 mt-1">Columns: <code>Name, Position, Team</code> (Team optional).</p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            className="mt-2 block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-amber-700 file:text-white file:hover:bg-amber-600" />
          {csvError && <div className="text-red-600 text-sm mt-2">{csvError}</div>}
          {rows.length > 0 && (
            <div className="mt-2 text-sm text-emerald-700 font-medium">{rows.length} players loaded.</div>
          )}
        </div>

        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button onClick={create} disabled={busy}
          className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-400 text-white font-semibold py-3 rounded-lg shadow-md">
          {busy ? "Creating…" : "Create League"}
        </button>
      </div>
    </main>
  );
}
