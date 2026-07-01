# LAPIS3 テスト認証情報 (Test Credentials)

> **⚠️ このファイルはローカル開発・テスト専用です。本番環境の認証情報は含みません。**

---

## プライマリテストアカウント（優先使用）

| 項目 | 値 |
|------|-----|
| **Email** | `lapis-test@lapis.local` |
| **Password** | `Lapis3_2026!` |
| **権限** | `admin`（管理者） |
| **担当者名** | 中村 |

---

## サブアカウント一覧（必要な場合）

| Email | Password | 権限 | 担当者名 |
|-------|----------|------|---------|
| `test@example.com` | `Lapis3_2026!` | admin | テストユーザー |
| `hosoi@example.com` | `Lapis3_2026!` | staff | 細井 |
| `hironaka@example.com` | `Lapis3_2026!` | staff | 弘中 |
| `owada@example.com` | `Lapis3_2026!` | staff | 大和田 |

---

## アクセスURL

| 環境 | URL |
|------|-----|
| **ローカル開発サーバー** | `http://localhost:5005/` |
| **ログインページ** | `http://localhost:5005/login.html` |
| **顧客管理** | `http://localhost:5005/customer_list.html` |
| **Emulator UI** | `http://127.0.0.1:4005/` |
| **Emulator Auth** | `http://127.0.0.1:4005/auth` |

---

## ブラウザ操作でのログイン手順

### 正しい手順
1. `http://localhost:5005/login.html` を開く
2. Email欄に `lapis-test@lapis.local` を入力
3. Password欄に `Lapis3_2026!` を入力
4. 「ログイン」ボタンをクリック
5. `customer_list.html` にリダイレクトされれば成功

### よくある失敗原因と対策

| 失敗パターン | 原因 | 対策 |
|-------------|------|------|
| ログインページが表示されない | ローカルサーバー未起動 | `npx http-server -p 5005` を実行 |
| 認証エラーが出る | エミュレータ未起動 | `./start_emulator.bat` を実行してから再試行 |
| 「ユーザーが見つかりません」 | エミュレータがデータなし状態 | `start_emulator.bat` (--import オプション付き) で起動し直す |
| 何度試してもエラー | FirebaseがEmulatorに接続していない | ブラウザのコンソールで `firebase.auth().currentUser` を確認 |

### 事前確認チェックリスト（ログイン前に必ず確認）
- [ ] `start_emulator.bat` は起動済みか？（ターミナルで `All emulators ready!` が出ているか）
- [ ] ローカルサーバーは `http://localhost:5005` で起動しているか？
- [ ] ブラウザのコンソールにエラーが出ていないか？

---

## 注意事項

- **このファイルはエミュレータ環境専用**です。本番Firebase Auth には `lapis-test@lapis.local` ドメインのアカウントは存在しません。
- パスワードは全アカウント共通: `Lapis3_2026!`
- ログイン失敗を繰り返す前に、必ず上記チェックリストを確認してください。
