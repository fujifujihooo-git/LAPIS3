const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('🚀 LAPIS3 顧客カルテ 請求書一覧クリック遷移機能 自動検証');
console.log('========================================================================\n');

// 1. customer_detail.js の検証
console.log('--- 1. customer_detail.js の検証 ---');
const customerDetailCode = fs.readFileSync(path.resolve(__dirname, '../customer_detail.js'), 'utf8');

// [UT-BILLING-001] invoice-row クラスおよび data-id の付与
assert.ok(
    customerDetailCode.includes("tr.className = 'invoice-row';") &&
    customerDetailCode.includes("tr.dataset.id = docId;"),
    '❌ customer_detail.js に invoice-row クラスまたは data-id 付与ロジックが存在しません'
);
console.log('✅ [UT-BILLING-001] 各請求書行への invoice-row クラスおよび data-id 付与を確認');

// [UT-BILLING-002] 状態別クラス（is-cancelled, has-balance）の付与
assert.ok(
    customerDetailCode.includes("tr.classList.add('is-cancelled');") &&
    customerDetailCode.includes("tr.classList.add('has-balance');"),
    '❌ 取消・未収状態に応じた CSS クラス付与ロジックが存在しません'
);
console.log('✅ [UT-BILLING-002] インラインスタイルを排除した状態別 CSS クラス (is-cancelled, has-balance) 付与を確認');

// [UT-BILLING-003] イベント委譲方式によるクリック遷移ハンドラ
assert.ok(
    customerDetailCode.includes("billingListBody.addEventListener('click', (e) => {") &&
    customerDetailCode.includes("const row = e.target.closest('.invoice-row');") &&
    customerDetailCode.includes("window.location.href = `invoice_detail.html?id=${encodeURIComponent(docId)}`;"),
    '❌ イベント委譲方式のクリック遷移ハンドラが正しく設定されていません'
);
console.log('✅ [UT-BILLING-003] billingListBody に対するイベント委譲方式のクリック遷移ロジックを確認');


// 2. style_modern.css の検証
console.log('\n--- 2. style_modern.css の検証 ---');
const styleCss = fs.readFileSync(path.resolve(__dirname, '../style_modern.css'), 'utf8');

// [UT-BILLING-004] invoice-row の cursor と hover
assert.ok(
    styleCss.includes('.billing-table tbody tr.invoice-row {') &&
    styleCss.includes('cursor: pointer;') &&
    styleCss.includes('.billing-table tbody tr.invoice-row:hover {') &&
    styleCss.includes('background-color: #f5f8ff;'),
    '❌ style_modern.css に invoice-row の cursor または hover スタイルが存在しません'
);
console.log('✅ [UT-BILLING-004] .invoice-row の cursor: pointer および hover: #f5f8ff スタイルを確認');

// [UT-BILLING-005] !important の不使用
const invoiceRowHoverMatch = styleCss.match(/\.billing-table tbody tr\.invoice-row:hover\s*\{([^}]+)\}/);
assert.ok(
    invoiceRowHoverMatch && !invoiceRowHoverMatch[1].includes('!important'),
    '❌ invoice-row:hover に !important が使用されています'
);
console.log('✅ [UT-BILLING-005] invoice-row:hover に !important が使われていないことを確認');


// 3. customer_detail.html の検証
console.log('\n--- 3. customer_detail.html の検証 ---');
const customerDetailHtml = fs.readFileSync(path.resolve(__dirname, '../customer_detail.html'), 'utf8');

// [UT-BILLING-006] テーブル構造が6列のまま維持されていること
const tableMatch = customerDetailHtml.match(/<table[^>]*id="customer-billing-table"[^>]*>([\s\S]*?)<\/thead>/);
assert.ok(tableMatch, '❌ customer-billing-table が見つかりません');
const thCount = (tableMatch[1].match(/<th[\s>]/g) || []).length;
assert.strictEqual(thCount, 6, `❌ テーブルヘッダーの列数が 6 ではありません (現在: ${thCount})`);
console.log('✅ [UT-BILLING-006] 請求書一覧テーブルが 6 列構造（スマホ・タブレット配慮）を維持していることを確認');

console.log('\n------------------------------------------------------------------------');
console.log('🎉 すべての請求書一覧クリック遷移機能検証テストに合格しました！ [合格: 6/6]');
console.log('------------------------------------------------------------------------');
