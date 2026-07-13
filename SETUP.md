# Setup Guide - Fantasy Football Live Auction (Netlify + Firebase)

We'll walk through this together in chat, one step at a time. This file is just a reference you can come back to if you want to re-deploy in the future.

## What we're doing
- **Firebase (Firestore)** - the live database (real-time bids/timers)
- **Netlify** - the web host (the public URL your league members visit)
- **GitHub** - where your code lives (Netlify pulls from here to deploy)

Total cost: $0. You already have Netlify and Firebase accounts.

## Environment variables you'll need
When we set up Netlify at the end, you'll paste these seven values in:

| Name | Where it comes from |
|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY | Firebase - Web app config |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | Firebase - Web app config |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | Firebase - Web app config |
| NEXT_PUBLIC_FIREBASE_APP_ID | Firebase - Web app config |
| FIREBASE_PROJECT_ID | Firebase - Service account JSON |
| FIREBASE_CLIENT_EMAIL | Firebase - Service account JSON |
| FIREBASE_PRIVATE_KEY | Firebase - Service account JSON |

## High-level order of operations
1. Push the code to GitHub
2. Create a Firebase project + enable Firestore
3. Get the two sets of Firebase credentials (web config + service account)
4. Connect GitHub to Netlify
5. Paste env vars, deploy
6. Test with yourself before draft day

## CSV format
Columns: `Name, Position, Team`. See `sample-players.csv` in this folder for an example.
Positions: QB, RB, WR, TE, K, DEF (color-coded in the UI).
