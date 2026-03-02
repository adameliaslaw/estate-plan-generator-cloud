const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

async function main() {
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    try {
        const url = `https://run.googleapis.com/v1/projects/${projectId}/locations/us-east1/services`;
        const res = await client.request({ url });
        if (res.data && res.data.items) {
            console.log('Services:', res.data.items.map(i => i.metadata.name));
        } else {
            console.log('No services found.');
        }
    } catch (err) {
        console.error('Error fetching services:', err.message);
    }
}

main().catch(console.error);
