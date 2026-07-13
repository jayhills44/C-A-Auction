"use client";
import { useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";

type Row = { name: string; position: string; team?: string };

export default function CreatePage() {
  const router = useRouter();
  const [leagueName, setLeagueName] = useState("");
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
          // accept several common column-name variants
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
    // Save commissioner credentials on this device.
    localStorage.setItem(`commish:${json.roomCode}`, json.commissionerId);
    router.push(`/league/${json.roomCode}`);
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-12">
      <h1 className="text-2xl font-bold mb-6">Create a League</h1>
      <div className="bg-zinc-900 rounded-2xl p-6 space-y-5 border border-zinc-800">
        <label className="block">
          <span className="text-sm text-zinc-300">League name</span>
          <input value={leagueName} onChange={(e) => setLeagueName(e.target.value)}
            placeholder="The 2026 Showdown"
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 outline-none focus:border-blue-500" />
        </label>

        <label className="block">
          <span className="text-sm text-zinc-300">Bid timer (seconds, resets on each new bid)</span>
          <input type="number" min={5} max={120} value={timerSecs}
            onChange={(e) => setTimerSecs(Math.max(5, Math.min(120, Number(e.target.value) || 15)))}
            className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 outline-none focus:border-blue-500" />
        </label>

        <div>
          <span className="text-sm text-zinc-300">Player CSV</span>
          <p className="text-xs text-zinc-500 mt-1">Columns: <code>Name, Position, Team</code> (Team optional).</p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            className="mt-2 block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white" />
          {csvError && <div className="text-red-400 text-sm mt-2">{csvError}</div>}
          {rows.length > 0 && (
            <div className="mt-2 text-sm text-green-400">{rows.length} players loaded.</div>
          )}
        </div>

        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button onClick={create} disabled={busy}
          className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 text-white font-semibold py-3 rounded-lg">
          {busy ? "Creating…" : "Create League"}
        </button>
      </div>
    </main>
  );
}
