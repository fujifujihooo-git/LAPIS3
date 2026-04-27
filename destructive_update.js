const admin = require('firebase-admin');

// 破壊的更新スクリプトはエミュレータでのみ動作するように強制
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({
    projectId: 'lapis3-4113e'
});

const db = admin.firestore();

async function runDestructiveUpdate() {
    const args = process.argv.slice(2);
    const targetCustomerId = parseInt(args[0]) || 900003;
    const mode = args[1] || 'update'; // 'update' or 'add'

    console.log(`💥 [破壊的更新スクリプト] 開始します... (TargetID: ${targetCustomerId}, Mode: ${mode})`);

    if (mode === 'update') {
        // 1. ソート変動（既存データの更新）
        // 指定された顧客の一番古い案件を取得して、updated_at を現在時刻に更新
        const oldestSnap = await db.collection('cases')
            .where('customer_id', '==', targetCustomerId)
            .orderBy('updated_at', 'asc')
            .limit(1)
            .get();

        if (!oldestSnap.empty) {
            const doc = oldestSnap.docs[0];
            console.log(`[ソート変動] 案件ID: ${doc.id} の updated_at を最新に更新します...`);
            await doc.ref.update({
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
                procedure_name: doc.data().procedure_name + ' (ソート変動テスト)'
            });
            console.log("✅ 更新完了");
        } else {
            console.log("⚠️ 対象データが見つかりませんでした");
        }
    } else if (mode === 'add') {
        // 2. 同時更新（新規データの追加）
        console.log(`[同時更新] 顧客ID: ${targetCustomerId} に新しい案件を追加します...`);
        const newCaseRef = db.collection('cases').doc();
        await newCaseRef.set({
            case_id: Math.floor(Math.random() * 100000) + 990000,
            customer_id: targetCustomerId,
            procedure_name: `[TEST] 外部追加案件 ${Date.now()}`,
            status: '進行中',
            is_test: true,
            contract_date: admin.firestore.FieldValue.serverTimestamp(),
            created_date: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            last_updated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ 追加完了 (DocID: ${newCaseRef.id})`);
    }

    console.log("\n💥 破壊的更新が完了しました。");
    process.exit(0);
}

runDestructiveUpdate().catch(console.error);
