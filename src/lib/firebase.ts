import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  getAuth,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  type ConfirmationResult,
  type UserCredential
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
export const firebaseAuth = firebaseConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export async function signInWithGoogle(): Promise<UserCredential> {
  if (!firebaseAuth) throw new Error("Google sign-in is not configured.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(firebaseAuth, provider);
}

export function createPhoneVerifier(container: HTMLElement): RecaptchaVerifier {
  if (!firebaseAuth) throw new Error("Phone sign-in is not configured.");
  return new RecaptchaVerifier(firebaseAuth, container, { size: "invisible" });
}

export async function requestPhoneCode(phoneNumber: string, verifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  if (!firebaseAuth) throw new Error("Phone sign-in is not configured.");
  return signInWithPhoneNumber(firebaseAuth, phoneNumber, verifier);
}

export async function clearFirebaseSession(): Promise<void> {
  if (firebaseAuth) await signOut(firebaseAuth);
}
