import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GithubAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Initialize Firebase only if config is present (to avoid crashing when env vars are missing)
const app = getApps().length > 0 ? getApp() : (firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null);
const auth = app ? getAuth(app) : null;

export { auth, GithubAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged };
