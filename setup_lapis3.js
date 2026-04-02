/**
 * LAPIS3 ユーザー一括作成スクリプト
 * 
 * 機能:
 *   1. Firebase Authentication にユーザーを一括登録
 *   2. Firestore の staff コレクションに対応するドキュメントを作成
 *   3. Firestore の counters コレクションを初期化
 * 
 * 前提:
 *   - Node.js がインストールされていること
 *   - firebase-admin がインストール済み (package.json に記載済み)
 *   - Service Account Key ファイルを取得済みであること
 * 
 * 使い方:
 *   1. setup_users.json を編集（17名分のユーザー情報を入力）
 *   2. Firebaseコンソールからサービスアカウントキーをダウンロード
 *   3. 以下のコマンドで実行:
 *      node setup_lapis3.js ./serviceAccountKey.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ============================================================
// 設定
// ============================================================
const USERS_FILE = path.join(__dirname, 'setup_users.json');

// counters コレクションの初期値
const INITIAL_COUNTERS = {
    customers: 0,
    cases: 0,
    staff: 0,        // ユーザー作成後に自動更新
    invoices: 0,
    license_types: 0,
    government_offices: 0,
    customer_licenses: 0,
    contacts: 0,
    receipts: 0,
    sales: 0
};

// ============================================================
// メイン処理
// ============================================================
async function main() {
    // --- 1. Service Account Key の読み込み ---
    const keyPath = process.argv[2];
    if (!keyPath) {
        console.error('========================================');
        console.error('エラー: サービスアカウントキーのパスを指定してください');
        console.error('');
        console.error('使い方:');
        console.error('  node setup_lapis3.js ./serviceAccountKey.json');
        console.error('');
        console.error('サービスアカウントキーの取得方法:');
        console.error('  1. https://console.firebase.google.com/project/lapis3-4113e/settings/serviceaccounts/adminsdk');
        console.error('  2. 「新しい秘密鍵の生成」をクリック');
        console.error('  3. ダウンロードしたJSONファイルのパスを指定');
        console.error('========================================');
        process.exit(1);
    }

    if (!fs.existsSync(keyPath)) {
        console.error(`エラー: ファイルが見つかりません: ${keyPath}`);
        process.exit(1);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

    // --- 2. Firebase Admin 初期化 ---
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });

    const db = admin.firestore();
    const auth = admin.auth();

    console.log(`\n🚀 LAPIS3 セットアップ開始`);
    console.log(`   プロジェクト: ${serviceAccount.project_id}`);
    console.log('');

    // --- 3. ユーザーリストの読み込み ---
    if (!fs.existsSync(USERS_FILE)) {
        console.error(`エラー: ユーザーファイルが見つかりません: ${USERS_FILE}`);
        console.error('setup_users.json を作成してから再実行してください。');
        process.exit(1);
    }

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    console.log(`📋 ${users.length} 名のユーザーを処理します\n`);

    // --- 4. ユーザー作成 ---
    const results = { success: [], failed: [], skipped: [] };
    let staffId = 0;

    for (const user of users) {
        staffId++;
        const label = `[${staffId}/${users.length}] ${user.staff_name} (${user.email})`;

        try {
            // 4-1. Auth ユーザー作成
            let authUser;
            try {
                // 既存ユーザーチェック
                authUser = await auth.getUserByEmail(user.email);
                console.log(`  ⏭️  ${label} - Auth: 既に存在 (uid: ${authUser.uid})`);
                results.skipped.push({ ...user, reason: 'Auth既存' });
            } catch (err) {
                if (err.code === 'auth/user-not-found') {
                    // 新規作成
                    authUser = await auth.createUser({
                        email: user.email,
                        password: user.password,
                        displayName: user.staff_name,
                        emailVerified: true,    // メール確認済みとする
                        disabled: false
                    });
                    console.log(`  ✅ ${label} - Auth: 作成完了 (uid: ${authUser.uid})`);
                } else {
                    throw err;
                }
            }

            // 4-2. Firestore staff ドキュメント作成
            const staffDocId = `staff_${staffId}`;
            const staffData = {
                staff_id: staffId,
                staff_name: user.staff_name,
                email: user.email,
                authority: user.authority || 'staff',
                role: user.role || '担当者',
                status: user.status || '在籍',
                uid: authUser.uid,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_at: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('staff').doc(staffDocId).set(staffData, { merge: true });
            console.log(`      → Firestore: staff/${staffDocId} 作成完了`);

            results.success.push({ ...user, staffDocId, uid: authUser.uid });

        } catch (err) {
            console.error(`  ❌ ${label} - エラー: ${err.message}`);
            results.failed.push({ ...user, error: err.message });
        }
    }

    // --- 5. Counters 初期化 ---
    console.log('\n📊 カウンター初期化中...');
    const counters = { ...INITIAL_COUNTERS };
    counters.staff = staffId;  // 作成したスタッフ数で更新

    const batch = db.batch();
    for (const [name, count] of Object.entries(counters)) {
        const ref = db.collection('counters').doc(name);
        batch.set(ref, { count }, { merge: true });
    }
    await batch.commit();
    console.log(`  ✅ ${Object.keys(counters).length} 件のカウンター初期化完了`);

    // --- 6. 結果サマリ ---
    console.log('\n========================================');
    console.log('📊 セットアップ結果サマリ');
    console.log('========================================');
    console.log(`  ✅ 成功: ${results.success.length} 名`);
    console.log(`  ⏭️  スキップ (既存): ${results.skipped.length} 名`);
    console.log(`  ❌ 失敗: ${results.failed.length} 名`);
    console.log('');

    if (results.success.length > 0) {
        console.log('【作成されたユーザー】');
        results.success.forEach(u => {
            console.log(`  ${u.staffDocId}: ${u.staff_name} <${u.email}> [${u.authority}]`);
        });
    }

    if (results.failed.length > 0) {
        console.log('\n【失敗したユーザー】');
        results.failed.forEach(u => {
            console.log(`  ${u.staff_name} <${u.email}> → ${u.error}`);
        });
    }

    console.log('\n========================================');
    console.log('🎉 セットアップ完了！');
    console.log(`   Hosting URL: https://${serviceAccount.project_id}.web.app`);
    console.log('========================================\n');

    process.exit(0);
}

// 実行
main().catch(err => {
    console.error('致命的エラー:', err);
    process.exit(1);
});
