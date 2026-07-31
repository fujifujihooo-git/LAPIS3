# Changelog

All notable changes to this project will be documented in this file.

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
