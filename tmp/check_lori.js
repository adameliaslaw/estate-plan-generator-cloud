const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'estate-plan-generator' // or use default
});

async function checkLori() {
  const listUsersResult = await admin.auth().listUsers(100);
  for (const userRecord of listUsersResult.users) {
    const claims = userRecord.customClaims || {};
    if (claims.role === 'paralegal') {
      console.log(`User: ${userRecord.email}`);
      console.log(`Claims:`, claims);
      console.log('----------------');
    }
  }
}
checkLori().catch(console.error);
