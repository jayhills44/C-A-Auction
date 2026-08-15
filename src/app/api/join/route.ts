import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { findLeagueByCode } from "@/lib/engine";
import { generateToken } from "@/lib/utils";

export const runtime = "nodejs";

// POST /api/join  { roomCode, teamName }
// Also supports "rejoin" — if the auction has already started, a request with
// a matching team name returns that team's existing credentials so the user
// can recover from a localStorage wipe (accidental incognito, cleared storage,
// switched devices, etc). This IS impersonation-vulnerable — anyone with the
// room code + a team name could take over — but for a private friend league
// the recovery benefit outweighs the risk.
export async function POST(req: Request) {
  try {
    const { roomCode, teamName } = await req.json();
    const code = String(roomCode || "").trim().toUpperCase();
    const tn = String(teamName || "").trim();
    if (!code || !tn) return NextResponse.json({ error: "Missing room code or team name" }, { status: 400 });

    const league = await findLeagueByCode(code);
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const db = adminDb();
    const teamsCol = league.ref.collection("teams");

    // Transaction: check for existing name (rejoin) OR count+add atomically.
    // Without a transaction, two simultaneous joiners at 11 teams could both
    // slip through the "< 12" check and produce a 13-team league.
    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.get(teamsCol);
      const nameMatch = existing.docs.find(
        (d) => (d.data() as any).name.toLowerCase() === tn.toLowerCase()
      );

      // If a team with this name already exists, treat this as a rejoin.
      if (nameMatch) {
        return {
          rejoin: true,
          teamId: nameMatch.id,
          token: (nameMatch.data() as any).token,
        };
      }

      // Otherwise it's a fresh join — validate lobby state and capacity.
      if (league.data.status !== "lobby")
        return { err: "League has already started. If you had a team, rejoin with the same team name." };
      if (existing.size >= 12) return { err: "League is full (12 teams)" };

      const token = generateToken();
      const ref = teamsCol.doc();
      tx.set(ref, {
        name: tn,
        token,
        budgetLeft: league.data.budget || 200,
        createdAt: new Date().toISOString(),
      });
      return { rejoin: false, teamId: ref.id, token };
    });

    if ("err" in result) return NextResponse.json({ error: result.err }, { status: 400 });
    return NextResponse.json({
      teamId: result.teamId,
      token: result.token,
      leagueId: league.id,
      roomCode: league.data.roomCode,
      rejoined: result.rejoin,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
