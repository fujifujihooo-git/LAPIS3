const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 鍵ファイルの設定
const OLD_KEY_PATH = path.join(__dirname, 'old_key.json');
const NEW_KEY_PATH = path.join(__dirname, 'lapis3-4113e-firebase-adminsdk-fbsvc-f4e38d0188.json');

// --- 認証と初期化 ---
let oldDb, newDb;
try {
    const oldKey = require(OLD_KEY_PATH);
    const oldApp = admin.initializeApp({
        credential: admin.credential.cert(oldKey)
    }, 'oldApp');
    oldDb = oldApp.firestore();
    
    const newKey = require(NEW_KEY_PATH);
    const newApp = admin.initializeApp({
        credential: admin.credential.cert(newKey)
    }, 'newApp');
    newDb = newApp.firestore();
    
    console.log("✅ 鍵の読み込みとFirestore初期化に成功しました。");
} catch (e) {
    console.error("❌ 鍵の読み込みに失敗しました。ファイル名を確認してください。\n", e.message);
    process.exit(1);
}

// --- マイグレーション処理本体 ---
async function copyCollection(collectionRef, customId = null) {
    const colName = customId || collectionRef.id;
    console.log(`\n📦 コレクションをコピー中: [${colName}]`);
    
    try {
        const snapshot = await collectionRef.get();
        if (snapshot.empty) {
            console.log(`   └─ ドキュメントなし（スキップ）`);
            return;
        }

        let batches = [];
        let currentBatch = newDb.batch();
        let currentBatchSize = 0;
        let count = 0;

        snapshot.docs.forEach((doc) => {
            // 新しいDBにセットする参照先
            const newDocRef = newDb.collection(colName).doc(doc.id);
            currentBatch.set(newDocRef, doc.data());
            
            currentBatchSize++;
            count++;
            
            // バッチの上限は500件
            if (currentBatchSize >= 500) {
                batches.push(currentBatch.commit());
                currentBatch = newDb.batch();
                currentBatchSize = 0;
            }
        });

        // 残りのバッチをコミット
        if (currentBatchSize > 0) {
            batches.push(currentBatch.commit());
        }

        await Promise.all(batches);
        console.log(`   └─ ✅ ${count} 件のドキュメントを移行しました！`);
        
    } catch (e) {
        console.error(`   └─ ❌ エラー発生: ${e.message}`);
    }
}

async function migrateData() {
    console.log("🚀 データ移行を開始します...");
    
    try {
        // トップレベルのコレクション一覧を取得
        const collections = await oldDb.listCollections();
        
        console.log(`👀 ${collections.length} 個のトップレベルコレクションが見つかりました。`);

        for (const collection of collections) {
            await copyCollection(collection);
            // ※サブコレクションが必要な場合はここで再帰処理を書く（今回のLAPISはトップレベル主体のため省略）
        }

        console.log("\n🎊 すべてのデータ移行が完了しました！！");
        
    } catch (error) {
        console.error("💥 移行中にエラーが発生しました:", error);
    }
    
    process.exit(0);
}

migrateData();
