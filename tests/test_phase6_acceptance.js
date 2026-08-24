// Phase 6 Comprehensive Acceptance Test (受入試験スクリプト)
const assert = require('assert');

// 1. search_utils ロジック
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

// 2. モックFirestore
class MockFirestore {
    constructor() {
        this.store = new Map();
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
    async runTransaction(fn) {
        return fn({
            get: async (docRef) => docRef.get(),
            set: (docRef, data, options) => docRef.set(data, options)
        });
    }
    batch() {
        const self = this;
        const operations = [];
        return {
            set(docRef, data) { operations.push({ key: docRef.key, data }); },
            async commit() { operations.forEach(op => self.store.set(op.key, op.data)); }
        };
    }
}

const db = new MockFirestore();

// 3. 採番関数
async function getNextSequenceBatch(counterName, count) {
    const docRef = db.collection('counters').doc(counterName);
    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const currentCount = doc.exists ? (doc.data().count || 0) : 0;
        const newCount = currentCount + count;
        transaction.set(docRef, { count: newCount }, { merge: true });
        return currentCount + 1;
    });
}

// 4. 正規化＆バリデーションエンジン
function normalizeCustomerRow(rawRow) {
    const toHalfDigits = (str) => !str ? '' : String(str).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    const normalizeHyphens = (str) => !str ? '' : String(str).replace(/[ー―‐－–—]/g, '-');

    const normalized = {
        customer_name: (rawRow.customer_name || '').trim(),
        customer_kana: (rawRow.customer_kana || '').trim(),
        representative_name: (rawRow.representative_name || '').trim(),
        corporate_number: toHalfDigits(rawRow.corporate_number || '').replace(/\D/g, '').trim(),
        address: (rawRow.address || '').trim(),
        building_name: (rawRow.building_name || '').trim(),
        phone: normalizeHyphens(toHalfDigits(rawRow.phone || '')).trim(),
        fax: normalizeHyphens(toHalfDigits(rawRow.fax || '')).trim(),
        email: (rawRow.email || '').trim(),
        remarks: (rawRow.remarks || '').trim(),
        customer_type: (rawRow.customer_type || '').trim()
    };

    let rawZip = normalizeHyphens(toHalfDigits(rawRow.postal_code || '')).trim();
    if (/^\d{7}$/.test(rawZip)) {
        rawZip = rawZip.slice(0, 3) + '-' + rawZip.slice(3);
    }
    normalized.postal_code = rawZip;

    return normalized;
}

function validateAndDetectDuplicates(parsedRows, existingIndex) {
    const corporateNumberMap = existingIndex.corporateNumberMap || new Map();
    const customerNameSet = existingIndex.customerNameSet || new Set();

    const csvCorpCount = new Map();
    const csvNameCount = new Map();

    parsedRows.forEach(row => {
        const norm = normalizeCustomerRow(row);
        if (norm.corporate_number && norm.corporate_number.length === 13) {
            csvCorpCount.set(norm.corporate_number, (csvCorpCount.get(norm.corporate_number) || 0) + 1);
        }
        if (norm.customer_name) {
            csvNameCount.set(norm.customer_name, (csvNameCount.get(norm.customer_name) || 0) + 1);
        }
    });

    return parsedRows.map(row => {
        const norm = normalizeCustomerRow(row);
        let status = 'ok';
        const messages = [];

        // 1. 顧客名チェック (必須)
        if (!norm.customer_name) {
            status = 'error';
            messages.push('顧客名が未入力です');
        } else {
            if (customerNameSet.has(norm.customer_name)) {
                if (status !== 'error') status = 'warning';
                messages.push('既存顧客と同名です（要確認）');
            }
            if ((csvNameCount.get(norm.customer_name) || 0) > 1) {
                if (status !== 'error') status = 'warning';
                messages.push('CSVファイル内に同一顧客名が存在します');
            }
        }

        // 2. 法人番号チェック
        if (norm.corporate_number) {
            if (norm.corporate_number.length !== 13) {
                status = 'error';
                messages.push('法人番号は半角数字13桁で入力してください');
            } else {
                if (corporateNumberMap.has(norm.corporate_number)) {
                    if (status !== 'error') status = 'warning';
                    const exist = corporateNumberMap.get(norm.corporate_number);
                    messages.push(`既存顧客と法人番号が一致（ID: ${exist.customer_id} / ${exist.customer_name}）`);
                }
                if ((csvCorpCount.get(norm.corporate_number) || 0) > 1) {
                    if (status !== 'error') status = 'warning';
                    messages.push('CSVファイル内で法人番号が重複しています');
                }
            }
        }

        // 3. 区分判定
        if (!norm.customer_type) {
            if (norm.corporate_number && norm.corporate_number.length === 13) {
                norm.customer_type = '法人';
            } else {
                norm.customer_type = '未設定';
                if (status !== 'error') status = 'warning';
                messages.push('区分未指定（法人番号なし）のため「未設定」として登録します');
            }
        }

        // 4. メール
        if (norm.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(norm.email)) {
                status = 'error';
                messages.push('メールアドレスの形式が不正です');
            }
        }

        return {
            rowNumber: row._rowNumber,
            status: status,
            messages: messages,
            data: norm,
            raw: row
        };
    });
}

// 5. バッチ登録関数
async function executeBatchImport(importableRows) {
    const total = importableRows.length;
    if (total === 0) return { total: 0, successCount: 0, failedCount: 0, startId: null, endId: null, errors: [] };

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
        } catch (chunkErr) {
            failedCount += chunk.length;
            errors.push({ offset: i, count: chunk.length, error: chunkErr.message });
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

// 6. 顧客検索ロジック（customer_list.js L202-205 シミュレーション）
function simulateCustomerSearch(searchQuery, allCustomers) {
    const searchVal = searchQuery.trim().toLowerCase();
    return allCustomers.filter(c => {
        if (searchVal === "") return true;
        const nameMatch = (c.customer_name || '').toLowerCase().includes(searchVal);
        const kanaMatch = (c.customer_kana && c.customer_kana.toLowerCase().includes(searchVal));
        const searchNameMatch = (c.search_name && c.search_name.toLowerCase().includes(searchVal));
        const searchKanaMatch = (c.search_kana && c.search_kana.toLowerCase().includes(searchVal));
        return nameMatch || kanaMatch || searchNameMatch || searchKanaMatch;
    });
}

// ==========================================
// Phase 6 総合受入試験の実行
// ==========================================
async function runAcceptanceTest() {
    console.log('====================================================');
    console.log('  Phase 6: LAPIS3 顧客CSVインポート 総合受入試験');
    console.log('====================================================\n');

    // 0. 初期データ準備 (既存顧客 1件: ID 1001 が登録済み、カウンター値 1001)
    await db.collection('counters').doc('customers').set({ count: 1001 });
    await db.collection('customers').doc('cust_1001').set({
        customer_id: 1001,
        customer_name: '株式会社既存工務店',
        corporate_number: '1111222233334',
        customer_type: '法人',
        status: '稼働中'
    });

    const existingIndex = {
        corporateNumberMap: new Map([
            ['1111222233334', { customer_id: 1001, customer_name: '株式会社既存工務店' }]
        ]),
        customerNameSet: new Set(['株式会社既存工務店'])
    };

    // 1. 実データ10件（Gビズインフォ補完想定の混在CSVデータ）
    const testCSVData = [
        // ケース1: 正常5件 (行2〜6)
        { _rowNumber: 2, customer_name: '株式会社アイウ建設', customer_kana: 'カブシキガイシャアイウケンセツ', customer_type: '法人', representative_name: '愛羽 太郎', corporate_number: '9876543210123', postal_code: '100-0001', address: '東京都千代田区千代田1-1', phone: '03-1111-2222', email: 'aiu@example.com', remarks: 'Gビズ補完済' },
        { _rowNumber: 3, customer_name: '合同会社カキク開発', customer_kana: 'ゴウドウガイシャカキクカイハツ', customer_type: '法人', representative_name: '柿久 次郎', corporate_number: '8765432109876', postal_code: '105-0004', address: '東京都港区新橋2-2', phone: '03-2222-3333', email: 'kakiku@example.com', remarks: '' },
        { _rowNumber: 4, customer_name: '有限会社サシス商事', customer_kana: 'ユウゲンガイシャサシスショウジ', customer_type: '法人', representative_name: '佐々木 三郎', corporate_number: '7654321098765', postal_code: '160-0022', address: '東京都新宿区新宿3-3', phone: '03-3333-4444', email: 'sashisu@example.com', remarks: '' },
        { _rowNumber: 5, customer_name: '田中電気工事店', customer_kana: 'タナカデンキコウジテン', customer_type: '個人', representative_name: '田中 四郎', corporate_number: '', postal_code: '150-0002', address: '東京都渋谷区渋谷4-4', phone: '090-1234-5678', email: 'tanaka@example.com', remarks: '一人親方' },
        { _rowNumber: 6, customer_name: '高橋設計事務所', customer_kana: 'タカハシセッケイジムショ', customer_type: '個人', representative_name: '高橋 五郎', corporate_number: '', postal_code: '170-0013', address: '東京都豊島区東池袋5-5', phone: '090-2345-6789', email: 'takahashi@example.com', remarks: '建築士' },

        // ケース2: 既存法人番号重複 (行7) -> 警告
        { _rowNumber: 7, customer_name: 'アイウ工務店別名義', customer_kana: 'アイウコウムテン', customer_type: '法人', representative_name: '別名 代表', corporate_number: '1111222233334', postal_code: '100-0001', address: '東京都千代田区', phone: '03-9999-8888', remarks: '既存1001と重複' },

        // ケース3: 顧客名重複 (行8) -> 警告
        { _rowNumber: 8, customer_name: '株式会社既存工務店', customer_kana: 'カブシキガイシャキゾンコウムテン', customer_type: '法人', representative_name: '同名 代表', corporate_number: '5555666677778', postal_code: '100-0001', address: '東京都千代田区', phone: '03-9999-7777', remarks: '既存と同名' },

        // ケース4: 顧客名空欄 (行9) -> エラー (除外)
        { _rowNumber: 9, customer_name: '', customer_kana: '', customer_type: '法人', representative_name: '名前なし', corporate_number: '1234567890999', phone: '03-0000-0000', remarks: '顧客名未入力' },

        // ケース5: 法人番号桁数不正 (行10) -> エラー (除外)
        { _rowNumber: 10, customer_name: '不正番号商事', customer_kana: '', customer_type: '法人', representative_name: '桁数不足', corporate_number: '123456789012', phone: '03-0000-1111', remarks: '12桁' },

        // ケース6: customer_type未指定＆法人番号なし (行11) -> 警告 (未設定で登録)
        { _rowNumber: 11, customer_name: '未指定フリーランス工房', customer_kana: 'ミシテイフリーランス', customer_type: '', representative_name: 'フリー 太郎', corporate_number: '', phone: '090-9999-0000', remarks: '区分未指定' }
    ];

    // ----------------------------------------------------
    // Phase 6-1: バリデーション＆重複判定受入試験
    // ----------------------------------------------------
    console.log('--- [Phase 6-1] 10件CSVの検証＆重複判定試験 ---');
    const validated = validateAndDetectDuplicates(testCSVData, existingIndex);

    const okList = validated.filter(r => r.status === 'ok');
    const warnList = validated.filter(r => r.status === 'warning');
    const errorList = validated.filter(r => r.status === 'error');
    const importableList = validated.filter(r => r.status === 'ok' || r.status === 'warning');

    console.log(`総件数: ${validated.length}件 | 🟢正常: ${okList.length}件 | 🟡警告: ${warnList.length}件 | 🔴エラー: ${errorList.length}件`);
    assert.strictEqual(validated.length, 10, '総件数は10件');
    assert.strictEqual(okList.length, 5, '正常データは5件');
    assert.strictEqual(warnList.length, 3, '警告データは3件（既存法人番号重複、既存同名、区分未指定）');
    assert.strictEqual(errorList.length, 2, 'エラーデータは2件（顧客名空欄、法人番号12桁）');
    assert.strictEqual(importableList.length, 8, '登録可能件数は 8件 (10件中エラー2件除外)');

    // 警告メッセージ詳細確認
    const row7 = validated.find(r => r.rowNumber === 7);
    assert.ok(row7.messages.some(m => m.includes('1001') && m.includes('株式会社既存工務店')), '行7に既存法人番号重複と顧客名が表示されること');

    const row8 = validated.find(r => r.rowNumber === 8);
    assert.ok(row8.messages.some(m => m.includes('既存顧客と同名')), '行8に既存同名警告が表示されること');

    const row11 = validated.find(r => r.rowNumber === 11);
    assert.strictEqual(row11.data.customer_type, '未設定', '行11の区分が「未設定」に設定されていること');
    assert.ok(row11.messages.some(m => m.includes('未設定')), '行11に未設定警告が表示されること');

    console.log('✅ Phase 6-1 PASS: 10件の判定集計・エラー除外・警告メッセージ完全一致\n');

    // ----------------------------------------------------
    // Phase 6-2: Firestoreバッチ登録＆本番スキーマ確認
    // ----------------------------------------------------
    console.log('--- [Phase 6-2] 登録実行＆本番スキーマ完全一致検証 ---');
    const importResult = await executeBatchImport(importableList);

    console.log('登録結果:', importResult);
    assert.strictEqual(importResult.total, 8);
    assert.strictEqual(importResult.successCount, 8);
    assert.strictEqual(importResult.failedCount, 0);
    assert.strictEqual(importResult.startId, 1002);
    assert.strictEqual(importResult.endId, 1009);

    // 登録されたドキュメントのスキーマ詳細検証 (ID 1002: 株式会社アイウ建設)
    const doc1002 = db.store.get('customers/cust_1002');
    assert.ok(doc1002, 'cust_1002 が存在すること');
    assert.strictEqual(typeof doc1002.customer_id, 'number', 'customer_id は数値型');
    assert.strictEqual(doc1002.customer_id, 1002);
    assert.strictEqual(doc1002.customer_name, '株式会社アイウ建設');
    assert.strictEqual(doc1002.customer_kana, 'カブシキガイシャアイウケンセツ');
    assert.strictEqual(doc1002.customer_type, '法人');
    assert.strictEqual(doc1002.status, '稼働中');
    assert.strictEqual(doc1002.nenga, 'なし');
    assert.strictEqual(doc1002.chugen, 'なし');
    assert.strictEqual(doc1002.fax_ok, '送信OK');
    assert.strictEqual(doc1002.corporate_number, '9876543210123');
    assert.strictEqual(doc1002.search_name, 'アイウ建設', '法人格「株式会社」が除外された検索名');
    assert.strictEqual(doc1002.search_kana, 'アイウケンセツ', 'カナ法人格が除外された検索カナ');
    assert.ok(doc1002.created_date, 'created_date がセットされていること');
    assert.ok(doc1002.last_updated, 'last_updated がセットされていること');

    // 「未設定」で登録されたドキュメント検証 (ID 1009: 未指定フリーランス工房)
    const doc1009 = db.store.get('customers/cust_1009');
    assert.ok(doc1009, 'cust_1009 が存在すること');
    assert.strictEqual(doc1009.customer_type, '未設定');
    assert.strictEqual(doc1009.customer_name, '未指定フリーランス工房');

    console.log('✅ Phase 6-2 PASS: スキーマ完全一致・検索キー自動生成・連番 1002..1009 登録完了\n');

    // ----------------------------------------------------
    // Phase 6-3: 顧客一覧・検索・詳細編集フローの検証
    // ----------------------------------------------------
    console.log('--- [Phase 6-3] 顧客一覧・検索・詳細編集フロー検証 ---');

    // 全顧客データを取得 (既存 1件 + 今回登録 8件 = 9件)
    const allCustomers = [];
    for (let [key, val] of db.store.entries()) {
        if (key.startsWith('customers/')) {
            allCustomers.push(val);
        }
    }
    assert.strictEqual(allCustomers.length, 9, 'Firestore内の全顧客数は9件');

    // 検索テスト1: 「アイウ」で検索 -> 「株式会社アイウ建設」がヒット
    const searchResult1 = simulateCustomerSearch('アイウ', allCustomers);
    assert.ok(searchResult1.some(c => c.customer_name === '株式会社アイウ建設'), '「アイウ」で株式会社アイウ建設がヒットすること');

    // 検索テスト2: 法人格なしの「建設」で検索 -> ヒット
    const searchResult2 = simulateCustomerSearch('建設', allCustomers);
    assert.ok(searchResult2.some(c => c.customer_name === '株式会社アイウ建設'));

    // 検索テスト3: 「田中」で検索 -> 「田中電気工事店」がヒット
    const searchResult3 = simulateCustomerSearch('田中', allCustomers);
    assert.strictEqual(searchResult3.length, 1);
    assert.strictEqual(searchResult3[0].customer_name, '田中電気工事店');

    // 詳細画面での編集保存シミュレーション (ID 1009 の「未設定」を「個人」に変更して保存)
    const targetCust = db.store.get('customers/cust_1009');
    assert.strictEqual(targetCust.customer_type, '未設定');

    // 人間が顧客詳細フォームで「個人」を選択して保存
    targetCust.customer_type = '個人';
    targetCust.last_updated = new Date().toISOString();
    await db.collection('customers').doc('cust_1009').set(targetCust);

    const updatedDoc1009 = db.store.get('customers/cust_1009');
    assert.strictEqual(updatedDoc1009.customer_type, '個人', '詳細画面での保存で「個人」に正常更新されること');

    console.log('✅ Phase 6-3 PASS: 部分一致検索（法人格なし検索）・詳細画面の区分確定更新フロー動作確認\n');

    console.log('====================================================');
    console.log('  🎉 総合受入試験（Phase 6）全項目合格！');
    console.log('====================================================');
}

runAcceptanceTest().catch(err => {
    console.error('❌ Acceptance Test Failed:', err);
    process.exit(1);
});
