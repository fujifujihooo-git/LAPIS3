/**
 * scripts/check_pre_release.js
 * 
 * リリース前・コミット前 総合安全監査スクリプト (Strict Mode)
 * 
 * 検証項目:
 *   1. HTML静的リソース監査 (欠落スクリプト・CSSの検知)
 *   2. 単体テスト群の実行 (billing_summary, 宛名ラベル, 書類返却, 見積PDF)
 *   3. Git未追跡ファイル (Untracked files) の検知（存在時は RELEASE BLOCKED で exit 1）
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function runStep(name, command) {
    console.log(`\n▶ [STEP] ${name}...`);
    try {
        const output = execSync(command, { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'pipe' });
        console.log(output.trim());
        console.log(`✅ ${name} 合格`);
        return true;
    } catch (err) {
        console.error(`❌ ${name} 失敗:`);
        if (err.stdout) console.error(err.stdout.trim());
        if (err.stderr) console.error(err.stderr.trim());
        return false;
    }
}

function checkUntrackedFiles() {
    console.log(`\n▶ [STEP] Git未追跡ファイル (Untracked files) 厳格検査...`);
    try {
        const output = execSync('git ls-files --others --exclude-standard', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
        if (output) {
            const files = output.split('\n').filter(Boolean);
            console.error(`\n🚫 【RELEASE BLOCKED】未追跡（Untracked）ファイルが存在します (${files.length}件):`);
            files.forEach(f => console.error(`   - ${f}`));
            console.error('\n⚠️  未追跡ファイルのコミット漏れを防ぐため、リリースチェックを中断（FAIL）しました。');
            console.error('   必要なファイルは `git add <file>` してステージングするか、');
            console.error('   不要なファイルは削除または .gitignore に追加してください。\n');
            return false;
        } else {
            console.log('✅ 未追跡ファイルはありません（完全クリーン）。');
            return true;
        }
    } catch (err) {
        console.warn('⚠️  Gitステータス取得をスキップしました:', err.message);
        return true;
    }
}

function main() {
    console.log('====================================================');
    console.log('🛡️  LAPIS3 Pre-Release Integrated Health Check');
    console.log('====================================================');

    const steps = [
        { name: '1. HTML静的リソース監査', cmd: 'node scripts/audit_html_resources.js' },
        { name: '2. 請求サマリー単体テスト', cmd: 'node tests/test_billing_summary_unit.js' },
        { name: '3. 宛名ラベル印刷テスト (全32項目)', cmd: 'node tests/reports/verify_shipping_label.js' },
        { name: '4. 書類返却通知書テスト', cmd: 'node tests/test_document_return_unit.js' },
        { name: '5. 見積書PDFテスト (全10項目)', cmd: 'node tests/reports/verify_estimate_pdf.js' },
        { name: '6. 顧客カルテ履歴・帳票運用改善テスト (フェーズ1〜3 & 5)', cmd: 'node tests/test_phase1_to_3_improvements.js' }
    ];

    let allPassed = true;
    for (const step of steps) {
        const ok = runStep(step.name, step.cmd);
        if (!ok) {
            allPassed = false;
            break;
        }
    }

    if (allPassed) {
        const untrackedOk = checkUntrackedFiles();
        if (!untrackedOk) {
            allPassed = false;
        }
    }

    if (allPassed) {
        console.log('\n====================================================');
        console.log('🎉 すべての事前検証をクリアしました！安全にコミット可能です。');
        console.log('====================================================\n');
        process.exit(0);
    } else {
        console.error('\n====================================================');
        console.error('❌ RELEASE BLOCKED: 検証に失敗した項目があります。');
        console.error('====================================================\n');
        process.exit(1);
    }
}

main();
