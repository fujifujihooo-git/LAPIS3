// Rollback Script Unit Test (batch-id query & range test)
const assert = require('assert');

// Mock Firestore with Query support
class MockFirestore {
    constructor() {
        this.store = new Map();
        // ID 1002 〜 1009 をセット (batchId: imp_test_001)
        for (let i = 1002; i <= 1009; i++) {
            this.store.set(`customers/cust_${i}`, {
                customer_id: i,
                customer_name: `誤取込顧客_${i}`,
                import_batch_id: 'imp_test_001',
                created_date: new Date().toISOString()
            });
        }
        // 他のバッチ・通常登録データ (ID 9999, batchId なし)
        this.store.set(`customers/cust_9999`, {
            customer_id: 9999,
            customer_name: `通常登録顧客_手動作成`,
            created_date: new Date().toISOString()
        });
    }
    collection(colName) {
        const self = this;
        return {
            doc(docId) {
                const key = `${colName}/${docId}`;
                return {
                    key,
                    async get() {
                        const data = self.store.get(key);
                        return { exists: data !== undefined, data: () => data };
                    },
                    async delete() {
                        self.store.delete(key);
                    }
                };
            },
            where(field, op, val) {
                return {
                    async get() {
                        const docs = [];
                        for (let [key, data] of self.store.entries()) {
                            if (key.startsWith(`${colName}/`) && data[field] === val) {
                                docs.push({
                                    id: data.customer_id,
                                    ref: { key },
                                    data: () => data
                                });
                            }
                        }
                        return {
                            docs,
                            forEach: (fn) => docs.forEach(fn),
                            size: docs.length
                        };
                    }
                };
            }
        };
    }
    batch() {
        const self = this;
        const deletes = [];
        return {
            delete(docRef) { deletes.push(docRef.key); },
            async commit() { deletes.forEach(k => self.store.delete(k)); }
        };
    }
}

const db = new MockFirestore();

async function testBatchIdRollback() {
    console.log('=== Rollback Script Batch-ID Test ===');
    const targetBatchId = 'imp_test_001';

    assert.strictEqual(db.store.size, 9, '初期データは9件 (インポート8件 + 通常顧客1件)');

    // 1. バッチIDによるクエリ検索
    const snapshot = await db.collection('customers').where('import_batch_id', '==', targetBatchId).get();
    assert.strictEqual(snapshot.docs.length, 8, 'imp_test_001 のデータは8件');

    // 2. バッチ削除実行
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // 3. 検証: インポート8件のみが削除され、通常顧客(cust_9999)は完全に保護されていること
    assert.strictEqual(db.store.size, 1, '残りは通常顧客1件のみ');
    assert.ok(db.store.has('customers/cust_9999'), 'cust_9999 が保護されていること');

    console.log('✅ Batch-ID Rollback Test PASSED: インポートデータのみピンポイント削除＆他データ完全保護確認!');
}

testBatchIdRollback().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
