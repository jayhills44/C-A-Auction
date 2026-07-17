import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/time  ->  { serverTime: <ms since epoch> }
// Used by clients to compute their clock offset so timers display the same
// value across every device regardless of local system clock drift.
export async function GET() {
  return NextResponse.json({ serverTime: Date.now() }, {
    headers: { "cache-control": "no-store" },
  });
}
