const { execSync } = require('child_process');

// Credentials have been removed from this file.
// Before running, set the secrets manually:
//
//   firebase functions:secrets:set GOOGLE_CLIENT_ID
//   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
//
// Then run this script to deploy the function:

try {
    console.log('Deploying exchangeGoogleAuthCode...');
    execSync('firebase deploy --only functions:exchangeGoogleAuthCode', {
        stdio: 'inherit',
    });

    console.log('Success!');
} catch (error) {
    console.error('Error during deployment:', error);
    process.exit(1);
}
