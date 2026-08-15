// Ably real-time push layer. Sits alongside Firestore: Firestore is the source
// of truth for state, Ably is a low-latency fanout for change notifications.
// When either arrives, the client updates its local view — first-writer-wins.

import Ably from "ably";

// -------- Server side --------
// Singleton so we don't create a new REST client per invocation on Netlify.
let serverClient: Ably.Rest | null = null;
export function ablyServer(): Ably.Rest | null {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null; // Ably not configured — publishing becomes a no-op
  if (!serverClient) serverClient = new Ably.Rest(key);
  return serverClient;
}

// Publish a change notification to the league's channel.
// Non-blocking best-effort — never throws or blocks the caller's response.
export function publishLeagueChange(roomCode: string, type: string, data?: any) {
  const client = ablyServer();
  if (!client) return;
  const channel = client.channels.get(`league:${String(roomCode).toUpperCase()}`);
  channel.publish(type, data ?? {}).catch(() => {
    // Best-effort. Firestore is source of truth so a dropped Ably message
    // will be caught by the Firestore listener within ~500ms anyway.
  });
}

// The channel name convention.
export function leagueChannelName(roomCode: string) {
  return `league:${String(roomCode).toUpperCase()}`;
}
