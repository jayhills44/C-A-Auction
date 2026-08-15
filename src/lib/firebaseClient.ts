"use client";
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let db: Firestore;
let dbInitialized = false;

export function firebaseApp() {
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function firestore() {
  if (!dbInitialized) {
    try {
      // IndexedDB-backed cache so page reloads / refreshes serve the last
      // known state instantly and Firestore syncs deltas in the background.
      db = initializeFirestore(firebaseApp(), {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      // Fallback (e.g. private-browsing mode where IndexedDB is unavailable).
      db = getFirestore(firebaseApp());
    }
    dbInitialized = true;
  }
  return db;
}
