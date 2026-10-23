# RecoverX role and authentication hardening (first pass)

## What changed
- Private `/app/*` routes now verify the server session via `/api/auth/me`; localStorage identity is no longer treated as authentication.
- Citizen navigation no longer exposes Tasks & Reminders. Internal task UI is under `/admin/tasks`.
- Added `/admin` investigation queue; the API is protected by `requireAuth` and `requireAdmin`.
- Added `User.role` with `CITIZEN` default. Admin roles are not self-assignable during registration.
- Added strict `YYYY-MM-DD` calendar-date validation and rejects future incident dates at the API boundary.

## Apply database migration
From `backend/`, run `npx prisma generate` first, then `npm run db:deploy`, then restart `npm run dev`.

## Promote an authorized staff account
Only after verifying the account identity and authorization, use Prisma Studio or a controlled SQL session to set the specific user's `role` to `ADMIN` or `INVESTIGATOR`. Example SQL (replace with the verified account email):

```sql
UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = 'verified-admin@example.org';
```

Do not expose a public role-change endpoint. Do not grant admin access based only on an email submitted by a registrant.

## Verification checklist
1. Logged out: `/app` redirects to `/login`.
2. Logged out: `GET /api/cases` returns 401.
3. Citizen: `/admin` is blocked and `GET /api/admin/cases` returns 403.
4. Admin/investigator: `/admin` shows all cases and complainant metadata.
5. API rejects impossible dates (e.g. `2026-02-30`) and future incident dates.
6. Check frontend/backend build and run integration tests before deployment.

This is a first security pass, not a compliance certification. Production deployment still needs review of cookie domain/SameSite settings, HTTPS, audit logging, evidence download authorization, backup/retention and operational admin provisioning.

## Admin dashboard and evidence review (updated)

- `/admin` now shows live database-backed report totals, active reports, evidence totals, reports missing evidence, reported amount totals, and recent submissions.
- `/admin/evidence` lists submitted evidence with case reference, complainant identity, MIME type, size, and upload timestamp.
- The `/api/admin/evidence` API requires an authenticated ADMIN or INVESTIGATOR role.
- Evidence downloads are permitted for the owning citizen or authorized staff. Do not share downloaded evidence outside authorized casework.
- The top-right profile name is loaded from `/api/auth/me`; the admin navigation no longer links to the citizen portal.
- Case queue and evidence list refresh every 10 seconds while open. The API/database must be running and have real submissions for records to appear.
