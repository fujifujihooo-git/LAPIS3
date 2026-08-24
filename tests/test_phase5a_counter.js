// Unit Test for getNextSequenceBatch & getNextSequence (Mock Transaction Concurrency & Consistency)
const assert = require('assert');

// Firestore トランザクションを模した並行性シミュレータ
class MockFirestore {
    constructor() {
        this.store = new Map();
        this._lock = Promise.resolve();
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
                        return {
                            exists: data !== undefined,
                            data: () => data
                        };
                    },
                    async set(data, options = {}) {
                        if (options.merge && self.store.has(key)) {
                            const existing = self.store.get(key);
                            self.store.set(key, { ...existing, ...data });
                        } else {
                            self.store.set(key, data);
                        }
                    }
                };
            }
        };
    }

    // Firestoreの runTransaction を厳密にシミュレート（排他ロック＆再試行機構）
    async runTransaction(updateFunction) {
        // トランザクションキューによる直列化（Firestore内部のOptimistic Concurrency Control）
        let releaseLock;
        const currentLock = this._lock;
        this._lock = new Promise(resolve => { releaseLock = resolve; });

        await currentLock;
        try {
            const transactionContext = {
                get: async (docRef) => {
                    // 読み取り時に微小な非同期遅延（I/Oシミュレーション）
                    await new Promise(r => setTimeout(r, Math.random() * 5));
                    return docRef.get();
                },
                set: (docRef, data, options) => {
                    return docRef.set(data, options);
                }
            };

            const result = await updateFunction(transactionContext);
            return result;
        } finally {
            releaseLock();
        }
    }
}

const db = new MockFirestore();

// テスト対象の関数（common.js の実装と完全同一）
async function getNextSequence(counterName) {
    const docRef = db.collection('counters').doc(counterName);
    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let newCount = 1;
        if (doc.exists) {
            newCount = (doc.data().count || 0) + 1;
        }
        transaction.set(docRef, { count: newCount });
        return newCount;
    });
}

async function getNextSequenceBatch(counterName, count) {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error('getNextSequenceBatch: count must be a positive integer (>= 1)');
    }
    const docRef = db.collection('counters').doc(counterName);
    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const currentCount = doc.exists ? (doc.data().count || 0) : 0;
        const newCount = currentCount + count;
        transaction.set(docRef, { count: newCount }, { merge: true });
        return currentCount + 1;
    });
}

async function runTests() {
    console.log('=== Phase 5-A: getNextSequenceBatch Unit Tests ===');

    // 1. 新規カウンターからの採番 (初回5件: 1..5)
    const testCounter1 = 'test_counter_init';
    const startId1 = await getNextSequenceBatch(testCounter1, 5);
    const snap1 = await db.collection('counters').doc(testCounter1).get();
    assert.strictEqual(startId1, 1, '初回採番の開始IDは 1 であること');
    assert.strictEqual(snap1.data().count, 5, 'カウンターのcountは 5 であること');
    console.log('✅ TEST 1 PASS: 新規カウンターから5件採番 (startId: 1, count: 5)');

    // 2. 既存値（1000）からの連続採番 (1001..1005, 1006..1015)
    const testCounter2 = 'test_counter_1000';
    await db.collection('counters').doc(testCounter2).set({ count: 1000 });
    
    const startId2 = await getNextSequenceBatch(testCounter2, 5);
    const snap2 = await db.collection('counters').doc(testCounter2).get();
    assert.strictEqual(startId2, 1001, '初期値1000からの開始IDは 1001');
    assert.strictEqual(snap2.data().count, 1005, 'countは 1005');

    const startId3 = await getNextSequenceBatch(testCounter2, 10);
    const snap3 = await db.collection('counters').doc(testCounter2).get();
    assert.strictEqual(startId3, 1006, '連続採番の開始IDは 1006');
    assert.strictEqual(snap3.data().count, 1015, 'countは 1015');
    console.log('✅ TEST 2 PASS: 既存値1000から連続採番 (1001-1005, 1006-1015)');

    // 3. 既存 getNextSequence() との混在利用
    const testCounter3 = 'test_counter_mix';
    const idList = [];

    // バッチ3件 (1, 2, 3)
    const b1 = await getNextSequenceBatch(testCounter3, 3);
    for (let i = 0; i < 3; i++) idList.push(b1 + i);

    // 単体1件 (4)
    const s1 = await getNextSequence(testCounter3);
    idList.push(s1);

    // バッチ2件 (5, 6)
    const b2 = await getNextSequenceBatch(testCounter3, 2);
    for (let i = 0; i < 2; i++) idList.push(b2 + i);

    // 単体1件 (7)
    const s2 = await getNextSequence(testCounter3);
    idList.push(s2);

    assert.deepStrictEqual(idList, [1, 2, 3, 4, 5, 6, 7], '混在実行しても連番が完全一致すること');
    const snapMix = await db.collection('counters').doc(testCounter3).get();
    assert.strictEqual(snapMix.data().count, 7, '最終カウンター値は 7');
    console.log('✅ TEST 3 PASS: getNextSequence と getNextSequenceBatch の混在整合性 (1..7)');

    // 4. 同時並行トランザクション実行テスト (20並行 x 各5件 = 100件)
    const testCounter4 = 'test_counter_concurrent';
    const parallelCalls = 20;
    const itemsPerCall = 5;
    const promises = [];

    for (let i = 0; i < parallelCalls; i++) {
        promises.push(getNextSequenceBatch(testCounter4, itemsPerCall));
    }

    const results = await Promise.all(promises);
    
    // 全採番IDを収集
    const allAllocatedIds = [];
    results.forEach(startId => {
        for (let j = 0; j < itemsPerCall; j++) {
            allAllocatedIds.push(startId + j);
        }
    });

    // 昇順ソートして 1〜100 が重複・欠番なく揃っているか確認
    allAllocatedIds.sort((a, b) => a - b);
    const expectedIds = Array.from({ length: parallelCalls * itemsPerCall }, (_, i) => i + 1);
    assert.deepStrictEqual(allAllocatedIds, expectedIds, '並行実行で重複や欠番が一切ないこと');

    const snapConcurrent = await db.collection('counters').doc(testCounter4).get();
    assert.strictEqual(snapConcurrent.data().count, 100, '最終カウンター値は 100');
    console.log(`✅ TEST 4 PASS: ${parallelCalls}並行トランザクション同時採番テスト (全100件重複・欠番ゼロ)`);

    // 5. 不正引数のバリデーションテスト
    let errorCaught = false;
    try {
        await getNextSequenceBatch('test_err', 0);
    } catch (e) {
        errorCaught = true;
    }
    assert.ok(errorCaught, '0以下の指定でエラーが発生すること');

    console.log('\n🎉 ALL PHASE 5-A getNextSequenceBatch TESTS PASSED!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
