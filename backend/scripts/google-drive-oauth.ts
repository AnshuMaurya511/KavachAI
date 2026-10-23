import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in backend/.env first.");
}

const redirectUri = "http://127.0.0.1:53682/oauth2callback";
const state = randomBytes(32).toString("hex");
const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authorizationUrl = auth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive"]
});
const url = new URL(authorizationUrl);
url.searchParams.set("state", state);

const server = createServer(async (request, response) => {
  const callbackUrl = new URL(request.url ?? "/", redirectUri);
  if (callbackUrl.pathname !== "/oauth2callback") {
    response.writeHead(404).end("Not found.");
    return;
  }
  if (callbackUrl.searchParams.get("state") !== state) {
    response.writeHead(400).end("OAuth state did not match. Close this page and try again.");
    return;
  }
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    response.writeHead(400).end("Google did not return an authorization code. Check the consent screen and try again.");
    return;
  }

  try {
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) {
      response.writeHead(400).end("Google did not issue a refresh token. Revoke the app's Google account access and run this setup again.");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end("<h2>Google Drive authorization complete</h2><p>Return to the backend terminal and copy the refresh token into backend/.env. You can close this page.</p>");
    console.log("\nAdd this value to backend/.env as GOOGLE_OAUTH_REFRESH_TOKEN:\n");
    console.log(tokens.refresh_token);
  } catch {
    response.writeHead(500).end("Google Drive authorization failed. Check the OAuth client and redirect URI, then try again.");
    console.error("Could not exchange the Google authorization code for a refresh token.");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(53682, "127.0.0.1", () => {
  console.log("Open this URL in a browser and authorize the Google account that owns the evidence folder:\n");
  console.log(url.toString());
});
