const admin = require('firebase-admin');
const projectId = 'lapis3-4113e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

admin.initializeApp({ projectId });
const db = admin.firestore();

async function debug() {
    console.log(`Checking Firestore Emulator at ${process.env.FIRESTORE_EMULATOR_HOST} for project ${projectId}`);
    
    const testRef = db.collection('debug_test').doc('doc1');
    await testRef.set({ hello: 'world', timestamp: new Date() });
    console.log("Write successful.");

    const snap = await testRef.get();
    console.log("Read back exists:", snap.exists);
    console.log("Read back data:", snap.data());

    const custSnap = await db.collection('customers').limit(5).get();
    console.log("Total customers found:", custSnap.size);
    custSnap.forEach(doc => console.log(" - ", doc.id));
}

debug().catch(console.error);
