import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/undo-sale  { roomCode, commissionerId, playerId }
// Reverses a completed sale: refunds the buying team, returns the player to
// the available pool. Commissioner only.
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
      const pSnap = await tx.get(playerRef);
      if (!pSnap.exists) return;
      const p = pSnap.data() as any;
      if (p.status !== "sold") return;

      if (p.soldTo && p.soldPrice) {
        const teamRef = league.ref.collection("teams").doc(p.soldTo);
        const tSnap = await tx.get(teamRef);
        if (tSnap.exists) {
          const cur = (tSnap.data() as any).budgetLeft || 0;
          tx.update(teamRef, { budgetLeft: cur + p.soldPrice });
        }
      }
      tx.update(playerRef, {
        status: "available",
        soldTo: null,
        soldPrice: null,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
