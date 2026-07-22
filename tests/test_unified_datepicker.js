const fs = require('fs');
const path = require('path');

// 簡易DOMモック
class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.value = '';
        this.className = '';
        this.placeholder = '';
        this.listeners = {};
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k] || null; }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    insertBefore(newChild, refChild) {
        newChild.parentNode = this;
        this.children.push(newChild);
        return newChild;
    }
    addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
    }
    dispatchEvent(evt) {
        if (this.listeners[evt.type]) {
            this.listeners[evt.type].forEach(fn => fn.call(this, evt));
        }
    }
    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
        let results = [];
        const search = (node) => {
            if (node.className && sel.startsWith('.')) {
                const cls = sel.slice(1);
                if (node.className.split(' ').includes(cls)) results.push(node);
            }
            if (node.tagName && sel.toUpperCase() === node.tagName) {
                results.push(node);
            }
            node.children.forEach(search);
        };
        search(this);
        return results;
    }
    contains() { return false; }
    getBoundingClientRect() { return { top: 100, bottom: 140 }; }
}

const documentMock = {
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: () => [],
    addEventListener: () => {}
};

global.window = { innerHeight: 800 };
global.document = documentMock;
global.Event = function(type) { this.type = type; };
global.Intl = Intl;

// unified_datepicker.js 読み込み
const code = fs.readFileSync(path.join(__dirname, '../unified_datepicker.js'), 'utf8');
eval(code);

const UnifiedDatePicker = global.window.UnifiedDatePicker;

console.log('--- UnifiedDatePicker v3.0 Unit Test ---');

// Test 1: minYear=2020, maxYear=2040, value="1985/04/01" -> 案Cで表示下限が1985になるか
const input1 = new MockElement('input');
input1.parentNode = new MockElement('div');
input1.value = '1985/04/01';
input1.setAttribute('data-min-year', '2020');
input1.setAttribute('data-max-year', '2040');

const picker1 = new UnifiedDatePicker(input1);
picker1.open();

const yearSelectHtml1 = picker1.popup.innerHTML.match(/<select class="udp-year-select"[^>]*>([\s\S]*?)<\/select>/)[1];
const yearOptions1 = Array.from(yearSelectHtml1.matchAll(/value="(\d+)"/g)).map(m => parseInt(m[1], 10));

const minYearOpt = Math.min(...yearOptions1);
const maxYearOpt = Math.max(...yearOptions1);

console.log('Test 1 - Effective Min Year:', minYearOpt); // 1985
console.log('Test 1 - Effective Max Year:', maxYearOpt); // 2040
if (minYearOpt === 1985 && maxYearOpt === 2040) {
    console.log('PASS: Case C Effective Year calculation works correctly.');
} else {
    console.error('FAIL: Case C Effective Year calculation failed.');
}

// Test 2: 空欄時のデフォルト1900-2100
const input2 = new MockElement('input');
input2.parentNode = new MockElement('div');
const picker2 = new UnifiedDatePicker(input2);
picker2.open();

const yearSelectHtml2 = picker2.popup.innerHTML.match(/<select class="udp-year-select"[^>]*>([\s\S]*?)<\/select>/)[1];
const yearOptions2 = Array.from(yearSelectHtml2.matchAll(/value="(\d+)"/g)).map(m => parseInt(m[1], 10));

console.log('Test 2 - Default Min Year:', Math.min(...yearOptions2)); // 1900
console.log('Test 2 - Default Max Year:', Math.max(...yearOptions2)); // 2100
console.log('Test 2 - Dropdown Count:', yearOptions2.length); // 201
if (Math.min(...yearOptions2) === 1900 && Math.max(...yearOptions2) === 2100 && yearOptions2.length === 201) {
    console.log('PASS: Default 1900-2100 range works correctly.');
} else {
    console.error('FAIL: Default range failed.');
}

// Test 3: 手入力復元（範囲外日付 1899/12/31 を入力時）
picker1.displayInput.value = '1899/12/31';
picker1._handleManualInput();
console.log('Test 3 - Value after invalid manual input:', picker1.displayInput.value); // 1985/04/01
if (picker1.displayInput.value === '1985/04/01') {
    console.log('PASS: Invalid manual input correctly restored to previous valid value.');
} else {
    console.error('FAIL: Manual input restoration failed.');
}

// Test 4: minDate優先判定
const input3 = new MockElement('input');
input3.parentNode = new MockElement('div');
input3.setAttribute('data-min-date', '2026-05-01');
const picker3 = new UnifiedDatePicker(input3);
picker3.setDate('2026-05-10');
console.log('Test 4 - Set valid date:', input3.value); // 2026-05-10
picker3.setDate('2026-04-30'); // Out of bounds
console.log('Test 4 - Attempt out of bounds date:', input3.value); // Should stay 2026-05-10
if (input3.value === '2026-05-10') {
    console.log('PASS: minDate priority enforcement works correctly.');
} else {
    console.error('FAIL: minDate enforcement failed.');
}

// Test 5: うるう年判定 (2000/02/29 ○, 1900/02/29 ×, 2100/02/29 ×)
const inputLeap = new MockElement('input');
inputLeap.parentNode = new MockElement('div');
const pickerLeap = new UnifiedDatePicker(inputLeap);

// 2000/02/29 (ウルウ年)
pickerLeap.displayInput.value = '2000/02/29';
pickerLeap._handleManualInput();
const leap2000Ok = (inputLeap.value === '2000-02-29');

// 1900/02/29 (平年)
pickerLeap.displayInput.value = '1900/02/29';
pickerLeap._handleManualInput();
const leap1900Fail = (inputLeap.value === '2000-02-29'); // 失敗して2000-02-29に復元

// 2100/02/29 (平年)
pickerLeap.displayInput.value = '2100/02/29';
pickerLeap._handleManualInput();
const leap2100Fail = (inputLeap.value === '2000-02-29'); // 失敗して2000-02-29に復元

console.log('Test 5 - Leap year 2000/02/29:', leap2000Ok ? 'PASS' : 'FAIL');
console.log('Test 5 - Non-leap 1900/02/29 rejected:', leap1900Fail ? 'PASS' : 'FAIL');
console.log('Test 5 - Non-leap 2100/02/29 rejected:', leap2100Fail ? 'PASS' : 'FAIL');

// Test 6: 境界日 1900/01/01 & 2100/12/31
pickerLeap.displayInput.value = '1900/01/01';
pickerLeap._handleManualInput();
const minBoundaryOk = (inputLeap.value === '1900-01-01');

pickerLeap.displayInput.value = '2100/12/31';
pickerLeap._handleManualInput();
const maxBoundaryOk = (inputLeap.value === '2100-12-31');

console.log('Test 6 - Min Boundary 1900/01/01:', minBoundaryOk ? 'PASS' : 'FAIL');
console.log('Test 6 - Max Boundary 2100/12/31:', maxBoundaryOk ? 'PASS' : 'FAIL');

console.log('--- ALL UNIT TESTS COMPLETED ---');

