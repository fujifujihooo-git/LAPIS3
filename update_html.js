const fs = require('fs');
let html = fs.readFileSync('customer_detail.html', 'utf8');

html = html.replace(
    '<script src="https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js"></script>\r\n    <script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>\r\n    <script src="https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js"></script>\r\n    <script src="report-system/report-engine/report_engine.js"></script>\r\n    <script src="report-system/report-views/tax_certificate_view.js"></script>'
);

html = html.replace(
    '<button type="button" class="tab-btn" data-tab="projects">案件履歴</button>',
    '<button type="button" class="tab-btn" data-tab="projects">案件履歴</button>\r\n                        <button type="button" class="tab-btn" data-tab="reports">帳票出力</button>'
);

const reportTabHtml = `</div>
                            </div>

                            <!-- Tab Content: Reports -->
                            <div id="tab-reports" class="tab-content">
                                <h3 class="form-section-title">帳票出力</h3>
                                <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                                    <button type="button" class="btn btn-primary" id="btn-open-tax-cert-modal" style="background:#0284c7; border:none;">
                                        <i data-lucide="file-text"></i> 東京都納税証明書交付申請書 印刷
                                    </button>
                                </div>
                            </div>`;

html = html.replace('</div>\r\n                            </div>\r\n\r\n\r\n                        </div>', reportTabHtml + '\r\n\r\n                        </div>');
// Fallback for LF
if(!html.includes('id="tab-reports"')) {
    html = html.replace('</div>\n                            </div>\n\n\n                        </div>', reportTabHtml + '\n\n                        </div>');
}

// Ensure the print-template replacement is smooth
const modalHtml = `    <!-- Hidden Print Template (JS dynamically generates content via buildPrintHTML) -->
    <div id="print-template" style="display: none;"></div>

    <!-- 帳票用モーダル (東京都納税証明書交付申請書) -->
    <div id="report-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
        <div style="background:#fff; width: 600px; max-width: 90%; border-radius:8px; padding:24px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 90vh; overflow-y: auto;">
            <h3 style="margin-top:0; border-bottom:1px solid var(--border-color); padding-bottom:12px; font-size: 14pt;">東京都納税証明書交付申請書 出力設定</h3>
            <div class="form-grid" style="grid-template-columns: 1fr;">
                <div class="form-group">
                    <label>税目 (複数選択可)</label>
                    <div style="display:flex; gap:12px; flex-wrap:wrap; font-size: 13pt;">
                        <label><input type="checkbox" name="taxType" value="法人都民税" checked> 法人都民税</label>
                        <label><input type="checkbox" name="taxType" value="法人事業税" checked> 法人事業税</label>
                        <label><input type="checkbox" name="taxType" value="固定資産税"> 固定資産税</label>
                        <label><input type="checkbox" name="taxType" value="自動車税"> 自動車税</label>
                    </div>
                </div>
                <div style="display:flex; gap: 20px;">
                    <div class="form-group" style="flex:1;">
                        <label>年度</label>
                        <input type="text" id="report_year" class="form-control" placeholder="例: 令和5年度" value="">
                    </div>
                    <div class="form-group" style="width: 100px;">
                        <label>枚数</label>
                        <input type="number" id="report_copies" class="form-control" value="1" min="1">
                    </div>
                </div>
                <div class="form-group">
                    <label>提出先</label>
                    <input type="text" id="report_submitted_to" class="form-control" placeholder="例: 東京都主税局" value="">
                </div>
                <div class="form-group">
                    <label>申請者区分</label>
                    <select id="report_applicant_type" class="form-select">
                        <option value="本人">本人 (顧客自身)</option>
                        <option value="代理人" selected>代理人 (自事務所スタッフ)</option>
                    </select>
                </div>
                <div class="form-group" id="group_staff_select">
                    <label>担当者 (代理人) <span class="required">*</span></label>
                    <select id="report_staff_id" class="form-select">
                        <option value="">(未選択)</option>
                    </select>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
                <button type="button" class="btn btn-secondary" id="btn-close-report-modal">キャンセル</button>
                <button type="button" class="btn btn-primary" id="btn-print-report">印刷（ダウンロード）</button>
            </div>
        </div>
    </div>`;

html = html.replace(/<div id="print-template" style="display: none;"><\/div>/g, modalHtml);

fs.writeFileSync('customer_detail.html', html, 'utf8');
console.log('Update complete!');
