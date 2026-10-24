# RecoverX API

Node.js + Express + TypeScript REST API with PostgreSQL/Prisma, HTTP-only session cookie auth, and evidence storage. Google Drive is used when service-account credentials are configured; otherwise development files are stored privately in `backend/uploads`.

## Requirements
- Node.js 20+
- PostgreSQL 14+
- Google Cloud service account + Drive API enabled (optional for local development)

## Setup
```bash
cp .env.example .env
# Set DATABASE_URL, DIRECT_URL and a random JWT_SECRET (32+ characters) in .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```
API health: `GET http://localhost:4000/api/health`

When starting the backend from `backend`, its environment loader reads `backend/.env` first and then fills missing values from the project root `.env`. Existing backend values take precedence.

For Neon/serverless deployment, use the pooled URL for `DATABASE_URL` and the direct/unpooled URL for `DIRECT_URL`.

## Google Drive setup
1. Enable Google Drive API in a Google Cloud project.
2. Create a service account and grant it access to a dedicated private folder or Shared Drive.
3. Preferred for local development: place the downloaded key at `backend/secrets/google-service-account.json` and set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./secrets/google-service-account.json`. The `secrets/` directory is git-ignored. Never commit or share the key.
4. Set `GOOGLE_DRIVE_FOLDER_ID` to the private destination folder ID. The service account must be explicitly shared on that folder as Editor.
5. Restart the API. `GET /api/health` reports the configured storage provider. After signing in as an admin, call `GET /api/admin/storage/health` to verify that the service account can access the configured folder before uploading real evidence. `GOOGLE_SERVICE_ACCOUNT_JSON` remains supported for a hosting secret store, but do not place raw credentials in source control.
Keep the destination private; the API does not make uploaded evidence public.

## Main endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/cases`, `GET/PATCH/DELETE /api/cases/:id`
- `GET/POST /api/cases/:id/timeline`
- `GET/POST /api/cases/:id/evidence`
- `GET/DELETE /api/evidence/:id`, `GET /api/evidence/:id/download`
- `GET/POST /api/tasks`, `PATCH /api/tasks/:id`
- `POST /api/support/tickets`

## Upload policy
- JPG/JPEG/PNG: max 500 KiB (512,000 bytes) per file.
- PDF: max 2 MiB (2,097,152 bytes) per file.
- Uploads are validated by detected file signature and declared MIME type. Only case owners can access, download, or delete evidence.
- Upload API expects `multipart/form-data` with one or more `files` fields.

## Important
Local storage is for development only. For production, use HTTPS, a strong secret manager, a dedicated Google Workspace/Shared Drive policy, backups, monitoring, malware scanning, retention controls, and privacy/legal review. Review the Google Drive account's permissions and data residency needs before storing sensitive evidence.
