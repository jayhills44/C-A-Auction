// Misc shared helpers.

export function generateRoomCode() {
  // 6-character uppercase code, e.g. "K7H2QP"
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateToken() {
  // 32 char random hex
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function positionColor(pos: string): string {
  switch (pos.toUpperCase()) {
    case "QB":  return "bg-red-600 text-white";
    case "RB":  return "bg-green-600 text-white";
    case "WR":  return "bg-blue-600 text-white";
    case "TE":  return "bg-orange-500 text-white";
    case "K":   return "bg-purple-600 text-white";
    case "DEF":
    case "D/ST":
    case "DST": return "bg-slate-600 text-white";
    default:    return "bg-zinc-500 text-white";
  }
}

export function normalizePosition(pos: string): string {
  const p = pos.trim().toUpperCase();
  if (p === "D/ST" || p === "DST" || p === "DEFENSE") return "DEF";
  return p;
}
