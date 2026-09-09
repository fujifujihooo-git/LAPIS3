/**
 * test_contact_detail_ui.js
 * 担当者詳細画面（contact_detail.html）UIレイアウト改善 単体検証テスト
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('========================================================================');
console.log('🚀 LAPIS3 担当者詳細画面 レイアウト改善 UI自動単体検証');
console.log('========================================================================\n');

const htmlPath = path.join(__dirname, '..', 'contact_detail.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

let passCount = 0;
let totalTests = 0;

function runTest(testId, description, fn) {
    totalTests++;
    try {
        fn();
        console.log(`✅ [${testId}] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`❌ [${testId}] ${description}: ${err.message}`);
    }
}

// 1. 大見出しの検証
runTest('UT-CD-001', '大見出しが「担当者編集」に設定されていること', () => {
    assert(
        htmlContent.includes('<h2 style="margin: 0; font-size: 1.5rem; color: var(--text-main);">担当者編集</h2>') ||
        htmlContent.includes('>担当者編集</h2>'),
        '大見出し「担当者編集」が見つかりません'
    );
});

// 2. セクション見出しの検証
runTest('UT-CD-002', '3つのセクション見出し（👤 担当者情報, ☎ 連絡先, 📌 管理情報）が存在すること', () => {
    assert(htmlContent.includes('👤 担当者情報'), '「👤 担当者情報」が見つかりません');
    assert(htmlContent.includes('☎ 連絡先'), '「☎ 連絡先」が見つかりません');
    assert(htmlContent.includes('📌 管理情報'), '「📌 管理情報」が見つかりません');
});

// 3. Unicodeアイコンの検証
runTest('UT-CD-003', '必要なUnicodeアイコンが全てラベルに正しく含まれていること', () => {
    const requiredIcons = [
        { label: '👤 氏名', id: 'contact_name' },
        { label: '📝 フリガナ', id: 'contact_kana' },
        { label: '🏢 部署', id: 'department' },
        { label: '🎖 役職', id: 'title' },
        { label: '📍 所属拠点', id: 'office_id' },
        { label: '☎ 電話番号', id: 'phone' },
        { label: '📱 携帯番号', id: 'mobile' },
        { label: '✉ メールアドレス', id: 'email' },
        { label: '📠 FAX番号', id: 'fax' }
    ];

    for (const item of requiredIcons) {
        assert(htmlContent.includes(item.label), `ラベル「${item.label}」が見つかりません`);
    }
});

// 4. 汎用クラス名と構造の検証
runTest('UT-CD-004', '汎用クラス（.form-section, .info-list, .info-row, .info-label, .info-value）による構造が存在すること', () => {
    assert(htmlContent.includes('class="form-section"'), 'クラス「form-section」が見つかりません');
    assert(htmlContent.includes('class="info-list"'), 'クラス「info-list」が見つかりません');
    assert(htmlContent.includes('class="info-row"'), 'クラス「info-row」が見つかりません');
    assert(htmlContent.includes('class="info-label"'), 'クラス「info-label」が見つかりません');
    assert(htmlContent.includes('class="info-value"'), 'クラス「info-value」が見つかりません');
});

// 5. CSSスタイル定義（ラベル幅・最大幅・レスポンシブ）の検証
runTest('UT-CD-005', 'CSSスタイル定義（width: 130px, max-width: 700px, @media 640px）が正しく定義されていること', () => {
    assert(htmlContent.includes('width: 130px;'), 'CSS「width: 130px;」が定義されていません');
    assert(htmlContent.includes('max-width: 700px;'), 'CSS「max-width: 700px;」が定義されていません');
    assert(htmlContent.includes('@media (max-width: 640px)'), 'レスポンシブ用「@media (max-width: 640px)」が定義されていません');
    assert(htmlContent.includes('.form-section {'), 'CSS「.form-section」が定義されていません');
});

// 6. 全入力要素IDの維持（JS連携・保存処理の非破壊検証）
runTest('UT-CD-006', '全ての入力要素ID（JS連動）が100%維持されていること', () => {
    const requiredIds = [
        'contact_name',
        'contact_kana',
        'department',
        'title',
        'office_id',
        'is_primary',
        'phone',
        'mobile',
        'email',
        'fax',
        'status',
        'remarks',
        'btn-back',
        'btn-delete',
        'btn-save',
        'header-contact-name',
        'customer-link',
        'page-title'
    ];

    for (const id of requiredIds) {
        assert(
            htmlContent.includes(`id="${id}"`),
            `要素ID「${id}」が見つかりません。JavaScript連動が壊れている可能性があります。`
        );
    }
});

console.log('------------------------------------------------------------------------');
if (passCount === totalTests) {
    console.log(`🎉 すべての担当者詳細画面UI改善検証テストに合格しました！ [合格: ${passCount}/${totalTests}]\n`);
    process.exit(0);
} else {
    console.error(`⚠️ 一部のテストに失敗しました [合格: ${passCount}/${totalTests}]\n`);
    process.exit(1);
}
