import { NextResponse } from "next/server";
import { finalizeAndDraw, findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/advance  { roomCode }
// Idempotent: called by any client when their local timer hits 0.
export async function POST(req: Request) {
  try {
    const { roomCode } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.status !== "active") return NextResponse.json({ ok: true });
    if (!league.data.timerEndsAt || new Date(league.data.timerEndsAt) > new Date())
      return NextResponse.json({ ok: true });

    await finalizeAndDraw(league.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
