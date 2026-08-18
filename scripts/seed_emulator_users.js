const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({
    projectId: 'lapis3-2026'
});

const db = admin.firestore();
const auth = admin.auth();

async function initEmulatorUsers() {
    console.log('=== Initializing Emulator Users ===');
    const usersFile = path.join(__dirname, '..', 'setup_users.json');
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));

    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const staffId = i + 1;
        let uid;
        try {
            const existing = await auth.getUserByEmail(u.email);
            uid = existing.uid;
            await auth.updateUser(uid, {
                password: u.password,
                displayName: u.staff_name
            });
            console.log(`[AUTH UPDATE] ${u.email} (UID: ${uid})`);
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                const created = await auth.createUser({
                    email: u.email,
                    password: u.password,
                    displayName: u.staff_name
                });
                uid = created.uid;
                console.log(`[AUTH CREATE] ${u.email} (UID: ${uid})`);
            } else {
                console.error(`[AUTH ERROR] ${u.email}:`, err.message);
                continue;
            }
        }

        // Firestore staff
        try {
            await db.collection('staff').doc(uid).set({
                staff_id: staffId,
                staff_name: u.staff_name,
                email: u.email,
                role: u.role || '担当者',
                authority: u.authority || 'staff',
                status: u.status || '在籍',
                last_updated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`[FIRESTORE STAFF] doc(${uid}) set for ${u.staff_name}`);
        } catch (dbErr) {
            console.error(`[FIRESTORE ERROR] ${u.email}:`, dbErr.message);
        }
    }

    console.log('=== Finished Emulator Users Setup ===');
    process.exit(0);
}

initEmulatorUsers().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
