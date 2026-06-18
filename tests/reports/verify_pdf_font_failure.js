const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:8080';
const DOWNLOAD_DIR = path.resolve(__dirname, 'download_test');
const FONT_PATH = path.resolve(__dirname, 'report-system', 'report-templates', 'NotoSansJP-Regular.ttf');
const FONT_TEMP_PATH = path.resolve(__dirname, 'report-system', 'report-templates', 'NotoSansJP-Regular.ttf.tmp');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

// 既存のダウンロードファイルを削除
fs.readdirSync(DOWNLOAD_DIR).forEach(file => {
    fs.unlinkSync(path.join(DOWNLOAD_DIR, file));
});

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log("🚀 Starting Font Failure (UT-016) verification test...");
    let testFailed = false;

    // 1. フォントファイルを一時的にリネームして見つからないようにする
    if (!fs.existsSync(FONT_PATH)) {
        console.error("❌ Font file not found at:", FONT_PATH);
        process.exit(1);
    }
    fs.renameSync(FONT_PATH, FONT_TEMP_PATH);
    console.log("📁 Renamed font file to make fetch fail (404).");

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // ダウンロード先ディレクトリの設定
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_DIR
    });

    let consoleErrors = [];
    page.on('console', msg => {
        const type = msg.type().toUpperCase();
        if (type === 'ERROR') {
            console.error(`[Browser Error] ${msg.text()}`);
            consoleErrors.push(msg.text());
        } else {
            console.log(`[Browser Console] ${type} - ${msg.text()}`);
        }
    });

    page.on('pageerror', err => {
        console.error(`[Page Uncaught Error] ${err.toString()}`);
        consoleErrors.push(err.toString());
    });

    let fontAlertMsg = "";
    let alertCount = 0;

    // ダイアログハンドラー: 期待されるメッセージが表示されたら承諾する
    page.on('dialog', async dialog => {
        const msg = dialog.message();
        console.log(`[Browser Dialog] ${dialog.type()}: ${msg}`);
        
        if (msg.includes('PDF出力に必要なフォントの読み込みに失敗しました')) {
            fontAlertMsg = msg;
            alertCount++;
        }
        await dialog.accept();
    });

    try {
        console.log("🔐 Logging in...");
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'load' });
        
        await page.type('#login-email', 'lapis-test@lapis.local');
        await page.type('#login-pass', 'Lapis3_2026!');
        await page.click('#login-form button[type="submit"]');

        // OTPモーダルの出現を待つ
        console.log("🔑 Waiting for 2FA / OTP Dialog...");
        await page.waitForSelector('#otp-code', { timeout: 10000 });
        await page.type('#otp-code', '123456');
        
        // アニメーション競合やクリックバグを防ぐため、直接submitイベントをトリガーする
        console.log("📤 Submitting OTP form...");
        await page.evaluate(() => {
            document.getElementById('otp-form').dispatchEvent(new Event('submit'));
        });

        await delay(3000);

        console.log("📂 Navigating to Customer Detail...");
        await page.goto(`${BASE_URL}/customer_detail.html?id=1001&v=${Date.now()}`, { waitUntil: 'load' });
        await delay(2000);

        console.log("🖨️ Clicking PDF Export Button (Should Fail)...");
        await page.waitForSelector('#btn-export-summary-pdf', { timeout: 10000 });
        await page.click('#btn-export-summary-pdf');

        // 生成処理が失敗するのを待つ (ダイアログがトリガーされる)
        await delay(3000);

        // ダイアログが正しく表示されたか検証
        if (alertCount === 0) {
            throw new Error("Failure alert dialog was not shown!");
        }
        console.log(`✅ Success! Failure dialog captured: "${fontAlertMsg}"`);

        // ダウンロードディレクトリが空であることを確認（処理中断の検証）
        const files = fs.readdirSync(DOWNLOAD_DIR);
        if (files.length > 0) {
            throw new Error(`PDF was downloaded even though font loading failed! Files: ${files.join(', ')}`);
        }
        console.log("✅ Success! Download directory is empty (Process aborted).");

        // ボタンの表示が元に戻っていることを確認（Disabledが解除されていること）
        const btnState = await page.evaluate(() => {
            const btn = document.getElementById('btn-export-summary-pdf');
            return {
                disabled: btn.disabled,
                text: btn.innerText
            };
        });
        console.log(`Button state after failure: disabled=${btnState.disabled}, text="${btnState.text.trim()}"`);
        if (btnState.disabled) {
            throw new Error("Export button remains disabled after failure!");
        }
        console.log("✅ Success! Export button state has been restored.");

    } catch (err) {
        console.error("❌ Test run failed:", err);
        testFailed = true;
    } finally {
        // フォントファイルの復元（リネーム）
        if (fs.existsSync(FONT_TEMP_PATH)) {
            fs.renameSync(FONT_TEMP_PATH, FONT_PATH);
            console.log("📁 Restored font file path.");
        }
        await browser.close();
        process.exit(testFailed ? 1 : 0);
    }
})();
