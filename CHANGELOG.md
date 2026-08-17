# Changelog

All notable changes to this project will be documented in this file.

### 2026-08-03

Fixed:
- fix(case→invoice): 案件画面から請求書作成できない不具合を修正
  - `detail.js` の `btn-create-invoice-from-case` ハンドラで未定義変数 `currentCaseId` を参照していたため、
    ボタンクリック時に常に「案件情報が保存されていません」と表示され、請求書作成画面に遷移できなかった
  - 正しい変数 `caseId` に修正（L337, L352, L371）
  - 原因コミット: `eed2d00` (2026-07-31)

Added:
- E2E受入テスト Step 1 を構築 (`test_acceptance_step1.js`)
  - Scenario A: 案件 → 請求書作成 → 保存 → 戻り
  - Scenario B: 案件 → 請求書作成 → 閉じる → 請求書未増加確認
  - Scenario C: 案件 → 請求書作成 → 金額変更 → 保存 → 見積明細不変確認

Tests:
- E2E Step 1 全3シナリオ PASS
- テストレポート: `docs/testing/E2E_ACCEPTANCE_STEP1_REPORT_20260803.md`

### 2026-07-30

Added:
- 案件詳細画面に見積書PDF出力機能を追加
- estimate_pdf.js を追加
- 見積番号 EST-{案件番号} を自動生成
- 有効期限表示を追加
- 税区分混在対応
- PDFファイル名サニタイズ対応

Tests:
- UT-EST-001 ～ UT-EST-008 PASS


### 2026-07-31

Added:
- 案件詳細画面からの請求書作成機能（Phase 1）を追加
- 案件と請求書の独立オブジェクト化（参照切り離し）
- 請求書データに送信元情報（source_type, source_id, case_id, case_number）を保存する処理を追加
- 請求書の二重作成防止用警告ダイアログ（件数表示付き）を追加
- 明細のない案件からの請求書作成ブロック機能を追加
- 保存失敗時のリダイレクト阻止機構を確認・実証

Tests:
- UT-INV-CASE-001 ～ 007 PASS
