# RecoverX API integration

The repository now includes an Express + TypeScript backend under `/backend` and a typed frontend API client at `src/lib/api.ts`.

## Connected UI flows
- Register/login/logout use backend endpoints and an HTTP-only session cookie.
- My Cases loads authenticated case data from PostgreSQL.
- Create New Case submits the case to the API and uploads selected evidence after case creation.
- Case detail requests its case record from the API.
- Evidence Vault selects a user's case, lists evidence from the API, uploads via `multipart/form-data`, and supports authenticated downloads/deletion.
- Tasks & Reminders loads, creates, and updates tasks through the API.

## Run locally
Terminal 1:
```bash
docker compose up -d postgres
cd backend
cp .env.example .env
# Configure PostgreSQL DATABASE_URL and JWT_SECRET
npm install
npm run db:generate
npm run db:migrate
npm run dev
```
Terminal 2, from repository root:
```bash
cp .env.example .env
npm install
npm run dev
```

Frontend API base defaults to `http://localhost:4000/api`; override with `VITE_API_BASE_URL` in the frontend `.env`.

Google Drive is optional for local development. Set `GOOGLE_DRIVE_FOLDER_ID` in `backend/.env` to either a folder ID or its Google Drive URL. For a personal Gmail/My Drive folder, configure a Google OAuth desktop client with the Drive API enabled, then follow these steps from the `backend` directory:

```text
GOOGLE_OAUTH_CLIENT_ID=your-desktop-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-desktop-oauth-client-secret
```

Run `npm run drive:oauth`, open its URL, sign in to the Google account that owns the folder, and consent. Copy the refresh token printed in the backend terminal into `GOOGLE_OAUTH_REFRESH_TOKEN` in `backend/.env`, then restart the backend. Keep the OAuth client secret and refresh token private. Apps left in Google OAuth "Testing" mode may have refresh tokens that expire after seven days; configure the OAuth consent screen appropriately for long-term use.

Alternatively, service accounts can upload only to a folder in a Google Shared Drive: add the service account email as a Content manager and ensure the Shared Drive has storage available. Without Drive credentials, uploads use private local development storage.

Evidence uploaded before Google Drive was configured remains in local development storage and is not moved automatically. If a local copy is missing, ask the complainant to upload the original file again.

Upload limits are enforced in both the UI and server: JPG/JPEG/PNG up to 500 KiB; PDF up to 2 MiB.
