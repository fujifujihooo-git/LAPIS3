const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'lapis3-2026' });
}
const db = admin.firestore();

async function check() {
    const snap = await db.collection('customers').get();
    console.log('Total customers in emulator:', snap.size);
    const batches = new Map();
    const list = [];
    snap.forEach(doc => {
        const d = doc.data();
        const bId = d.import_batch_id || '(通常登録/手動)';
        batches.set(bId, (batches.get(bId) || 0) + 1);
        list.push({
            id: d.customer_id,
            name: d.customer_name,
            batchId: d.import_batch_id || null,
            created: d.created_date
        });
    });

    console.log('\n--- バッチID別集計 ---');
    for (let [bId, count] of batches.entries()) {
        console.log(`- バッチID: ${bId} (${count}件)`);
    }

    console.log('\n--- 顧客データ一覧 ---');
    list.forEach(c => {
        console.log(`[ID: ${c.id}] ${c.name} | Batch: ${c.batchId || 'なし'} | 作成: ${c.created}`);
    });
}

check().catch(console.error);
