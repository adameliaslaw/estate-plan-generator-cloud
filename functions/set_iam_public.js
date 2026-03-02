const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

async function main() {
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    console.log('Project ID:', projectId);

    // We need to fetch all onCall functions in functions/src and apply the policy
    const functionsToMakePublic = [
        'sendQuestionnaireInvitation',
        'sendquestionnairecompletenotification',
        'senddocumentreadynotification',
        'sendpaymentreceipt',
        'sendpaymentreceivednotification',
        'sendappointmentreminder',
        'sendfollowupreminder',
        'generatedocuments',
        'generatesingledocument',
        'reviewdocument',
        'generateflexdocument',
        'exportdocumentpdf',
        'exportdocumentdocx',
        'exportbatchdocuments',
        'transcribeaudio',
        'summarizetranscription',
        'createpaymentrequest',
        'pusheventtogooglecalendar',
        'pullgooglecalendarevents',
        'checkdocumentcompliance',
        'logaccess'
    ];

    for (const fn of functionsToMakePublic) {
        try {
            const url = `https://run.googleapis.com/v1/projects/${projectId}/locations/us-east1/services/${fn}:setIamPolicy`;
            const res = await client.request({
                url,
                method: 'POST',
                data: {
                    policy: {
                        bindings: [
                            {
                                role: 'roles/run.invoker',
                                members: ['allUsers']
                            }
                        ]
                    }
                }
            });
            console.log(`Successfully updated IAM policy for ${fn}`);
        } catch (err) {
            console.error(`Error updating ${fn}:`, err.message);
        }
    }
}

main().catch(console.error);
