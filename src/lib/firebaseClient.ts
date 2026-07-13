"use client";
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Debug: this shows up in browser console. Safe because NEXT_PUBLIC_ values are public anyway.
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log("[FirebaseDebug] config values embedded in bundle:", {
    hasApiKey: !!config.apiKey,
    apiKeyStart: (config.apiKey || "").slice(0, 10),
    authDomain: config.authDomain,
    projectId: config.projectId,
    appIdStart: (config.appId || "").slice(0, 20),
  });
}

let app: FirebaseApp;
let db: Firestore;

export function firebaseApp() {
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}
export function firestore() {
  if (!db) db = getFirestore(firebaseApp());
  return db;
}
