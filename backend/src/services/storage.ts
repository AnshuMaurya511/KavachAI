import { google } from "googleapis";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const uploadDir = path.resolve(process.cwd(), "uploads");
const credentialFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const inlineCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

export class DriveStorageError extends Error {
  constructor(reason: "shared-drive-required" | "permission-denied" | "storage-quota" | "folder-not-found" | "unknown") {
    const messages = {
      "shared-drive-required": "The configured Google Drive folder is in My Drive. Service accounts cannot upload files there. Create a folder in a Google Shared Drive, add the service account as Content manager, then update GOOGLE_DRIVE_FOLDER_ID and restart the backend.",
      "permission-denied": "Google Drive denied the upload. Add the service account email to the Shared Drive as Content manager and confirm the folder is inside that Shared Drive.",
      "storage-quota": "The Google Shared Drive is out of storage. Free up Shared Drive space or ask its administrator to increase storage.",
      "folder-not-found": "The configured Google Drive folder was not found or is not shared with the service account. Check GOOGLE_DRIVE_FOLDER_ID and the Shared Drive membership.",
      "unknown": "Google Drive could not store the file. Confirm the Shared Drive, service account permissions, and available storage."
    };
    super(messages[reason]);
    this.name = "DriveStorageError";
  }
}

type DriveFailureReason = ConstructorParameters<typeof DriveStorageError>[0];

function driveFailureReason(error: unknown): DriveFailureReason {
  if (!error || typeof error !== "object") return "unknown";
  const failure = error as {
    code?: string | number;
    response?: {
      status?: number;
      data?: { error?: { errors?: Array<{ reason?: string }>; status?: string } };
    };
  };
  const reason = failure.response?.data?.error?.errors?.[0]?.reason
    ?? failure.response?.data?.error?.status;
  if (reason === "storageQuotaExceeded") return "storage-quota";
  if (reason === "insufficientFilePermissions" || reason === "teamDriveMembershipRequired") return "permission-denied";
  if (reason === "notFound" || failure.response?.status === 404) return "folder-not-found";
  if (reason === "teamDriveFileLimitExceeded") return "storage-quota";
  if (failure.response?.status === 403 || failure.code === 403) return "permission-denied";
  return "unknown";
}

function driveFolderId() {
  const configured = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!configured) throw new Error("GOOGLE_DRIVE_FOLDER_ID is required when Google Drive credentials are configured.");
  if (!/^https?:\/\//i.test(configured)) return configured;

  let folderUrl: URL;
  try {
    folderUrl = new URL(configured);
  } catch {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID must be a Google Drive folder ID or folder URL.");
  }
  const folderId = folderUrl.hostname === "drive.google.com"
    ? folderUrl.pathname.match(/^\/(?:drive\/(?:u\/\d+\/)?)?folders\/([\w-]+)/)?.[1]
    : undefined;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID must be a Google Drive folder ID or folder URL.");
  return folderId;
}

async function loadCredentials() {
  if (inlineCredentials) return JSON.parse(inlineCredentials);
  if (credentialFile) {
    // Resolve relative paths from the backend working directory; never log credential contents.
    const resolved = path.resolve(process.cwd(), credentialFile);
    const raw = await fs.readFile(resolved, "utf8");
    return JSON.parse(raw);
  }
  return null;
}

function hasGoogleOAuthCredentials() {
  return Boolean(oauthClientId && oauthClientSecret && oauthRefreshToken);
}

async function driveClient() {
  const hasPartialGoogleOAuthCredentials = Boolean(oauthClientId || oauthClientSecret || oauthRefreshToken)
    && !hasGoogleOAuthCredentials();
  if (hasPartialGoogleOAuthCredentials) {
    throw new Error("Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN together.");
  }
  if (hasGoogleOAuthCredentials()) {
    const auth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    auth.setCredentials({ refresh_token: oauthRefreshToken });
    return google.drive({ version: "v3", auth });
  }

  const credentials = await loadCredentials();
  if (!credentials) return null;
  driveFolderId();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  return google.drive({ version: "v3", auth });
}

export function storageProvider() {
  return (hasGoogleOAuthCredentials() || inlineCredentials || credentialFile) ? "google-drive" : "local-dev";
}

export async function verifyDriveConnection() {
  const drive = await driveClient();
  if (!drive) return { provider: "local-dev" as const, connected: false };
  const folderId = driveFolderId();
  const folder = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType,trashed,driveId", supportsAllDrives: true });
  if (folder.data.trashed || folder.data.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Configured Google Drive destination is not an available folder.");
  }
  if (!folder.data.driveId && !hasGoogleOAuthCredentials()) {
    return { provider: "google-drive" as const, connected: false, reason: "shared-drive-required" as const };
  }
  return { provider: "google-drive" as const, connected: true, folderName: folder.data.name ?? "private folder" };
}

export async function saveEvidence(buffer: Buffer, name: string, mimeType: string) {
  const drive = await driveClient();
  if (drive) {
    let folder;
    try {
      folder = await drive.files.get({
        fileId: driveFolderId(),
        fields: "mimeType,trashed,driveId",
        supportsAllDrives: true
      });
    } catch (error) {
      throw new DriveStorageError(driveFailureReason(error));
    }
    if (folder.data.trashed || folder.data.mimeType !== "application/vnd.google-apps.folder") {
      throw new DriveStorageError("folder-not-found");
    }
    if (!folder.data.driveId && !hasGoogleOAuthCredentials()) {
      throw new DriveStorageError("shared-drive-required");
    }

    let result;
    try {
      result = await drive.files.create({
        requestBody: {
          name: `${Date.now()}-${name.replace(/[^\w.\- ]/g, "_")}`,
          mimeType,
          parents: [driveFolderId()]
        },
        media: { mimeType, body: Readable.from([buffer]) },
        fields: "id,name,mimeType,size",
        supportsAllDrives: true
      });
    } catch (error) {
      throw new DriveStorageError(driveFailureReason(error));
    }
    if (!result.data.id) throw new Error("Google Drive did not return a file ID.");
    return { provider: "google-drive", key: result.data.id };
  }
  await fs.mkdir(uploadDir, { recursive: true });
  const key = `${crypto.randomUUID()}-${name.replace(/[^\w.\-]/g, "_")}`;
  await fs.writeFile(path.join(uploadDir, key), buffer, { flag: "wx", mode: 0o600 });
  return { provider: "local-dev", key };
}

export async function readEvidence(provider: string, key: string) {
  if (provider === "google-drive") {
    const drive = await driveClient();
    if (!drive) throw new Error("Google Drive credentials are not configured.");
    const result = await drive.files.get({ fileId: key, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return Buffer.from(result.data as ArrayBuffer);
  }
  if (provider === "local-dev") return fs.readFile(path.join(uploadDir, path.basename(key)));
  throw new Error("Unsupported evidence storage provider.");
}

export async function deleteEvidence(provider: string, key: string) {
  if (provider === "google-drive") {
    const drive = await driveClient();
    if (!drive) throw new Error("Google Drive credentials are not configured.");
    await drive.files.delete({ fileId: key, supportsAllDrives: true });
    return;
  }
  if (provider === "local-dev") await fs.rm(path.join(uploadDir, path.basename(key)), { force: true });
}
