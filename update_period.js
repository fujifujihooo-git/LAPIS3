const fs = require('fs');

// --- 1. Update customer_detail.html ---
let html = fs.readFileSync('customer_detail.html', 'utf8');

const oldYearHtml = `<div class="form-group" style="flex:1;">
                        <label>年度</label>
                        <input type="text" id="report_year" class="form-control" placeholder="例: 令和5年度" value="">
                    </div>`;

const newPeriodHtml = `<div class="form-group" style="flex:1;">
                        <label>事業年度</label>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <input type="date" id="report_period_start" class="form-control">
                            <span>〜</span>
                            <input type="date" id="report_period_end" class="form-control">
                        </div>
                    </div>`;

html = html.replace(oldYearHtml, newPeriodHtml);
// Fallback if whitespace differs
if (!html.includes('report_period_start')) {
    html = html.replace(/<div class="form-group" style="flex:1;">[\s]*<label>年度<\/label>[\s]*<input type="text" id="report_year" class="form-control" placeholder="例: 令和5年度" value="">[\s]*<\/div>/m, newPeriodHtml);
}

fs.writeFileSync('customer_detail.html', html, 'utf8');


// --- 2. Update customer_detail.js ---
let js = fs.readFileSync('customer_detail.js', 'utf8');

// Replace Year default setting logic
const oldYearLogic = `// Set default year
            const today = new Date();
            const yearStr = "令和" + (today.getFullYear() - 2018) + "年度";
            const yearInput = document.getElementById('report_year');
            if(yearInput && !yearInput.value) yearInput.value = yearStr;`;

const newPeriodLogic = `// Set default period
            const periodStartInput = document.getElementById('report_period_start');
            const periodEndInput = document.getElementById('report_period_end');
            
            function calculateStartDate(endDateStr) {
                if (!endDateStr) return '';
                const endDate = new Date(endDateStr);
                if (isNaN(endDate.getTime())) return '';
                // 1年前の翌日
                const startDate = new Date(endDate);
                startDate.setFullYear(startDate.getFullYear() - 1);
                startDate.setDate(startDate.getDate() + 1);
                return Math.max(startDate.getFullYear(), 1900) + '-' + String(startDate.getMonth() + 1).padStart(2, '0') + '-' + String(startDate.getDate()).padStart(2, '0');
            }

            if (periodEndInput && periodStartInput) {
                if (!periodEndInput.value) {
                    let initialEndDate = '';
                    if (currentCustomer.settlement_date) {
                        initialEndDate = currentCustomer.settlement_date;
                    } else if (currentCustomer.fiscal_year_end_month && currentCustomer.fiscal_year_end_day) {
                        const today = new Date();
                        const m = String(currentCustomer.fiscal_year_end_month).padStart(2, '0');
                        const d = String(currentCustomer.fiscal_year_end_day).padStart(2, '0');
                        // 決算月が現在月より後なら去年の年を使用
                        let y = today.getFullYear();
                        if (today.getMonth() + 1 < currentCustomer.fiscal_year_end_month) {
                            y -= 1;
                        }
                        initialEndDate = \`\${y}-\${m}-\${d}\`;
                    } else {
                        const today = new Date();
                        initialEndDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
                    }
                    
                    periodEndInput.value = initialEndDate;
                    periodStartInput.value = calculateStartDate(initialEndDate);
                }

                if (!periodEndInput.dataset.listenerAttached) {
                    periodEndInput.addEventListener('change', (e) => {
                        periodStartInput.value = calculateStartDate(e.target.value);
                    });
                    periodEndInput.dataset.listenerAttached = 'true';
                }
            }`;

js = js.replace(oldYearLogic, newPeriodLogic);
// Format Data change
js = js.replace("year: document.getElementById('report_year') ? document.getElementById('report_year').value : '',", 
                "period_start: document.getElementById('report_period_start') ? document.getElementById('report_period_start').value : '',\n            period_end: document.getElementById('report_period_end') ? document.getElementById('report_period_end').value : '',");


// Replace URLs with Absolute Path
js = js.replace(/fetch\('report-system\/report-templates\/tax_certificate_map\.json'\)/g, "fetch('/report-system/report-templates/tax_certificate_map.json')");
js = js.replace(/'report-system\/report-templates\/tax_certificate\.pdf'/g, "'/report-system/report-templates/tax_certificate.pdf'");
js = js.replace(/'report-system\/report-templates\/tax_certificate\.pdf\.pdf'/g, "'/report-system/report-templates/tax_certificate.pdf.pdf'");
js = js.replace(/'report-system\/report-templates\/NotoSansJP-Regular\.ttf'/g, "'/report-system/report-templates/NotoSansJP-Regular.ttf'");

fs.writeFileSync('customer_detail.js', js, 'utf8');

console.log("Updated HTML and JS successfully!");
