const admin = require('firebase-admin');

// エミュレータに向けるための環境変数設定
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

// Firebase Admin初期化
admin.initializeApp({
    projectId: 'lapis3-2026'
});

const db = admin.firestore();

// 投入するテストデータ（10件）
const customersData = [
    {
        customer_id: 1001,
        customer_name: '株式会社 テスト商事',
        customer_kana: 'カブシキガイシャ テストショウジ',
        customer_type: '法人',
        postal_code: '100-0001',
        address: '東京都千代田区千代田1-1',
        building_name: 'テストタワー 10F',
        phone_number: '03-1234-5678',
        email: 'info@test-shoji.co.jp',
        representative_name: '山田 太郎',
        industry: 'IT・通信',
        status: 'アクティブ',
        remarks: '初期システム構築時のテストデータです。'
    },
    {
        customer_id: 1002,
        customer_name: '鈴木 一郎',
        customer_kana: 'スズキ イチロウ',
        customer_type: '個人',
        postal_code: '150-0002',
        address: '東京都渋谷区渋谷2-2',
        building_name: 'コーポテスト 202',
        phone_number: '090-9876-5432',
        email: 'ichiro.suzuki@example.com',
        representative_name: '',
        industry: '',
        status: 'アクティブ',
        remarks: '個人事業主のテストデータ。'
    },
    {
        customer_id: 1003,
        customer_name: '合同会社 サンプル・ソリューションズ',
        customer_kana: 'ゴウドウガイシャ サンプルソリューションズ',
        customer_type: '法人',
        postal_code: '530-0001',
        address: '大阪府大阪市北区梅田3-3',
        building_name: '',
        phone_number: '06-8765-4321',
        email: 'contact@sample-sol.co.jp',
        representative_name: '佐藤 花子',
        industry: 'コンサルティング',
        status: 'アクティブ',
        remarks: '関西地区のクライアント。'
    },
    {
        customer_id: 1004,
        customer_name: '田中 建設工業',
        customer_kana: 'タナカ ケンセツコウギョウ',
        customer_type: '個人',
        postal_code: '060-0001',
        address: '北海道札幌市中央区北一条西4-4',
        building_name: '札幌ビル 5F',
        phone_number: '011-222-3333',
        email: 'tanaka-ken@sapporo.example',
        representative_name: '',
        industry: '建設・土木',
        status: '非アクティブ',
        remarks: '現在は取引停止中。'
    },
    {
        customer_id: 1005,
        customer_name: 'NPO法人 未来クリエイティブ',
        customer_kana: 'エヌピーオーホウジン ミライクリエイティブ',
        customer_type: '法人',
        postal_code: '810-0001',
        address: '福岡県福岡市中央区天神5-5',
        building_name: '天神パークビル',
        phone_number: '092-444-5555',
        email: 'npo_mirai@example.org',
        representative_name: '高橋 次郎',
        industry: '教育・福祉',
        status: 'アクティブ',
        remarks: 'NPO法人のサンプルです。'
    },
    {
        customer_id: 1006,
        customer_name: '渡辺 青果店',
        customer_kana: 'ワタナベ セイカテン',
        customer_type: '個人',
        postal_code: '330-0001',
        address: '埼玉県さいたま市大宮区高鼻町6-6',
        building_name: '',
        phone_number: '048-777-8888',
        email: 'watanabe-shop@example.com',
        representative_name: '',
        industry: '小売・卸売',
        status: 'アクティブ',
        remarks: ''
    },
    {
        customer_id: 1007,
        customer_name: '株式会社 デジタル・フロンティア',
        customer_kana: 'カブシキガイシャ デジタルフロンティア',
        customer_type: '法人',
        postal_code: '220-0012',
        address: '神奈川県横浜市西区みなとみらい7-7',
        building_name: 'みなとみらいタワー 35F',
        phone_number: '045-999-0000',
        email: 'info@digital-frontier.co.jp',
        representative_name: '伊藤 サブロウ',
        industry: 'デザイン・制作',
        status: 'アクティブ',
        remarks: ''
    },
    {
        customer_id: 1008,
        customer_name: '小林 クリニック',
        customer_kana: 'コバヤシ クリニック',
        customer_type: '法人',
        postal_code: '980-0021',
        address: '宮城県仙台市青葉区中央8-8',
        building_name: 'メディカルモール仙台 2階',
        phone_number: '022-111-2222',
        email: 'kobayashi-clinic@example.jp',
        representative_name: '小林 義雄',
        industry: '医療・介護',
        status: 'アクティブ',
        remarks: '医療法人の例。'
    },
    {
        customer_id: 1009,
        customer_name: '山本 アグリサービス',
        customer_kana: 'ヤマモト アグリサービス',
        customer_type: '個人',
        postal_code: '604-8004',
        address: '京都府京都市中京区中島町9-9',
        building_name: '',
        phone_number: '075-666-7777',
        email: 'yamamoto_agri@example.com',
        representative_name: '',
        industry: '農業・林業',
        status: 'アクティブ',
        remarks: ''
    },
    {
        customer_id: 1010,
        customer_name: '一般社団法人 グローバル・リンク',
        customer_kana: 'イッパンシャダンホウジン グローバルリンク',
        customer_type: '法人',
        postal_code: '460-0008',
        address: '愛知県名古屋市中区栄10-10',
        building_name: 'サカエヒルズ 8F',
        phone_number: '052-555-6666',
        email: 'contact@global-link.or.jp',
        representative_name: '中村 恵美',
        industry: 'その他',
        status: 'アクティブ',
        remarks: '一般社団法人のパターン。'
    }
];

async function seedCustomersDatabase() {
    try {
        console.log('--- 顧客テストデータ（10件）のFirestore書き込み開始 ---');

        const batch = db.batch();
        const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

        // Counterコレクションを初期化しておく (ID採番用)
        const sequenceRef = db.collection('sequences').doc('customers');
        // 今回1010番まで振ったので、採番カウンターは1010にセットしておく
        batch.set(sequenceRef, { current_value: 1010 }, { merge: true });

        // 各顧客データをバッチに追加
        customersData.forEach((data) => {
            // LAPIS3の現在の仕様に合わせ、ドキュメントIDは autoId で生成し、
            // 内部に連番の customer_id を持つように設定。
            const newDocRef = db.collection('customers').doc();

            batch.set(newDocRef, {
                ...data,
                created_date: serverTimestamp,
                last_updated: serverTimestamp
            });
            console.log(`準備完了: ${data.customer_name} (ID: ${data.customer_id})`);
        });

        // コミットして一括書き込み
        await batch.commit();

        console.log('\n=== 顧客データの登録がすべて完了しました！ ===');
        console.log(`自動採番カウンター(customers)も '1010' に更新されました。`);

    } catch (error) {
        console.error('データの流し込みに失敗しました:', error);
    } finally {
        // Node.jsのプロセスを終了
        process.exit();
    }
}

seedCustomersDatabase();
