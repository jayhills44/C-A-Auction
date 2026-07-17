import { NextResponse } from "next/server";
import { schedulePause, findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/start  { roomCode, commissionerId }
// Sets status=active and enters the PAUSE phase so the first player gets the
// "NEXT PLAYER UP" grand-entry treatment like every subsequent player.
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can start" }, { status: 403 });
    if (league.data.status === "active") return NextResponse.json({ ok: true });

    await league.ref.update({ status: "active" });
    await schedulePause(league.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
