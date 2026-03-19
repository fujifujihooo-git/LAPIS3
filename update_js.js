const fs = require('fs');
let js = fs.readFileSync('customer_detail.js', 'utf8');

const reportCode = `
    // --- Report Engine (Tax Certificate) ---
    const btnOpenTaxCert = document.getElementById('btn-open-tax-cert-modal');
    const reportModal = document.getElementById('report-modal');
    const btnCloseReport = document.getElementById('btn-close-report-modal');
    const btnPreviewReport = document.getElementById('btn-preview-report');
    const btnPrintReport = document.getElementById('btn-print-report');
    const selApplicantType = document.getElementById('report_applicant_type');
    const groupStaffSelect = document.getElementById('group_staff_select');
    const selReportStaff = document.getElementById('report_staff_id');

    if (btnOpenTaxCert) {
        btnOpenTaxCert.addEventListener('click', () => {
            if (!currentCustomer) {
                alert('顧客データが保存されていません。先に保存してください。');
                return;
            }
            
            // Populate staff dropdown if empty
            if (selReportStaff && selReportStaff.options.length <= 1) {
                const activeStaff = staffMembers
                    .filter(s => s.status === '在籍')
                    .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));
                activeStaff.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.staff_id;
                    opt.textContent = s.staff_name;
                    selReportStaff.appendChild(opt);
                });
            }

            // Set default year
            const today = new Date();
            const yearStr = "令和" + (today.getFullYear() - 2018) + "年度";
            const yearInput = document.getElementById('report_year');
            if(yearInput && !yearInput.value) yearInput.value = yearStr;

            if(reportModal) reportModal.style.display = 'flex';
        });
    }

    if (btnCloseReport) {
        btnCloseReport.addEventListener('click', () => {
            if(reportModal) reportModal.style.display = 'none';
        });
    }

    if (selApplicantType) {
        selApplicantType.addEventListener('change', (e) => {
            if (e.target.value === '代理人') {
                if(groupStaffSelect) groupStaffSelect.style.display = 'block';
            } else {
                if(groupStaffSelect) groupStaffSelect.style.display = 'none';
                if(selReportStaff) selReportStaff.value = ''; // Reset
            }
        });
        // Trigger initial state
        setTimeout(()=>selApplicantType.dispatchEvent(new Event('change')), 100);
    }

    async function handleReportAction(actionType) {
        if (!currentCustomer) return;

        // Validation
        const appType = selApplicantType ? selApplicantType.value : '本人';
        const staffId = selReportStaff ? selReportStaff.value : '';
        if (appType === '代理人' && !staffId) {
            alert('代理人の担当者を選択してください。');
            return;
        }

        // Gather form data
        const taxTypes = Array.from(document.querySelectorAll('input[name="taxType"]:checked')).map(cb => cb.value);
        const selectedStaff = staffMembers.find(s => String(s.staff_id) === String(staffId)) || null;
        
        const formData = {
            taxTypes: taxTypes,
            year: document.getElementById('report_year') ? document.getElementById('report_year').value : '',
            copies: document.getElementById('report_copies') ? document.getElementById('report_copies').value : '1',
            submittedTo: document.getElementById('report_submitted_to') ? document.getElementById('report_submitted_to').value : '',
            applicantType: appType,
            staff: selectedStaff ? {
                name: selectedStaff.staff_name,
                kana: selectedStaff.staff_kana,
                tel: selectedStaff.phone
            } : null
        };

        try {
            // Disable buttons
            if (btnPreviewReport) btnPreviewReport.disabled = true;
            if (btnPrintReport) btnPrintReport.disabled = true;
            let btnOriginalText = '';
            if (actionType === 'preview') {
                btnOriginalText = btnPreviewReport.textContent;
                btnPreviewReport.textContent = '生成中...';
            } else {
                btnOriginalText = btnPrintReport.textContent;
                btnPrintReport.textContent = '生成中...';
            }

            // 1. Build View Data
            const viewData = window.TaxCertificateView.buildData(currentCustomer, formData);

            // 2. Load Mapping
            const mapRes = await fetch('report-system/report-templates/tax_certificate_map.json');
            if (!mapRes.ok) throw new Error('マッピング定義の読み込みに失敗しました');
            const mappingJson = await mapRes.json();

            // 3. URLs
            let templateUrl = 'report-system/report-templates/tax_certificate.pdf';
            const templateRes = await fetch(templateUrl, {method: 'HEAD'});
            if (!templateRes.ok) {
                templateUrl = 'report-system/report-templates/tax_certificate.pdf.pdf'; // User upload fallback
            }
            const fontUrl = 'report-system/report-templates/NotoSansJP-Regular.ttf';

            // 4. Generate
            const pdfBytes = await window.ReportEngine.generateReport(templateUrl, fontUrl, mappingJson, viewData);

            // 5. Output
            if (actionType === 'preview') {
                window.ReportEngine.previewPDF(pdfBytes);
                if (btnPreviewReport) btnPreviewReport.textContent = btnOriginalText;
            } else {
                const filename = \`納税証明書_\${currentCustomer.customer_name}.pdf\`;
                window.ReportEngine.downloadPDF(pdfBytes, filename);
                if(reportModal) reportModal.style.display = 'none'; // Close modal on download
                if (btnPrintReport) btnPrintReport.textContent = btnOriginalText;
            }
        } catch (err) {
            console.error('Report Generation Error:', err);
            alert('帳票の生成に失敗しました: ' + err.message);
            if (btnPreviewReport) btnPreviewReport.textContent = 'プレビュー';
            if (btnPrintReport) btnPrintReport.textContent = '印刷（ダウンロード）';
        } finally {
            if (btnPreviewReport) btnPreviewReport.disabled = false;
            if (btnPrintReport) btnPrintReport.disabled = false;
        }
    }

    if (btnPreviewReport) {
        btnPreviewReport.addEventListener('click', () => handleReportAction('preview'));
    }
    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => handleReportAction('download'));
    }
`;

// Insert before `await init();`
if(!js.includes('btnOpenTaxCert')) {
    js = js.replace('    await init();\n', reportCode + '\n    await init();\n');
    // Fallback for CRLF
    js = js.replace('    await init();\r\n', reportCode + '\r\n    await init();\r\n');
    fs.writeFileSync('customer_detail.js', js, 'utf8');
    console.log('JS Updated!');
} else {
    console.log('JS already updated.');
}
