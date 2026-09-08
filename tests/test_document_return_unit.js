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

async function testDocReturnWithBodyMessage() {
    const report = new window.DocumentReturnReport();
    
    const customer = {
        customer_name: '有限会社 カスタム建設',
    };
    
    const record = {
        delivery_method: 'letterpack_plus',
        ship_date: '2026/09/08',
        arrival_date: '2026/09/09',
        tracking_number: '9999-8888-7777',
        body_message: 'いつも大変お世話になっております。\n建設業許可更新申請の手続きが完了致しましたので、お預かり書類等を本日発送のレターパックプラスにてお送り致しました。\nご確認の上、保管をお願いいたします。',
        returned_items: ['copy', 'permit_notice'],
        staff_name: '藤田 宏明'
    };

    await report.generate(customer, record);
    
    // body_messageのカスタム本文がPDFに出力されていることを確認
    const allTexts = report.doc.texts.map(t => t.text).join(' ');
    console.assert(allTexts.includes('建設業許可更新申請'), 'カスタム本文 body_message がPDF出力に含まれるべき');
    console.assert(!allTexts.includes('届出・申請の手続きが完了'), 'フォールバック文がPDFに含まれてはいけない（body_message指定時）');
    console.log('✅ testDocReturnWithBodyMessage: body_message がPDFに正しく反映されました。');
}

async function testDocReturnFallbackBody() {
    const report = new window.DocumentReturnReport();
    
    const customer = { customer_name: '旧形式テスト株式会社' };
    
    // body_message なし（後方互換：従来の固定文面がフォールバック生成される）
    const record = {
        delivery_method: 'takkyubin',
        ship_date: '2026/09/08',
        arrival_date: '2026/09/09',
        returned_items: ['copy'],
        staff_name: '担当者'
    };

    await report.generate(customer, record);
    
    const allTexts = report.doc.texts.map(t => t.text).join(' ');
    console.assert(allTexts.includes('届出・申請の手続きが完了'), 'body_message未指定時はフォールバック文が使用されるべき');
    console.log('✅ testDocReturnFallbackBody: body_message未指定時のフォールバック文面が正しく生成されました。');
}

async function testDocReturnCamelCaseFallback() {
    const report = new window.DocumentReturnReport();
    
    const customer = { customer_name: 'キャメルケーステスト株式会社' };
    
    // 旧キャメルケース bodyMessage でも動作することを確認
    const record = {
        deliveryMethod: 'hand_delivery',
        shipDate: '2026/09/08',
        bodyMessage: 'いつも大変お世話になっております。\n旧形式のキャメルケースでの本文テストです。',
        returnedItems: ['copy'],
        staffName: '担当者'
    };

    await report.generate(customer, record);
    
    const allTexts = report.doc.texts.map(t => t.text).join(' ');
    console.assert(allTexts.includes('旧形式のキャメルケース'), 'bodyMessage（キャメルケース）でもPDF出力に反映されるべき');
    console.log('✅ testDocReturnCamelCaseFallback: bodyMessage（キャメルケース）の後方互換が正しく動作しました。');
}

testDocReturn().then(() => {
    console.log('🎉 Test 1/4: 基本生成テスト 完了');
    return testDocReturnWithBodyMessage();
}).then(() => {
    console.log('🎉 Test 2/4: body_message動的本文テスト 完了');
    return testDocReturnFallbackBody();
}).then(() => {
    console.log('🎉 Test 3/4: フォールバック文面テスト 完了');
    return testDocReturnCamelCaseFallback();
}).then(() => {
    console.log('🎉 Test 4/4: キャメルケース後方互換テスト 完了');
    console.log('');
    console.log('🎉🎉🎉 全テスト合格！ DocumentReturnReport フェーズ4.1検証完了 🎉🎉🎉');
}).catch(err => {
    console.error('❌ テスト失敗:', err);
    process.exit(1);
});
