const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
admin.initializeApp({ projectId: 'lapis3-4113e' });
const db = admin.firestore();

(async () => {
    console.log("Checking cases for customer 900001...");
    const snap = await db.collection('cases').where('customer_id', '==', 900001).get();
    console.log(`Found ${snap.size} cases.`);
    if (snap.size > 0) {
        console.log("Sample case:", snap.docs[0].data());
    } else {
        console.log("No cases found with numeric ID 900001.");
        const snap2 = await db.collection('cases').where('customer_id', '==', '900001').get();
        console.log(`Found ${snap2.size} cases with string ID '900001'.`);
    }
    process.exit(0);
})();
