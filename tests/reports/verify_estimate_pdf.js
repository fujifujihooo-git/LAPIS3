const fs = require('fs');
const vm = require('vm');

// Read the estimate_pdf.js file
const code = fs.readFileSync('d:/Antigravity/LAPIS3/estimate_pdf.js', 'utf-8');

// Mock objects to track jspdf calls
let docMock = null;
let savedFilename = null;

class MockJsPDF {
    constructor() {
        this.texts = [];
        this.autoTables = [];
        this.lastAutoTable = { finalY: 100 };
        this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    }
    setFontSize() {}
    setLineWidth() {}
    line() {}
    text(text, x, y, options) {
        if (text === undefined || text === null) {
            throw new Error("Invalid arguments passed to jsPDF.text: text is undefined or null");
        }
        if (typeof text !== 'string' && typeof text !== 'number' && !Array.isArray(text)) {
            throw new Error(`Invalid arguments passed to jsPDF.text: expected string, number or array, got ${typeof text}`);
        }
        if (x === undefined || y === undefined || isNaN(x) || isNaN(y)) {
            throw new Error(`Invalid coordinates passed to jsPDF.text: x=${x}, y=${y}`);
        }
        this.texts.push({ text, x, y, options });
    }
    getImageProperties(img) {
        return { width: 300, height: 100 };
    }
    addImage() {}
    autoTable(options) {
        this.autoTables.push(options);
        this.lastAutoTable.finalY += 50;
    }
    addPage() {}
    save(filename) {
        savedFilename = filename;
    }
    output(type) {
        return { size: 1024, type: 'application/pdf' };
    }
}

// Setup VM context
const sandbox = {
    window: {
        ReportEngine: {
            initPDF: async () => {
                docMock = new MockJsPDF();
                return docMock;
            }
        },
        open: (url, target) => ({ focus: () => {} })
    },
    URL: {
        createObjectURL: (blob) => 'blob:http://localhost/dummy-pdf-url',
        revokeObjectURL: (url) => {}
    },
    setTimeout: (fn) => {},
    console: console,
    Math: Math,
    Date: Date,
    Number: Number,
    String: String,
    lucide: { createIcons: () => {} },
    alert: (msg) => console.log('ALERT:', msg)
};
sandbox.ReportEngine = sandbox.window.ReportEngine;

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const generateEstimatePdf = sandbox.generateEstimatePdf;

async function runTest(testId, name, data, verifyFn) {
    docMock = null;
    savedFilename = null;
    let result = 'PASS';
    let msg = '';
    
    try {
        await generateEstimatePdf(data, null);
        msg = verifyFn(docMock, savedFilename);
    } catch (e) {
        result = 'FAIL';
        msg = e.message;
    }
    
    console.log(`${testId}: ${result} - ${name} ${msg ? '=> ' + msg : ''}`);
}

async function runAll() {
    console.log("=== UT-EST 実行開始 ===");

    // UT-EST-001: 正常系テスト
    await runTest('UT-EST-001', '正常系テスト', {
        caseNumber: '2026-00123',
        customerName: 'テスト顧客',
        customerTitle: '御中',
        estimateItems: [
            { type: '報酬', description: '手続き代行', quantity: 1, unit_price: 50000, amount: 50000, is_taxable: true }
        ]
    }, (doc) => {
        return '';
    });

    // UT-EST-002: 金額計算ロジック（税計算）
    await runTest('UT-EST-002', '金額計算ロジック（税計算）', {
        caseNumber: '2026-00124',
        customerName: 'テスト顧客2',
        estimateItems: [
            { type: '報酬', description: '課税', quantity: 1, unit_price: 10000, amount: 10000, is_taxable: true },
            { type: '実費', description: '非課税', quantity: 1, unit_price: 20000, amount: 20000, is_taxable: false }
        ]
    }, (doc) => {
        // Find total summary table
        const summaryTable = doc.autoTables[1];
        if (!summaryTable) throw new Error("Summary table missing");
        
        // Find tax amount in the table
        const taxRow = summaryTable.body.find(row => row[0].includes('消費税'));
        const taxVal = taxRow[1];
        if (taxVal !== '¥1,000-') throw new Error(`消費税計算エラー: 期待値 ¥1,000-, 実際 ${taxVal}`);
        return '税計算正常確認';
    });

    // UT-EST-003: 20件出力確認
    const items20 = [];
    for(let i=1; i<=20; i++) {
        items20.push({ type: '報酬', description: `明細${i}`, quantity: 1, unit_price: 1000, amount: 1000, is_taxable: true });
    }
    await runTest('UT-EST-003', '20件出力確認', {
        caseNumber: '2026-00125',
        customerName: 'テスト顧客3',
        estimateItems: items20
    }, (doc) => {
        if(doc.autoTables[0].body.length !== 20) throw new Error("20件出力されていない");
        return '20件出力確認';
    });

    // UT-EST-004: 長い顧客名確認
    await runTest('UT-EST-004', '長い顧客名確認', {
        caseNumber: '2026-00126',
        customerName: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ',
        customerTitle: '様',
        estimateItems: [
            { type: '報酬', description: 'テスト', quantity: 1, unit_price: 1000, amount: 1000, is_taxable: true }
        ]
    }, (doc) => {
        return '長い顧客名確認';
    });

    // UT-EST-005: 課税/非課税混在確認
    await runTest('UT-EST-005', '課税/非課税混在確認', {
        caseNumber: '2026-00127',
        customerName: 'テスト顧客5',
        estimateItems: [
            { type: '報酬', description: '課税1', quantity: 1, unit_price: 15000, amount: 15000, is_taxable: true },
            { type: '実費', description: '非課税1', quantity: 1, unit_price: 3300, amount: 3300, is_taxable: false },
            { type: '報酬', description: '課税2', quantity: 1, unit_price: 2000, amount: 2000, is_taxable: true },
        ]
    }, (doc) => {
        const summaryTable = doc.autoTables[1];
        const taxRow = summaryTable.body.find(row => row[0].includes('消費税'));
        const subTaxable = summaryTable.body.find(row => row[0].includes('課税対象'));
        const subNonTaxable = summaryTable.body.find(row => row[0].includes('非課税'));
        if (taxRow[1] !== '¥1,700-') throw new Error(`消費税エラー: ${taxRow[1]}`);
        if (subTaxable[1] !== '¥17,000-') throw new Error(`課税小計エラー: ${subTaxable[1]}`);
        if (subNonTaxable[1] !== '¥3,300-') throw new Error(`非課税小計エラー: ${subNonTaxable[1]}`);
        return '課税/非課税混在確認';
    });

    // UT-EST-006: 100件確認
    const items100 = [];
    for(let i=1; i<=100; i++) {
        items100.push({ type: '報酬', description: `明細${i}`, quantity: 1, unit_price: 100, amount: 100, is_taxable: true });
    }
    await runTest('UT-EST-006', '100件確認', {
        caseNumber: '2026-00128',
        customerName: 'テスト顧客6',
        estimateItems: items100
    }, (doc) => {
        if(doc.autoTables[0].body.length !== 100) throw new Error("100件出力されていない");
        return '100件確認';
    });

    // UT-EST-007: ファイル名確認（ポップアップブロック時のフォールバック保存ファイル名）
    const origOpen = sandbox.window.open;
    sandbox.window.open = () => null; // ポップアップブロックを模倣
    await runTest('UT-EST-007', 'ファイル名確認（案件番号未設定、サニタイズ、フォールバック保存）', {
        caseNumber: null, // 未設定
        customerName: '顧客/株式会社?テスト*',
        estimateItems: [
            { type: '報酬', description: 'テスト', quantity: 1, unit_price: 1000, amount: 1000, is_taxable: true }
        ]
    }, (doc, filename) => {
        if (filename !== '見積書_顧客_株式会社_テスト__EST-NEW.pdf') {
            throw new Error(`ファイル名サニタイズエラー: ${filename}`);
        }
        return `フォールバック保存ファイル名確認 (${filename})`;
    });
    sandbox.window.open = origOpen; // 戻す

    // Extra Case: Check estimate number formatting directly
    await runTest('UT-EST-008', '見積番号フォーマット確認', {
        caseNumber: '2026-00123',
        customerName: 'テスト',
        estimateItems: [
            { type: '報酬', description: 'テスト', quantity: 1, unit_price: 1000, amount: 1000, is_taxable: true }
        ]
    }, (doc, filename) => {
        const estNumRow = doc.texts.find(t => t.text.includes('見積番号'));
        if (!estNumRow || !estNumRow.text.includes('EST-2026-00123')) throw new Error(`見積番号エラー: ${estNumRow.text}`);
        return `見積番号確認 (${estNumRow.text})`;
    });

    // UT-EST-009: 顧客名欠損時のFail-Fast確認 (例外がスローされて生成停止すること)
    let ut009Passed = false;
    try {
        await generateEstimatePdf({
            caseNumber: 'CASE-001',
            customerName: '', // 顧客名未指定
            estimateItems: [
                { type: '報酬', description: 'テスト', quantity: 1, unit_price: 1000, amount: 1000, is_taxable: true }
            ]
        }, null);
    } catch (e) {
        if (e.message.includes('宛名（顧客名）が設定されていません')) {
            ut009Passed = true;
        }
    }
    console.log(`UT-EST-009: ${ut009Passed ? 'PASS' : 'FAIL'} - 顧客名欠損時Fail-Fast確認 (例外スローと生成停止)`);

    // UT-EST-010: 明細0件時のFail-Fast確認 (例外がスローされて生成停止すること)
    let ut010Passed = false;
    try {
        await generateEstimatePdf({
            caseNumber: 'CASE-001',
            customerName: 'テスト顧客',
            estimateItems: [] // 明細0件
        }, null);
    } catch (e) {
        if (e.message.includes('見積明細が登録されていません')) {
            ut010Passed = true;
        }
    }
    console.log(`UT-EST-010: ${ut010Passed ? 'PASS' : 'FAIL'} - 明細0件時Fail-Fast確認 (例外スローと生成停止)`);
}

runAll().catch(console.error);
