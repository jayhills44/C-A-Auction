import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";
import { generateToken } from "@/lib/utils";

export const runtime = "nodejs";

// POST /api/join  { roomCode, teamName }
export async function POST(req: Request) {
  try {
    const { roomCode, teamName } = await req.json();
    const code = String(roomCode || "").trim().toUpperCase();
    const tn = String(teamName || "").trim();
    if (!code || !tn) return NextResponse.json({ error: "Missing room code or team name" }, { status: 400 });

    const league = await findLeagueByCode(code);
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.status !== "lobby")
      return NextResponse.json({ error: "League has already started" }, { status: 400 });

    const db = adminDb();
    const teamsCol = league.ref.collection("teams");
    const existing = await teamsCol.get();
    if (existing.size >= 12)
      return NextResponse.json({ error: "League is full (12 teams)" }, { status: 400 });
    if (existing.docs.some((d) => (d.data() as any).name.toLowerCase() === tn.toLowerCase()))
      return NextResponse.json({ error: "That team name is already taken" }, { status: 400 });

    const token = generateToken();
    const now = new Date().toISOString();
    const ref = await teamsCol.add({
      name: tn,
      token,
      budgetLeft: league.data.budget || 200,
      createdAt: now,
    });

    return NextResponse.json({
      teamId: ref.id,
      token,
      leagueId: league.id,
      roomCode: league.data.roomCode,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
