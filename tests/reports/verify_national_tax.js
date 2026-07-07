const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:5005';
const EVIDENCE_DIR = path.resolve(__dirname, 'evidence');
const DOWNLOAD_DIR = path.resolve(__dirname, 'download_tmp');

if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log("🎬 Starting National Tax Certificate Acceptance Test v7...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    // Expose file saving
    await page.exposeFunction('saveBlobAsFile', async (base64Data, filename) => {
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(path.join(DOWNLOAD_DIR, filename), buffer);
        console.log(`[Test] Intercepted and saved PDF to: ${filename}`);
    });

    // Mock window.open
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
                            const filename = `納税証明書_国税_test_${Date.now()}.pdf`;
                            window.saveBlobAsFile(base64, filename);
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(err => console.error('Error fetching text / blob:', err));
                return null;
            }
            return null;
        };
    });

    page.on('console', msg => {
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    let lastDialogMsg = '';
    page.on('dialog', async dialog => {
        lastDialogMsg = dialog.message();
        console.log(`[Browser Dialog] ${dialog.type()}: ${lastDialogMsg}`);
        await dialog.accept();
    });

    try {
        console.log("🔐 Logging in...");
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'load' });
        
        await page.type('#login-email', 'lapis-test@lapis.local');
        await page.type('#login-pass', 'Lapis3_2026!');
        await page.click('#login-form button[type="submit"]');

        // OTP入力画面が表示されるか確認
        console.log("🔑 Waiting for 2FA / OTP Dialog...");
        try {
            await page.waitForSelector('#otp-code', { visible: true, timeout: 5000 });
            console.log("🔑 Entering OTP...");
            await page.type('#otp-code', '123456');
            await page.click('#otp-form button[type="submit"]');
            await delay(3000);
        } catch (e) {
            console.log("OTP dialog not displayed or bypassed.");
        }

        console.log("📂 Navigating to Customer Detail...");
        await page.goto(`${BASE_URL}/customer_detail.html?id=1001`, { waitUntil: 'load' });
        console.log("Current URL in customer detail:", page.url());

        await delay(2000);

        // 📑 「帳票」タブをクリックしてアクティブ化
        console.log("📑 Clicking Reports tab...");
        await page.waitForSelector('button.tab-btn[data-tab="reports"]', { timeout: 5000 });
        await page.click('button.tab-btn[data-tab="reports"]');
        await delay(1000);

        await page.screenshot({ path: path.join(EVIDENCE_DIR, '00_customer_detail_page.png') });

        // 1. 開くボタンの存在確認とクリック
        console.log("🔍 Checking modal open button...");
        await page.waitForSelector('#btn-open-national-tax-cert-modal', { timeout: 5000 });
        await page.click('#btn-open-national-tax-cert-modal');
        await delay(1500);

        // モーダルのスクリーンショットを撮影 (初期表示・自動計算日付が入っているか確認)
        await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_modal_initial.png') });
        console.log("📸 Saved screenshot: 01_modal_initial.png");

        // 2. 共通バリデーションチェック（何も選択せずに「印刷・保存」をクリック）
        console.log("⚠️ Testing validation (no type selected)...");
        lastDialogMsg = '';
        await page.click('#btn-print-national-report');
        await delay(1500);

        if (!lastDialogMsg.includes('その1・その2・その3の3のいずれかを選択してください。')) {
            throw new Error('Validation failed for no type selected: ' + lastDialogMsg);
        }
        console.log("✅ Validation for no type selected passed!");

        // 3. その1, その2, その3の3をチェックして、入力グループの表示確認
        console.log("☑️ Checking all certificate types checkboxes...");
        await page.click('#national_cert_sono1');
        await page.click('#national_cert_sono2');
        await page.click('#national_cert_sono33');
        await delay(1500);

        await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_modal_all_selected.png') });
        console.log("📸 Saved screenshot: 02_modal_all_selected.png");

        // 4. その1、その2、その3の3の入力フォームへ入力
        console.log("✍️ Entering data into forms...");
        
        // その1の入力 (税目と枚数のみ設定し、日付は自動計算された初期値をそのまま使用)
        await page.click('#national_sono1_tax_corporate');
        await page.click('#national_sono1_tax_consumption');
        const sono1StartVal = await page.$eval('#national_sono1_period_start', el => el.value);
        const sono1EndVal = await page.$eval('#national_sono1_period_end', el => el.value);
        console.log(`[Test] Auto-calculated Sono1 Period: ${sono1StartVal} ~ ${sono1EndVal}`);
        if (!sono1StartVal || !sono1EndVal) {
            throw new Error("Auto-calculated dates for Sono1 are empty!");
        }
        await page.evaluate(() => document.getElementById('national_sono1_copies').value = '2');

        // その2の入力 (日付は自動入力された初期値をそのまま使用)
        await page.click('#national_sono2_tax_income');
        const sono2StartVal = await page.$eval('#national_sono2_period_start', el => el.value);
        const sono2EndVal = await page.$eval('#national_sono2_period_end', el => el.value);
        console.log(`[Test] Auto-calculated Sono2 Period: ${sono2StartVal} ~ ${sono2EndVal}`);
        if (!sono2StartVal || !sono2EndVal) {
            throw new Error("Auto-calculated dates for Sono2 are empty!");
        }
        await page.evaluate(() => document.getElementById('national_sono2_copies').value = '1');

        // その3の3の入力
        await page.evaluate(() => document.getElementById('national_sono33_copies').value = '3');

        // 使用目的
        await page.select('#report_national_purpose', '登録申請（更新）');

        // 申請者区分を本人に変更
        await page.select('#report_national_applicant_type', '本人');

        await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_modal_filled.png') });
        console.log("📸 Saved screenshot: 03_modal_filled.png");

        // 5. 印刷ボタンをクリックして PDF を生成
        console.log("🖨️ Clicking print button to generate PDF...");
        await page.click('#btn-print-national-report');
        
        console.log("⏳ Waiting for PDF generation...");
        await delay(12000);

        // ファイル存在確認
        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith('納税証明書_国税_test_') && f.endsWith('.pdf'));
        if (files.length === 0) {
            throw new Error("No PDF generated!");
        }
        console.log("✅ Success! Generated PDF: " + files[0]);

    } catch (err) {
        console.error("❌ Acceptance test failed:", err);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, 'error_page.png') });
        process.exit(1);
    } finally {
        await browser.close();
        process.exit(0);
    }
})();
