---
description: Commit all changes, push to GitHub, build, and deploy to Firebase
---
// turbo-all

## Full Deploy Pipeline

> **MANDATORY**: This pipeline MUST be run after completing ANY task that modifies code files. Do NOT notify or report completion to the user until all applicable steps below have been executed. If the user asks you to make code changes, finishing the code is NOT the end — deploy is.

Run these steps in order to ship the current changes to production.

1. Stage and commit all changes with a descriptive message:
```
git add -A && git commit -m "<descriptive commit message>"
```

2. Push to GitHub:
```
git push origin main
```

3. Build the production frontend:
```
npm run build
```

4. Deploy hosting to Firebase:
```
npx firebase deploy --only hosting
```

5. If Cloud Functions were changed, deploy functions too:
```
npx firebase deploy --only functions
```

6. If Firestore rules were changed, deploy rules too:
```
npx firebase deploy --only firestore:rules
```
