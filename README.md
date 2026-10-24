# RecoverX

Responsive React + TypeScript + Vite frontend with an Express + TypeScript API backend.

## Frontend
Requires Node.js 20+.
```bash
npm install
npm run dev
```

## Backend
Requires Node.js 20+ and PostgreSQL.
```bash
docker compose up -d postgres
cd backend
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET in backend/.env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```
Backend health endpoint: `http://localhost:4000/api/health`.

Set the frontend API URL in root `.env` if needed:
`VITE_API_BASE_URL=http://localhost:4000/api`

## Evidence storage
Evidence upload limits are enforced in UI and API:
- JPG/JPEG/PNG: maximum 500 KiB per file
- PDF: maximum 2 MiB per file

Without Google Drive credentials, local development files are stored under `backend/uploads` and served only through authenticated API endpoints. To use Google Drive, configure `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_FOLDER_ID` in `backend/.env`. Keep the destination private.

See `backend/README.md` and `API_INTEGRATION.md` for setup and endpoints. This is a development implementation; complete production security review, malware scanning, backups, retention and deployment hardening before storing real sensitive evidence.

## SOS fraud alerts
Authenticated citizen accounts can open the floating **SOS Fraud Alert** control from the signed-in workspace. The short form asks for the fraud category, approximate incident date/time, optional loss amount, description, and a phone number (the current user profile does not store one). Alerts are recorded for the RecoverX administration team; this does not notify law enforcement or government agencies. The admin workspace includes the **SOS Alerts** section.

The SOS data migration is additive and is not applied automatically. From `backend`, run `npm run db:deploy` after reviewing the migration. Citizen alert creation is idempotent via the `Idempotency-Key` header; new alert records and their initial history entry commit atomically. Admin live notifications use Socket.IO authenticated by the existing HTTP-only RecoverX session cookie. Browser audio is opt-in after a click and alert IDs are deduplicated before playback. The admin dashboard reloads stored alerts on connection/reconnection, so the database remains the source of truth. Socket.IO requires a persistent Node.js backend; serverless deployments such as Vercel do not provide the local Socket.IO listener configured here.

Never enter passwords, PINs, CVV or OTPs in an alert. Use your bank's official channel and the relevant official reporting service for urgent action.
