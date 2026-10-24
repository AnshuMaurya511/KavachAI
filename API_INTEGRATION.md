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

## SOS fraud alert API
Before using SOS routes, review `backend/prisma/migrations/20261024010000_sos_alerts/migration.sql`, then apply it from `backend` with `npm run db:deploy`. Do not reset the database. The endpoints require the existing HTTP-only session cookie; citizen ownership and staff roles are validated server-side.

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/sos/alerts` | Citizen; JSON alert with an `Idempotency-Key` header |
| `GET` | `/api/sos/alerts` | Citizen; own alerts |
| `GET` | `/api/sos/alerts/:id` | Citizen; own alert status/history |
| `GET` | `/api/sos/admin/alerts` | `ADMIN` / `INVESTIGATOR`; recent alert list and aggregate counts |
| `GET` | `/api/sos/admin/alerts/:id` | `ADMIN` / `INVESTIGATOR`; alert detail and audit history |
| `POST` | `/api/sos/admin/alerts/:id/acknowledge` | `ADMIN` / `INVESTIGATOR`; acknowledge a new alert |
| `PATCH` | `/api/sos/admin/alerts/:id/status` | `ADMIN` / `INVESTIGATOR`; set `New`, `Acknowledged`, `In Progress`, or `Resolved` |

The request contains `category`, ISO-8601 `incidentAt`, optional numeric `amount`, `description`, and `contactPhone`. The server assigns the citizen ID from the authenticated session; client-supplied IDs are rejected. Reusing an idempotency key with the same payload returns the existing alert; reusing it with a different payload returns `409 Conflict`. Creation is rate limited and the alert plus initial history record are committed in one transaction.

On a persistent Node.js backend, authenticated admin Socket.IO clients receive `sos:new-alert` only after the database transaction commits. Socket connections use the same session cookie and only `ADMIN` / `INVESTIGATOR` users join the authorized notification room. The dashboard fetches stored alerts on initial load and reconnect; duplicate event IDs do not replay the buzzer. Audio requires an explicit user gesture and is not the sole alert channel. Socket.IO is not available through the existing Vercel serverless export; deploy the backend to a persistent Node.js service to use live events.
