const puppeteer = require('puppeteer');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { execSync } = require('child_process');

// --- 設定 ---
const BASE_URL = 'http://127.0.0.1:5005';
const TEST_RESULTS_FILE = 'test_results.json';
const SCREENSHOT_DIR = './screenshots';

// Firestore Emulator環境変数の設定
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'lapis3-4113e';

if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR);
}

const results = [];

function saveResults() {
    fs.writeFileSync(TEST_RESULTS_FILE, JSON.stringify(results, null, 2));
}

function logResult(scenario, result, detail) {
    const entry = {
        scenario,
        result,
        detail,
        timestamp: new Date().toISOString()
    };
    results.push(entry);
    console.log(`\n=== ${scenario} ===\nResult: ${result.toUpperCase()}\nDetail: ${detail}\n`);
    saveResults();
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log("🌱 テストデータを生成中...");
    try {
        execSync('node generate_test_data.js', { stdio: 'inherit' });
    } catch (e) {
        console.error("Test data generation failed:", e);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    page.on('console', msg => {
        const type = msg.type().toUpperCase();
        if (type === 'LOG' || type === 'INFO' || type === 'WARN' || type === 'ERROR') {
            console.log(`[Browser Console] ${type} - ${msg.text()}`);
        }
    });

    page.on('dialog', async dialog => {
        console.log(`[Browser Dialog] ${dialog.type()}: ${dialog.message()}`);
        await dialog.dismiss();
    });

    try {
        await page.evaluateOnNewDocument(() => {
            window.__TEST_MODE__ = true;
        });

        console.log("🔐 ログイン処理を実行中...");
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'load' });
        await page.evaluate(async () => {
            if (typeof firebase === 'undefined') return;
            try {
                await firebase.auth().signInWithEmailAndPassword('test@example.com', 'password123');
            } catch (e) {
                console.error("Login failed:", e);
            }
        });
        await delay(3000); 
        
        console.log("🚀 テストシナリオを開始します...");

        const switchToProjectsTab = async () => {
            await page.waitForSelector('button[data-tab="projects"]', { timeout: 10000 });
            await page.click('button[data-tab="projects"]');
            await delay(500);
        };

        const boundaries = [
            { count: 0, id: 900000 },
            { count: 20, id: 900001 },
            { count: 21, id: 900002 },
            { count: 39, id: 900003 },
            { count: 40, id: 900004 }
        ];

        for (const b of boundaries) {
            console.log(`🔍 境界値検証中: ${b.id} (${b.count}件)...`);
            await page.goto(`${BASE_URL}/customer_detail.html?id=${b.id}`, { waitUntil: 'load' });
            await switchToProjectsTab();

            try {
                if (b.count === 0) {
                    await page.waitForFunction(() => {
                        const cell = document.querySelector('#related-cases-body td.no-data-cell');
                        return cell && cell.offsetParent !== null;
                    }, { timeout: 10000 });
                } else {
                    const expectedInitial = Math.min(b.count, 20);
                    await page.waitForFunction((count) => {
                        const rows = Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                            !tr.querySelector('.no-data-cell') && 
                            !tr.querySelector('.skeleton-row') &&
                            !tr.querySelector('.btn-load-more')
                        );
                        return rows.length >= count;
                    }, { timeout: 15000 }, expectedInitial);
                }

                if (b.count > 20) {
                    let currentCount = 0;
                    let retry = 0;
                    while (currentCount < b.count && retry < 5) {
                        currentCount = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                                !tr.querySelector('.no-data-cell') && 
                                !tr.querySelector('.skeleton-row') &&
                                !tr.querySelector('.btn-load-more')
                            ).length;
                        });
                        if (currentCount >= b.count) break;
                        const btnClicked = await page.evaluate(() => {
                            const btn = document.querySelector('#related-cases-body .btn-load-more');
                            if (btn && btn.offsetParent !== null && !btn.disabled) {
                                btn.click();
                                return true;
                            }
                            return false;
                        });
                        if (!btnClicked) {
                            await delay(1000);
                            retry++;
                            continue;
                        }
                        const prevCount = currentCount;
                        await page.waitForFunction((prev) => {
                            const rows = Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                                !tr.querySelector('.no-data-cell') && 
                                !tr.querySelector('.skeleton-row') &&
                                !tr.querySelector('.btn-load-more')
                            );
                            return rows.length > prev;
                        }, { timeout: 10000 }, prevCount).catch(() => {});
                        retry = 0;
                    }
                }

                const finalRowCount = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                        !tr.querySelector('.no-data-cell') && 
                        !tr.querySelector('.skeleton-row') &&
                        !tr.querySelector('.btn-load-more')
                    ).length;
                });

                if (finalRowCount === b.count) {
                    logResult(`Pagination (${b.count}件)`, "pass", `期待通りの件数: ${finalRowCount}`);
                } else {
                    logResult(`Pagination (${b.count}件)`, "fail", `件数不一致: 期待=${b.count}, 実際=${finalRowCount}`);
                }
            } catch (err) {
                logResult(`Pagination (${b.count}件)`, "fail", `エラー発生: ${err.message}`);
            }
        }

        logResult("ソート変動耐性テスト", "info", "開始");
        await page.goto(`${BASE_URL}/customer_detail.html?id=900004`, { waitUntil: 'load' });
        await switchToProjectsTab();
        await delay(1000);
        console.log("📝 データを擬似更新中...");
        execSync('node destructive_update.js 900004', { stdio: 'inherit' });
        await delay(2000);
        const loadMoreClicked = await page.evaluate(() => {
            const btn = document.querySelector('#related-cases-body .btn-load-more');
            if (btn && btn.offsetParent !== null) {
                btn.click();
                return true;
            }
            return false;
        });
        if (loadMoreClicked) {
            await delay(3000);
            const rowCount = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                    !tr.querySelector('.no-data-cell') && 
                    !tr.querySelector('.skeleton-row') &&
                    !tr.querySelector('.btn-load-more')
                ).length;
            });
            if (rowCount > 20) {
                logResult("ソート変動耐性", "pass", `更新後の「もっと見る」に成功: ${rowCount}件`);
            } else {
                logResult("ソート変動耐性", "fail", "更新後にデータが追加読み込みされませんでした");
            }
        } else {
            logResult("ソート変動耐性", "fail", "「もっと見る」ボタンが見つかりませんでした");
        }

        logResult("同時更新シナリオ", "info", "開始");
        await page.goto(`${BASE_URL}/customer_detail.html?id=900001`, { waitUntil: 'load' });
        await switchToProjectsTab();
        await delay(1000);
        console.log("➕ 並行してデータ追加を実行...");
        execSync('node destructive_update.js 900001 add', { stdio: 'inherit' });
        await delay(3000);
        const hasConflict = await page.evaluate(() => {
            return document.body.innerText.includes('Error') || document.body.innerText.includes('undefined');
        });
        if (!hasConflict) {
            logResult("同時更新", "pass", "不整合や表示崩れなし");
        } else {
            logResult("同時更新", "fail", "不整合またはエラー表示を検出");
        }

        logResult("遅延注入テスト (スケルトンUI)", "info", "開始");
        // Use a clean URL for skeleton check
        await page.goto(`${BASE_URL}/customer_detail.html?id=900001&test_delay=5000`, { waitUntil: 'domcontentloaded' });
        
        let initialSkeleton = false;
        try {
            await page.waitForSelector('.skeleton-row', { timeout: 3000 });
            initialSkeleton = true;
            console.log("✅ Skeleton detected");
        } catch (e) {
            console.warn("Skeleton not detected via waitForSelector");
        }

        await switchToProjectsTab();
        
        // Switch tab and check again if skeleton is still there
        const skeletonInTab = await page.evaluate(() => {
            const skel = document.querySelector('.skeleton-row');
            return skel && skel.offsetParent !== null;
        });

        await delay(7000); // 10s wait for data
        
        const afterSkeleton = await page.evaluate(() => document.querySelector('.skeleton-row') === null);
        const hasData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#related-cases-body tr')).filter(tr => 
                !tr.querySelector('.no-data-cell') && 
                !tr.querySelector('.skeleton-row') &&
                !tr.querySelector('.btn-load-more')
            );
            return rows.length > 0;
        });

        if (initialSkeleton && afterSkeleton && hasData) {
            logResult("遅延注入", "pass", "スケルトン表示からデータ表示への遷移を確認");
        } else {
            logResult("遅延注入", "fail", `スケルトン表示破綻: initial=${initialSkeleton}, inTab=${skeletonInTab}, afterRemoved=${afterSkeleton}, hasData=${hasData}`);
        }

        logResult("エラー強制発生テスト", "info", "開始");
        await page.goto(`${BASE_URL}/customer_detail.html?id=900001&test_error=true`, { waitUntil: 'load' });
        await switchToProjectsTab();
        await delay(2000);
        const hasErrorUI = await page.evaluate(() => {
            return document.body.innerText.includes('失敗') || document.querySelector('.section-error-ui') !== null;
        });
        if (hasErrorUI) {
            logResult("エラー強制発生", "pass", "エラーUIの表示を確認");
        } else {
            logResult("エラー強制発生", "fail", "エラーが発生したにも関わらずUIに変化なし");
        }

    } catch (err) {
        console.error("Test execution failed:", err);
    } finally {
        await browser.close();
        console.log("\n🏁 全てのテストシナリオが終了しました。");
        const allPass = results.filter(r => r.result === 'fail').length === 0;
        process.exit(allPass ? 0 : 1);
    }
})();
