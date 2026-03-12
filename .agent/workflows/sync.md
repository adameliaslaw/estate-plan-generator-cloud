---
description: Sync latest code when opening the project on a different machine
---
// turbo-all

## Auto-Sync on Startup

Run these steps when starting a work session, especially after switching between office and home machines.

1. Pull the latest changes from GitHub:
```
git pull origin main
```

2. Install any new dependencies (only needed if package.json changed):
```
npm install
```

3. Start the dev server:
```
npm run dev
```
