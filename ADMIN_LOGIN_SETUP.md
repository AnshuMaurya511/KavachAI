# RecoverX Admin login setup

The login page now has a workspace dropdown: **Victim / Citizen** or **Admin / Government Staff**. This dropdown only selects the intended workspace; it does not grant privileges. The API checks the account role server-side.

## Local setup
1. Copy `backend/.env.example` to `backend/.env` only if you do not already have an `.env`. Preserve your existing Neon `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, and `FRONTEND_ORIGIN`.
2. In `backend/.env`, set `ADMIN_LOGIN_USERNAME=anshu@123`, `ADMIN_EMAIL=admin@recoverx.local`, and `ADMIN_PASSWORD=12345678` for local testing. The username is an alias; the database account uses the internal email.
3. From the `backend` folder run `npm install`, `npx prisma generate`, `npm run db:deploy`, and `npm run admin:seed`.
4. Start backend with `npm run dev`; from the project root in a second terminal start frontend with `npm install` and `npm run dev`.
5. On `/login`, select **Admin / Government Staff**, enter username `anshu@123` and password `12345678`. Citizen registration never creates an admin account.

**Security warning:** `12345678` is a weak, demo-only password. Do not deploy this value or share it. Set a unique strong `ADMIN_PASSWORD` before exposing RecoverX to any network. Keep `.env` out of Git and ZIPs.

## Behaviour changes
- Citizen `/app` redirects to `/app/cases`; the citizen dashboard link and citizen task/reminder controls are removed.
- Citizen case details no longer show task tabs or task creation links.
- Admin case queue polls the authenticated `/api/admin/cases` endpoint every 10 seconds, so new filed cases appear without manual refresh.
- Admin task endpoints are staff-only; citizen APIs do not expose tasks.
- Date and case authorization remain enforced on the backend.
