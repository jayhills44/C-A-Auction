import { NextResponse } from "next/server";
import { finalizeAndDraw, findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/advance  { roomCode, force?, commissionerId? }
// Idempotent normal path: any client can call, only fires after timer expires.
// Commissioner override: `force: true` + matching commissionerId works anytime.
export async function POST(req: Request) {
  try {
    const { roomCode, force, commissionerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.status !== "active") return NextResponse.json({ ok: true });

    const timerExpired =
      league.data.timerEndsAt && new Date(league.data.timerEndsAt) <= new Date();

    if (!timerExpired) {
      if (!force) return NextResponse.json({ ok: true });
      if (league.data.commissionerId !== commissionerId)
        return NextResponse.json({ error: "Only the commissioner can force" }, { status: 403 });
    }

    await finalizeAndDraw(league.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
