import { NextResponse } from "next/server";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/pause  { roomCode, commissionerId, pause: boolean }
// pause=true  -> freeze the auction. Store pausedAt so we can restore later.
// pause=false -> resume. Shift timerEndsAt forward by (now - pausedAt).
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId, pause } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can pause" }, { status: 403 });

    if (pause) {
      if (league.data.paused) return NextResponse.json({ ok: true }); // idempotent
      await league.ref.update({
        paused: true,
        pausedAt: new Date().toISOString(),
      });
    } else {
      if (!league.data.paused) return NextResponse.json({ ok: true });
      // Compute how long we were paused; add it to timerEndsAt so remaining time is preserved.
      let updates: any = { paused: false, pausedAt: null };
      if (league.data.pausedAt && league.data.timerEndsAt) {
        const pausedMs = Date.now() - new Date(league.data.pausedAt).getTime();
        const newEnds = new Date(new Date(league.data.timerEndsAt).getTime() + pausedMs).toISOString();
        updates.timerEndsAt = newEnds;
      }
      await league.ref.update(updates);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
