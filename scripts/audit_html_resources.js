/**
 * scripts/audit_html_resources.js
 * 
 * 全HTMLファイル内のローカル参照リソース（<script src>, <link href>）の実在性を監査するスクリプト
 * 
 * 目的:
 *   新規作成したJS/CSSファイルの git add 漏れやパス間違いによる 404 エラーを
 *   コミット前・テスト段階で 100% 自動検知する。
 * 
 * 実行方法:
 *   node scripts/audit_html_resources.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// 監査対象から除外するディレクトリ
const IGNORE_DIRS = new Set([
    'node_modules',
    '.git',
    '.firebase',
    'emulator_data',
    'brain',
    '.gemini',
    'dist',
    'build',
    'reports' // レポート出力ディレクトリ（HTMLテンプレート以外の一時出力）
]);

/**
 * ディレクトリを再帰的に走査して .html ファイルを収集
 */
function findHtmlFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);

    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat && stat.isDirectory()) {
            if (!IGNORE_DIRS.has(file)) {
                results = results.concat(findHtmlFiles(fullPath));
            }
        } else if (file.endsWith('.html')) {
            results.push(fullPath);
        }
    });

    return results;
}

/**
 * HTMLからローカル参照の script / link タグを抽出
 */
function extractLocalResources(htmlContent, htmlFilePath) {
    const resources = [];
    const htmlDir = path.dirname(htmlFilePath);

    // 1. <script ... src="...">
    const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const src = match[1].trim();
        // 外部URL(http, https, //)やData URIはスキップ
        if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//') && !src.startsWith('data:')) {
            resources.push({
                type: 'script',
                raw: src,
                cleanPath: src.split('?')[0].split('#')[0],
                htmlDir: htmlDir
            });
        }
    }

    // 2. <link ... href="..."> (stylesheet, iconなど)
    const linkRegex = /<link\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
        const href = match[1].trim();
        if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//') && !href.startsWith('data:')) {
            resources.push({
                type: 'link',
                raw: href,
                cleanPath: href.split('?')[0].split('#')[0],
                htmlDir: htmlDir
            });
        }
    }

    return resources;
}

function runAudit() {
    console.log('====================================================');
    console.log('🔍 LAPIS3 HTML Static Resource Audit (静的リンク監査)');
    console.log('====================================================\n');

    const htmlFiles = findHtmlFiles(ROOT_DIR);
    console.log(`対象HTMLファイル数: ${htmlFiles.length}件\n`);

    let totalChecked = 0;
    let missingErrors = [];

    htmlFiles.forEach(htmlFile => {
        const relativeHtml = path.relative(ROOT_DIR, htmlFile);
        const content = fs.readFileSync(htmlFile, 'utf8');
        const resources = extractLocalResources(content, htmlFile);

        resources.forEach(res => {
            totalChecked++;
            // パス解決 (相対パスまたはルート相対パス)
            let targetPath;
            if (res.cleanPath.startsWith('/')) {
                targetPath = path.join(ROOT_DIR, res.cleanPath.substring(1));
            } else {
                targetPath = path.resolve(res.htmlDir, res.cleanPath);
            }

            if (!fs.existsSync(targetPath)) {
                missingErrors.push({
                    htmlFile: relativeHtml,
                    type: res.type,
                    raw: res.raw,
                    resolvedPath: path.relative(ROOT_DIR, targetPath)
                });
            }
        });
    });

    console.log(`チェックしたリソース参照数: ${totalChecked}件`);

    if (missingErrors.length > 0) {
        console.error(`\n❌ 【欠落検知】${missingErrors.length}件のリソースファイルが見つかりません:\n`);
        missingErrors.forEach((err, idx) => {
            console.error(`  [${idx + 1}] ${err.htmlFile}`);
            console.error(`      タグ種別: <${err.type}>`);
            console.error(`      記述内容: "${err.raw}"`);
            console.error(`      探索先  : ${err.resolvedPath}\n`);
        });
        console.error('⚠️  ファイルの git add 漏れ、リネーム漏れ、またはパスのタイプミスの可能性があります。');
        process.exit(1);
    } else {
        console.log('\n✅ すべてのローカルスクリプトおよびスタイルシートの実在が確認されました。（欠落 0件）');
        process.exit(0);
    }
}

runAudit();
