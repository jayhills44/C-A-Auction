// Server-side auction engine. Uses the Firebase Admin SDK.
// Auction lifecycle for a single player:
//   1. Pause phase   (5s):  currentPlayer=null,  nextPlayerAt in future
//   2. Reveal phase  (2s):  currentPlayer=set,   bidStartsAt in future, timerEndsAt=null
//   3. Bidding phase (bidTimerSecs): currentPlayer=set, timerEndsAt in future
//   4. Sold          -> transition back to phase 1
//
// The client watches these timestamps and pings /api/advance at the right times.

import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const PAUSE_BETWEEN_PLAYERS_MS = 5000; // "NEXT PLAYER UP" flash duration
export const REVEAL_DURATION_MS = 2000;       // "READY GO" flash duration

// Enter the PAUSE phase (used at start-of-auction and after a sale).
export async function schedulePause(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);
  await leagueRef.update({
    currentPlayer: null,
    currentBid: 0,
    currentWinner: null,
    timerEndsAt: null,
    nextPlayerAt: new Date(Date.now() + PAUSE_BETWEEN_PLAYERS_MS).toISOString(),
    bidStartsAt: null,
  });
}

// Pick a random AVAILABLE player and enter the REVEAL phase.
// If none remain, mark the league completed.
export async function drawNextPlayer(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);
  const leagueSnap = await leagueRef.get();
  if (!leagueSnap.exists) return;
  const l = leagueSnap.data() as any;
  if (l.currentPlayer) return; // already drawn

  const availSnap = await leagueRef.collection("players").where("status", "==", "available").get();
  if (availSnap.empty) {
    await leagueRef.update({
      status: "completed",
      currentPlayer: null,
      currentBid: 0,
      currentWinner: null,
      timerEndsAt: null,
      nextPlayerAt: null,
      bidStartsAt: null,
    });
    return;
  }

  const docs = availSnap.docs;
  const pick = docs[Math.floor(Math.random() * docs.length)];

  const batch = db.batch();
  batch.update(pick.ref, { status: "current" });
  batch.update(leagueRef, {
    currentPlayer: pick.id,
    currentBid: 0,
    currentWinner: null,
    timerEndsAt: null,
    nextPlayerAt: null,
    bidStartsAt: new Date(Date.now() + REVEAL_DURATION_MS).toISOString(),
  });
  await batch.commit();
}

// Start the bidding timer (REVEAL -> BIDDING).
export async function startBidding(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);
  const snap = await leagueRef.get();
  if (!snap.exists) return;
  const l = snap.data() as any;
  if (!l.currentPlayer) return;
  if (l.timerEndsAt) return; // already bidding

  await leagueRef.update({
    timerEndsAt: new Date(Date.now() + (l.bidTimerSecs || 15) * 1000).toISOString(),
    bidStartsAt: null,
  });
}

// Award current player to leading bidder, deduct budget, enter PAUSE phase.
export async function finalizeAndScheduleNext(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);

  await db.runTransaction(async (tx) => {
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists) return;
    const league = leagueSnap.data() as any;
    if (!league.currentPlayer) return;

    const playerRef = leagueRef.collection("players").doc(league.currentPlayer);

    if (league.currentWinner && league.currentBid > 0) {
      const winnerRef = leagueRef.collection("teams").doc(league.currentWinner);
      const winnerSnap = await tx.get(winnerRef);
      if (winnerSnap.exists) {
        const cur = (winnerSnap.data() as any).budgetLeft || 0;
        tx.update(winnerRef, { budgetLeft: Math.max(0, cur - league.currentBid) });
      }
      tx.update(playerRef, {
        status: "sold",
        soldTo: league.currentWinner,
        soldPrice: league.currentBid,
      });
    } else {
      tx.update(playerRef, {
        status: "sold",
        soldTo: null,
        soldPrice: 0,
      });
    }
    tx.update(leagueRef, {
      currentPlayer: null,
      currentBid: 0,
      currentWinner: null,
      timerEndsAt: null,
      nextPlayerAt: new Date(Date.now() + PAUSE_BETWEEN_PLAYERS_MS).toISOString(),
      bidStartsAt: null,
    });
  });
}

// Try to find a league by its 6-character room code.
export async function findLeagueByCode(roomCode: string) {
  const db = adminDb();
  const q = await db.collection("leagues").where("roomCode", "==", roomCode).limit(1).get();
  if (q.empty) return null;
  const d = q.docs[0];
  return { id: d.id, ref: d.ref, data: d.data() as any };
}

export { FieldValue };
