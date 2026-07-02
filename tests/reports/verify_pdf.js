const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:5005';
const DOWNLOAD_DIR = path.resolve(__dirname, 'download_test');

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
    console.log("🚀 Starting PDF verification test...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Expose file saving to Puppeteer page
    await page.exposeFunction('saveBlobAsFile', async (base64Data, filename) => {
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(path.join(DOWNLOAD_DIR, filename), buffer);
        console.log(`[Test Intercept] Intercepted and saved blob to: ${filename}`);
    });

    // Mock window.open to intercept blobs and save them locally
    await page.evaluateOnNewDocument(() => {
        window.__TEST__ = true;
        window.open = function(url, target, features) {
            if (url && url.startsWith('blob:')) {
                fetch(url)
                    .then(res => res.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const base64 = reader.result.split(',')[1];
                            const today = new Date();
                            const yyyymmdd = today.getFullYear() +
                                String(today.getMonth() + 1).padStart(2, '0') +
                                String(today.getDate()).padStart(2, '0');
                            const nameEl = document.getElementById('customer-name-display');
                            const customerName = (nameEl ? nameEl.textContent.trim() : 'テスト建設株式会社') || 'テスト建設株式会社';
                            const safeName = customerName.replace(/[\\/:*?"<>|]/g, '_');
                            const filename = `顧客カルテ概要_${safeName}_${yyyymmdd}.pdf`;
                            window.saveBlobAsFile(base64, filename);
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(err => console.error('Error fetching blob in mock open:', err));
                return null;
            }
            return null;
        };
    });

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

    page.on('dialog', async dialog => {
        console.log(`[Browser Dialog] ${dialog.type()}: ${dialog.message()}`);
        await dialog.accept();
    });

    try {
        console.log("🔐 Logging in...");
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'load' });
        
        // ログインフォームに入力
        await page.type('#login-email', 'lapis-test@lapis.local');
        await page.type('#login-pass', 'Lapis3_2026!');
        await page.click('#login-form button[type="submit"]');

        // OTP入力画面が表示されるのを待つ (表示された場合のみ)
        console.log("🔑 Waiting for 2FA / OTP Dialog...");
        try {
            await page.waitForSelector('#otp-code', { timeout: 4000 });
            await page.type('#otp-code', '123456');
            await page.click('#otp-form button[type="submit"]');
            await delay(3000);
        } catch (e) {
            console.log("OTP not required or already bypassed.");
        }

        console.log("📂 Navigating to Customer Detail...");
        // キャッシュバスター付きで遷移
        await page.goto(`${BASE_URL}/customer_detail.html?id=1001&v=${Date.now()}`, { waitUntil: 'load' });
        await delay(2000);

        // 概要タブがアクティブであることを確認し、PDF出力ボタンをクリック
        console.log("🖨️ Clicking PDF Export Button...");
        await page.waitForSelector('#btn-export-summary-pdf', { timeout: 10000 });
        await page.click('#btn-export-summary-pdf');

        console.log("⏳ Waiting for PDF generation & download (5s)...");
        await delay(5000);

        // コンソールエラーの確認 (404エラーなどは無視)
        const criticalErrors = consoleErrors.filter(e => !e.includes('Failed to load resource') && !e.includes('404'));
        if (criticalErrors.length > 0) {
            throw new Error(`Test failed due to browser console errors:\n${criticalErrors.join('\n')}`);
        }

        // ダウンロードディレクトリの確認
        const files = fs.readdirSync(DOWNLOAD_DIR);
        console.log("Downloaded files:", files);

        if (files.length === 0) {
            throw new Error("No PDF file downloaded!");
        }

        const pdfFile = files.find(f => f.startsWith('顧客カルテ概要_') && f.endsWith('.pdf'));
        if (!pdfFile) {
            throw new Error(`Downloaded file name is invalid: ${files.join(', ')}`);
        }

        const filePath = path.join(DOWNLOAD_DIR, pdfFile);
        const stats = fs.statSync(filePath);
        console.log(`✅ Success! Downloaded: ${pdfFile} (${stats.size} bytes)`);

    } catch (err) {
        console.error("❌ Test run failed:", err);
        process.exit(1);
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
