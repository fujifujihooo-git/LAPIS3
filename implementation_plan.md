# 請求・入金管理機能 実装計画

## 1. 概要
行政書士事務所向け業務システム「LAPIS3」へ、請求管理および入金消込機能を実装します。Firestoreを用いた非正規化データ構造とトランザクションを活用し、整合性の高い堅牢な会計データ管理（論理削除、DELETE禁止）を構築します。

## 2. User Review Required (重要確認事項)

> [!WARNING]
> **フロントエンドの技術スタックに関する確認**
> ご要望に「Reactエンジニアとして〜」と記載がありましたが、現在のLAPIS3のコードベースを確認したところ、**Vanilla JS (HTML + JavaScript(jQueryなし))** で実装されており、React等のビルド環境は導入されていません。
> 基本方針（requirements.md）にある「現状を優先」に従い、**既存のVanilla JSベースのアーキテクチャを維持して本機能を実装する**計画としていますが、よろしいでしょうか？ （もしReactで一から作り直す意図であればお知らせください。本計画はVanilla JSベースを前提としています。）

## 3. データ構造変更・追加の設計

### 3-1. コレクション構成
ご提示いただいた非正規化データ構造を採用します。
*   `customers` (既存のものを拡張・維持)
*   `projects` (既存の `cases` 相当。データ移行・連携については別途考慮するか、要求に従い `projects` を使用)
*   `invoices` (既存のものを拡張。`totalAmount`, `status` を管理)
*   `invoiceItems` (既存の `invoice_items` を移行または新設)
*   `receipts` (新規: 入金データ。`amount`, `status: active/cancelled`)
*   `receiptAllocations` (新規: 入金消込データ。トランザクションで作成。)

### 3-2. 厳格な会計ルールの適用
*   **DELETE処理の完全禁止**: 既存の [invoice_detail.js](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/invoice_detail.js) にある `batch.delete()` 等の物理削除処理を廃止し、すべて `status` の更新（例: `draft`, `cancelled` 等）による論理削除へ移行します。
*   **消込処理のトランザクション化**: 消込額（`receiptAllocations`）の作成・取消時は Firestore の Transaction を使用し、`invoices` の残額（未収額）と `receipts` の残額（未消込額）との整合性を担保します。

## 4. UI実装コンポーネント計画 (Vanilla JS前提)

画面は以下の構成で新規追加および改修を行います。

### 1. 請求書詳細画面 ([invoice_detail.html](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/invoice_detail.html) / [.js](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/app.js) の改修)
*   **物理削除の廃止**: 「削除」ボタンを「無効化（取消）」ボタンに変更。明細の削除も論理削除とする。
*   **入金記録の表示変更**: 従来の `payments` テーブル直接描画から、`receiptAllocations` (自請求に対する消込記録) の一覧表示へ変更。
*   **残額計算**: クライアントサイドでの画面表示時の残額は、`totalAmount - SUM(receiptAllocations.amount where status=active)` で計算して描画。

### 2. 未収請求一覧 (`unpaid_invoices.html` / [.js](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/app.js) 予定)
*   既存の [invoice_list.html](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/invoice_list.html) をベースにするか、または新規作成。
*   非正規化された `invoices` コレクションのインデックス (`status + invoiceDate` など) を活用し、ステータスが `issued` (発行済/未入金・一部入金) のものを高速に一覧表示。

### 3. 入金管理一覧 (`receipt_list.html` / [.js](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/app.js) 予定)
*   システムに登録された「入金 (Receipts)」の一覧画面。
*   銀行振込等の入金履歴を新規登録・一覧表示。
*   `status + receiptDate` のインデックスでソート。

### 4. 入金消込画面 (`receipt_allocation.html` / [.js](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/app.js) 予定)
*   特定の顧客の「未収請求一覧」と「未消込入金一覧」を左右または上下に並べて表示。
*   チェックボックスや金額入力欄を設け、どの入金をどの請求に充当するかを指定。
*   保存時に Firestore Transaction を呼び出し、`receiptAllocations` の登録処理を行う。

## 5. 既存コード(Firebase設定)へのインデックス追加要件
Firestoreで複雑なクエリが必要になるため、実行後にターミナルのログ等から必要な複合インデックスのリンクを取得し、手動で作成します。
*   `invoices`: `customerId` + `invoiceDate` 等
*   `receiptAllocations`: `invoiceId` + `createdAt` 等
*   `receipts`: `status` + `receiptDate` 等

## 6. Verification Plan (検証とテスト)

### マニュアルテスト項目
1.  **新規請求と明細の作成**:
    *   [invoice_detail.html](file:///c:/Users/nakamura/OneDrive/%E3%83%87%E3%82%B9%E3%82%AF%E3%83%88%E3%83%83%E3%83%97/AntigravityAPP/LAPIS3/invoice_detail.html)から新規請求を作成し、明細を追加して保存する。
    *   Firestore上でドキュメントが作成され、物理削除ではなく `status` で管理されることを確認する。
2.  **入金登録と消込 (トランザクション検証)**:
    *   `receipt_list.html` から10万円の入金を登録する。
    *   `receipt_allocation.html` にて、上記入金から5万円を特定の請求書に充当する。
    *   Firestoreデータ上で、対象の `invoices` の未収残額が減少し、`receipts` の未消込残額が減少していることを確認する。
    *   操作後、もう一度充当操作を行おうとした際に、残額以上の消込額がバリデーションで弾かれることを確認する。
3.  **UI表示の確認**:
    *   各一覧画面（未収請求一覧、入金一覧）に、最新のデータが非正規化インデックスを用いて高速かつ正しく表示されているかを確認。
