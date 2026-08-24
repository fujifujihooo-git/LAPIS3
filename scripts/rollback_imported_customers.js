/**
 * LAPIS3 誤取込顧客データ ロールバック（一括削除）スクリプト (v3: バッチ一覧表示・対話支援機能付き)
 * 
 * 使い方:
 *   1. バッチID指定（推奨・安全）:
 *      node scripts/rollback_imported_customers.js --batch-id imp_20260821_154500_abc12 [--dry-run]
 * 
 *   2. customer_id 範囲指定:
 *      node scripts/rollback_imported_customers.js --start 1002 --end 1101 [--dry-run]
 * 
 *   3. 引数なしで実行した場合:
 *      直近のインポートバッチ一覧と削除コマンド例を案内します。
 */

const admin = require('firebase-admin');

// コマンドライン引数の解析
const args = process.argv.slice(2);
let batchId = null;
let startId = null;
let endId = null;
let isDryRun = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id' && args[i + 1]) {
        batchId = args[i + 1].trim();
        i++;
    } else if (args[i] === '--start' && args[i + 1]) {
        startId = parseInt(args[i + 1], 10);
        i++;
    } else if (args[i] === '--end' && args[i + 1]) {
        endId = parseInt(args[i + 1], 10);
        i++;
    } else if (args[i] === '--dry-run') {
        isDryRun = true;
    }
}

// ローカルエミュレータ接続（未設定時は 127.0.0.1:8085 をデフォルト）
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
}

// Firebase 初期化
if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'lapis3-4113e' });
}

const db = admin.firestore();

async function main() {
    // 引数がない場合は、現在のインポートバッチ一覧を表示
    if (!batchId && (!startId || !endId)) {
        console.log('=====================================================');
        console.log('  LAPIS3 顧客CSVインポート ロールバックツール');
        console.log('=====================================================\n');
        
        console.log('インポート済みバッチを検索中...\n');
        const snap = await db.collection('customers').get();
        const batchMap = new Map();
        
        snap.forEach(doc => {
            const d = doc.data();
            if (d.import_batch_id) {
                if (!batchMap.has(d.import_batch_id)) {
                    batchMap.set(d.import_batch_id, {
                        count: 0,
                        minId: d.customer_id,
                        maxId: d.customer_id,
                        firstCustomer: d.customer_name,
                        created: d.created_date
                    });
                }
                const b = batchMap.get(d.import_batch_id);
                b.count++;
                if (d.customer_id < b.minId) b.minId = d.customer_id;
                if (d.customer_id > b.maxId) b.maxId = d.customer_id;
            }
        });

        if (batchMap.size === 0) {
            console.log('ℹ️ 現在、インポートバッチで登録された顧客データはありません。');
            console.log('（既存の手動登録顧客データのみが存在します）\n');
        } else {
            console.log('【見つかったインポートバッチ一覧】');
            for (let [bId, info] of batchMap.entries()) {
                console.log(`\n📌 バッチID: ${bId}`);
                console.log(`   件数: ${info.count}件 | ID範囲: ${info.minId} 〜 ${info.maxId}`);
                console.log(`   代表顧客名: ${info.firstCustomer} | 登録日時: ${info.created}`);
                console.log(`   👉 削除コマンド（確認のみ）: node scripts/rollback_imported_customers.js --batch-id ${bId} --dry-run`);
                console.log(`   👉 削除コマンド（実行）    : node scripts/rollback_imported_customers.js --batch-id ${bId}`);
            }
            console.log('\n-----------------------------------------------------');
        }
        return;
    }

    console.log('=====================================================');
    console.log(`  LAPIS3 顧客データ ロールバック`);
    if (batchId) {
        console.log(`  指定バッチID: ${batchId}`);
    } else {
        console.log(`  指定ID範囲: ${startId} 〜 ${endId}`);
    }
    console.log(`  モード: ${isDryRun ? '🔍 DRY-RUN (確認のみ・削除なし)' : '⚠️ 削除実行モード'}`);
    console.log('=====================================================\n');

    // 1. 対象ドキュメントの検索
    const targets = [];

    if (batchId) {
        // バッチIDクエリ検索（最も安全）
        const snapshot = await db.collection('customers').where('import_batch_id', '==', batchId).get();
        snapshot.forEach(doc => {
            targets.push({ id: doc.data().customer_id, ref: doc.ref, data: doc.data() });
        });
    } else {
        // ID範囲検索
        for (let id = startId; id <= endId; id++) {
            const docRef = db.collection('customers').doc(`cust_${id}`);
            const snap = await docRef.get();
            if (snap.exists) {
                targets.push({ id, ref: docRef, data: snap.data() });
            }
        }
    }

    console.log(`該当ドキュメント件数: ${targets.length} 件\n`);

    if (targets.length === 0) {
        console.log('削除対象のデータは見つかりませんでした。終了します。');
        return;
    }

    // 2. 対象データのプレビュー表示 (先頭5件と末尾5件)
    console.log('【削除対象プレビュー】');
    targets.slice(0, 5).forEach(t => {
        console.log(`  - [ID: ${t.id}] ${t.data.customer_name} (${t.data.customer_type || '未設定'}) バッチ: ${t.data.import_batch_id || '-'} 作成日: ${t.data.created_date}`);
    });
    if (targets.length > 10) {
        console.log(`  ... 他 ${targets.length - 10} 件 ...`);
    }
    if (targets.length > 5) {
        targets.slice(-5).forEach(t => {
            console.log(`  - [ID: ${t.id}] ${t.data.customer_name} (${t.data.customer_type || '未設定'}) バッチ: ${t.data.import_batch_id || '-'} 作成日: ${t.data.created_date}`);
        });
    }

    if (isDryRun) {
        console.log('\n🔍 DRY-RUN 完了。実際の削除は実行されていません。');
        console.log('実際に削除するには --dry-run を外して実行してください。');
        return;
    }

    // 3. 100件単位で分割バッチ削除
    console.log('\n削除処理を開始します...');
    const CHUNK_SIZE = 100;
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();
        chunk.forEach(t => {
            batch.delete(t.ref);
        });
        await batch.commit();
        console.log(`  削除完了: ${Math.min(i + CHUNK_SIZE, targets.length)} / ${targets.length} 件`);
    }

    console.log('\n✅ ロールバック（一括削除）が完了しました。');
}

main().catch(err => {
    console.error('❌ エラーが発生しました:', err);
    process.exit(1);
});
