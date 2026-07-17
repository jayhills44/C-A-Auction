import { NextResponse } from "next/server";
import { findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/pause  { roomCode, commissionerId, pause: boolean }
// Freezes/thaws whichever phase timestamps are currently in effect.
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId, pause } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can pause" }, { status: 403 });

    if (pause) {
      if (league.data.paused) return NextResponse.json({ ok: true });
      await league.ref.update({
        paused: true,
        pausedAt: new Date().toISOString(),
      });
    } else {
      if (!league.data.paused) return NextResponse.json({ ok: true });
      const updates: any = { paused: false, pausedAt: null };
      if (league.data.pausedAt) {
        const pausedMs = Date.now() - new Date(league.data.pausedAt).getTime();
        const shift = (iso: string | null) =>
          iso ? new Date(new Date(iso).getTime() + pausedMs).toISOString() : null;
        if (league.data.timerEndsAt) updates.timerEndsAt = shift(league.data.timerEndsAt);
        if (league.data.bidStartsAt) updates.bidStartsAt = shift(league.data.bidStartsAt);
        if (league.data.nextPlayerAt) updates.nextPlayerAt = shift(league.data.nextPlayerAt);
      }
      await league.ref.update(updates);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
