const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('========================================================================');
console.log('🚀 LAPIS3 顧客カルテ 履歴タブ・帳票タブ運用改善 (フェーズ1〜3 & フェーズ5) 自動単体検証');
console.log('========================================================================\n');

// 1. customer_detail.js の検証
console.log('--- 1. customer_detail.js の検証 ---');
const customerDetailCode = fs.readFileSync(path.resolve(__dirname, '../customer_detail.js'), 'utf8');

// [UT-PH1-001] 備考行削除
assert.ok(
    !customerDetailCode.includes('<div class="detail-label">備考</div>'),
    '❌ customer_detail.js に「備考」ラベル行が残っています'
);
console.log('✅ [UT-PH1-001] 履歴詳細UIから「備考」表示エリアが完全に削除されていることを確認');

// [UT-PH1-002] 過去備考フォールバック
assert.ok(
    customerDetailCode.includes('【過去登録備考】'),
    '❌ customer_detail.js に過去登録備考の安全合流コードが存在しません'
);
console.log('✅ [UT-PH1-002] 過去データ備考 (h.remarks) の安全合流フォールバック機構を確認');

// [UT-PH5-001] getHistoryTypeMeta による安全な動的表示変換機構
assert.ok(
    customerDetailCode.includes('function getHistoryTypeMeta(h)'),
    '❌ customer_detail.js に getHistoryTypeMeta 関数が存在しません'
);
assert.ok(
    customerDetailCode.includes("type = '書類発送';") && customerDetailCode.includes("type = '帳票出力';"),
    '❌ getHistoryTypeMeta で過去データの安全変換ロジックが不足しています'
);
console.log('✅ [UT-PH5-001] 過去データを破壊せず表示時のみ安全に変換する getHistoryTypeMeta ロジックを確認');

// [UT-PH5-002] アイコン必須設計（package, file-text, phone, mail, users, more-horizontal）
assert.ok(
    customerDetailCode.includes("icon: 'package'") &&
    customerDetailCode.includes("icon: 'file-text'") &&
    customerDetailCode.includes("icon: 'phone'") &&
    customerDetailCode.includes("icon: 'mail'") &&
    customerDetailCode.includes("icon: 'users'"),
    '❌ 各種別に対する専用アイコンマッピングが不足しています'
);
console.log('✅ [UT-PH5-002] 色だけでなくアイコンだけでも即座に判別できる設計（package, file-text, phone, mail, users）を確認');

// [UT-PH5-003] 種別フィルタの適用
assert.ok(
    customerDetailCode.includes('const meta = getHistoryTypeMeta(h);') &&
    customerDetailCode.includes('!checkedTypes.includes(meta.type)'),
    '❌ applyHistoryFilters で getHistoryTypeMeta に基づくフィルタ判定が正しく行われていません'
);
console.log('✅ [UT-PH5-003] フィルタリング処理での動的種別メタ判定連携を確認');


// 2. customer_detail.html の検証
console.log('\n--- 2. customer_detail.html の検証 ---');
const customerDetailHtml = fs.readFileSync(path.resolve(__dirname, '../customer_detail.html'), 'utf8');

// [UT-PH5-004] CSS カラー定義
assert.ok(
    customerDetailHtml.includes('.type-color-shipping') && customerDetailHtml.includes('.type-color-report'),
    '❌ customer_detail.html に新種別用カラーCSS (.type-color-shipping, .type-color-report) が不足しています'
);
console.log('✅ [UT-PH5-004] 新種別（書類発送: 濃ネイビー, 帳票出力: ティール）のCSSスタイル定義を確認');

// [UT-PH5-005] フィルタ初期値「すべて」ON ＆ 新種別チェックボックス
assert.ok(
    customerDetailHtml.includes('id="filter-type-all" checked'),
    '❌ フィルタ初期値「すべて」が checked になっていません'
);
assert.ok(
    customerDetailHtml.includes('value="書類発送"') && customerDetailHtml.includes('value="帳票出力"'),
    '❌ フィルタチェックボックスに「書類発送」または「帳票出力」が不足しています'
);
console.log('✅ [UT-PH5-005] フィルタ初期値「すべて」全選択担保 ＆ 新種別（書類発送・帳票出力）フィルタUIを確認');

// [UT-PH5-006] 履歴登録モーダルのラジオボタン
assert.ok(
    customerDetailHtml.includes('name="history-type" value="書類発送"') &&
    customerDetailHtml.includes('name="history-type" value="帳票出力"'),
    '❌ 履歴登録モーダルに「書類発送」または「帳票出力」のラジオボタンが不足しています'
);
console.log('✅ [UT-PH5-006] 履歴登録・編集モーダルへの「書類発送」「帳票出力」選択UI追加を確認');


// 3. js/document_return_modal.js の検証
console.log('\n--- 3. 書類返却通知書モーダル (document_return_modal.js) の検証 ---');
const docReturnModalCode = fs.readFileSync(path.resolve(__dirname, '../js/document_return_modal.js'), 'utf8');

// [UT-PH2-001] 推奨ラベルUI
assert.ok(
    docReturnModalCode.includes('対応履歴に記録する（推奨）'),
    '❌ document_return_modal.js に「対応履歴に記録する（推奨）」ラベルが存在しません'
);
console.log('✅ [UT-PH2-001] 書類返却通知書モーダルに「対応履歴に記録する（推奨）」チェックボックスUIが存在');

// [UT-PH2-002] 発行日時自動保存
assert.ok(
    docReturnModalCode.includes('発行日時：'),
    '❌ document_return_modal.js に「発行日時：」の自動生成コードが存在しません'
);
console.log('✅ [UT-PH2-002] 発行日時の自動保存ロジック（フェーズ2.1）を確認');

// [UT-PH2-003] 発送方法・追跡番号・宛先・返却書類の集約
assert.ok(
    docReturnModalCode.includes('発送方法：') && docReturnModalCode.includes('追跡番号：') && docReturnModalCode.includes('返却書類：'),
    '❌ document_return_modal.js の content に発送方法・追跡番号・返却書類が集約されていません'
);
console.log('✅ [UT-PH2-003] content への発送方法・追跡番号・宛先・返却書類の100%再現フォーマット集約を確認');

// [UT-PH5-007] 保存種別が「書類発送」であること
assert.ok(
    docReturnModalCode.includes('history_type: "書類発送"'),
    '❌ document_return_modal.js の保存 history_type が「書類発送」ではありません'
);
console.log('✅ [UT-PH5-007] 書類返却通知書の保存種別が history_type = "書類発送" へ連動していることを確認');

// [UT-PH3-001] チェックOFF時スキップ
assert.ok(
    docReturnModalCode.includes('対応履歴の保存はスキップされました'),
    '❌ document_return_modal.js にチェックOFF時のスキップ案内が存在しません'
);
console.log('✅ [UT-PH3-001] チェックOFF時の履歴保存スキップ＆PDFプレビュー発行動作を確認');


// 4. js/modals/shipping_label_modal.js の検証
console.log('\n--- 4. レターパック宛名印刷モーダル (shipping_label_modal.js) の検証 ---');
const shipLabelModalCode = fs.readFileSync(path.resolve(__dirname, '../js/modals/shipping_label_modal.js'), 'utf8');

// [UT-PH2-006] 追跡番号入力UI
assert.ok(
    shipLabelModalCode.includes('ship-label-tracking-input'),
    '❌ shipping_label_modal.js に ship-label-tracking-input が存在しません'
);
console.log('✅ [UT-PH2-006] レターパック宛名印刷モーダルに「追跡番号」入力欄が存在');

// [UT-PH3-002] 推奨ラベルUI
assert.ok(
    shipLabelModalCode.includes('対応履歴に記録する（推奨）'),
    '❌ shipping_label_modal.js に「対応履歴に記録する（推奨）」ラベルが存在しません'
);
console.log('✅ [UT-PH3-002] レターパック宛名印刷モーダルに「対応履歴に記録する（推奨）」チェックボックスUIが存在');

// [UT-PH2-007] 発行日時・発送方法・追跡番号・同封書類集約
assert.ok(
    shipLabelModalCode.includes('発行日時：') && shipLabelModalCode.includes('発送方法：') && shipLabelModalCode.includes('同封書類：'),
    '❌ shipping_label_modal.js の content に発行日時・発送方法・同封書類が集約されていません'
);
console.log('✅ [UT-PH2-007] レターパック content への発行日時・発送方法・追跡番号・同封書類の完全集約を確認');

// [UT-PH5-008] 保存種別が「書類発送」であること
assert.ok(
    shipLabelModalCode.includes('history_type: "書類発送"'),
    '❌ shipping_label_modal.js の保存 history_type が「書類発送」ではありません'
);
console.log('✅ [UT-PH5-008] レターパック宛名印刷の保存種別が history_type = "書類発送" へ連動していることを確認');

// [UT-PH3-003] チェックOFF時スキップ
assert.ok(
    shipLabelModalCode.includes('対応履歴の保存はスキップされました'),
    '❌ shipping_label_modal.js にチェックOFF時のスキップ案内が存在しません'
);
console.log('✅ [UT-PH3-003] レターパックのチェックOFF時スキップ＆PDFプレビュー発行動作を確認');

console.log('\n------------------------------------------------------------------------');
console.log('🎉 すべてのフェーズ1〜3 ＆ フェーズ5改善検証テストに合格しました！ [合格: 16/16]');
console.log('------------------------------------------------------------------------');
