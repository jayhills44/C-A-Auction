"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { firestore } from "@/lib/firebaseClient";
import { collection, getDocs, onSnapshot, query, where, limit } from "firebase/firestore";
import Lobby from "./Lobby";
import Auction from "./Auction";
import Results from "./Results";
import type { League } from "@/lib/types";
// Ably loaded via dynamic import inside effects (see below). See Auction.tsx
// for the same pattern — a top-level import breaks Next.js webpack build.

export default function LeaguePage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code || "").toUpperCase();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [notFound, setNotFound] = useState(false);

  // One-shot fetch, used by Ably push handler and the safety-net polling.
  const refetch = useCallback(async () => {
    try {
      const db = firestore();
      const q = query(collection(db, "leagues"), where("roomCode", "==", code), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return;
      const d = snap.docs[0];
      setLeague({ id: d.id, ...(d.data() as any) } as League);
      setNotFound(false);
    } catch {}
  }, [code]);

  // Primary: Firestore realtime listener.
  useEffect(() => {
    const db = firestore();
    const q = query(collection(db, "leagues"), where("roomCode", "==", code), limit(1));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) { setNotFound(true); return; }
        const d = snap.docs[0];
        setLeague({ id: d.id, ...(d.data() as any) } as League);
        setNotFound(false);
      },
      () => setNotFound(true)
    );
    return () => unsub();
  }, [code]);

  // Secondary: Ably push notification. When commissioner starts the auction
  // (or any state change happens), Ably delivers it in ~150ms, and we refetch
  // to update. Independent of the Firestore listener so we're covered if the
  // listener silently disconnects on a phone.
  useEffect(() => {
    if (!code) return;
    let client: any = null;
    let channel: any = null;
    let cancelled = false;

    (async () => {
      try {
        const tokenRes = await fetch(`/api/ably-token?roomCode=${code}`, { cache: "no-store" });
        if (tokenRes.status === 204 || !tokenRes.ok) return;
        const tokenRequest = await tokenRes.json();
        if (cancelled) return;
        // Dynamic import — see note at top of file.
        const AblyMod = await import("ably");
        if (cancelled) return;
        const Realtime = (AblyMod as any).Realtime;
        client = new Realtime({
          authCallback: (_p: any, cb: any) => cb(null, tokenRequest),
          transports: ["web_socket"],
        });
        channel = client.channels.get(`league:${code}`);
        channel.subscribe(() => { refetch(); });
      } catch {}
    })();

    return () => {
      cancelled = true;
      try { channel && channel.unsubscribe && channel.unsubscribe(); } catch {}
      try { client && client.close && client.close(); } catch {}
    };
  }, [code, refetch]);

  // Tertiary safety net: poll the league doc every 3 seconds. If Firestore's
  // realtime listener silently dropped AND Ably didn't deliver, this catches
  // state changes within 3 seconds. Cheap: one small read per user per 3s.
  useEffect(() => {
    const id = setInterval(() => refetch(), 3000);
    return () => clearInterval(id);
  }, [refetch]);

  // When tab becomes visible again, force a fresh refetch (in case something
  // was missed while the tab was backgrounded on a phone).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-md p-6 pt-12">
        <p>League <span className="font-mono">{code}</span> not found.</p>
        <button onClick={() => router.push("/")} className="mt-4 underline text-blue-400">Go home</button>
      </main>
    );
  }
  if (!league) return <main className="p-6">Loading…</main>;

  if (league.status === "lobby")     return <Lobby league={league} />;
  if (league.status === "active")    return <Auction league={league} />;
  if (league.status === "completed") return <Results league={league} />;
  return null;
}
