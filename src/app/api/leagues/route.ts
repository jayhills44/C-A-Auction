import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { generateRoomCode, generateToken, normalizePosition } from "@/lib/utils";

export const runtime = "nodejs";

// POST /api/leagues   { name, bidTimerSecs, players: [{name,position,team}] }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name: string = (body.name || "").trim();
    const bidTimerSecs: number = Math.max(5, Math.min(120, Number(body.bidTimerSecs) || 15));
    const players: { name: string; position: string; team?: string }[] = body.players || [];

    if (!name) return NextResponse.json({ error: "League name required" }, { status: 400 });
    if (!Array.isArray(players) || players.length === 0)
      return NextResponse.json({ error: "Player list is empty" }, { status: 400 });

    const db = adminDb();
    const commissionerId = generateToken();
    const now = new Date().toISOString();

    // Try up to 5 times to find a unique room code.
    let roomCode = "";
    let leagueId = "";
    for (let i = 0; i < 5; i++) {
      const candidate = generateRoomCode();
      const existing = await db.collection("leagues").where("roomCode", "==", candidate).limit(1).get();
      if (!existing.empty) continue;
      const ref = await db.collection("leagues").add({
        roomCode: candidate,
        name,
        budget: 200,
        bidTimerSecs,
        status: "lobby",
        currentPlayer: null,
        currentBid: 0,
        currentWinner: null,
        timerEndsAt: null,
        commissionerId,
        createdAt: now,
      });
      roomCode = candidate;
      leagueId = ref.id;
      break;
    }
    if (!leagueId) return NextResponse.json({ error: "Could not create league" }, { status: 500 });

    // Insert players in batches of 400 (Firestore batch limit is 500).
    const rows = players
      .filter((p) => p.name && p.position)
      .map((p) => ({
        name: p.name.trim(),
        position: normalizePosition(p.position),
        nflTeam: (p.team || "").trim() || null,
        status: "available" as const,
        soldTo: null,
        soldPrice: null,
        createdAt: now,
      }));

    const playersCol = db.collection("leagues").doc(leagueId).collection("players");
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      const slice = rows.slice(i, i + 400);
      for (const row of slice) batch.set(playersCol.doc(), row);
      await batch.commit();
    }

    return NextResponse.json({ roomCode, commissionerId, leagueId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
