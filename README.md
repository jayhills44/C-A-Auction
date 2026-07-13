# Fantasy Football Live Auction

A real-time, mobile-first auction app for 12-team fantasy football leagues. Built with Next.js + Supabase. Free to host.

**👉 To deploy and run, see [SETUP.md](./SETUP.md).**

## What it does
- 12 teams join a room with a 6-character code + their team name
- Random-draw auction: the system picks the next player; everyone bids
- Live bids, timers, budgets, and rosters sync to every device in real time
- $200 budget per team, configurable bid timer
- Final results page with CSV export

## Tech
- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Supabase (Postgres + Realtime)
- Deployed on Vercel free tier

## Local development (optional)
If you want to run it on your own computer first:
```bash
cd auction-app
npm install
cp .env.local.example .env.local   # fill in your Supabase keys
npm run dev
```
Open http://localhost:3000

## Files
- `src/app/page.tsx` — join page
- `src/app/create/page.tsx` — commissioner setup (CSV upload)
- `src/app/league/[code]/` — lobby, live auction, results
- `src/app/api/` — server routes (create league, join, start, bid, advance)
- `src/lib/engine.ts` — server-side auction logic (random draw + finalize)
- `supabase/schema.sql` — database schema (run once in Supabase SQL editor)
- `sample-players.csv` — 75-player test list
