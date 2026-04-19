# Firebase Setup and Secret Handoff (MoneyPulse Web)

This document gives you a beginner-friendly, click-by-click setup to create Firebase resources and collect the exact values needed to continue implementation and CI/CD.

## 1) Create/verify Google + Firebase access

1. Sign in to Google with the account you want to own the project.
2. Open Firebase Console: https://console.firebase.google.com/
3. If this is your first time, accept terms and continue.

## 2) Create the Firebase project (region target: us-east4)

1. Click **Create a project**.
2. Project name: `moneypulse-web` (or your preferred name).
3. Keep Google Analytics optional for MVP; you can enable it later.
4. Open project settings and copy **Project ID** (you will need this multiple times).

Record now:
- `FIREBASE_PROJECT_ID`

## 3) Add a Web app and capture public config

1. In Firebase Console, open **Project settings**.
2. Under **Your apps**, click **Web** (`</>`).
3. App nickname: `moneypulse-web-app`.
4. Register app.
5. Firebase shows a JS config object. Copy these fields:

Required values:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`

Note: `NEXT_PUBLIC_*` values are intentionally public client config (not secrets).

## 4) Enable Firebase Authentication (Email/Password)

1. Go to **Build -> Authentication -> Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. Save.
4. (Optional later) Enable MFA if you want stricter login protection.

## 5) Create Firestore database

1. Go to **Build -> Firestore Database -> Create database**.
2. Start in production mode.
3. Select location closest to users (for now use `us-east4` related US region option available in UI).
4. Create.

## 6) Enable Cloud Messaging and generate Web Push key

1. Go to **Project settings -> Cloud Messaging**.
2. Under **Web configuration**, create or use a Web Push certificate key pair.
3. Copy the **VAPID key**.

Record now:
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`

## 7) Create deploy credentials for GitHub Actions

Preferred (best practice): Workload Identity Federation (no long-lived JSON key).
Fast path (acceptable for MVP): Service account JSON key stored in GitHub secrets.

### Fast path steps

1. Open Google Cloud Console IAM service accounts for the same project.
2. Create service account: `github-actions-deploy`.
3. Grant minimum roles needed for Firebase deploy (typically Firebase Admin / Hosting Admin / Cloud Functions deploy roles as required by your workflows).
4. Create JSON key and download it once.

Extract and record:
- `FIREBASE_CLIENT_EMAIL` (from JSON `client_email`)
- `FIREBASE_PRIVATE_KEY` (from JSON `private_key`)

Important formatting for GitHub secret:
- Preserve line breaks in private key. If needed, store with escaped `\n` and unescape at runtime.

## 8) Create sync ingress signing secret (dedicated secret)

For local -> cloud payload signing, use a dedicated secret that is not reused for JWT/auth.

Generate example:

```bash
openssl rand -base64 48
```

Record now:
- `SYNC_SIGNING_SECRET`
- `SYNC_SIGNING_KEY_ID` (example: `sync-key-v1`)

Recommendation:
- Rotate by adding `sync-key-v2` later while still accepting `v1` during cutover.
- Never reuse JWT secret for sync signing.

## 9) Create local alias secret (for deterministic pseudonyms)

Generate example:

```bash
openssl rand -base64 48
```

Record now:
- `ALIAS_SECRET`

## 10) Provide values back for continuation

Please share these values (or confirm they are set in your env/secrets manager):

Web app config:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`

Server/deploy:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `SYNC_SIGNING_KEY_ID`
- `SYNC_SIGNING_SECRET`

Local sync security:
- `ALIAS_SECRET`

## 11) Where each value will be used

- Client runtime (`moneypulse-web/.env`): `NEXT_PUBLIC_FIREBASE_*`
- Functions/server runtime: `FIREBASE_PROJECT_ID`, `SYNC_SIGNING_*`
- GitHub Actions secrets: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Local API sync sender (`MyMoney` API env): `ALIAS_SECRET`, `SYNC_SIGNING_SECRET`, optional `SYNC_SIGNING_KEY_ID`

## 12) Security checklist before first deploy

- Do not commit `.env` files.
- Keep `SYNC_SIGNING_SECRET` and `ALIAS_SECRET` out of client-visible env vars.
- Restrict service account permissions to least privilege.
- Plan key rotation every 90 days.
- Keep Firestore rules deny-by-default and allow only authenticated household members by alias scope.
