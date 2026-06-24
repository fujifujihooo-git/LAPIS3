const fs = require('fs');
const path = require('path');

// 日付コントロールに関わる要素IDのリスト（厳密チェック用）
const DATE_ELEMENT_IDS = [
    'founded_date', 'history-input-date', 'history-input-next-action', 
    'report_period_start', 'report_period_end', 'batch-receipt-date', 
    'inline-receipt-date', 'filter-date-start', 'filter-date-end', 
    'snapshot-closing-date', 'modal-receipt-date', 'filter-expiry-start', 
    'filter-expiry-end', 'filter-notice-start', 'filter-notice-end', 
    'start-date', 'expiry-date', 'notice-date', 'invoice_date', 
    'due_date', 'contract_date', 'application_scheduled_date', 
    'acceptance_date', 'completion_date', 'return_date', 'hire_date'
];

// 無視するディレクトリ・ファイル
const IGNORE_DIRS = ['node_modules', '.git', '_agent_test', 'tests', 'emulator_data'];
const IGNORE_FILES = ['audit_date_inputs.js', 'unified_datepicker.js', 'unified_monthpicker.js', 'update_period.js'];

let hasErrors = false;

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) {
                scanDir(fullPath);
            }
        } else if (stat.isFile() && file.endsWith('.js')) {
            if (!IGNORE_FILES.includes(file)) {
                checkFile(fullPath);
            }
        }
    }
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
        const lineNum = index + 1;

        // パターン1: getElementById で既知の日付IDを指定して .value = 代入しているか
        for (const id of DATE_ELEMENT_IDS) {
            // 例: document.getElementById('founded_date').value = ...
            const getElementRegex = new RegExp(`document\\.getElementById\\(['"]${id}['"]\\)\\.value\\s*=`, 'i');
            if (getElementRegex.test(line)) {
                console.error(`[ERROR] ${filePath}:${lineNum} - Direct .value assignment to date element #${id} is forbidden.`);
                console.error(`        Code: ${line.trim()}`);
                hasErrors = true;
            }
        }

        // パターン2: 変数名/プロパティ名に date, expiry, notice, period, hire, ds, de などを伴う要素への直接代入
        // 例: dateInput.value = ..., expiryDate.value = ..., periodStart.value = ...
        // 代入であり、比較(==, ===)や演算(+=, -=)ではないこと
        const variableAssignRegex = /\b\w*(?:date|expiry|notice|hire|period)\w*\.value\s*=\s*(?!=)([^;]+)/i;
        const shortVarAssignRegex = /\b(ds|de)\.value\s*=\s*(?!=)([^;]+)/i;
        if (variableAssignRegex.test(line) || shortVarAssignRegex.test(line)) {
            // 除外ロジック: textInput.value などの一般的なテキスト要素や、共通APIでの代入を除く
            // また、setDateControlValue などのAPI自体が定義されている行も除く
            // セレクトボックスである filterDateType は除外する
            if (!line.includes('setDateControlValue') && !line.includes('setDateValueById') && !line.includes('==') && !line.includes('===') && !line.includes('filterDateType')) {
                console.error(`[ERROR] ${filePath}:${lineNum} - Direct value assignment to variable/property matching date keyword.`);
                console.error(`        Code: ${line.trim()}`);
                hasErrors = true;
            }
        }
    });
}

console.log('--- Starting Date Input Direct Value Assignment Audit ---');
scanDir(process.cwd());
console.log('---------------------------------------------------------');

if (hasErrors) {
    console.error('Audit FAILED. Please use window.setDateControlValue() or window.setDateValueById() instead of direct .value assignment.');
    process.exit(1);
} else {
    console.log('Audit PASSED. No forbidden direct date value assignments found.');
    process.exit(0);
}
