const { execSync } = require('child_process');

try {
    console.log('Setting GOOGLE_CLIENT_ID...');
    execSync('firebase functions:secrets:set GOOGLE_CLIENT_ID --force', {
        input: '749324460027-7f9s3sk22ckmp2r6u2v5u1o51nduck1v.apps.googleusercontent.com',
        stdio: ['pipe', 'inherit', 'inherit'],
    });

    console.log('Setting GOOGLE_CLIENT_SECRET...');
    execSync('firebase functions:secrets:set GOOGLE_CLIENT_SECRET --force', {
        input: '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',
        stdio: ['pipe', 'inherit', 'inherit'],
    });

    console.log('Deploying exchangeGoogleAuthCode...');
    execSync('firebase deploy --only functions:exchangeGoogleAuthCode', {
        stdio: 'inherit',
    });

    console.log('Success!');
} catch (error) {
    console.error('Error during secret injection deployment:', error);
    process.exit(1);
}
