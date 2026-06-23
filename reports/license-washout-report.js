/**
 * 決算期別一覧 帳票クラス (License Washout Report)
 * BaseReport を継承し、決算期別一覧のPDF生成処理を実装します。
 */

(function () {
    'use strict';

    class LicenseWashoutReport extends window.BaseReport {
        constructor() {
            super('決算期別一覧');
        }

        /**
         * 決算期別一覧 PDF を生成する
         * @param {Array} filteredData - 検索結果データリスト
         * @param {Object} filterOptions - 現在の検索フィルター条件
         *   { fiscalMonth, licenseType, staffName, keyword }
         */
        async generate(filteredData, filterOptions = {}) {
            // 1. PDFの初期化 (A4横, Landscape)
            await this.init();
            const doc = this.doc;
            const utils = window.ReportUtils;
            const theme = utils.THEME;

            // 2. 1ページ目のヘッダー描画
            let y = this.drawHeader(this.marginT);

            // 3. 検索条件・結果件数のサブヘッダー描画
            doc.setFontSize(8.5);
            doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);

            // 検索条件の文字列構築
            const mLabel = filterOptions.fiscalMonth ? `${filterOptions.fiscalMonth}月` : 'すべて';
            const tLabel = filterOptions.licenseType || 'すべて';
            const sLabel = filterOptions.staffName || 'すべて';
            const kLabel = filterOptions.keyword || '―';
            const condStr = `検索条件：決算月 [${mLabel}] / 許認可種別 [${tLabel}] / 担当者 [${sLabel}] / キーワード [${kLabel}]`;

            doc.text(condStr, this.marginL, y);

            // 検索結果件数 (右寄せ)
            const countStr = `検索結果：${filteredData.length}件`;
            const rightX = this.pageW - this.marginR;
            doc.text(countStr, rightX, y, { align: 'right' });

            y += 4.5; // 余白

            // 4. テーブルデータの構築
            const headers = [['顧客名', '決算月', '許認可種別 (許認可番号)', '有効期限', '担当者', '備考']];
            const rows = filteredData.map(item => {
                const customerName = item.customer ? (item.customer.customer_name || '―') : '―';
                
                const fiscalText = (item.customer && item.customer.fiscal_year_end_month && item.customer.fiscal_year_end_day)
                    ? `${item.customer.fiscal_year_end_month}/${item.customer.fiscal_year_end_day}`
                    : '―';

                const licType = item.licenseType ? item.licenseType.license_type_name : (item.license_type || '―');
                const licNum = utils.formatLicenseNumber(item.license);
                const licStr = `${licType}${licNum ? ' (' + licNum + ')' : ''}`;

                const expStr = utils.formatDate(item.license ? item.license.expiry_date : null);
                const staffStr = item.staff ? (item.staff.staff_name || '―') : '―';

                // 備考欄は最大50文字に制限
                let remarks = item.customer ? (item.customer.remarks || '―') : '―';
                if (remarks.length > 50) {
                    remarks = remarks.substring(0, 50) + '...';
                }

                return [customerName, fiscalText, licStr, expStr, staffStr, remarks];
            });

            // 5. autoTable 実行
            doc.autoTable({
                startY: y,
                margin: { left: this.marginL, right: this.marginR },
                head: headers,
                body: rows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8.5,
                    cellPadding: 2.5,
                    textColor: theme.TEXT_MAIN,
                    lineColor: theme.BORDER,
                    lineWidth: 0.1
                },
                headStyles: {
                    fillColor: theme.SUB_HEADER,
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    halign: 'center'
                },
                columnStyles: {
                    0: { cellWidth: 50 },                   // 顧客名
                    1: { cellWidth: 20, halign: 'center' }, // 決算月
                    2: { cellWidth: 65 },                   // 許認可種別 (番号含む)
                    3: { cellWidth: 30, halign: 'center' }, // 有効期限
                    4: { cellWidth: 32 },                   // 担当者
                    5: { cellWidth: 70 }                    // 備考
                },
                didDrawPage: (data) => {
                    // 各ページのフッター描画
                    this.drawFooter(data.pageNumber, doc.internal.getNumberOfPages());
                }
            });
        }
    }

    window.LicenseWashoutReport = LicenseWashoutReport;
})();
