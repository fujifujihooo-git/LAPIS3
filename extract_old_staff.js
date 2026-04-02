/**
 * 旧プロジェクト(lapis2-2026)からスタッフリストを取得し、
 * setup_users.json を自動生成するスクリプト
 * 
 * 使い方:
 *   node extract_old_staff.js
 * 
 * 注意: REST API経由で旧プロジェクトのFirestoreにアクセスします
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 旧プロジェクトの設定（公開済みのAPI Key使用）
const OLD_PROJECT_ID = 'lapis2-2026';
const OLD_API_KEY = 'AIzaSyDTiy6SkKl74myPT9A4BYSs45BgbjynerQ';

async function fetchFirestoreCollection(projectId, apiKey, collectionId) {
    return new Promise((resolve, reject) => {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}?key=${apiKey}`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function extractFieldValue(field) {
    if (!field) return null;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.integerValue !== undefined) return parseInt(field.integerValue);
    if (field.doubleValue !== undefined) return field.doubleValue;
    if (field.booleanValue !== undefined) return field.booleanValue;
    return null;
}

async function main() {
    console.log('🔍 旧プロジェクト(lapis2-2026)からスタッフデータを取得中...\n');

    try {
        const result = await fetchFirestoreCollection(OLD_PROJECT_ID, OLD_API_KEY, 'staff');

        if (!result.documents || result.documents.length === 0) {
            console.error('スタッフデータが見つかりませんでした。');
            console.error('旧プロジェクトの Firestore セキュリティルールで認証が必要な可能性があります。');
            console.error('\n代替方法: setup_users.json を手動で編集してください。');
            process.exit(1);
        }

        console.log(`✅ ${result.documents.length} 件のスタッフデータを取得\n`);

        const users = result.documents.map(doc => {
            const fields = doc.fields || {};
            return {
                email: extractFieldValue(fields.email) || '',
                password: 'Lapis3_2026!',  // デフォルト初期パスワード
                staff_name: extractFieldValue(fields.staff_name) || '',
                authority: extractFieldValue(fields.authority) || 'staff',
                role: extractFieldValue(fields.role) || '担当者',
                status: extractFieldValue(fields.status) || '在籍'
            };
        }).filter(u => u.email);  // メールがないものは除外

        // staff_id順にソート
        users.sort((a, b) => {
            const nameA = a.staff_name || '';
            const nameB = b.staff_name || '';
            return nameA.localeCompare(nameB, 'ja');
        });

        console.log('取得したスタッフ一覧:');
        console.log('─'.repeat(60));
        users.forEach((u, i) => {
            console.log(`  ${i + 1}. ${u.staff_name.padEnd(15)} <${u.email}> [${u.authority}]`);
        });
        console.log('─'.repeat(60));

        // setup_users.json に書き出し
        const outputPath = path.join(__dirname, 'setup_users.json');
        fs.writeFileSync(outputPath, JSON.stringify(users, null, 2), 'utf8');
        console.log(`\n📄 ${outputPath} に保存しました`);
        console.log(`   ${users.length} 名分のデータ`);
        console.log(`\n⚠️  初期パスワードは全員 "Lapis3_2026!" に設定されています。`);
        console.log(`   必要に応じて setup_users.json を編集してからスクリプトを実行してください。`);

    } catch (err) {
        console.error('エラー:', err.message);
        
        if (err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) {
            console.error('\n旧プロジェクトの認証により直接アクセスできません。');
            console.error('setup_users.json を手動で編集してください。');
        }
        process.exit(1);
    }
}

main();
