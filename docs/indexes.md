# LAPIS3 Firestore 複合インデックス定義

## 概要

`customer_detail.js` の各セクションロード関数は、
`where('customer_id', '==', cId).orderBy('last_updated', 'desc')` パターンのクエリを発行します。

Firestore では `where()` の等価フィルタと `orderBy()` のソートフィールドが異なる場合、
**複合インデックス（Composite Index）** が必要です。

## 必要なインデックス一覧

| コレクション | フィールド1 (等価) | フィールド2 (ソート) | 対応関数 |
|---|---|---|---|
| `offices` | `customer_id` ASC | `last_updated` DESC | `loadOffices()` |
| `contacts` | `customer_id` ASC | `last_updated` DESC | `loadContacts()` |
| `customer_licenses` | `customer_id` ASC | `last_updated` DESC | `loadLicenses()` |
| `cases` | `customer_id` ASC | `last_updated` DESC | `loadCases()` |

## インデックス定義ファイル

これらは `firestore.indexes.json` に定義されています。

デプロイコマンド：

```bash
firebase deploy --only firestore:indexes
```

## 注意事項

- インデックスの構築には **数分〜数十分** かかる場合があります
- インデックス構築中は該当クエリが `failed-precondition` エラーを返します
- `customer_detail.js` はこのエラーを検知し、ユーザー向けに「初期設定中です」と表示します
- **フィールド名を変更した場合は、必ず `firestore.indexes.json` も同期すること**

## 変更履歴

| 日付 | 変更内容 |
|---|---|
| 2026-05-22 | `updated_at` → `last_updated` に修正。コードとインデックス定義の不一致を解消 |
