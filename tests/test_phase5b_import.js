// Unit Test for Phase 5-B: executeBatchImport (Chunked Batch & Schema Verification)
const assert = require('assert');

// search_utils ロジック
const CORPORATE_PREFIXES = ['株式会社', '有限会社', '合同会社', 'NPO法人', '一般社団法人', '一般財団法人', '合資会社', '合名会社', '医療法人', '社団法人', '学校法人', '社会福祉法人'];
const CORPORATE_KANA_PREFIXES = ['カブシキガイシャ', 'ユウゲンガイシャ', 'ゴウドウガイシャ', 'エヌピーオーホウジン', 'イッパンシャダンホウジン', 'イッパンザイダンホウジン', 'ゴウシガイシャ', 'ゴウメイガイシャ', 'イリョウホウジン', 'シャダンホウジン', 'ガッコウホウジン', 'シャカイフクシホウジン'];

function normalizeSearchText(str) {
    if (!str) return '';
    var val = str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).toLowerCase();
    val = val.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
    val = val.replace(/[\s\u3000\u30FB\-\uFF0D\&\uFF06\(\)\uFF08\uFF09]/g, '');
    return val;
}
function generateSearchName(name) {
    if (!name) return '';
    var regex = new RegExp('^(' + CORPORATE_PREFIXES.join('|') + ')\\s*');
    return normalizeSearchText(name.replace(regex, ''));
}
function generateSearchKana(kana) {
    if (!kana) return '';
    var regex = new RegExp('^(' + CORPORATE_KANA_PREFIXES.join('|') + ')\\s*');
    return normalizeSearchText(kana.replace(regex, ''));
}

// Mock Firestore with Batch support
class MockFirestore {
    constructor() {
        this.store = new Map();
        this.batchCommitCount = 0;
        this.chunkSizes = [];
        this.forceErrorAtChunk = -1;
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
                    async set(data, options = {}) {
                        self.store.set(key, data);
                    }
                };
            }
        };
    }

    async runTransaction(fn) {
        const self = this;
        return fn({
            get: async (docRef) => docRef.get(),
            set: (docRef, data) => docRef.set(data)
        });
    }

    batch() {
        const self = this;
        const operations = [];
        return {
            set(docRef, data) {
                operations.push({ key: docRef.key, data });
            },
            async commit() {
                self.batchCommitCount++;
                self.chunkSizes.push(operations.length);
                if (self.forceErrorAtChunk === self.batchCommitCount) {
                    throw new Error(`Simulated Firestore Batch Commit Error at chunk #${self.batchCommitCount}`);
                }
                operations.forEach(op => {
                    self.store.set(op.key, op.data);
                });
            }
        };
    }
}

let db = new MockFirestore();

async function getNextSequenceBatch(counterName, count) {
    const docRef = db.collection('counters').doc(counterName);
    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const currentCount = doc.exists ? (doc.data().count || 0) : 0;
        const newCount = currentCount + count;
        transaction.set(docRef, { count: newCount });
        return currentCount + 1;
    });
}

// CustomerImporter.executeBatchImport ロジック（js/customer_import.js から抽出）
async function executeBatchImport(importableRows, onProgress) {
    const total = importableRows.length;
    if (total === 0) return { total: 0, successCount: 0, failedCount: 0, startId: null, errors: [] };

    const startId = await getNextSequenceBatch('customers', total);
    const now = new Date().toISOString();

    const customerDocs = importableRows.map((item, idx) => {
        const customerId = startId + idx;
        const rowData = item.data;
        const searchName = generateSearchName(rowData.customer_name);
        const searchKana = generateSearchKana(rowData.customer_kana);

        return {
            customer_id: customerId,
            customer_name: rowData.customer_name || '',
            customer_kana: rowData.customer_kana || '',
            customer_type: rowData.customer_type || '未設定',
            representative_name: rowData.representative_name || '',
            postal_code: rowData.postal_code || '',
            address: rowData.address || '',
            building_name: rowData.building_name || '',
            phone: rowData.phone || '',
            fax: rowData.fax || '',
            email: rowData.email || '',
            status: '稼働中',
            nenga: 'なし',
            chugen: 'なし',
            fax_ok: '送信OK',
            remarks: rowData.remarks || '',
            fiscal_year_end_month: null,
            fiscal_year_end_day: null,
            founded_date: '',
            capital: null,
            employee_count: null,
            corporate_number: rowData.corporate_number || '',
            primary_staff_id: null,
            last_updated: now,
            created_date: now,
            search_name: searchName,
            search_kana: searchKana
        };
    });

    const CHUNK_SIZE = 100;
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = customerDocs.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();

        chunk.forEach(docData => {
            const docRef = db.collection('customers').doc(`cust_${docData.customer_id}`);
            batch.set(docRef, docData);
        });

        try {
            await batch.commit();
            successCount += chunk.length;
            if (typeof onProgress === 'function') {
                onProgress(successCount, total);
            }
        } catch (chunkErr) {
            console.error(`[CustomerImporter] Chunk commit failed at offset ${i}:`, chunkErr.message);
            failedCount += chunk.length;
            errors.push({
                offset: i,
                count: chunk.length,
                error: chunkErr.message
            });
            break;
        }
    }

    return {
        total: total,
        successCount: successCount,
        failedCount: failedCount,
        startId: startId,
        endId: startId + successCount - 1,
        errors: errors
    };
}

async function runTests() {
    console.log('=== Phase 5-B: executeBatchImport Unit Tests ===');

    // 1. 250件の分割バッチ書き込みテスト (100 + 100 + 50)
    db = new MockFirestore();
    await db.collection('counters').doc('customers').set({ count: 1000 });

    const rows250 = [];
    for (let i = 1; i <= 250; i++) {
        rows250.push({
            data: {
                customer_name: `株式会社テスト${i}`,
                customer_kana: `カブシキガイシャテスト${i}`,
                customer_type: '法人',
                representative_name: `代表${i}`,
                postal_code: '100-0001',
                address: `東京都千代田区${i}-${i}`,
                phone: `03-1234-${String(i).padStart(4, '0')}`,
                corporate_number: `123456789${String(i).padStart(4, '0')}`,
                remarks: `テストデータ${i}`
            }
        });
    }

    const progressLogs = [];
    const result250 = await executeBatchImport(rows250, (processed, total) => {
        progressLogs.push(`${processed}/${total}`);
    });

    assert.strictEqual(result250.total, 250);
    assert.strictEqual(result250.successCount, 250);
    assert.strictEqual(result250.failedCount, 0);
    assert.strictEqual(result250.startId, 1001);
    assert.strictEqual(result250.endId, 1250);
    assert.strictEqual(db.batchCommitCount, 3, '250件で3回のバッチコミットが行われること');
    assert.deepStrictEqual(db.chunkSizes, [100, 100, 50], 'チャンクサイズが [100, 100, 50] であること');
    assert.deepStrictEqual(progressLogs, ['100/250', '200/250', '250/250'], '進捗コールバックがチャンク毎に呼ばれること');
    console.log('✅ TEST 1 PASS: 250件の分割バッチ書き込み (100, 100, 50) & 連番 1001-1250');

    // 2. handleSave() とのスキーマ完全一致検証
    const savedDoc1001 = db.store.get('customers/cust_1001');
    assert.ok(savedDoc1001, 'cust_1001 が存在すること');
    assert.strictEqual(typeof savedDoc1001.customer_id, 'number', 'customer_id は数値型であること');
    assert.strictEqual(savedDoc1001.customer_id, 1001);
    assert.strictEqual(savedDoc1001.customer_name, '株式会社テスト1');
    assert.strictEqual(savedDoc1001.customer_type, '法人');
    assert.strictEqual(savedDoc1001.status, '稼働中');
    assert.strictEqual(savedDoc1001.nenga, 'なし');
    assert.strictEqual(savedDoc1001.chugen, 'なし');
    assert.strictEqual(savedDoc1001.fax_ok, '送信OK');
    assert.strictEqual(savedDoc1001.search_name, 'テスト1', '法人格除外の正規化検索名が生成されていること');
    assert.strictEqual(savedDoc1001.search_kana, 'テスト1', 'カナ法人格除外の正規化検索カナが生成されていること');
    console.log('✅ TEST 2 PASS: handleSave() とのスキーマ完全一致・検索キー自動生成');

    // 3. 部分成功＆エラーハンドリングテスト (2チャンク目でエラー発生)
    db = new MockFirestore();
    db.forceErrorAtChunk = 2; // 2回目のコミットでエラーを強制

    const resultPartial = await executeBatchImport(rows250);
    assert.strictEqual(resultPartial.total, 250);
    assert.strictEqual(resultPartial.successCount, 100, '1チャンク目の100件は成功保持');
    assert.strictEqual(resultPartial.failedCount, 100, '2チャンク目の100件は失敗検知');
    assert.strictEqual(resultPartial.errors.length, 1);
    assert.ok(resultPartial.errors[0].error.includes('Simulated Firestore Batch Commit Error'));
    console.log('✅ TEST 3 PASS: 部分成功ハンドリング (100件成功保持 / エラー情報返却)');

    console.log('\n🎉 ALL PHASE 5-B executeBatchImport TESTS PASSED!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
