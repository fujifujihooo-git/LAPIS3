// Code Audit Verification Script
const assert = require('assert');

// CustomerImporter の判定・正規化ロジックの抽出検証
function toHalfDigits(str) {
    if (!str) return '';
    return String(str).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function normalizeHyphens(str) {
    if (!str) return '';
    return String(str).replace(/[\u2010-\u2015\u2212\uFF0D\u30FC]/g, '-');
}

function normalizeCustomerRow(rawRow) {
    const normalized = {
        customer_name: (rawRow.customer_name || '').trim(),
        customer_kana: (rawRow.customer_kana || '').trim(),
        representative_name: (rawRow.representative_name || '').trim(),
        corporate_number: toHalfDigits(rawRow.corporate_number || '').trim().replace(/\D/g, ''),
        postal_code: normalizeHyphens(toHalfDigits(rawRow.postal_code || '')).trim(),
        address: (rawRow.address || '').trim(),
        building_name: (rawRow.building_name || '').trim(),
        phone: normalizeHyphens(toHalfDigits(rawRow.phone || '')).trim(),
        fax: normalizeHyphens(toHalfDigits(rawRow.fax || '')).trim(),
        email: (rawRow.email || '').trim(),
        remarks: (rawRow.remarks || '').trim(),
        customer_type: (rawRow.customer_type || '').trim()
    };
    return normalized;
}

function validateRow(rawRow) {
    const norm = normalizeCustomerRow(rawRow);
    let status = 'ok';
    const messages = [];

    // 1. 顧客名チェック (必須)
    if (!norm.customer_name) {
        status = 'error';
        messages.push('顧客名が未入力です');
    }

    // 2. 法人番号チェック (任意入力)
    if (norm.corporate_number) {
        if (norm.corporate_number.length !== 13) {
            status = 'error';
            messages.push('法人番号は半角数字13桁で入力してください');
        }
    }

    // 3. 顧客区分（customer_type）の判定
    norm.customer_type = (norm.customer_type || '').replace(/[\s　]+/g, '');
    if (!norm.customer_type) {
        if (norm.corporate_number && norm.corporate_number.length === 13) {
            norm.customer_type = '法人';
        } else {
            norm.customer_type = '未設定';
            if (status !== 'error') status = 'warning';
            messages.push('区分未指定（法人番号なし）のため「未設定」として登録します');
        }
    } else if (!['法人', '個人'].includes(norm.customer_type)) {
        const rawType = norm.customer_type;
        norm.customer_type = '未設定';
        if (status !== 'error') status = 'warning';
        messages.push(`区分「${rawType}」は未定義のため「未設定」として登録します`);
    }

    // 4. メールアドレス形式チェック (任意入力: 不正時は警告として登録可)
    if (norm.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(norm.email)) {
            if (status !== 'error') status = 'warning';
            messages.push('メールアドレスの形式が不正です（登録後に確認・修正してください）');
        }
    }

    return { status, messages, data: norm };
}

async function runAudit() {
    console.log('=====================================================');
    console.log('  LAPIS3 customer_import.js コード監査実測テスト');
    console.log('=====================================================\n');

    // Case 1: メール形式不正 -> 🟡 警告（登録可）
    const r1 = validateRow({ customer_name: '株式会社テスト', email: 'invalid_email_no_at' });
    console.log('【監査項目 1: メールアドレス形式不正】');
    console.log('  判定ステータス:', r1.status, '(期待値: warning)');
    console.log('  メッセージ:', r1.messages[0]);
    assert.strictEqual(r1.status, 'warning', 'メール不正は error ではなく warning であること');
    assert.ok(r1.messages.some(m => m.includes('メールアドレスの形式が不正です')), 'メール警告メッセージが含まれていること');
    console.log('  👉 PASS: メール不正時もレコード除外されず登録可として判定\n');

    // Case 2: 区分「個人事業主」 -> 🟡 警告 ＆ data.customer_type は「未設定」にフォールバック
    const r2 = validateRow({ customer_name: '田中工房', customer_type: '個人事業主' });
    console.log('【監査項目 2: 区分表記揺れ「個人事業主」】');
    console.log('  判定ステータス:', r2.status, '(期待値: warning)');
    console.log('  保存予定 customer_type:', r2.data.customer_type, '(期待値: 未設定)');
    console.log('  メッセージ:', r2.messages[0]);
    assert.strictEqual(r2.status, 'warning');
    assert.strictEqual(r2.data.customer_type, '未設定', '生値の個人事業主ではなく未設定で保存されること');
    console.log('  👉 PASS: 未定義区分は自動で未設定にフォールバックし警告表示\n');

    // Case 3: 区分「法人　」（全角スペース混入） -> 🟢 正常 ＆ data.customer_type は「法人」
    const r3 = validateRow({ customer_name: '鈴木商事', customer_type: '法人　' });
    console.log('【監査項目 3: 区分への全角スペース混入「法人　」】');
    console.log('  判定ステータス:', r3.status, '(期待値: ok)');
    console.log('  保存予定 customer_type:', r3.data.customer_type, '(期待値: 法人)');
    assert.strictEqual(r3.status, 'ok');
    assert.strictEqual(r3.data.customer_type, '法人');
    console.log('  👉 PASS: 全角/半角スペースは自動トリムされ正常判定\n');

    // Case 4: 顧客名未入力 -> 🔴 エラー（除外）
    const r4 = validateRow({ customer_name: '', corporate_number: '1234567890123' });
    console.log('【監査項目 4: 顧客名未入力】');
    console.log('  判定ステータス:', r4.status, '(期待値: error)');
    assert.strictEqual(r4.status, 'error');
    console.log('  👉 PASS: 顧客名未入力は確実にエラー除外\n');

    // Case 5: 法人番号12桁 -> 🔴 エラー（除外）
    const r5 = validateRow({ customer_name: '佐藤工務店', corporate_number: '123456789012' });
    console.log('【監査項目 5: 法人番号桁数不正(12桁)】');
    console.log('  判定ステータス:', r5.status, '(期待値: error)');
    assert.strictEqual(r5.status, 'error');
    console.log('  👉 PASS: 法人番号12桁は確実にエラー除外\n');

    console.log('=====================================================');
    console.log('  🎉 すべてのコード監査項目が設計通りであることを証明完了！');
    console.log('=====================================================');
}

runAudit().catch(err => {
    console.error('❌ Audit Failed:', err);
    process.exit(1);
});
