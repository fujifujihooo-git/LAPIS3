const fs = require('fs');
const path = require('path');

console.log('--- Testing DocumentReturnReport Generation ---');

class MockJsPDF {
    constructor() {
        this.texts = [];
        this.rects = [];
        this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    }
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    setLineWidth() {}
    line(x1, y1, x2, y2) {
        this.rects.push({ x1, y1, x2, y2, type: 'line' });
    }
    rect(x, y, w, h, style) {
        this.rects.push({ x, y, w, h, style });
    }
    splitTextToSize(text, maxW) {
        if (!text) return [];
        return text.split('\n');
    }
    text(text, x, y, options) {
        if (text === undefined || text === null) {
            throw new Error("Invalid arguments passed to jsPDF.text: text is undefined or null");
        }
        this.texts.push({ text, x, y, options });
    }
    output(type) {
        return new Uint8Array(1024);
    }
}

global.window = global;
global.document = {
    createElement: () => ({ appendChild: () => {} }),
    body: { appendChild: () => {} }
};

class MockBaseReport {
    constructor(title) {
        this.title = title;
        this.marginL = 15;
        this.marginR = 15;
        this.marginT = 15;
        this.marginB = 15;
        this.pageWidth = 210;
        this.pageHeight = 297;
    }
    async init(options = {}) {
        this.doc = new MockJsPDF();
    }
    drawFooter() {}
}
window.BaseReport = MockBaseReport;

// Load report-utils.js
const utilsCode = fs.readFileSync(path.resolve(__dirname, '../reports/report-utils.js'), 'utf8');
eval(utilsCode);

// Load document-return-report.js
const code = fs.readFileSync(path.resolve(__dirname, '../reports/document-return-report.js'), 'utf8');
eval(code);

async function testDocReturn() {
    const report = new window.DocumentReturnReport();
    
    const customer = {
        customer_name: '株式会社 テスト建設',
        postal_code: '100-0001',
        address: '東京都千代田区千代田1-1'
    };
    
    const record = {
        recipientType: 'customer',
        deliveryMethod: 'letterpack_plus',
        shippingDate: '2026-08-20',
        arrivalDate: '2026-08-21',
        trackingNumber: '1234-5678-9012',
        returnedItems: ['permit_notice', 'copy', 'invoice', 'other'],
        returnedItemsOther: '申請書控え一式',
        remarks: 'ご確認の上、保管をお願いいたします。'
    };

    const officeInfo = {
        name: '行政書士 中村事務所',
        postalCode: '160-0023',
        address: '東京都新宿区西新宿1-1-1',
        tel: '03-1234-5678',
        fax: '03-1234-5679'
    };

    await report.generate(customer, record, officeInfo);
    console.log('✅ DocumentReturnReport generate executed without exception.');
    console.log(`✅ Tracked text calls: ${report.doc.texts.length}, rect calls: ${report.doc.rects.length}`);
    console.assert(report.doc.texts.length > 5, 'Should have printed texts');
}

testDocReturn().then(() => {
    console.log('🎉 DocumentReturnReport test completed successfully.');
}).catch(err => {
    console.error('❌ DocumentReturnReport test failed:', err);
    process.exit(1);
});
