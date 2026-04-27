const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

admin.initializeApp({ projectId: 'lapis3-4113e' });
const db = admin.firestore();

async function check() {
    const snap = await db.collection('customers').doc('cust_900000').get();
    console.log("EXISTS: ", snap.exists);
    if(snap.exists) {
        console.log("DATA: ", snap.data());
    } else {
        const all = await db.collection('customers').limit(5).get();
        console.log("Any customers? ", all.docs.map(d => d.id));
    }
}
check();
