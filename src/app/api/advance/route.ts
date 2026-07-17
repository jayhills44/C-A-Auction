import { NextResponse } from "next/server";
import { finalizeAndDraw, drawNextPlayer, findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/advance  { roomCode, force?, commissionerId? }
// Normal (any client): fires only when timer has expired.
// Force (commissioner):
//   - If no currentPlayer -> draws next player.
//   - If timer expired    -> finalizes current + draws next.
//   - If timer still running -> rejected (would prematurely end an active bid).
export async function POST(req: Request) {
  try {
    const { roomCode, force, commissionerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.status !== "active") return NextResponse.json({ ok: true });
    if (league.data.paused) return NextResponse.json({ error: "Auction is paused" }, { status: 400 });

    const timerExpired =
      league.data.timerEndsAt && new Date(league.data.timerEndsAt) <= new Date();

    if (force) {
      if (league.data.commissionerId !== commissionerId)
        return NextResponse.json({ error: "Only the commissioner can force" }, { status: 403 });
      if (league.data.currentPlayer && !timerExpired)
        return NextResponse.json(
          { error: "A player is currently being auctioned. Wait for timer or pause first." },
          { status: 400 }
        );
      if (!league.data.currentPlayer) {
        await drawNextPlayer(league.id);
      } else {
        await finalizeAndDraw(league.id);
      }
      return NextResponse.json({ ok: true });
    }

    // Non-force normal path
    if (!timerExpired) return NextResponse.json({ ok: true });
    await finalizeAndDraw(league.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
