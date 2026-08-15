import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";
import { publishLeagueChange } from "@/lib/ably";

export const runtime = "nodejs";

// POST /api/undo-sale  { roomCode, commissionerId, playerId }
// Reverses a completed sale: refunds the team, returns the player to the pool,
// and voids all bids for that player. Commissioner only.
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId, playerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can undo" }, { status: 403 });

    const db = adminDb();
    const playerRef = league.ref.collection("players").doc(String(playerId));

    await db.runTransaction(async (tx) => {
      // Reads first
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists) return;
      const p = pSnap.data() as any;
      if (p.status !== "sold") return;

      const bidsSnap = await tx.get(
        league.ref.collection("bids").where("playerId", "==", String(playerId))
      );

      let teamSnap: any = null;
      let teamRef: any = null;
      if (p.soldTo && p.soldPrice) {
        teamRef = league.ref.collection("teams").doc(p.soldTo);
        teamSnap = await tx.get(teamRef);
      }

      // Writes
      if (teamSnap && teamSnap.exists) {
        const cur = (teamSnap.data() as any).budgetLeft || 0;
        tx.update(teamRef, { budgetLeft: cur + p.soldPrice });
      }
      for (const doc of bidsSnap.docs) {
        tx.update(doc.ref, { voided: true });
      }
      tx.update(playerRef, {
        status: "available",
        soldTo: null,
        soldPrice: null,
      });
    });

    publishLeagueChange(roomCode, "undo", { playerId });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
