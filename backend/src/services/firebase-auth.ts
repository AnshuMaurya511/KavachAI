import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export class FirebaseAuthSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseAuthSetupError";
  }
}

async function firebaseAdminApp() {
  const existingApp = getApps().find(app => app.name === "recoverx-auth");
  if (existingApp) return existingApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountFile = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_FILE;
  let credential;
  let serviceAccountProjectId: string | undefined;

  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
      credential = cert(serviceAccount);
      serviceAccountProjectId = serviceAccount.projectId;
    } catch {
      throw new FirebaseAuthSetupError("Firebase service-account JSON is invalid. Update FIREBASE_SERVICE_ACCOUNT_JSON.");
    }
  } else if (serviceAccountFile) {
    try {
      const filePath = path.isAbsolute(serviceAccountFile)
        ? serviceAccountFile
        : path.resolve(process.cwd(), serviceAccountFile);
      const serviceAccount = JSON.parse(await readFile(filePath, "utf8")) as ServiceAccount;
      credential = cert(serviceAccount);
      serviceAccountProjectId = serviceAccount.projectId;
    } catch {
      throw new FirebaseAuthSetupError("Firebase service-account key file could not be loaded. Check FIREBASE_SERVICE_ACCOUNT_KEY_FILE.");
    }
  } else if (process.env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS === "true") {
    credential = applicationDefault();
  } else {
    throw new FirebaseAuthSetupError("Firebase Authentication is not configured on the server.");
  }

  const effectiveProjectId = projectId || serviceAccountProjectId;
  if (!effectiveProjectId) {
    throw new FirebaseAuthSetupError("Set FIREBASE_PROJECT_ID or provide a Firebase service account with a project ID.");
  }
  if (projectId && serviceAccountProjectId && projectId !== serviceAccountProjectId) {
    throw new FirebaseAuthSetupError("FIREBASE_PROJECT_ID does not match the configured Firebase service account.");
  }

  return initializeApp({
    credential,
    projectId: effectiveProjectId
  }, "recoverx-auth");
}

export async function verifyFirebaseIdToken(idToken: string) {
  const app = await firebaseAdminApp();
  return getAuth(app).verifyIdToken(idToken);
}
