import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/bid  { roomCode, teamId, token, amount }
export async function POST(req: Request) {
  try {
    const { roomCode, teamId, token, amount } = await req.json();
    const bid = Number(amount);
    if (!Number.isInteger(bid) || bid < 1)
      return NextResponse.json({ error: "Bid must be a whole number >= 1" }, { status: 400 });

    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const db = adminDb();
    const leagueRef = league.ref;
    const bidsCol = leagueRef.collection("bids");

    const result = await db.runTransaction(async (tx) => {
      const lSnap = await tx.get(leagueRef);
      if (!lSnap.exists) return { err: "League missing" };
      const l = lSnap.data() as any;
      if (l.status !== "active") return { err: "Auction is not active" };
      if (!l.currentPlayer) return { err: "No player up for bid" };
      if (l.timerEndsAt && new Date(l.timerEndsAt) <= new Date())
        return { err: "Bidding has closed for this player" };
      if (bid <= (l.currentBid || 0))
        return { err: `Bid must be higher than current ($${l.currentBid || 0})` };

      const teamRef = leagueRef.collection("teams").doc(teamId);
      const tSnap = await tx.get(teamRef);
      if (!tSnap.exists) return { err: "Team not found" };
      const t = tSnap.data() as any;
      if (t.token !== token) return { err: "Invalid team credentials" };
      if (bid > t.budgetLeft)
        return { err: `Bid exceeds your remaining budget ($${t.budgetLeft})` };

      const newEnds = new Date(Date.now() + (l.bidTimerSecs || 15) * 1000).toISOString();
      tx.update(leagueRef, {
        currentBid: bid,
        currentWinner: teamId,
        timerEndsAt: newEnds,
      });
      const bidRef = bidsCol.doc();
      tx.set(bidRef, {
        playerId: l.currentPlayer,
        teamId,
        amount: bid,
        createdAt: new Date().toISOString(),
      });
      return { ok: true };
    });

    if ("err" in result) return NextResponse.json({ error: result.err }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
