// tests/verify_dashboard_columns.js
// 案件管理ダッシュボードの7列化および管轄官公庁表示の網羅的自動検証テスト

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('  LAPIS3 案件管理ダッシュボード「管轄官公庁」7列化 網羅的検証テスト');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(testName, testFn) {
    try {
        testFn();
        console.log(`✅ PASS: ${testName}`);
        passCount++;
    } catch (err) {
        console.error(`❌ FAIL: ${testName}`);
        console.error(`   Error: ${err.message}\n`);
        failCount++;
    }
}

// -------------------------------------------------------------
// 1. 静的HTML構造検証 (index.html)
// -------------------------------------------------------------
console.log('--- 1. 静的HTMLヘッダー構造検証 (index.html) ---');

const indexHtmlPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

runTest('index.html に table#case-table が存在する', () => {
    assert.ok(indexHtml.includes('id="case-table"'), 'case-table が存在すること');
});

runTest('index.html のテーブルヘッダーが正確に7列あり、順序が正しい', () => {
    // thead内のthを抽出
    const theadMatch = indexHtml.match(/<table[^>]*id="case-table"[^>]*>[\s\S]*?<thead>([\s\S]*?)<\/thead>/i);
    assert.ok(theadMatch, 'thead が見つかること');

    const thMatches = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
    assert.strictEqual(thMatches.length, 7, `ヘッダー列数が7列であること (実測: ${thMatches.length}列)`);

    // クリーンなテキスト抽出
    const headers = thMatches.map(m => m[1].replace(/<[^>]+>/g, '').trim().split(/\s+/)[0]);
    console.log('   抽出されたヘッダー順:', headers.join(' | '));

    const expectedHeaders = ['ステータス', '受任日', '顧客名', '管轄官公庁', '業務内容', '残り日数', '担当者'];
    assert.deepStrictEqual(headers, expectedHeaders, 'ヘッダー項目の順序が一致していること');
});

runTest('index.html の app.js にキャッシュバスター（?v=...）が付与されている', () => {
    assert.ok(/<script\s+src="app\.js\?v=[^"]+"><\/script>/.test(indexHtml), 'app.js にバージョンクエリが付いていること');
});

// -------------------------------------------------------------
// 2. app.js 静的解析 (colspanの整合性チェック)
// -------------------------------------------------------------
console.log('\n--- 2. app.js 静的解析 (colspan整合性) ---');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');

runTest('app.js に colspan="6" が残っていないこと', () => {
    const matchCol6 = appJs.match(/colspan=["']6["']/g);
    assert.strictEqual(matchCol6, null, 'colspan="6" は存在しないこと');
});

runTest('app.js のテーブル全幅メッセージがすべて colspan="7" になっていること', () => {
    const matchCol7 = appJs.match(/colspan=["']7["']/g);
    assert.ok(matchCol7 && matchCol7.length >= 5, `colspan="7" が5箇所以上存在すること (実測: ${matchCol7 ? matchCol7.length : 0}箇所)`);
});

// -------------------------------------------------------------
// 3. 名称解決ロジック（getGovernmentOfficeName）の単体テスト
// -------------------------------------------------------------
console.log('\n--- 3. 管轄官公庁名称解決（getGovernmentOfficeName）の単体テスト ---');

// app.js と customer_detail.js で使われているロジックをシミュレート
const mockGovernmentOffices = [
    { office_id: 1, office_name: '東京都知事', status: '有効' },
    { office_id: 2, office_name: '神奈川県知事', status: '有効' },
    { office_id: 3, office_name: '関東地方整備局', status: '有効' },
    { office_id: 'off_4', office_name: '千葉県知事', status: '有効' }
];

function getGovernmentOfficeName(entity, govs = mockGovernmentOffices) {
    if (!entity) return '';
    if (entity.government_office_id) {
        const office = govs.find(
            o => Number(o.office_id) === Number(entity.government_office_id) || o.id === entity.government_office_id
        );
        if (office) {
            return office.office_name;
        }
    }
    return entity.government_office || '';
}

runTest('ケースA: government_office_id (数値) からマスタの office_name を正しく解決できる', () => {
    const caseData = { government_office_id: 1, government_office: '' };
    const res = getGovernmentOfficeName(caseData);
    assert.strictEqual(res, '東京都知事');
});

runTest('ケースB: government_office_id (文字列) からマスタの office_name を正しく解決できる', () => {
    const caseData = { government_office_id: '2', government_office: '' };
    const res = getGovernmentOfficeName(caseData);
    assert.strictEqual(res, '神奈川県知事');
});

runTest('ケースC: government_office_id がなく、文字列 government_office のみ存在する場合', () => {
    const caseData = { government_office_id: null, government_office: '埼玉県知事' };
    const res = getGovernmentOfficeName(caseData);
    assert.strictEqual(res, '埼玉県知事');
});

runTest('ケースD: IDも文字列も未設定（null/undefined/空文字）の場合、空文字を返し、|| "-" で "-" になる', () => {
    const caseData1 = { government_office_id: null, government_office: null };
    const caseData2 = {};
    assert.strictEqual(getGovernmentOfficeName(caseData1) || '-', '-');
    assert.strictEqual(getGovernmentOfficeName(caseData2) || '-', '-');
});

runTest('ケースE: マスタ未ロード（配列が空）時でも文字列フィールドがあればフォールバックされる', () => {
    const caseData = { government_office_id: 1, government_office: '東京都（直接保存値）' };
    const res = getGovernmentOfficeName(caseData, []);
    assert.strictEqual(res, '東京都（直接保存値）');
});

// -------------------------------------------------------------
// 4. 行レンダリングHTML生成の全列整合性テスト（7列完全一致）
// -------------------------------------------------------------
console.log('\n--- 4. 行レンダリングHTML生成の全列整合性テスト ---');

const mockStaff = [
    { staff_id: 101, staff_name: '田中 次郎' },
    { staff_id: 102, staff_name: '藤田 宏明' }
];

function mockFormatDate(d) { return d ? String(d).replace(/-/g, '/') : '-'; }
function mockGetStatusKey(s) { return s || 'sodan'; }
function mockCalculateRemainingDays() { return 10; }
function mockGetRemainingDaysClass() { return 'days-normal'; }
function mockFormatRemainingDays(days) { return `${days}日後`; }

// app.js の renderTable の行HTML生成ロジックを忠実に再現
function generateRowHtml(c) {
    const days = mockCalculateRemainingDays(c.application_scheduled_date);
    const daysClass = mockGetRemainingDaysClass(days, c.status);
    const fieldStaff = mockStaff.find(s => s.staff_id === Number(c.field_staff_id))?.staff_name || '-';
    const docStaff = mockStaff.find(s => s.staff_id === Number(c.document_staff_id))?.staff_name || '-';

    return `
        <td><span class="badge status-${mockGetStatusKey(c.status)}">${c.status || '-'}</span></td>
        <td>${mockFormatDate(c.contract_date)}</td>
        <td class="customer-cell">
            <a href="customer_detail.html?id=${c.customer_id}">${c.customer_name || '-'}</a>
        </td>
        <td>${getGovernmentOfficeName(c) || '-'}</td>
        <td>
            <div style="font-weight: 600;">${c.license_type || '-'}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${c.procedure_name || '-'}</div>
        </td>
        <td>
            <span class="days-badge ${daysClass}">${mockFormatRemainingDays(days, c.status)}</span>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${mockFormatDate(c.application_scheduled_date)}</div>
        </td>
        <td>
            <div>${fieldStaff}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid rgba(0,0,0,0.05);">${docStaff}</div>
        </td>
    `;
}

function parseCells(rowHtml) {
    // <td>...</td> をパース
    const cells = [];
    const regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    while ((match = regex.exec(rowHtml)) !== null) {
        cells.push(match[1].trim());
    }
    return cells;
}

// テストデータケース集
const testCases = [
    {
        name: 'ケース1: 官公庁マスタ紐付けあり案件（東京都知事）',
        data: {
            case_id: 1,
            customer_id: 10,
            customer_name: '株式会社テスト建設',
            government_office_id: 1,
            government_office: '',
            license_type: '建設業許可',
            procedure_name: '新規申請',
            status: '受任',
            contract_date: '2026-08-01',
            application_scheduled_date: '2026-09-01',
            field_staff_id: 101,
            document_staff_id: 102
        },
        expectedGov: '東京都知事',
        expectedLicense: '建設業許可'
    },
    {
        name: 'ケース2: 官公庁直接文字列入力案件（神奈川県知事）',
        data: {
            case_id: 2,
            customer_id: 20,
            customer_name: '佐藤土木有限会社',
            government_office_id: null,
            government_office: '神奈川県知事',
            license_type: '宅地建物取引業',
            procedure_name: '免許更新',
            status: '作成中',
            contract_date: '2026-08-10',
            application_scheduled_date: '2026-09-15',
            field_staff_id: 102,
            document_staff_id: 102
        },
        expectedGov: '神奈川県知事',
        expectedLicense: '宅地建物取引業'
    },
    {
        name: 'ケース3: 官公庁未設定案件（未入力）',
        data: {
            case_id: 3,
            customer_id: 30,
            customer_name: 'カツデン株式会社',
            government_office_id: null,
            government_office: null,
            license_type: '産業廃棄物収集運搬',
            procedure_name: '新規許可',
            status: '相談',
            contract_date: null,
            application_scheduled_date: null,
            field_staff_id: null,
            document_staff_id: null
        },
        expectedGov: '-',
        expectedLicense: '産業廃棄物収集運搬'
    }
];

testCases.forEach(tc => {
    runTest(`行レンダリング検証 [${tc.name}]`, () => {
        const html = generateRowHtml(tc.data);
        const cells = parseCells(html);

        // 1. セル数が正確に7個
        assert.strictEqual(cells.length, 7, `生成されるtd数が7であること (実測: ${cells.length})`);

        // 2. 各列の内容を検証
        // 列1: ステータス
        assert.ok(cells[0].includes(tc.data.status), `列1(ステータス)に「${tc.data.status}」が含まれること`);

        // 列2: 受任日
        const expDate = tc.data.contract_date ? tc.data.contract_date.replace(/-/g, '/') : '-';
        assert.ok(cells[1].includes(expDate), `列2(受任日)に「${expDate}」が含まれること`);

        // 列3: 顧客名
        assert.ok(cells[2].includes(tc.data.customer_name), `列3(顧客名)に「${tc.data.customer_name}」が含まれること`);

        // 列4: 管轄官公庁 ★最重要
        assert.strictEqual(cells[3], tc.expectedGov, `列4(管轄官公庁)が期待値「${tc.expectedGov}」と完全一致すること`);

        // 列5: 業務内容 ★最重要
        assert.ok(cells[4].includes(tc.expectedLicense), `列5(業務内容)に許認可名「${tc.expectedLicense}」が含まれること (列4と混同していないこと)`);

        // 列6: 残り日数
        assert.ok(cells[5].includes('日後'), `列6(残り日数)に期限バッジが含まれること`);

        // 列7: 担当者
        const expStaff = tc.data.field_staff_id === 101 ? '田中 次郎' : (tc.data.field_staff_id === 102 ? '藤田 宏明' : '-');
        assert.ok(cells[6].includes(expStaff), `列7(担当者)に「${expStaff}」が含まれること`);
    });
});

console.log('\n===============================================================');
console.log(`  検証結果: ${passCount} 件 成功 / ${failCount} 件 失敗`);
console.log('===============================================================\n');

if (failCount > 0) {
    process.exit(1);
}
