const admin = require('firebase-admin');

// エミュレータに向けるための環境変数設定
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// Firebase Admin初期化（認証情報はエミュレータ利用時はダミーでOK）
admin.initializeApp({
    projectId: 'lapis3-2026'
});

const db = admin.firestore();
const auth = admin.auth();

async function seedDatabase() {
    try {
        console.log('--- 認証用ユーザーの作成開始 ---');

        // 1. Authで新規ユーザーを作成 (パスワードは6文字以上)
        const userEmail = 'lapis-test@lapis.local';
        const userPassword = 'Lapis3_2026!';

        let user;
        try {
            // すでに存在するかチェック
            user = await auth.getUserByEmail(userEmail);
            console.log(`既にAuthユーザーが存在します: ${user.uid}`);
            await auth.updateUser(user.uid, { password: userPassword });
            console.log(`パスワードを再設定しました`);
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                user = await auth.createUser({
                    email: userEmail,
                    password: userPassword,
                    displayName: 'テスト スタッフ',
                });
                console.log(`新規にAuthユーザーを作成しました: ${user.uid}`);
            } else {
                throw err;
            }
        }

        console.log('\n--- スタッフデータのFirestore書き込み開始 ---');

        // 2. AuthのUIDを使ってFirestoreにスタッフデータを作成
        // `staff` コレクションにドキュメントとして保存する
        // アプリケーションの実装（Auth UIDとstaffマスターの紐付けの仕組み）に依存しますが、
        // 多くの一般的な設計に合わせて uid をドキュメントIDとして作成します。

        const staffRef = db.collection('staff').doc(user.uid);

        await staffRef.set({
            staff_id: user.uid, // アプリ上の内部ID（必要に応じて数値や文字列）
            staff_name: 'テスト スタッフ',
            email: userEmail,
            role: 'admin',      // 権限管理がある場合
            status: '在籍',
            created_date: admin.firestore.FieldValue.serverTimestamp(),
            last_updated: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }); // すでにあればマージ（上書き）

        console.log(`スタッフデータを保存しました。 Firestore: /staffs/${user.uid}`);

        console.log('\n=== シーディング（初期データ登録）が正常に完了しました ===');
        console.log(`[ログイン用情報]`);
        console.log(` メール   : ${userEmail}`);
        console.log(` パスワード: ${userPassword}`);

    } catch (error) {
        console.error('シーディングに失敗しました:', error);
    } finally {
        process.exit();
    }
}

seedDatabase();
