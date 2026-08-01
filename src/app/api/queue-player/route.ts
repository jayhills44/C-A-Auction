import { NextResponse } from "next/server";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/queue-player  { roomCode, commissionerId, playerId | null }
// Commissioner-only: set the next player that drawNextPlayer will pick.
// Pass playerId = null to clear the override.
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId, playerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can queue" }, { status: 403 });

    if (playerId === null || playerId === undefined || playerId === "") {
      await league.ref.update({ queuedPlayerId: null });
      return NextResponse.json({ ok: true });
    }

    // Validate the player exists and is available.
    const playerSnap = await league.ref.collection("players").doc(String(playerId)).get();
    if (!playerSnap.exists) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    const p = playerSnap.data() as any;
    if (p.status !== "available")
      return NextResponse.json({ error: `Player is not available (status: ${p.status})` }, { status: 400 });

    await league.ref.update({ queuedPlayerId: String(playerId) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
