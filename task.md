# LAPIS3 開発タスクリスト（Task.md）

## ✅ 完了済みの主要タスク (Completed)
- [x] **インフラ基盤構築**
  - [x] Firebaseプロビジョニング (Authentication, Firestore, Hosting)
  - [x] Firebase Sparkプラン（無料枠）での運用を前提とした通信最適化
- [x] **UI/UXコンポーネント実装**
  - [x] BIZ UDゴシック（13pt）を基準とした視認性の高い共通CSSの適用
  - [x] 月選択カレンダー (Unified MonthPicker) の実装とレイアウト調整
  - [x] サイドバーおよびログイン画面への公式ロゴ画像の適用
- [x] **ダッシュボード & 売上管理機能**
  - [x] 案件データ（受任日、見込報酬額など）からのリアルタイム売上集計
  - [x] ダッシュボードのサマリーカードフィルタリング不具合の解消
  - [x] 売上データ表示におけるクエリの修正と正確性の担保
- [x] **請求書管理 & PDF生成機能**
  - [x] 請求書作成時の案件絞り込み（完了済み・支払い済み案件の除外）
  - [x] 請求書一覧画面でのステータス表示の不具合修正
  - [x] `jsPDF` `jspdf-autotable` を用いた、クライアント完結型PDF自動生成ロジックの実装
  - [x] デザイン指定書（デザイン案02）に基づくPDFレイアウトの忠実な再現

- [x] **顧客カルテ：対応履歴機能（顧客履歴）の実装**
  - [x] `customer_histories` コレクション設計（`customer_id: Number`, `created_by_id`, `created_by_name` 二重保存方式）
  - [x] 3カラムレイアウト（検索・一覧・詳細）の実装
  - [x] モーダルによる履歴登録・編集・削除
  - [x] 種別ラジオボタンの1行表示修正（flex-wrap: nowrap）
  - [x] `customer_id` 型統一（Number型強制キャスト・`in` クエリ廃止）
  - [x] 調査用デバッグログ（`[DEBUG_COMP]`, `[Perf]`等）の本番前クリーンアップ完了

---

## 🔥 インシデント記録（2026-06-17）

### [INC-001] 対応履歴が画面に表示されない問題

**症状**
- Puppeteerテスト・DOM確認では `取得件数: 6件 / 描画件数: 6件` で成功
- ユーザー実画面では対応履歴が一切表示されない

**推定原因（未確定）**
- `FirebaseError: The query requires an index` エラーが発生していたことは確定。
- `where('customer_id') + where('deleted_at') + orderBy('response_date')` の組み合わせは Firestore 複合インデックスが必須。
- `firestore.indexes.json` には定義済みであったが、本番Firestoreへの**デプロイが未実施だった可能性が高い**。
- ただし、接続先が本番Firestoreかエミュレータかの切り分けが不十分（`hostname === "127.0.0.1"` の場合はエミュレータ接続になるはずだが、エミュレータ環境でインデックスエラーが出た明確な理由は解明されていない）。
- ローカル環境でのFirestoreキャッシュ干渉、エミュレータの再起動不足、または接続先（本番/エミュレータ）の認識のズレといった、複数の環境要因が重なった可能性がある。

**調査経緯**
1. Firestore保存 → OK（データ存在確認済み）
2. loadCustomerHistories() 取得件数 → OK（エミュレータ環境では正常）
3. renderHistories() 描画件数 → OK（同上）
4. ユーザー実画面 → NG（インデックスエラーで catch へ落下 → 履歴0件扱い）

**修正内容**
- `firebase deploy --only firestore:indexes` を実行し本番Firestoreにインデックスを反映
- `orderBy` をクエリから除外しJS側ソートに変更（インデックス依存を排除・環境差異を吸収）
- `firebase-config.js` の `enablePersistence()` をエミュレータ使用時は無効化（キャッシュ干渉防止）

**再発防止策**
- `firestore.indexes.json` を変更したら必ず `firebase deploy --only firestore:indexes` をデプロイチェックリストに含める
- Firestoreの `where + where + orderBy` 複合クエリは、開発初期から `firestore.indexes.json` への登録とデプロイを徹底する
- エミュレータでのみ動作確認して完了とみなさない（本番Firestoreでのインデックスエラーはエミュレータでは再現しない）

---

## 🚧 進行中・残りのタスク (To Do / In Progress)

### 1. アカウント移行・運用環境の整理
- [ ] **[WIP] AntigravityアカウントとFirebaseアカウントの統一（検討・実施）**
  - [ ] 新しい（または統一する）GoogleアカウントへのFirebaseプロジェクト権限の付与・移行
  - [ ] デプロイ（Hosting）及びFirestoreのルール権限の再確認

### 2. トライアル運用 (PoC) と現場フィードバック
- [ ] 実際の業務データを数件入力し、ダッシュボードの集計数値について現場確認
- [ ] 実環境のPC/ブラウザから請求書PDFを発行し、印刷時のレイアウトや文字化けがないかの最終テスト

### 3. バグフィックス・UX調整（フェーズ2）
- [ ] アプリケーション全体のエラーハンドリング強化（Firestoreのクエリ上限時やネットワークエラー時のUI表示）
- [ ] データ入力フォームのバリデーション強化（必須項目の漏れ防止、金額の半角数字固定など）

### 4. 対応履歴機能の動作確認（ユーザー環境）
- [x] 新規登録 → 一覧即時反映の確認
- [x] 編集・削除の動作確認
- [x] F5リロード後の再表示確認
- [x] 顧客切替後の再表示確認（別顧客の履歴が混入しないこと）
- [x] `response_date` 降順ソートの正確性確認（同日時データの並び）

### 5. クリーンアップ・リファクタリング
- [ ] `_BACKUP_BEFORE_REDESIGN` 等の一時退避用フォルダや、未使用になったコードの整理
- [ ] コメントの整理とドキュメント（README等）の最新化

### 6. 決算期別一覧画面の改善 (完了)
- [x] 検索条件の並び順変更（許認可種別を2番目に繰り上げる）
  - [x] HTML変更 ([license_washout.html](file:///d:/Antigravity/LAPIS3/license_washout.html))
  - [x] JS側のID参照依存確認（DOM順序非依存のためJS変更不要）
  - [x] Firebaseエミュレータ及びPuppeteerによる画面表示・動作確認

---

## 📋 帳票基盤 (Version 1.0) のリリースおよび次期課題バックログ

### 🏆 完了実績 (Closed)
* **タスク**: 顧客カルテ概要票PDF出力機能 ＆ 帳票エンジン基礎構築
* **リリース成果物**:
  * [report-engine.js](file:///d:/Antigravity/LAPIS3/reports/report-engine.js) : `jsPDF` 動的ロードおよび NotoSansJP 遅延ロード/メモリキャッシュ基盤
  * [report-utils.js](file:///d:/Antigravity/LAPIS3/reports/report-utils.js) : 期限・残日数判定、テキスト折り返し等のユーティリティ
  * [base-report.js](file:///d:/Antigravity/LAPIS3/reports/base-report.js) : 共通ヘッダー・フッター描画を抽象化したレポートベースクラス
  * [customer-summary-report.js](file:///d:/Antigravity/LAPIS3/reports/customer-summary-report.js) : 顧客カルテ概要票（A4横2ページ構成PDF）の具現クラス
  * [verify_all_ut.js](file:///d:/Antigravity/LAPIS3/tests/reports/verify_all_ut.js) : 全17項目の受入試験を自動アサーション検証する自動テストスクリプト
  * [analyze_pdf.js](file:///d:/Antigravity/LAPIS3/tests/reports/analyze_pdf.js) : PDFのフォントファイル埋め込み（サブセット化サイズ）を証明する解析スクリプト
* **受入試験ステータス**: 全17項目 (UT-001〜UT-017) 合格 (PASS) 済み
  * **UT-017 追加経緯**: 本番運用中に `file://` 直接起動によるCORSエラーが発生。障害が発生したら再現テストケースを増やす原則に基づき追加。

---

### 🚀 次期改善・機能拡張バックログ (Future Work)

> **優先順位の原則**: 実データを見ずに仕様を決めない。
> REP-001/REP-002 の具体的な仕様は、REP-006（実データ検証）の結果を見てから確定する。

| 優先度 | フェーズ | チケット | 対象コード・内容 | 状態 / 監視条件 | 理由 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| **P9 (保留)** | **Phase 1** | **[REP-006] 顧客カルテ概要票 実データ検証** | `verify_rep006.js` 等での本番顧客データでのPDF検証 | **保留（Deferred）** | 本番データが22件と少なく、最長社名19文字、最長備考20文字（絵文字含）程度であり、帳票破壊リスクを観測できるデータが育っていないため。 |
| **P9 (保留)** | **Phase 2** | **[REP-006B] 実運用再評価（トリガー条件監視）** | 顧客データ増加時のPDF再検証 | **監視中 (Monitoring)**<br>・顧客数が100件を超える<br>・備考500文字超の顧客が出現する<br>・PDF出力累計50回超 or 月間20回超<br>・帳票不具合報告が1件以上発生する | **新規（保留）**。データ量増加および実運用上の利用実績（利用頻度）が高まり、問題発生確率が上昇した時点で再評価を実施する。 |
| **P9 (保留)** | **Phase 3** | **[REP-001] 長い顧客名の折り返し改善** | [report-utils.js](file:///d:/Antigravity/LAPIS3/reports/report-utils.js) の文字幅判定・折り返し | **保留（Deferred）** | 現状の最長社名が19文字（株式会社フォーラインコミュニケーションズ）程度であれば現状設計で十分なため。 |
| **P9 (保留)** | **Phase 4** | **[REP-002] 備考欄の最大表示文字数制御** | [customer-summary-report.js](file:///d:/Antigravity/LAPIS3/reports/customer-summary-report.js) の長文制限 | **保留（Deferred）** | 実データ備考の最長が20文字前後（「新幹線の工事で忙しい🚃TEST」）であり、評価困難なため。 |
| **P2** | Phase 5 | **[REP-003] 許認可期限一覧帳票の追加** | `BaseReport` の継承による新規帳票 | **未着手 (Todo)** | **帳票基盤の再利用性検証**。3種類以上の複数帳票で同一基盤が共通利用可能であることを実証する。 |
| **P2** | Phase 5 | **[REP-004] 案件一覧帳票の追加** | `BaseReport` の継承による新規帳票 | **未着手 (Todo)** | **帳票基盤の再利用性検証**。複数種類の帳票を同一基盤が正常に処理できることを実証する。 |
| **P3** | Phase 6 | **[REP-005] 顧客カルテ概要票Excel出力への対応** | xlsx出力ライブラリの選定・基盤構築 | **未着手 (Todo)** | 現場でのデータ二次利用や編集要求への対応。 |

* **UT-018 (絵文字混在検証) の技術的評価の扱い**:
  * **確認できた事実**: 絵文字 `🚃` を含むテスト用PDFが生成され、エビデンス画像 `UT-018_preview.png` 上で正常に描画されたこと。
  * **未確定の技術的要素**: 埋め込み状況、フォールバックの仕組み、ビューア依存の可能性については技術的な区別を行っていないため、「すべての絵文字に完全対応」を保証するものではない。ステータスは「観測上問題なし」とする。



