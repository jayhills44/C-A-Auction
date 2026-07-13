"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { firestore } from "@/lib/firebaseClient";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import Lobby from "./Lobby";
import Auction from "./Auction";
import Results from "./Results";
import type { League } from "@/lib/types";

export default function LeaguePage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code || "").toUpperCase();
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [notFound, setNotFound] = useState(false);

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
