const admin = require('firebase-admin');

admin.initializeApp();

async function migrateParalegals() {
  const db = admin.firestore();
  const auth = admin.auth();
  
  console.log('Starting migration for paralegal and attorney capabilities...');

  let pageToken;
  let count = 0;
  
  do {
    const listUsersResult = await auth.listUsers(1000, pageToken);
    
    for (const userRecord of listUsersResult.users) {
      const claims = userRecord.customClaims || {};
      const role = claims.role;
      // Also check firm_id as some users might have it, or firmId.
      const firmId = claims.firmId || claims.firm_id;
      
      if ((role === 'paralegal' || role === 'attorney') && firmId) {
        let currentCapabilities = claims.capabilities || [];
        
        if (!currentCapabilities.includes('manage_billing')) {
          console.log(`[MIGRATE] Updating user: ${userRecord.email} (Role: ${role}, Firm: ${firmId})`);
          
          // 1. Update Auth Custom Claims
          const newCapabilities = [...currentCapabilities, 'manage_billing'];
          const newClaims = {
            ...claims,
            capabilities: newCapabilities
          };
          
          await auth.setCustomUserClaims(userRecord.uid, newClaims);
          
          // 2. Update Firestore Profile
          try {
            await db.doc(`firms/${firmId}/users/${userRecord.uid}`).update({
              customCapabilities: newCapabilities,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`  -> Successfully updated Auth claims and Firestore profile for ${userRecord.email}`);
            count++;
          } catch (err) {
            console.error(`  -> ERROR updating Firestore for ${userRecord.email}:`, err.message);
          }
        }
      }
    }
    
    pageToken = listUsersResult.pageToken;
  } while (pageToken);

  console.log(`Migration complete. Updated ${count} users.`);
  process.exit(0);
}

migrateParalegals().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
