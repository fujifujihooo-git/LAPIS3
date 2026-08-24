// テンプレートCSV生成スクリプト
const fs = require('fs');
const path = require('path');

const templatesDir = path.join(__dirname, '../templates');
if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
}

// 日本語ヘッダーと入力例（2行目）
const header = '顧客名,フリガナ,区分,代表者名,法人番号,郵便番号,住所,建物名,電話番号,FAX番号,メールアドレス,備考';
const sampleRow = '株式会社アイウ建設,カブシキガイシャアイウケンセツ,法人,愛羽 太郎,9876543210123,100-0001,東京都千代田区千代田1-1,サンプルビル5F,03-1111-2222,03-1111-2223,info@aiu-kensetsu.co.jp,移行データ';

const csvContent = `${header}\r\n${sampleRow}\r\n`;

// 1. UTF-8 BOM付き (Excelでダブルクリックしても文字化けしない)
const bomHeader = Buffer.from([0xEF, 0xBB, 0xBF]);
const utf8BomContent = Buffer.concat([bomHeader, Buffer.from(csvContent, 'utf-8')]);
fs.writeFileSync(path.join(templatesDir, 'customer_import_template.csv'), utf8BomContent);

console.log('✅ templates/customer_import_template.csv generated successfully.');
