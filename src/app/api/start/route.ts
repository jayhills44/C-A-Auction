import { NextResponse } from "next/server";
import { drawNextPlayer, findLeagueByCode } from "@/lib/engine";

export const runtime = "nodejs";

// POST /api/start  { roomCode, commissionerId }
export async function POST(req: Request) {
  try {
    const { roomCode, commissionerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.commissionerId !== commissionerId)
      return NextResponse.json({ error: "Only the commissioner can start" }, { status: 403 });
    if (league.data.status === "active") return NextResponse.json({ ok: true });

    await league.ref.update({ status: "active" });
    await drawNextPlayer(league.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
