# Google and mobile sign-in

RecoverX keeps email/password sign-in and adds Firebase Authentication for citizen Google sign-in and SMS-verified phone sign-in. Admin and investigator accounts must continue to use the existing staff password flow. Firebase ID tokens are verified by the backend before it issues the existing HTTP-only RecoverX session cookie.

## Firebase project setup

1. Create or select a Firebase project. Add a Web App and enable **Google** and **Phone** under Authentication → Sign-in method.
2. Add the development host (`localhost` and `127.0.0.1`) and the production frontend host under Authentication → Settings → Authorized domains.
3. Set the phone SMS region policy to the countries you intend to support. Firebase phone verification uses reCAPTCHA and may require billing or have SMS quotas depending on your project and region. Use Firebase test phone numbers for development.
4. Copy the Firebase Web App's API key, Auth domain, project ID and App ID into the frontend environment:

   ```dotenv
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_APP_ID=...
   ```

   These web-app values are public client configuration; restrict the API key to the required Firebase APIs and your application domains. Do not put private service-account credentials in frontend variables.

5. Create a server service account with Firebase Authentication verification permissions. Store its JSON key outside source control, for example at `backend/secrets/firebase-service-account.json`, and set:

   ```dotenv
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_SERVICE_ACCOUNT_KEY_FILE=./secrets/firebase-service-account.json
   ```

   Alternatively, provide `FIREBASE_SERVICE_ACCOUNT_JSON` through the server's secret manager, or use Google Cloud Application Default Credentials with `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true`. Never commit or share service-account keys.

6. Configure a valid PostgreSQL `DATABASE_URL` and `DIRECT_URL` in `backend/.env` (Prisma CLI does not use the backend runtime's root `.env` fallback), then apply the new migration from `backend`:

   ```powershell
   npx prisma migrate deploy
   npx prisma generate
   ```

7. Restart the frontend and backend after changing environment variables. The frontend reads its `VITE_` settings at startup/build time.

## Account behavior

- Google sign-in requires a verified Google email. A verified Google account with the same email as an existing citizen account can attach to that citizen account; staff accounts are never linked through Firebase.
- Phone sign-in requires E.164 format (for example `+919876543210`), a valid SMS code, and a name for a new account. A phone-only account has no email or password until one is added through a future account-linking flow.
- A verified phone number or Firebase UID already belonging to a different account is rejected; accounts are not merged based only on a phone number or unverified email.
- Email/password login remains available. Existing passwords and accounts are preserved by the migration.
- Admin and investigator accounts continue to use the existing authorized staff login and cannot create a staff session via Google or phone sign-in.
- If Firebase is not configured, Google and phone options are explicitly marked as needing setup; email/password sign-in continues to work. The API returns a configuration error instead of accepting an unverified token.

## Troubleshooting

- `Firebase Authentication is not configured on the server`: set `FIREBASE_PROJECT_ID` and one supported service-account credential option.
- `Google must provide a verified email address`: enable Google sign-in in Firebase and use a Google account with a verified email.
- `This website domain is not allowed`: add the exact frontend hostname in Firebase Authentication's Authorized domains.
- SMS / reCAPTCHA failures: check the phone provider toggle, allowed SMS regions, quotas, billing requirements, browser network access, and authorized domains.
- If `DIRECT_URL` is invalid, Prisma migration commands will fail even if normal API requests can connect through the pooled `DATABASE_URL`. Set it to the valid direct/unpooled PostgreSQL URL from your provider.
