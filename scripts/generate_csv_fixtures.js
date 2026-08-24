// 実機受入検証用 CSV フィクスチャ生成スクリプト
const fs = require('fs');
const path = require('path');

const fixtureDir = path.join(__dirname, '../tests/fixtures');
if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
}

// 1. サンプル10件データ（長文会社名、特殊記号、旧字体、半角カナ等を含む）
const header = 'customer_name,customer_kana,customer_type,representative_name,corporate_number,postal_code,address,building_name,phone,fax,email,remarks';
const sampleRows10 = [
    '株式会社アイウ建設,カブシキガイシャアイウケンセツ,法人,愛羽 太郎,9876543210123,100-0001,東京都千代田区千代田1-1,サンプルビル5F,03-1111-2222,03-1111-2223,aiu@example.com,Gビズインフォ補完データ',
    '合同会社カキク総合開発＆パートナーズ,ゴウドウガイシャカキクソウゴウカイハツ,法人,柿久 次郎,8765432109876,105-0004,東京都港区新橋2-2-2,新橋オフィスプラザ10階,03-2222-3333,,kakiku@example.com,長文会社名テスト',
    '有限会社サシス・エンジニアリング,ユウゲンガイシャサシス,法人,佐々木 祥三,7654321098765,160-0022,東京都新宿区新宿3-3-3,新宿サシスビル,03-3333-4444,03-3333-4445,sashisu@example.com,旧字体（祥）含む',
    '田中電気工事店,ﾀﾅｶﾃﾞﾝｷ,個人,田中 四郎,,150-0002,東京都渋谷区渋谷4-4-4,,090-1234-5678,,tanaka@example.com,半角カナ＆法人番号なし',
    '高橋設計工房,タカハシセッケイ,個人,高橋 五郎,,170-0013,東京都豊島区東池袋5-5-5,,090-2345-6789,,takahashi@example.com,建築士一人親方',
    '株式会社グローバル・トレーディング・ジャパン,カブシキガイシャグローバル,法人,渡邉 髙史,6543210987654,101-0021,東京都千代田区外神田6-6-6,,03-4444-5555,,global@example.com,異体字（髙・邉）',
    '佐藤行政法務事務所,サトウギョウセイ,個人,佐藤 七郎,,104-0061,東京都中央区銀座7-7-7,銀座ビル3F,03-5555-6666,,sato@example.com,士業',
    'ワールドワイド・テクノロジーズ株式会社,ワールドワイド,法人,ジョン スミス,5432109876543,106-0032,東京都港区六本木8-8-8,六本木タワー,03-6666-7777,03-6666-7778,john@example.com,外資系企業',
    '有限会社鈴木商店,ユウゲンガイシャスズキショウテン,法人,鈴木 太郎,4321098765432,130-0001,東京都墨田区吾妻橋1-2-3,,03-7777-8888,,suzuki@example.com,老舗企業',
    '未指定フリーランス工房,ミシテイフリーランス,,フリー 太郎,,166-0003,東京都杉並区高円寺南1-1-1,,090-9999-0000,,free@example.com,区分未指定（警告対象）'
];

const csv10Content = [header, ...sampleRows10].join('\r\n');

// 1-1. UTF-8 (BOMなし)
fs.writeFileSync(path.join(fixtureDir, 'sample_utf8.csv'), Buffer.from(csv10Content, 'utf-8'));

// 1-2. UTF-8 (BOMあり)
const bomHeader = Buffer.from([0xEF, 0xBB, 0xBF]);
const utf8BomContent = Buffer.concat([bomHeader, Buffer.from(csv10Content, 'utf-8')]);
fs.writeFileSync(path.join(fixtureDir, 'sample_utf8_bom.csv'), utf8BomContent);

// 1-3. 100件大規模データ (sample_100_customers.csv)
const rows100 = [header];
for (let i = 1; i <= 100; i++) {
    const isCorp = i % 3 !== 0;
    const corpNum = isCorp ? `123456789${String(i).padStart(4, '0')}` : '';
    const type = isCorp ? '法人' : '個人';
    const name = isCorp ? `株式会社サンプル_${i}` : `個人事業者_${i}`;
    const kana = isCorp ? `カブシキガイシャサンプル_${i}` : `コジンジギョウシャ_${i}`;
    rows100.push(`${name},${kana},${type},代表_${i},${corpNum},100-0001,東京都千代田区1-${i},ビル${i}F,03-1234-${String(i).padStart(4, '0')},,info_${i}@example.com,大規模テストデータ_${i}`);
}
fs.writeFileSync(path.join(fixtureDir, 'sample_100_customers.csv'), Buffer.from(rows100.join('\r\n'), 'utf-8'));

console.log('✅ CSV Fixtures generated successfully in tests/fixtures/');
