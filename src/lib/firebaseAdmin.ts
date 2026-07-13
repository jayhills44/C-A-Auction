import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let adminApp: App | undefined;

function initAdmin(): App {
  if (getApps().length) return getApps()[0]!;
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  // Netlify/Vercel encode newlines as literal "\n" — restore them.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function adminDb(): Firestore {
  if (!adminApp) adminApp = initAdmin();
  return getFirestore(adminApp);
}
