const fs = require('fs');
const path = require('path');

const pdfPath = path.resolve(__dirname, 'evidence/UT-013.pdf');
if (!fs.existsSync(pdfPath)) {
    console.error('PDF file not found:', pdfPath);
    process.exit(1);
}

const pdfBuffer = fs.readFileSync(pdfPath);
const pdfText = pdfBuffer.toString('binary');

console.log('PDF File Size:', pdfBuffer.length, 'bytes');

// フォントに関連するキーワードを検索
const fontMatches = pdfText.match(/\/FontName\s*\/[A-Za-z0-9+#-]+/g);
console.log('FontName matches:', fontMatches);

const fontFileMatches = pdfText.match(/\/FontFile\d?\s*\d+\s+\d+\s+R/g);
console.log('FontFile references:', fontFileMatches);

// ストリームのサイズを検索
const streamMatches = pdfText.match(/\/Length\s+(\d+)/g);
console.log('Stream lengths:', streamMatches);

// NotoSansJPという文字列が何回出現するか
const notoMatches = pdfText.match(/NotoSansJP/g);
console.log('NotoSansJP count:', notoMatches ? notoMatches.length : 0);

// オブジェクト21の定義部分を検索
const objIndex = pdfText.indexOf('21 0 obj');
if (objIndex !== -1) {
    console.log('Object 21 Context:');
    console.log(pdfText.substring(objIndex, objIndex + 500));
} else {
    console.log('Object 21 not found by exact string "21 0 obj"');
}

// ローカルのWebサーバーからフォントをフェッチしてサイズを確認
const http = require('http');
http.get('http://127.0.0.1:8080/report-system/report-templates/NotoSansJP-Regular.ttf', (res) => {
    let size = 0;
    res.on('data', (chunk) => {
        size += chunk.length;
    });
    res.on('end', () => {
        console.log('Font size fetched from web server (8080):', size, 'bytes');
        // ローカルファイルシステムのフォントサイズも確認
        const localPath = path.resolve(__dirname, '../../report-system/report-templates/NotoSansJP-Regular.ttf');
        if (fs.existsSync(localPath)) {
            console.log('Local font file size:', fs.statSync(localPath).size, 'bytes');
        } else {
            console.log('Local font file not found at:', localPath);
        }
    });
}).on('error', (e) => {
    console.error('Failed to fetch font from server:', e.message);
});


