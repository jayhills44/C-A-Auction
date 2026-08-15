import { NextResponse } from "next/server";
import { ablyServer, leagueChannelName } from "@/lib/ably";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ably-token?roomCode=XXXXXX
// Mints a short-lived Ably token scoped to a specific league's channel.
// The full ABLY_API_KEY never leaves the server.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const roomCode = String(url.searchParams.get("roomCode") || "").toUpperCase();
    if (!roomCode) return NextResponse.json({ error: "roomCode required" }, { status: 400 });

    const client = ablyServer();
    if (!client) {
      // Ably not configured — return 204 so clients know to skip the layer.
      return new Response(null, { status: 204 });
    }

    const channel = leagueChannelName(roomCode);
    const tokenRequest = await client.auth.createTokenRequest({
      capability: { [channel]: ["subscribe", "presence", "history"] },
      // Client identity isn't strictly needed for our fanout use; keep anonymous.
      ttl: 60 * 60 * 1000, // 1 hour
    });
    return NextResponse.json(tokenRequest, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
