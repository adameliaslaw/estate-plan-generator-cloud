# NJ Estate Plan Generator — Deployment Guide

**Elias Counsel, LLC** | Build Date: March 2026

---

## Prerequisites

- **Node.js 20+** — [https://nodejs.org](https://nodejs.org)
- **Firebase CLI** — `npm install -g firebase-tools`
- **Firebase Project** — Create at [https://console.firebase.google.com](https://console.firebase.google.com)

### Firebase Console Setup

1. **Authentication** → Enable Email/Password and Google sign-in providers
2. **Firestore Database** → Create in `us-east1` region, production mode
3. **Storage** → Enable Cloud Storage
4. **Functions** → Enable Cloud Functions (Blaze plan required)
5. **Identity Platform** → (Optional) Upgrade for MFA/TOTP support

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/adameliaslaw/estate-plan-generator-cloud.git
cd estate-plan-generator

# 2. Configure environment variables
# Copy the example and fill in your Firebase config values
cp .env.example .env

# 3. Set Cloud Functions secrets (REQUIRED)
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set SENDGRID_API_KEY

# 4. Install dependencies and build
npm install
npm run build
cd functions && npm install && cd ..

# 5. Deploy to Firebase
firebase deploy
```

---

## Deployment Targets

```bash
bash scripts/deploy.sh all        # Full deploy (Hosting + Functions + Rules + Storage)
bash scripts/deploy.sh hosting    # Frontend only
bash scripts/deploy.sh functions  # Cloud Functions only
bash scripts/deploy.sh rules      # Firestore + Storage rules only
```

---

## Environment Variables

### Frontend (.env)

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket URL |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_USE_EMULATORS` | `true` for local dev, `false` for production |

### Cloud Functions Secrets

Set via `firebase functions:secrets:set <KEY>`:

| Secret | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | GPT-4.1 — document generation, transcription, compliance checks |
| `SENDGRID_API_KEY` | Yes | Email notifications (7 notification types) |
| `LAWPAY_API_KEY` | Optional | Payment processing integration |
| `LAWPAY_ACCOUNT_ID` | Optional | LawPay account identifier |
| `GOOGLE_CLIENT_ID` | Optional | Google Drive / Calendar sync |
| `GOOGLE_CLIENT_SECRET` | Optional | Google Drive / Calendar sync |

---

## Local Development

```bash
# Terminal 1: Start Firebase Emulators
firebase emulators:start

# Terminal 2: Start Vite dev server
VITE_USE_EMULATORS=true npm run dev

# Terminal 3: Seed test data into emulators
FIRESTORE_EMULATOR_HOST=localhost:8080 npx ts-node scripts/seed-test-data.ts
```

Emulator ports:
- Auth: `localhost:9099`
- Firestore: `localhost:8080`
- Functions: `localhost:5001`
- Storage: `localhost:9199`
- Emulator UI: `localhost:4000`

---

## Testing

```bash
# Run all tests
npx vitest run

# Watch mode (re-runs on file change)
npx vitest

# With coverage report
npx vitest run --coverage

# Run specific test suite
npx vitest run tests/unit/questionnaire-logic.test.ts
npx vitest run tests/e2e/questionnaire-scenarios.test.ts
```

### Test Coverage

| Suite | Tests | Description |
|---|---|---|
| `unit/questionnaire-logic` | 46 | Skip logic, validation, NJ counties, package recommendation |
| `unit/document-templates` | 36 | 10 doc types, NJ statutory citations, notary/witness blocks |
| `unit/security-rules` | 43 | RBAC roles, firm isolation, data validation |
| `unit/ai-service` | 35 | Prompt injection protection, sanitization, AI config |
| `unit/export-functions` | 40 | DRAFT watermark, HTML→DOCX, batch ZIP, approval gate |
| `integration/auth-flow` | 36 | Auth flows, session timeout, route guards |
| `integration/client-dashboard` | 48 | 5-tab dashboard, notes, payments, calendar |
| `e2e/questionnaire-scenarios` | 63 | 4 full NJ scenarios (single/married × children/no-children) |
| `e2e/document-generation` | 63 | Package→document mapping, approval gate, watermarks |
| `e2e/security-access` | 36 | Cross-client access, injection, CSRF, firm isolation |
| **Total** | **578** | |

---

## RBAC Setup

After a user signs up, set their role using the custom claims script:

```bash
# Attorney (full access to firm data)
npx ts-node scripts/set-custom-claims.ts <uid> attorney <firmId>

# Paralegal (read all, write notes/calendar/docs only)
npx ts-node scripts/set-custom-claims.ts <uid> paralegal <firmId>

# Client (access own data only)
npx ts-node scripts/set-custom-claims.ts <uid> client <firmId> <clientId>

# Admin (global access)
npx ts-node scripts/set-custom-claims.ts <uid> admin <firmId>
```

---

## Custom Domain

1. Firebase Console → Hosting → Add custom domain
2. Follow DNS verification steps
3. SSL certificate is provisioned automatically

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Client Browser (React 19 + Vite + Tailwind + shadcn/ui)    │
│  Firebase Auth │ Firestore (offline) │ Storage (audio/docs)  │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼───────────────────────────────────┐
│  Firebase Hosting (CDN)  │  Cloud Functions (us-east1)       │
│  SPA routing             │  31 callable/trigger functions     │
│                          │  OpenAI GPT-4.1 (temp 0.2)       │
│                          │  SendGrid, LawPay, Google APIs    │
└──────────────────────────┴───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│  Firestore Database                                          │
│  /firms/{firmId}/clients/{clientId}/...                      │
│  Sub-collections: documents, notes, payments, calendar,      │
│                   auditTrail, versions                        │
│  RBAC: admin > attorney > paralegal > client                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Production Checklist

- [ ] Firebase project created and Blaze plan enabled
- [ ] `.env` configured with production Firebase config
- [ ] All required secrets set via `firebase functions:secrets:set`
- [ ] Authentication providers enabled (Email/Password, Google)
- [ ] Firestore created in us-east1
- [ ] `bash scripts/deploy.sh all` completes successfully
- [ ] Custom domain configured (optional)
- [ ] Attorney user created and claims set (`role: attorney`)
- [ ] Test client created via UI or seed script
- [ ] Full questionnaire walkthrough completed
- [ ] Document generation produces all expected documents
- [ ] PDF/DOCX export verified
- [ ] DRAFT watermark visible on all generated documents
- [ ] Attorney approval gate blocks export until approved
- [ ] Email notifications sending correctly
- [ ] SendGrid sender verified and authorized
