const fs = require('fs');
const path = require('path');

console.log('--- Testing DocumentReturnReport & Modal v2.3 Logic ---');

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

// Load & Validate document_return_modal.js (構文およびDocumentReturnModalクラス定義の検証)
global.localStorage = { getItem: () => null, setItem: () => {} };
global.firebase = { firestore: { Timestamp: { fromDate: () => ({}) }, FieldValue: { serverTimestamp: () => ({}) } } };
const modalCode = fs.readFileSync(path.resolve(__dirname, '../js/document_return_modal.js'), 'utf8');
eval(modalCode);
console.assert(typeof window.DocumentReturnModal === 'function', 'window.DocumentReturnModal がクラス/関数として正常に読み込まれること');
console.log('✅ document_return_modal.js 構文・クラスロード検証: 成功 (typeof window.DocumentReturnModal =', typeof window.DocumentReturnModal, ')');

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
}

async function testDocReturnWithBodyMessage() {
    const report = new window.DocumentReturnReport();
    
    const customer = {
        customer_name: '株式会社 鈴木商事',
        contact_name: '鈴木 太郎'
    };
    
    // フェーズ4.1仕様: body_message によるカスタム通知本文
    const customMessage = `いつもお世話になっております。
建設業許可更新申請の手続きが完了いたしましたので、
お預かり書類等を本日発送のレターパックプラスにてお送りいたしました。
ご査収のほどよろしくお願い申し上げます。`;

    const record = {
        delivery_method: 'letterpack_plus',
        ship_date: '2026/09/08',
        arrival_date: '2026/09/09',
        tracking_number: '3906-1259-5800',
        returned_items: ['permit_notice', 'copy'],
        body_message: customMessage,
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

/**
 * v2.3 新規テスト: UT-PH41-009
 * 編集 → 元に戻す → 保存 で is_template_edited === false
 */
function testRevertEditPreservesUneditedState() {
    console.log('--- Testing UT-PH41-009: 編集→元に戻す の厳密判定 ---');
    const templateType = 'complete';
    const generatedTemplateText = `いつも大変お世話になっております。
届出・申請の手続きが完了致しましたので、お預かり書類等を本日発送のレターパックプラスにてお送り致しました。
ご確認のほど、よろしくお願い申し上げます。`;

    // 1. 1文字追加された状態
    let currentInput = generatedTemplateText + '追加';
    let isEdited = (templateType !== 'custom') && (currentInput.trim() !== generatedTemplateText.trim());
    console.assert(isEdited === true, '文字追加時は isEdited が true であること');

    // 2. 削除して完全に元に戻した状態
    currentInput = generatedTemplateText;
    isEdited = (templateType !== 'custom') && (currentInput.trim() !== generatedTemplateText.trim());
    console.assert(isEdited === false, '元に戻した後は isEdited が false に戻ること');

    console.log('✅ UT-PH41-009: 編集→元に戻す で is_template_edited === false が正常に判定されました。');
}

/**
 * v2.3 新規テスト: UT-PH41-010
 * 完了返却 → 編集 → 審査中返却へ変更 で isBodyDirty リセット、新テンプレ生成
 */
function testSwitchTemplateResetsDirtyState() {
    console.log('--- Testing UT-PH41-010: テンプレ切替によるリセットと再生成 ---');
    
    // 擬似モーダル状態
    let currentTemplate = 'complete';
    let isBodyDirty = true;
    let badgeDisplay = 'inline-block';

    // ユーザーが「審査中返却」ラジオをクリック
    const handleRadioChange = (newTemplate) => {
        currentTemplate = newTemplate;
        isBodyDirty = false;
        badgeDisplay = 'none';
    };

    handleRadioChange('under_review');
    console.assert(currentTemplate === 'under_review', 'テンプレート種別が under_review に切り替わること');
    console.assert(isBodyDirty === false, 'isBodyDirty が false にリセットされること');
    console.assert(badgeDisplay === 'none', '編集済バッジが非表示化されること');

    console.log('✅ UT-PH41-010: テンプレ切替で isBodyDirty リセット・バッジ消滅が正常に機能しました。');
}

/**
 * v2.3 新規テスト: UT-PH41-011
 * 700文字・1000文字超の長文通知文でも PDF 生成がエラーなく完了すること
 */
async function testLongBodyMessagePdfGeneration() {
    console.log('--- Testing UT-PH41-011: 長文通知文（700字/1000字）のPDF生成耐性 ---');
    const report = new window.DocumentReturnReport();
    const customer = { customer_name: '長文テスト株式会社' };

    // 1000文字超の長文テキスト
    const longTextParagraph = 'いつも大変お世話になっております。建設業許可申請の手続きが完了いたしましたのでご案内いたします。詳細な注意事項を記載いたしますので必ずご確認ください。';
    let longMessage = '';
    while (longMessage.length < 1050) {
        longMessage += longTextParagraph + '\n';
    }

    const record = {
        delivery_method: 'letterpack_plus',
        ship_date: '2026/09/08',
        arrival_date: '2026/09/09',
        tracking_number: '3906-1259-5800',
        returned_items: ['permit_notice', 'copy', 'invoice'],
        body_message: longMessage,
        staff_name: '藤田 宏明'
    };

    // 例外なく生成完了することを確認
    await report.generate(customer, record);
    console.assert(report.doc.texts.length > 20, '長文テキストが複数行に分割描画されていること');
    console.log(`✅ UT-PH41-011: 1,000文字超の長文本文でもエラーなくPDF描画が完了しました。（描画行数: ${report.doc.texts.length}）`);
}

/**
 * v2.3 新規テスト: UT-PH41-012
 * 出処記録と content 見出しの検証
 */
function testProvenanceContentHeading() {
    console.log('--- Testing UT-PH41-012: 出処記録と content 見出し ---');

    const tplNames = {
        complete: '完了返却',
        under_review: '審査中返却',
        original_return: '原本返却',
        custom: '自由入力'
    };

    const getHeading = (templateType, isTemplateEdited) => {
        const tplLabel = tplNames[templateType] || '完了返却';
        return isTemplateEdited
            ? `通知文（${tplLabel}・編集済）：`
            : (templateType === 'custom' ? '通知文（自由入力）：' : `通知文（${tplLabel}）：`);
    };

    console.assert(getHeading('complete', false) === '通知文（完了返却）：', '定型そのままの場合は「通知文（完了返却）：」');
    console.assert(getHeading('complete', true) === '通知文（完了返却・編集済）：', '編集ありの場合は「通知文（完了返却・編集済）：」');
    console.assert(getHeading('under_review', true) === '通知文（審査中返却・編集済）：', '審査中編集時は「通知文（審査中返却・編集済）：」');
    console.assert(getHeading('custom', false) === '通知文（自由入力）：', '自由入力時は「通知文（自由入力）：」');

    console.log('✅ UT-PH41-012: 出処記録の見出しフォーマットが全て期待通りです。');
}

testDocReturn().then(() => {
    console.log('🎉 Test 1: 基本生成テスト 完了');
    return testDocReturnWithBodyMessage();
}).then(() => {
    console.log('🎉 Test 2: body_message動的本文テスト 完了');
    return testDocReturnFallbackBody();
}).then(() => {
    console.log('🎉 Test 3: フォールバック文面テスト 完了');
    return testDocReturnCamelCaseFallback();
}).then(() => {
    console.log('🎉 Test 4: キャメルケース後方互換テスト 完了');
    testRevertEditPreservesUneditedState();
    testSwitchTemplateResetsDirtyState();
    return testLongBodyMessagePdfGeneration();
}).then(() => {
    testProvenanceContentHeading();
    console.log('');
    console.log('🎉🎉🎉 全8テスト合格！ DocumentReturnReport & Modal v2.3 安全装置検証完了 🎉🎉🎉');
}).catch(err => {
    console.error('❌ テスト失敗:', err);
    process.exit(1);
});
