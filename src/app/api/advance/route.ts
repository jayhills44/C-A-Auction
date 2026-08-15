import { NextResponse } from "next/server";
import {
  finalizeAndScheduleNext,
  drawNextPlayer,
  startBidding,
  findLeagueByCode,
} from "@/lib/engine";
import { publishLeagueChange } from "@/lib/ably";

export const runtime = "nodejs";

// POST /api/advance  { roomCode, force?, commissionerId? }
// Inspects current phase and does the next appropriate action.
export async function POST(req: Request) {
  try {
    const { roomCode, force, commissionerId } = await req.json();
    const league = await findLeagueByCode(String(roomCode || "").toUpperCase());
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.data.status !== "active") return NextResponse.json({ ok: true });
    if (league.data.paused) return NextResponse.json({ error: "Auction is paused" }, { status: 400 });

    const now = Date.now();
    const timerExpired = league.data.timerEndsAt && new Date(league.data.timerEndsAt).getTime() <= now;
    const pauseElapsed = league.data.nextPlayerAt && new Date(league.data.nextPlayerAt).getTime() <= now;
    const revealElapsed = league.data.bidStartsAt && new Date(league.data.bidStartsAt).getTime() <= now;

    // Commissioner force: run the appropriate next step regardless of timer (but not mid-bid).
    let didTransition: string | null = null;

    if (force) {
      if (league.data.commissionerId !== commissionerId)
        return NextResponse.json({ error: "Only the commissioner can force" }, { status: 403 });
      // Can't skip an active bid — the timer must have expired or no player up.
      if (league.data.currentPlayer && league.data.timerEndsAt && !timerExpired) {
        return NextResponse.json(
          { error: "A player is currently being auctioned. Wait for timer or pause first." },
          { status: 400 }
        );
      }
      if (league.data.currentPlayer && league.data.timerEndsAt && timerExpired) {
        await finalizeAndScheduleNext(league.id);
        didTransition = "finalize";
      } else if (league.data.currentPlayer && league.data.bidStartsAt) {
        await startBidding(league.id);
        didTransition = "start-bid";
      } else if (!league.data.currentPlayer) {
        await drawNextPlayer(league.id);
        didTransition = "draw-next";
      }
    } else {
      // Non-force normal path: only progresses when a phase timer has elapsed.
      if (timerExpired && league.data.currentPlayer) {
        await finalizeAndScheduleNext(league.id);
        didTransition = "finalize";
      } else if (pauseElapsed && !league.data.currentPlayer) {
        await drawNextPlayer(league.id);
        didTransition = "draw-next";
      } else if (revealElapsed && league.data.currentPlayer && !league.data.timerEndsAt) {
        await startBidding(league.id);
        didTransition = "start-bid";
      }
    }

    if (didTransition) {
      publishLeagueChange(roomCode, "phase", { transition: didTransition });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
