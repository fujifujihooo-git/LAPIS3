# E2E受入テスト Step 1 レポート (2026-08-03)

## 結果

```
Scenario A PASSED   (Case → 請求書作成 → 保存 → 戻り)
Scenario B PASSED   (Case → 請求書作成 → 閉じる → 請求書未増加確認)
Scenario C PASSED   (Case → 請求書作成 → 金額変更 → 保存 → 見積明細不変確認)

=== All Step 1 Acceptance Tests PASSED ===
```

## 実施環境

| 項目 | 値 |
|---|---|
| 日時 | 2026-08-03 16:10 JST |
| 環境 | Firebase Emulator (Auth + Firestore) |
| ブラウザ | Puppeteer (headless Chromium) |
| テストファイル | `test_acceptance_step1.js` |

---

## 発見された不具合

### 【本番バグ】案件画面から請求書作成できない (S級)

| 項目 | 内容 |
|---|---|
| **ファイル** | `detail.js` L337, L352, L371 |
| **コミット** | `eed2d00` (`feat: 案件画面から請求書を作成する機能を追加 (Phase 1)`) |
| **原因** | `currentCaseId`（未定義変数）を参照。正しくは `caseId`（L13で宣言済み） |
| **影響** | `#btn-create-invoice-from-case` をクリックすると、`currentCaseId` が `undefined` のため常に `alert('案件情報が保存されていません')` が表示され、請求書作成画面に遷移できない |
| **重大度** | 高 — 案件→請求書作成の業務導線が完全に不通 |

```diff
- if (!currentCaseId || currentCaseId === 'new') {
+ if (!caseId || caseId === 'new') {

- .where('case_id', '==', Number(currentCaseId))
+ .where('case_id', '==', Number(caseId))

- const url = `invoice_detail.html?id=new&source=case&caseId=${currentCaseId}&customerId=${customerId}&returnCaseId=${currentCaseId}`;
+ const url = `invoice_detail.html?id=new&source=case&caseId=${caseId}&customerId=${customerId}&returnCaseId=${caseId}`;
```

---

## テスト側の修正一覧

### 修正1: セレクタ誤り

| 項目 | 内容 |
|---|---|
| **ファイル** | `test_acceptance_step1.js` (6箇所) |
| **修正前** | `#btn-create-invoice` |
| **修正後** | `#btn-create-invoice-from-case` |
| **原因** | テスト作成時に、`#billing-section`（`display: none`）内の未登録ボタンを参照。正規ボタンは見積セクション内の `#btn-create-invoice-from-case` |

### 修正2: Firestoreフィールド名不一致

| 項目 | 内容 |
|---|---|
| **ファイル** | `test_acceptance_step1.js` L93 |
| **修正前** | `estimateItems`（キャメルケース） |
| **修正後** | `estimate_items`（スネークケース） |
| **原因** | `detail.js` の `initEstimates()` は `data.estimate_items` を読むが、テスト側でキャメルケースを使用 |
| **備考** | LAPIS3全体の命名規約統一は別チケットで検討予定 |

### 修正3: ダイアログハンドラ

| 項目 | 内容 |
|---|---|
| **ファイル** | `test_acceptance_step1.js` L55-69 |
| **修正** | OTP用のPromiseベースハンドラを永続イベントリスナーに変更 |
| **原因** | 最初のOTPダイアログでPromise消費後、後続alert/confirmがログ出力されなくなっていた |

### 修正4: タイムアウト調整

| 項目 | 内容 |
|---|---|
| **ファイル** | `test_acceptance_step1.js` Scenario C |
| **修正前** | `timeout: 10000` |
| **修正後** | `timeout: 30000` |
| **原因** | Scenario B→C遷移で Phase 2 データロードに22,909msかかるケースあり |

### 修正5: HTML復元

| 項目 | 内容 |
|---|---|
| **ファイル** | `detail.html` |
| **修正** | `git checkout` で復元。未コミットで追加された `#btn-create-invoice` 重複ボタンを削除 |

---

## パフォーマンス観測値

| 指標 | 値 | 備考 |
|---|---|---|
| Phase 2 初回ロード | 412ms | 正常 |
| Phase 2 通常ロード | 253ms | 正常 |
| Phase 2 再接続後ロード | **22,909ms** | 要監視（エミュレータ特有の可能性あり） |

> **注意**: 22秒の異常値はFirestoreエミュレータのWebChannel再接続遅延と推測されるが、本番環境でも同様の事象が発生する可能性は排除できない。今後のテスト実行時にconsole log / network logを記録し、傾向を監視すること。

---

## 影響範囲検索

```
grep -R "btn-create-invoice[^-]" -- 結果: 0件
grep -R "currentCaseId" detail.js -- 結果: 0件（修正後）
```

古い参照は全ファイルから除去済み。

---

## 調査経緯

```
セレクタ #btn-create-invoice が 30秒タイムアウト
  ↓ HTML調査
#billing-section が display:none（非表示セクション内）
  ↓ イベントリスナー調査
#btn-create-invoice にイベント未登録
  ↓ 正規ボタン特定
#btn-create-invoice-from-case が正規ボタン（コミット eed2d00）
  ↓ セレクタ修正 → テスト再実行
alert: 見積明細がありません → estimate_items フィールド名不一致を発見
  ↓ フィールド名修正 → テスト再実行
Navigation timeout → currentCaseId 未定義変数を発見（本番バグ）
  ↓ 変数名修正 → テスト再実行
Scenario A, B PASSED / Scenario C タイムアウト（10秒）
  ↓ Phase 2 ロード 22秒を確認、タイムアウト値調整
全シナリオ PASSED
```

---

## 結論

E2Eテストが本来の目的を果たし、**本番コードのバグを1件検出・修正した**。
`currentCaseId → caseId` の修正により、案件画面からの請求書作成機能が正常に動作するようになった。
