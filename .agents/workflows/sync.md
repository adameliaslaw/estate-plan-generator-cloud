---
description: Sync latest code when opening the project on a different machine
---

# Sync Workflow

// turbo-all

1. Pull the latest code from GitHub:
```
git pull origin main
```

2. Install frontend dependencies:
```
npm install
```

3. Install functions dependencies:
```
cd functions; npm install; cd ..
```
Note: On Windows PowerShell, use `Push-Location functions; npm install; Pop-Location` instead.

4. Start the dev server:
```
npm run dev
```
