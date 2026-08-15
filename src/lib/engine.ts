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

// Pick the next player and enter the REVEAL phase. If the league has a
// queuedPlayerId set (commissioner override), use that instead of random.
//
// CRITICAL: this runs inside a Firestore transaction because ALL connected
// clients typically fire /api/advance simultaneously at the end of the pause
// phase. Without a transaction, two calls would each pick a different random
// player, each mark theirs "current", but only one wins the league's
// currentPlayer field — leaving the other player orphaned. With a transaction,
// Firestore serializes concurrent writes and one call aborts+retries, seeing
// currentPlayer is set and no-oping.
//
// We also heal any pre-existing orphans by resetting stray "current" players
// back to "available" on every draw.
export async function drawNextPlayer(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);

  await db.runTransaction(async (tx) => {
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists) return;
    const l = leagueSnap.data() as any;
    if (l.currentPlayer) return; // another draw already committed

    const availSnap = await tx.get(
      leagueRef.collection("players").where("status", "==", "available")
    );
    const orphanSnap = await tx.get(
      leagueRef.collection("players").where("status", "==", "current")
    );

    if (availSnap.empty) {
      // No players left — heal orphans and mark league complete.
      for (const doc of orphanSnap.docs) {
        tx.update(doc.ref, { status: "available" });
      }
      tx.update(leagueRef, {
        status: "completed",
        currentPlayer: null,
        currentBid: 0,
        currentWinner: null,
        timerEndsAt: null,
        nextPlayerAt: null,
        bidStartsAt: null,
        queuedPlayerId: null,
      });
      return;
    }

    // Commissioner queued a specific player as next? Use it, if still available.
    let pick: null | { id: string; ref: FirebaseFirestore.DocumentReference } = null;
    if (l.queuedPlayerId) {
      const queued = availSnap.docs.find((d) => d.id === l.queuedPlayerId);
      if (queued) pick = { id: queued.id, ref: queued.ref };
    }
    if (!pick) {
      const docs = availSnap.docs;
      const random = docs[Math.floor(Math.random() * docs.length)];
      pick = { id: random.id, ref: random.ref };
    }

    // Heal any orphaned "current" players (from prior race conditions).
    for (const doc of orphanSnap.docs) {
      if (doc.id !== pick.id) {
        tx.update(doc.ref, { status: "available" });
      }
    }

    tx.update(pick.ref, { status: "current" });
    tx.update(leagueRef, {
      currentPlayer: pick.id,
      currentBid: 0,
      currentWinner: null,
      timerEndsAt: null,
      nextPlayerAt: null,
      bidStartsAt: new Date(Date.now() + REVEAL_DURATION_MS).toISOString(),
      queuedPlayerId: null,
    });
  });
}

// Start the bidding timer (REVEAL -> BIDDING). Uses a transaction so
// simultaneous /api/advance calls from multiple clients don't each set a
// timerEndsAt with slightly different times.
export async function startBidding(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(leagueRef);
    if (!snap.exists) return;
    const l = snap.data() as any;
    if (!l.currentPlayer) return;
    if (l.timerEndsAt) return; // already bidding
    tx.update(leagueRef, {
      timerEndsAt: new Date(Date.now() + (l.bidTimerSecs || 15) * 1000).toISOString(),
      bidStartsAt: null,
    });
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
