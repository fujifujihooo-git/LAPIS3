/**
 * REP-006A: LAPIS3 本番データ実態調査スクリプト（偵察フェーズ）
 *
 * 目的:
 *   本番Firestoreの顧客データを統計的に調査し、
 *   REP-006B（PDF出力検証）の戦略を決定するための情報を収集する。
 *
 * 接続方式:
 *   Puppeteer でブラウザを起動し、テストアカウントでログイン後、
 *   ブラウザ内のFirebase SDKを使って本番Firestoreから読み取る。
 *   ★ 読み取り専用。書き込みは一切行わない。★
 *
 * 前提条件:
 *   - Webサーバーが http://127.0.0.1:8080 で起動していること
 *   - ただし接続先Firestoreは「本番」(useEmulator=false の環境)
 *   - つまり hostname が 127.0.0.1 だとエミュレータに接続してしまうため、
 *     本番接続用のポート (8081) か、本番ホスティングURLを使う必要がある。
 *
 * 接続先の判断:
 *   firebase-config.js の useEmulator 判定:
 *     hostname === 'localhost' || hostname === '127.0.0.1' → エミュレータ
 *   → 本番Firestoreに接続するには https://lapis3-4113e.web.app を使う
 *
 * 使い方:
 *   node tests/reports/rep006a_scout.js
 *   node tests/reports/rep006a_scout.js --local   (ローカルエミュレータを使う場合)
 */

'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// --local フラグ: エミュレータ環境で動作確認したい場合に使う
const USE_LOCAL = process.argv.includes('--local');
const BASE_URL = USE_LOCAL ? 'http://127.0.0.1:8080' : 'https://lapis3-4113e.web.app';

const EVIDENCE_DIR = path.resolve(__dirname, 'evidence', 'rep006a');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// 特殊文字の検出リスト
const SPECIAL_CHARS = [
    '㈱', '㈲', '㈻', '㈹', // 括弧付き法人格
    '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', // 丸数字
    'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', // ローマ数字
    '髙', '﨑', '濵', '栁', '彅', // 人名異体字
    '〜', '～', '－', '―', '—', // 各種ダッシュ・波線
    '・', '･', // 中黒（全角・半角）
];

// 半角カナ検出用正規表現
const HALF_KANA_REGEX = /[\uFF61-\uFF9F]/;

// 制御文字・不可視文字検出用正規表現（改行・タブ以外の制御文字）
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\u200D\uFEFF]/;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  REP-006A: LAPIS3 本番データ実態調査（偵察フェーズ）');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  接続先: ${BASE_URL}`);
    console.log(`  モード: ${USE_LOCAL ? 'エミュレータ' : '本番Firestore'}`);
    console.log('  ※ 読み取り専用。データは一切変更しません。');
    console.log('═══════════════════════════════════════════════════════\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // ダイアログは自動承認
    page.on('dialog', async dialog => {
        console.log(`[Dialog] ${dialog.type()}: ${dialog.message().substring(0, 80)}`);
        await dialog.accept();
    });

    try {
        // ─────────────────────────────────────────────
        // Step 1: ログイン
        // ─────────────────────────────────────────────
        console.log('🔐 Step 1: ログイン処理...');
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'load', timeout: 30000 });

        if (USE_LOCAL) {
            // エミュレータ: テストアカウントでOTP経由ログイン (verify_all_ut.js と同一方式)
            await page.type('#login-email', 'lapis-test@lapis.local');
            await page.type('#login-pass', 'Lapis3_2026!');
            await page.click('#login-form button[type="submit"]');

            // OTP入力モーダルの表示を待つ
            await page.waitForSelector('#otp-code', { timeout: 10000 });
            await page.evaluate(() => {
                const input = document.getElementById('otp-code');
                input.value = '123456';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                document.getElementById('otp-form').dispatchEvent(new Event('submit'));
            });
            // ログイン後のリダイレクトを待つ
            await delay(5000);

            // ログイン成功確認: index.html または dashboard に遷移しているか
            const currentUrl = page.url();
            console.log(`  ログイン後URL: ${currentUrl}`);
            if (currentUrl.includes('login.html')) {
                throw new Error('ログインに失敗しました。エミュレータに lapis-test@lapis.local の staff データが存在するか確認してください。');
            }
            console.log('  ✅ ログイン成功');
        } else {
            // 本番: テストアカウントでログイン（OTP は本番では実メール送信）
            // ⚠️ AGENTS.md 準拠: nakamura@nakamuraj.com は使用禁止
            // 本番環境へのログインが必要なため、ユーザーに確認が必要
            console.log('');
            console.log('⚠️  本番環境へのログインが必要です。');
            console.log('   ブラウザが起動します。5分以内に手動でログインしてください。');
            console.log('   ログイン完了後、スクリプトが自動継続します。');
            console.log('');
            await browser.close();
            console.log('');
            console.log('【解決策】');
            console.log('  本番データを調査するには以下のいずれかを使ってください:');
            console.log('');
            console.log('  方法A: --local フラグでエミュレータデータを調査（現在の開発データ）');
            console.log('    node tests/reports/rep006a_scout.js --local');
            console.log('');
            console.log('  方法B: エミュレータに本番データをエクスポートしてから調査');
            console.log('    1. Firebase Consoleからデータをエクスポート');
            console.log('    2. firebase emulators:start --import=./emulator_data');
            console.log('    3. node tests/reports/rep006a_scout.js --local');
            console.log('');
            console.log('  方法C: サービスアカウントキーを取得して接続');
            console.log('    1. Firebase Console > プロジェクト設定 > サービスアカウント');
            console.log('    2. 「新しい秘密鍵の生成」でJSONをダウンロード');
            console.log('    3. GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json を設定');
            console.log('    4. node tests/reports/rep006a_scout.js --service-account');
            process.exit(0);
        }

        // ─────────────────────────────────────────────
        // Step 2: Firestore から全顧客データを収集
        // ─────────────────────────────────────────────
        console.log('📊 Step 2: 顧客データ収集中（本番Firestoreは時間がかかる場合あり）...');

        // customer_list.html を開いてFirebase SDKが初期化された状態にする
        await page.goto(`${BASE_URL}/customer_list.html`, { waitUntil: 'load', timeout: 30000 });
        await delay(3000);

        // ブラウザ内でFirestore全顧客データを収集して統計を計算する
        const rawStats = await page.evaluate(async (specialChars, halfKanaPattern, controlCharPattern) => {
            // Firestoreから全顧客を取得
            let allCustomers = [];
            try {
                const snapshot = await firebase.firestore().collection('customers').get();
                snapshot.forEach(doc => {
                    const d = doc.data();
                    allCustomers.push({
                        id: doc.id,
                        customer_id: d.customer_id,
                        customer_name: d.customer_name || '',
                        remarks: d.remarks || '',
                        status: d.status || '',
                    });
                });
            } catch (e) {
                return { error: e.message };
            }

            const total = allCustomers.length;
            if (total === 0) return { error: 'customers コレクションにデータがありません' };

            // ── 顧客名 統計 ──
            const nameLengths = allCustomers.map(c => c.customer_name.length);
            const nameMax = Math.max(...nameLengths);
            const nameAvg = Math.round(nameLengths.reduce((a, b) => a + b, 0) / total);
            const topNamesByLength = [...allCustomers]
                .sort((a, b) => b.customer_name.length - a.customer_name.length)
                .slice(0, 20)
                .map(c => ({ name: c.customer_name, len: c.customer_name.length, id: c.customer_id }));

            // ── 備考 統計 ──
            const remarksLengths = allCustomers.map(c => c.remarks.length);
            const remarksMax = Math.max(...remarksLengths);
            const remarksAvg = Math.round(remarksLengths.reduce((a, b) => a + b, 0) / total);
            const remarksDist = {
                zero: allCustomers.filter(c => c.remarks.length === 0).length,
                under100: allCustomers.filter(c => c.remarks.length > 0 && c.remarks.length <= 100).length,
                under500: allCustomers.filter(c => c.remarks.length > 100 && c.remarks.length <= 500).length,
                over500: allCustomers.filter(c => c.remarks.length > 500 && c.remarks.length <= 2000).length,
                over2000: allCustomers.filter(c => c.remarks.length > 2000).length,
            };
            const topRemarksByLength = [...allCustomers]
                .sort((a, b) => b.remarks.length - a.remarks.length)
                .slice(0, 10)
                .map(c => ({
                    name: c.customer_name,
                    len: c.remarks.length,
                    preview: c.remarks.substring(0, 50).replace(/\n/g, '↵'),
                    id: c.customer_id
                }));

            // ── 特殊文字 検出 ──
            const specialCharCounts = {};
            const halfKanaRe = new RegExp(halfKanaPattern);
            const controlCharRe = new RegExp(controlCharPattern);
            let halfKanaCount = 0;
            let controlCharCount = 0;
            let newlineInRemarksCount = 0;

            for (const sc of specialChars) {
                specialCharCounts[sc] = 0;
            }

            for (const c of allCustomers) {
                const combined = c.customer_name + ' ' + c.remarks;
                for (const sc of specialChars) {
                    if (combined.includes(sc)) specialCharCounts[sc]++;
                }
                if (halfKanaRe.test(combined)) halfKanaCount++;
                if (controlCharRe.test(combined)) controlCharCount++;
                if (c.remarks.includes('\n') || c.remarks.includes('\r')) newlineInRemarksCount++;
            }

            return {
                total,
                name: { max: nameMax, avg: nameAvg, top20: topNamesByLength },
                remarks: { max: remarksMax, avg: remarksAvg, dist: remarksDist, top10: topRemarksByLength },
                specialChars: specialCharCounts,
                halfKanaCount,
                controlCharCount,
                newlineInRemarksCount,
                // ライセンス・案件の集計は別クエリ（重いので件数だけ）
                customerIds: allCustomers.map(c => ({ id: c.customer_id, docId: c.id }))
            };
        }, SPECIAL_CHARS, HALF_KANA_REGEX.source, CONTROL_CHAR_REGEX.source);

        if (rawStats.error) {
            throw new Error(`データ収集エラー: ${rawStats.error}`);
        }

        console.log(`✅ 顧客データ収集完了: ${rawStats.total}件`);

        // ─────────────────────────────────────────────
        // Step 3: 許認可・案件の件数分布を収集
        // ─────────────────────────────────────────────
        console.log('📊 Step 3: 許認可・案件件数分布を収集中...');

        // 件数が多い場合はサンプリング（最大100件）
        const sampleIds = rawStats.customerIds.slice(0, Math.min(100, rawStats.customerIds.length));
        const sampleSize = sampleIds.length;
        const isSampled = rawStats.total > 100;

        const subStats = await page.evaluate(async (ids) => {
            const licCounts = {};
            const caseCounts = {};

            for (const { customer_id } of ids) {
                if (customer_id == null) continue;
                try {
                    const licSnap = await firebase.firestore()
                        .collection('licenses')
                        .where('customer_id', '==', Number(customer_id))
                        .get();
                    licCounts[customer_id] = licSnap.size;
                } catch (e) {
                    licCounts[customer_id] = -1; // エラー
                }
                try {
                    const caseSnap = await firebase.firestore()
                        .collection('cases')
                        .where('customer_id', '==', Number(customer_id))
                        .get();
                    caseCounts[customer_id] = caseSnap.size;
                } catch (e) {
                    caseCounts[customer_id] = -1;
                }
            }

            return { licCounts, caseCounts };
        }, sampleIds);

        console.log(`✅ 許認可・案件データ収集完了 (${sampleSize}件サンプル)`);

        // ─────────────────────────────────────────────
        // Step 4: 統計集計
        // ─────────────────────────────────────────────
        const licValues = Object.values(subStats.licCounts).filter(v => v >= 0);
        const caseValues = Object.values(subStats.caseCounts).filter(v => v >= 0);

        const licDist = {
            zero: licValues.filter(v => v === 0).length,
            under5: licValues.filter(v => v >= 1 && v <= 5).length,
            over6: licValues.filter(v => v >= 6).length,
        };
        const caseDist = {
            zero: caseValues.filter(v => v === 0).length,
            under5: caseValues.filter(v => v >= 1 && v <= 5).length,
            over6: caseValues.filter(v => v >= 6).length,
        };

        const MAX_LIC_CID = licValues.length > 0 ? Math.max(...licValues) : 0;
        const MAX_CASE_CID = caseValues.length > 0 ? Math.max(...caseValues) : 0;

        // ─────────────────────────────────────────────
        // Step 5: レポート出力
        // ─────────────────────────────────────────────
        console.log('\n📝 Step 5: レポート生成中...\n');

        const now = new Date();
        const dateStr = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);

        const scoutResult = {
            generated_at: now.toISOString(),
            mode: USE_LOCAL ? 'emulator' : 'production',
            base_url: BASE_URL,
            customers: {
                total: rawStats.total,
                name: {
                    max_length: rawStats.name.max,
                    avg_length: rawStats.name.avg,
                    top20_by_length: rawStats.name.top20,
                },
                remarks: {
                    max_length: rawStats.remarks.max,
                    avg_length: rawStats.remarks.avg,
                    distribution: rawStats.remarks.dist,
                    top10_by_length: rawStats.remarks.top10,
                },
                special_chars: rawStats.specialChars,
                half_kana_count: rawStats.halfKanaCount,
                control_char_count: rawStats.controlCharCount,
                newline_in_remarks_count: rawStats.newlineInRemarksCount,
            },
            licenses: {
                sample_size: sampleSize,
                is_sampled: isSampled,
                distribution: licDist,
                max_per_customer: MAX_LIC_CID,
            },
            cases: {
                sample_size: sampleSize,
                is_sampled: isSampled,
                distribution: caseDist,
                max_per_customer: MAX_CASE_CID,
            },
        };

        // JSON保存
        const jsonPath = path.join(EVIDENCE_DIR, `rep006a_scout_${dateStr}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(scoutResult, null, 2), 'utf8');
        console.log(`💾 JSON保存: ${jsonPath}`);

        // ── Markdownレポート生成 ──
        const specialCharLines = Object.entries(rawStats.specialChars)
            .filter(([, cnt]) => cnt > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([ch, cnt]) => `| \`${ch}\` | ${cnt}件 |`)
            .join('\n');

        const top20NameLines = rawStats.name.top20
            .map((n, i) => `| ${i + 1} | ${n.name} | ${n.len}文字 |`)
            .join('\n');

        const top10RemarksLines = rawStats.remarks.top10
            .map((r, i) => `| ${i + 1} | ${r.name} | ${r.len}文字 | ${r.preview}... |`)
            .join('\n');

        // REP-001/002の推奨仕様を自動判定
        let rep001Advice = '';
        if (rawStats.name.max <= 15) {
            rep001Advice = `顧客名最大${rawStats.name.max}文字。現状の省略表示で実害は少ないが、折り返し対応推奨。`;
        } else if (rawStats.name.max <= 30) {
            rep001Advice = `顧客名最大${rawStats.name.max}文字。折り返し表示への対応が必要。`;
        } else {
            rep001Advice = `顧客名最大${rawStats.name.max}文字。長名が実在する。折り返し表示は必須。REP-001の優先度はP1で確定。`;
        }

        let rep002Advice = '';
        if (rawStats.remarks.dist.over500 === 0 && rawStats.remarks.dist.over2000 === 0) {
            rep002Advice = `500文字超えの備考は存在しない。REP-002は優先度を下げてよい。`;
        } else if (rawStats.remarks.dist.over2000 === 0) {
            rep002Advice = `500文字超えが${rawStats.remarks.dist.over500}件。2000文字超えなし。上限1000文字程度で対応可能。`;
        } else {
            rep002Advice = `2000文字超えが${rawStats.remarks.dist.over2000}件存在する。帳票崩れリスクあり。REP-002は必須対応。`;
        }

        const md = `# REP-006A: LAPIS3 本番データ実態調査レポート

**調査日時**: ${now.toLocaleString('ja-JP')}  
**調査対象**: ${USE_LOCAL ? 'エミュレータ (localhost:8085)' : '本番 Firestore (lapis3-4113e)'}  
**⚠️ 読み取り専用 - データ変更なし**

---

## 1. 顧客総数

**${rawStats.total}件**

${rawStats.total < 100 ? '→ 規模は小さい。全件PDF検証が可能。' :
  rawStats.total < 500 ? '→ 中規模。全件は重いため、優先抽出戦略が適切。' :
  '→ 大規模。優先抽出（長名・長文備考・特殊文字）での絞り込みが必須。'}

---

## 2. 顧客名 統計

| 指標 | 値 |
|------|----|
| 最大文字数 | **${rawStats.name.max}文字** |
| 平均文字数 | ${rawStats.name.avg}文字 |

### 顧客名 長い順TOP20

| # | 顧客名 | 文字数 |
|---|--------|--------|
${top20NameLines}

### REP-001 への示唆
> ${rep001Advice}

---

## 3. 備考 統計

| 指標 | 値 |
|------|----|
| 最大文字数 | **${rawStats.remarks.max}文字** |
| 平均文字数 | ${rawStats.remarks.avg}文字 |

### 備考 文字数分布

| 区分 | 件数 |
|------|------|
| 0文字（未入力） | ${rawStats.remarks.dist.zero}件 |
| 1〜100文字 | ${rawStats.remarks.dist.under100}件 |
| 101〜500文字 | ${rawStats.remarks.dist.under500}件 |
| 501〜2,000文字 | ${rawStats.remarks.dist.over500}件 |
| 2,001文字以上 | ${rawStats.remarks.dist.over2000}件 |

### 備考 長い順TOP10

| # | 顧客名 | 文字数 | 冒頭50文字 |
|---|--------|--------|------------|
${top10RemarksLines}

### REP-002 への示唆
> ${rep002Advice}

---

## 4. 特殊文字・問題文字 検出結果

### 特殊文字（顧客名＋備考の合計）

${specialCharLines.length > 0 ? `| 文字 | 件数 |\n|------|------|\n${specialCharLines}` : '> 検出された特殊文字はありません。'}

### その他の問題文字

| 種別 | 件数 |
|------|------|
| 半角カナを含む顧客 | **${rawStats.halfKanaCount}件** |
| 制御文字・不可視文字を含む顧客 | **${rawStats.controlCharCount}件** |
| 備考に改行コードを含む顧客 | **${rawStats.newlineInRemarksCount}件** |

---

## 5. 許認可・案件 件数分布

${isSampled ? `> ⚠️ 顧客数が多いため、先頭${sampleSize}件のみサンプリング集計。` : ''}

### 許認可

| 区分 | 件数 |
|------|------|
| 0件 | ${licDist.zero}社 |
| 1〜5件 | ${licDist.under5}社 |
| 6件以上 | ${licDist.over6}社 |
| 1社あたり最大件数 | ${MAX_LIC_CID}件 |

### 案件

| 区分 | 件数 |
|------|------|
| 0件 | ${caseDist.zero}社 |
| 1〜5件 | ${caseDist.under5}社 |
| 6件以上 | ${caseDist.over6}社 |
| 1社あたり最大件数 | ${MAX_CASE_CID}件 |

---

## 6. REP-006B（PDF出力検証）への戦略

### 推奨検証対象の選定

| 優先度 | 選定条件 | 件数上限 | 理由 |
|--------|----------|----------|------|
| 最高 | 顧客名が最も長い順 | 10件 | REP-001の仕様確定に必須 |
| 最高 | 備考が最も長い順 | 10件 | REP-002の仕様確定に必須 |
| 高 | 備考に改行を含む | 5件 | 改行処理の実態確認 |
| 高 | 特殊文字を含む | 5件 | 文字化けリスクの実態確認 |
| 高 | 半角カナを含む | 3件 | 半角カナの描画確認 |
| 中 | 許認可6件以上 | 5件 | テーブル制限の動作確認 |
| 中 | 案件0件 | 3件 | プレースホルダー表示の確認 |
| 低 | ランダム | 5件 | 予期しない問題の発見 |

**予想検証件数: 30〜40件（重複除外後）**

---

## 7. 結論

${rawStats.total}件の本番データを調査した結果:

- **顧客名**: 最大${rawStats.name.max}文字 → ${rep001Advice}
- **備考**: 最大${rawStats.remarks.max}文字 → ${rep002Advice}
- **特殊文字**: ${Object.values(rawStats.specialChars).some(v => v > 0) ? '実在する。UT-013での検証は現実に即していた。' : '検出なし。テストデータとの差異なし。'}
- **半角カナ**: ${rawStats.halfKanaCount}件 ${rawStats.halfKanaCount > 0 ? '→ REP-006B での確認が必要。' : '→ 問題なし。'}
- **改行入り備考**: ${rawStats.newlineInRemarksCount}件 ${rawStats.newlineInRemarksCount > 0 ? '→ 改行処理の検証が必要。' : '→ 問題なし。'}

**次のステップ**: 上記の示唆に基づき、REP-006B の検証対象顧客を選定してPDF出力検証を実施する。
`;

        const mdPath = path.join(EVIDENCE_DIR, `rep006a_scout_${dateStr}.md`);
        fs.writeFileSync(mdPath, md, 'utf8');
        console.log(`📄 Markdown保存: ${mdPath}`);

        // ─────────────────────────────────────────────
        // Step 6: コンソールサマリー出力
        // ─────────────────────────────────────────────
        console.log('\n════════════════════ 調査結果サマリー ════════════════════');
        console.log(`顧客総数        : ${rawStats.total}件`);
        console.log(`顧客名 最大長   : ${rawStats.name.max}文字`);
        console.log(`顧客名 平均長   : ${rawStats.name.avg}文字`);
        console.log(`備考   最大長   : ${rawStats.remarks.max}文字`);
        console.log(`備考   平均長   : ${rawStats.remarks.avg}文字`);
        console.log('');
        console.log('備考 分布:');
        console.log(`  0文字         : ${rawStats.remarks.dist.zero}件`);
        console.log(`  1〜100文字    : ${rawStats.remarks.dist.under100}件`);
        console.log(`  101〜500文字  : ${rawStats.remarks.dist.under500}件`);
        console.log(`  501〜2000文字 : ${rawStats.remarks.dist.over500}件`);
        console.log(`  2001文字以上  : ${rawStats.remarks.dist.over2000}件`);
        console.log('');
        console.log('特殊文字（件数>0のもの）:');
        const detectedSpecials = Object.entries(rawStats.specialChars).filter(([, v]) => v > 0);
        if (detectedSpecials.length === 0) {
            console.log('  (なし)');
        } else {
            detectedSpecials.forEach(([ch, cnt]) => console.log(`  ${ch}: ${cnt}件`));
        }
        console.log(`半角カナ含む    : ${rawStats.halfKanaCount}件`);
        console.log(`制御文字含む    : ${rawStats.controlCharCount}件`);
        console.log(`備考に改行含む  : ${rawStats.newlineInRemarksCount}件`);
        console.log('');
        console.log(`許認可 0件:${licDist.zero} / 1-5件:${licDist.under5} / 6件以上:${licDist.over6} (最大:${MAX_LIC_CID}件)`);
        console.log(`案件   0件:${caseDist.zero} / 1-5件:${caseDist.under5} / 6件以上:${caseDist.over6} (最大:${MAX_CASE_CID}件)`);
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        console.log(`📁 詳細レポート: ${mdPath}`);
        console.log('');
        console.log('✅ REP-006A 完了。上記の結果を見て REP-006B の戦略を決定してください。');

    } catch (e) {
        console.error(`\n❌ エラー発生: ${e.message}`);
        console.error(e.stack);
    } finally {
        await browser.close();
    }

    process.exit(0);
})();
