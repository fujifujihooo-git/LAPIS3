const admin = require('firebase-admin');
const path = require('path');

const USE_PRODUCTION = process.env.USE_PRODUCTION === 'true';
const ALLOW_PROD_WRITE = process.env.ALLOW_PROD_WRITE === 'true';

if (USE_PRODUCTION) {
    if (!ALLOW_PROD_WRITE) {
        console.error("❌ 警告: 本番環境への書き込みはデフォルトで無効化されています。");
        console.error("   本当に実行する場合は、環境変数 ALLOW_PROD_WRITE=true を同時に指定してください。");
        process.exit(1);
    }
    const NEW_KEY_PATH = path.join(__dirname, 'lapis3-4113e-firebase-adminsdk-fbsvc-f4e38d0188.json');
    try {
        const newKey = require(NEW_KEY_PATH);
        admin.initializeApp({
            credential: admin.credential.cert(newKey)
        });
        console.log("✅ [本番環境 (PRODUCTION)] Firestore初期化に成功しました。");
    } catch (e) {
        console.error("❌ 鍵の読み込みに失敗しました。ファイル名を確認してください。\n", e.message);
        process.exit(1);
    }
} else {
    // デフォルト: エミュレータ環境
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    admin.initializeApp({
        projectId: 'lapis3-2026'
    });
    console.log("✅ [エミュレータ環境 (EMULATOR)] Firestore初期化に成功しました。");
}

const db = admin.firestore();

// --- 設定 ---
const TOTAL_HEAVY_CUSTOMERS = 10;
const TOTAL_NORMAL_CUSTOMERS = 100;

// ランダム日時生成ユーティリティ
function getRandomDate(isRecent) {
    const now = new Date();
    let pastDate = new Date();
    if (isRecent) {
        // 過去1ヶ月以内 (70%のデータ)
        pastDate.setDate(now.getDate() - Math.floor(Math.random() * 30));
    } else {
        // 過去3年以内 (30%のデータ)
        pastDate.setFullYear(now.getFullYear() - Math.floor(Math.random() * 3));
        pastDate.setMonth(Math.floor(Math.random() * 12));
    }
    return admin.firestore.Timestamp.fromDate(pastDate);
}

// ランダムステータス生成 (偏りあり)
function getRandomStatus() {
    const r = Math.random();
    if (r < 0.5) return '進行中';     // 50%
    if (r < 0.8) return '完了';       // 30%
    if (r < 0.9) return '相談';       // 10%
    return '申請中';                  // 10%
}

// メイン生成処理
async function generateData() {
    console.log("🚀 テストデータの生成を開始します...");

    // --------------------------------------------------
    // 【E2E専用データ生成処理】
    // 役割定義:
    // 1. lapis-test@lapis.local : E2Eテスト専用の正式ユーザー（全自動テストはこれに統一）
    // 2. test@example.com       : 開発者個人のローカルテスト用（削除候補として別途検討可能）
    // 3. fujita                 : 初期データ(accounts.json)に含まれる業務確認用アカウント
    // --------------------------------------------------
    try {
        await admin.auth().createUser({
            uid: 'test-user',
            email: 'test@example.com',
            password: 'password123'
        });
    } catch(e) {}
    
    try {
        await admin.auth().createUser({
            uid: 'lapis-test',
            email: 'lapis-test@lapis.local',
            password: 'Lapis3_2026!'
        });
    } catch(e) {}
    console.log("✅ テストユーザー作成チェック完了");

    // E2Eテスト用のstaffデータを冪等に生成・更新 (何回実行しても同じ状態になることを保証)
    try {
        await db.collection('staff').doc('lapis-test').set({
            staff_name: 'E2Eテストユーザー',
            email: 'lapis-test@lapis.local',
            role: 'admin',
            status: '在籍',
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log("✅ E2Eテスト用staffデータ (lapis-test) の冪等生成完了");
    } catch(e) {
        console.warn("⚠️ E2Eテスト用staffデータ生成失敗:", e.message);
    }
    // --------------------------------------------------
    
    // 現在の最大シーケンスを取得（簡易的にランダムな大きいIDから始めるか、既存シーケンスを使わないように900000番台を使用）
    const START_CUSTOMER_ID = 900000;
    const START_CASE_ID = 900000;
    
    let currentCustomerId = START_CUSTOMER_ID;
    let currentCaseId = START_CASE_ID;

    let batches = [];
    let currentBatch = db.batch();
    let currentBatchSize = 0;

    let stats = { customers: 0, cases: 0, licenses: 0 };

    const commitBatchIfNeeded = async () => {
        if (currentBatchSize >= 450) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
            currentBatchSize = 0;
        }
    };

    const createCustomer = async (isHeavy, specificCaseCount = null) => {
        const cId = currentCustomerId++;
        const custRef = db.collection('customers').doc(`cust_${cId}`);
        const isRecent = Math.random() < 0.7;
        const updatedAt = getRandomDate(isRecent);

        currentBatch.set(custRef, {
            customer_id: cId,
            customer_name: `[TEST] ${isHeavy ? '大口顧客' : '一般顧客'} ${cId}` + (specificCaseCount !== null ? ` (境界値: ${specificCaseCount}件)` : ''),
            customer_name_kana: `テスト コキャク ${cId}`,
            customer_type: '法人',
            is_test: true, // ロールバック用フラグ
            created_date: updatedAt,
            last_updated: updatedAt
        });
        console.log(`[DATA GEN] Created customer ${cId} with ${specificCaseCount} cases`);
        currentBatchSize++;
        stats.customers++;
        await commitBatchIfNeeded();

        // 案件の生成
        let caseCount;
        if (specificCaseCount !== null) {
            caseCount = specificCaseCount;
        } else {
            caseCount = isHeavy ? Math.floor(Math.random() * 21) + 30 : Math.floor(Math.random() * 3) + 1; // Heavy: 30-50, Normal: 1-3
        }
        for (let i = 0; i < caseCount; i++) {
            const caseId = currentCaseId++;
            const caseRef = db.collection('cases').doc(`case_${caseId}`);
            const caseIsRecent = Math.random() < 0.7;
            const caseUpdatedAt = getRandomDate(caseIsRecent);

            currentBatch.set(caseRef, {
                case_id: caseId,
                customer_id: cId,
                procedure_name: `[TEST] 案件 ${caseId}`,
                status: getRandomStatus(),
                is_test: true, // ロールバック用フラグ
                created_date: caseUpdatedAt,
                updated_at: caseUpdatedAt, // インデックス用
                last_updated: caseUpdatedAt
            });
            currentBatchSize++;
            stats.cases++;
            await commitBatchIfNeeded();

            // 一定確率(30%)で許認可データも生成
            if (Math.random() < 0.3) {
                const licRef = db.collection('customer_licenses').doc();
                currentBatch.set(licRef, {
                    customer_id: cId,
                    case_id: caseId,
                    license_type_id: 1, // ダミー
                    status: '有効',
                    is_test: true,
                    created_date: caseUpdatedAt,
                    updated_at: caseUpdatedAt
                });
                currentBatchSize++;
                stats.licenses++;
                await commitBatchIfNeeded();
            }
        }
    };

    console.log(`生成中... 境界値顧客: 5件, 大口顧客: ${TOTAL_HEAVY_CUSTOMERS}件, 一般顧客: ${TOTAL_NORMAL_CUSTOMERS}件`);

    // 境界値テスト用顧客の生成 (0, 20, 21, 39, 40)
    await createCustomer(false, 0);
    await createCustomer(true, 20);
    await createCustomer(true, 21);
    await createCustomer(true, 39);
    await createCustomer(true, 40);

    for (let i = 0; i < TOTAL_HEAVY_CUSTOMERS; i++) {
        await createCustomer(true);
    }
    for (let i = 0; i < TOTAL_NORMAL_CUSTOMERS; i++) {
        await createCustomer(false);
    }

    if (currentBatchSize > 0) {
        batches.push(currentBatch.commit());
    }

    await Promise.all(batches);

    console.log("\n🎊 テストデータの生成が完了しました！");
    console.log(`- 顧客データ: ${stats.customers}件`);
    console.log(`- 案件データ: ${stats.cases}件`);
    console.log(`- 許認可データ: ${stats.licenses}件`);
    
    process.exit(0);
}

generateData().catch(console.error);
