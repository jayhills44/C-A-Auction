// Server-side auction engine. Uses the Firebase Admin SDK.
import { adminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// Pick the next random AVAILABLE player and mark it as the current one.
// If none remain, mark the league completed.
export async function drawNextPlayer(leagueId: string) {
  const db = adminDb();
  const leagueRef = db.collection("leagues").doc(leagueId);
  const leagueSnap = await leagueRef.get();
  if (!leagueSnap.exists) return;
  const league = leagueSnap.data() as any;

  const availSnap = await leagueRef.collection("players").where("status", "==", "available").get();
  if (availSnap.empty) {
    await leagueRef.update({
      status: "completed",
      currentPlayer: null,
      currentBid: 0,
      currentWinner: null,
      timerEndsAt: null,
    });
    return;
  }

  const docs = availSnap.docs;
  const pick = docs[Math.floor(Math.random() * docs.length)];

  const endsAt = new Date(Date.now() + (league.bidTimerSecs || 15) * 1000).toISOString();
  const batch = db.batch();
  batch.update(pick.ref, { status: "current" });
  batch.update(leagueRef, {
    currentPlayer: pick.id,
    currentBid: 0,
    currentWinner: null,
    timerEndsAt: endsAt,
  });
  await batch.commit();
}

// Award current player to leading bidder, deduct their budget, draw next.
export async function finalizeAndDraw(leagueId: string) {
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
    // Clear current-auction fields; next player will be drawn outside the tx.
    tx.update(leagueRef, {
      currentPlayer: null,
      currentBid: 0,
      currentWinner: null,
      timerEndsAt: null,
    });
  });

  await drawNextPlayer(leagueId);
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
