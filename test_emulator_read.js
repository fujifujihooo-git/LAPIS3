/**
 * Phase3-1 検証スクリプト
 * 
 * search_utils.js のロジック検証と
 * Firestoreクエリの動作確認を行う。
 */

const admin = require('firebase-admin');
const { generateSearchName, generateSearchKana, normalizeSearchText } = require('./search_utils');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
admin.initializeApp({ projectId: 'lapis3-4113e' });
const db = admin.firestore();

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(name, condition, detail) {
        if (condition) {
            console.log(`  ✅ PASS: ${name}`);
            passed++;
        } else {
            console.log(`  ❌ FAIL: ${name} | ${detail || ''}`);
            failed++;
        }
    }

    // ============================================
    // Test 1: search_utils.js ロジック検証
    // ============================================
    console.log('\n=== Test 1: search_utils.js ロジック検証 ===');
    
    assert('法人格除去 - 株式会社', generateSearchName('株式会社 テスト商事') === 'テスト商事',
        `got: "${generateSearchName('株式会社 テスト商事')}"`);
    
    assert('法人格除去 - NPO法人', generateSearchName('NPO法人 未来クリエイティブ') === '未来クリエイティブ',
        `got: "${generateSearchName('NPO法人 未来クリエイティブ')}"`);
    
    assert('法人格除去 - 一般社団法人', generateSearchName('一般社団法人 グローバル・リンク') === 'グローバルリンク',
        `got: "${generateSearchName('一般社団法人 グローバル・リンク')}"`);
    
    assert('法人格なし', generateSearchName('田中 建設工業') === '田中建設工業',
        `got: "${generateSearchName('田中 建設工業')}"`);
    
    assert('カナ法人格除去', generateSearchKana('カブシキガイシャ テストショウジ') === 'テストショウジ',
        `got: "${generateSearchKana('カブシキガイシャ テストショウジ')}"`);
    
    assert('normalizeSearchText - スペース除去', normalizeSearchText('テスト 商事') === 'テスト商事',
        `got: "${normalizeSearchText('テスト 商事')}"`);
    
    assert('normalizeSearchText - 記号除去', normalizeSearchText('サンプル・ソリューションズ') === 'サンプルソリューションズ',
        `got: "${normalizeSearchText('サンプル・ソリューションズ')}"`);
    
    assert('null入力', generateSearchName(null) === '' && generateSearchKana(null) === '', 'null should return empty string');
    
    assert('空文字入力', generateSearchName('') === '' && generateSearchKana('') === '', 'empty should return empty string');

    // ============================================
    // Test 2: 移行データの検証
    // ============================================
    console.log('\n=== Test 2: 移行データの検証 ===');
    
    const snap = await db.collection('customers').get();
    let allHaveSearchName = true;
    let allHaveSearchKana = true;
    let missingFields = [];
    
    snap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.search_name && data.search_name !== '') {
            allHaveSearchName = false;
            missingFields.push(`${doc.id}: search_name missing`);
        }
        if (!data.search_kana && data.search_kana !== '') {
            allHaveSearchKana = false;
            missingFields.push(`${doc.id}: search_kana missing`);
        }
    });
    
    assert('全顧客にsearch_nameが存在', allHaveSearchName, missingFields.join(', '));
    assert('全顧客にsearch_kanaが存在', allHaveSearchKana, missingFields.join(', '));

    // ============================================
    // Test 3: Firestoreクエリ検証 (前方一致検索)
    // ============================================
    console.log('\n=== Test 3: Firestoreクエリ検証 ===');
    
    // search_name 前方一致: "テスト" で検索
    const nameQuery = normalizeSearchText('テスト');
    const nameSnap = await db.collection('customers')
        .where('status', '==', '稼働中')
        .where('search_name', '>=', nameQuery)
        .where('search_name', '<=', nameQuery + '\uf8ff')
        .limit(10)
        .get();
    
    assert('search_name前方一致: "テスト" → 結果あり', nameSnap.size > 0,
        `got ${nameSnap.size} results`);
    
    console.log(`    検索結果 (search_name "テスト"):`);
    nameSnap.docs.forEach(d => {
        const data = d.data();
        console.log(`      → ${data.customer_name} (search_name: ${data.search_name})`);
    });
    
    // search_kana 前方一致: "スズキ" で検索
    const kanaQuery = normalizeSearchText('スズキ');
    const kanaSnap = await db.collection('customers')
        .where('status', '==', '稼働中')
        .where('search_kana', '>=', kanaQuery)
        .where('search_kana', '<=', kanaQuery + '\uf8ff')
        .limit(10)
        .get();
    
    assert('search_kana前方一致: "スズキ" → 結果あり', kanaSnap.size > 0,
        `got ${kanaSnap.size} results`);
    
    console.log(`    検索結果 (search_kana "スズキ"):`);
    kanaSnap.docs.forEach(d => {
        const data = d.data();
        console.log(`      → ${data.customer_name} (search_kana: ${data.search_kana})`);
    });
    
    // 存在しない顧客の検索 → 0件
    const noResultSnap = await db.collection('customers')
        .where('status', '==', '稼働中')
        .where('search_name', '>=', 'zzzzzzz')
        .where('search_name', '<=', 'zzzzzzz\uf8ff')
        .limit(10)
        .get();
    
    assert('存在しない顧客検索 → 0件', noResultSnap.size === 0,
        `expected 0, got ${noResultSnap.size}`);

    // ============================================
    // Test 4: Read数検証
    // ============================================
    console.log('\n=== Test 4: Read数分析 ===');
    
    // 旧方式: 全件取得
    const allCustomersSnap = await db.collection('customers').where('status', '==', '稼働中').get();
    const oldReadCount = allCustomersSnap.size;
    console.log(`  旧方式 (全件取得): ${oldReadCount} Read`);
    
    // 新方式: 検索クエリ (最大10件 × 2クエリ)
    const newReadCount = nameSnap.size + kanaSnap.size;
    console.log(`  新方式 (検索クエリ): ${newReadCount} Read (最大20)`);
    
    console.log(`  初期表示: 旧方式 ${oldReadCount} Read → 新方式 0 Read`);
    console.log(`  検索時: 新方式は入力ごとに最大20 Read（ただし顧客件数に非依存）`);

    // ============================================
    // 結果サマリ
    // ============================================
    console.log(`\n${'='.repeat(50)}`);
    console.log(`テスト結果: ${passed} passed / ${failed} failed`);
    console.log(`${'='.repeat(50)}`);

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('テストエラー:', err);
    process.exit(1);
});
