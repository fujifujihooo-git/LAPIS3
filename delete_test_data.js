const admin = require('firebase-admin');
const path = require('path');

const USE_PRODUCTION = process.env.USE_PRODUCTION === 'true';
const ALLOW_PROD_WRITE = process.env.ALLOW_PROD_WRITE === 'true';

if (USE_PRODUCTION) {
    if (!ALLOW_PROD_WRITE) {
        console.error("❌ 警告: 本番環境へのアクセスはデフォルトで無効化されています。");
        console.error("   本当に実行する場合は、環境変数 ALLOW_PROD_WRITE=true を同時に指定してください。");
        process.exit(1);
    }
    const NEW_KEY_PATH = path.join(__dirname, 'lapis3-4113e-firebase-adminsdk-fbsvc-f4e38d0188.json');
    try {
        const newKey = require(NEW_KEY_PATH);
        admin.initializeApp({
            credential: admin.credential.cert(newKey)
        });
        console.log("✅ [本番環境 (PRODUCTION)] Firestore初期化に成功しました。");
    } catch (e) {
        console.error("❌ 鍵の読み込みに失敗しました。ファイル名を確認してください。\n", e.message);
        process.exit(1);
    }
} else {
    // デフォルト: エミュレータ環境
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095';
    admin.initializeApp({
        projectId: 'lapis3-4113e'
    });
    console.log("✅ [エミュレータ環境 (EMULATOR)] Firestore初期化に成功しました。");
}

const db = admin.firestore();

// 削除対象のコレクション
const COLLECTIONS = ['customers', 'cases', 'customer_licenses'];

async function deleteCollectionTestData(collectionName) {
    console.log(`\n🗑️ [${collectionName}] コレクションのテストデータを検索中...`);
    
    let deletedCount = 0;
    
    try {
        const snapshot = await db.collection(collectionName)
            .where('is_test', '==', true)
            .get();

        if (snapshot.empty) {
            console.log(`   └─ テストデータなし`);
            return 0;
        }

        let batches = [];
        let currentBatch = db.batch();
        let currentBatchSize = 0;

        snapshot.docs.forEach((doc) => {
            currentBatch.delete(doc.ref);
            currentBatchSize++;
            deletedCount++;

            if (currentBatchSize >= 500) {
                batches.push(currentBatch.commit());
                currentBatch = db.batch();
                currentBatchSize = 0;
            }
        });

        if (currentBatchSize > 0) {
            batches.push(currentBatch.commit());
        }

        await Promise.all(batches);
        console.log(`   └─ ✅ ${deletedCount} 件のテストデータを削除しました！`);
        return deletedCount;

    } catch (e) {
        console.error(`   └─ ❌ エラー発生: ${e.message}`);
        return 0;
    }
}

async function deleteTestData() {
    console.log("🚀 テストデータの削除（ロールバック）を開始します...");
    
    let totalDeleted = 0;

    for (const col of COLLECTIONS) {
        totalDeleted += await deleteCollectionTestData(col);
    }

    console.log(`\n🎊 すべてのテストデータ削除が完了しました！ (合計: ${totalDeleted}件)`);
    process.exit(0);
}

deleteTestData().catch(console.error);
