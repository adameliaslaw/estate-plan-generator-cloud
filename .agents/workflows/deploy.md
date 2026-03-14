---
description: Commit all changes, push to GitHub, build, and deploy to Firebase
---

# Deploy Workflow

// turbo-all

1. Stage and commit all changes:
```
git add -A; git commit -m "deploy: latest changes"
```

2. Push to GitHub:
```
git push origin main
```

3. Build the frontend:
```
npx vite build
```

4. Build Cloud Functions:
```
cd functions; npm run build; cd ..
```
Note: On Windows PowerShell, use `Push-Location functions; npm run build; Pop-Location` instead.

5. Deploy to Firebase:
```
firebase deploy --only "hosting,functions,firestore:rules,storage"
```
