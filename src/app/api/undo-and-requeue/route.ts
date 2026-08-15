import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/undo-and-requeue  { roomCode, commissionerId, playerId }
// Commissioner-only combined action for dispute resolution:
//   1. Refund the buying team the sold price.
//   2. Return the player to the "available" pool.
//   3. Queue that same player as the next one drawn.
// Runs atomically in a single Firestore transaction so a mid-op crash can't
// leave things half-done.
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId, playerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can undo" }, { status: 403 });

    const db = adminDb();
    const playerRef = league.ref.collection("players").doc(String(playerId));

    const result = await db.runTransaction(async (tx) => {
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists) return { err: "Player not found" };
      const p = pSnap.data() as any;
      if (p.status !== "sold") return { err: `Player is not sold (status: ${p.status})` };

      if (p.soldTo && p.soldPrice) {
        const teamRef = league.ref.collection("teams").doc(p.soldTo);
        const tSnap = await tx.get(teamRef);
        if (tSnap.exists) {
          const cur = (tSnap.data() as any).budgetLeft || 0;
          tx.update(teamRef, { budgetLeft: cur + p.soldPrice });
        }
      }

      // Return player to the pool.
      tx.update(playerRef, {
        status: "available",
        soldTo: null,
        soldPrice: null,
      });

      // Queue this player as the next one drawn.
      tx.update(league.ref, {
        queuedPlayerId: String(playerId),
      });

      return { ok: true, playerName: p.name };
    });

    if ("err" in result) return NextResponse.json({ error: result.err }, { status: 400 });
    return NextResponse.json({ ok: true, playerName: result.playerName });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
