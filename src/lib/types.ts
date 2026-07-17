// Firestore document shapes. All timestamps are stored as ISO strings on the
// server side for easier JSON round-tripping.

export type LeagueStatus = "lobby" | "active" | "completed";
export type PlayerStatus = "available" | "current" | "sold";

export interface League {
  id: string;
  roomCode: string;
  name: string;
  budget: number;
  bidTimerSecs: number;
  status: LeagueStatus;
  currentPlayer: string | null;
  currentBid: number;
  currentWinner: string | null; // teamId
  timerEndsAt: string | null;   // ISO string
  // Phase timestamps for the "NEXT PLAYER UP → READY GO" grand transition.
  nextPlayerAt: string | null;  // during 5s pause between players (no currentPlayer)
  bidStartsAt: string | null;   // during 2s "READY GO" reveal (currentPlayer set, no bidding yet)
  paused: boolean;
  pausedAt: string | null;      // ISO string when paused (used to freeze timer)
  commissionerId: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  token: string;
  budgetLeft: number;
  createdAt: string;
}

export interface Player {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  status: PlayerStatus;
  soldTo: string | null;
  soldPrice: number | null;
  createdAt: string;
}

export interface Bid {
  id: string;
  playerId: string;
  teamId: string;
  amount: number;
  createdAt: string;
}
