/**
 * 許認可管理一覧 帳票クラス (License List Report)
 * BaseReport を継承し、許認可管理一覧のPDF生成処理を実装します。
 */

(function () {
    'use strict';

    class LicenseListReport extends window.BaseReport {
        constructor() {
            super('許認可一覧');
        }

        /**
         * 許認可管理一覧 PDF を生成する
         * @param {Array} filteredData - 検索結果データリスト
         * @param {Object} filterOptions - 現在の検索フィルター条件
         *   { customer, fieldStaff, status, jurisdiction, licenseType, noticeDue, expiryStart, expiryEnd, noticeStart, noticeEnd }
         * @param {Array} customers - 顧客キャッシュ
         * @param {Array} licenseTypes - 許認可種別キャッシュ
         * @param {Array} staffMembers - 担当者キャッシュ
         */
        async generate(filteredData, filterOptions = {}, customers = [], licenseTypes = [], staffMembers = []) {
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

            // 検索条件の文字列構築（ユーザー指定された有効な条件のみ）
            const condParts = [];
            if (filterOptions.customer) condParts.push(`顧客名 [${filterOptions.customer}]`);
            if (filterOptions.fieldStaff) {
                const staff = staffMembers.find(s => s.staff_id === Number(filterOptions.fieldStaff));
                condParts.push(`外務担当者 [${staff ? staff.staff_name : filterOptions.fieldStaff}]`);
            }
            if (filterOptions.status) condParts.push(`状態 [${filterOptions.status}]`);
            if (filterOptions.jurisdiction) condParts.push(`管轄官公庁 [${filterOptions.jurisdiction}]`);
            if (filterOptions.licenseType) {
                const lt = licenseTypes.find(l => l.license_type_id === Number(filterOptions.licenseType));
                condParts.push(`許認可種別 [${lt ? lt.license_type_name : filterOptions.licenseType}]`);
            }
            if (filterOptions.noticeDue) condParts.push(`案内日が今日以前`);
            if (filterOptions.expiryStart || filterOptions.expiryEnd) {
                condParts.push(`期限 [${filterOptions.expiryStart || ''} ～ ${filterOptions.expiryEnd || ''}]`);
            }
            if (filterOptions.noticeStart || filterOptions.noticeEnd) {
                condParts.push(`案内日 [${filterOptions.noticeStart || ''} ～ ${filterOptions.noticeEnd || ''}]`);
            }

            const condStr = condParts.length > 0 ? `抽出条件：${condParts.join(' / ')}` : '抽出条件：なし';

            doc.text(condStr, this.marginL, y);

            // 検索結果件数 (右寄せ)
            const countStr = `検索結果：${filteredData.length}件`;
            const rightX = this.pageW - this.marginR;
            doc.text(countStr, rightX, y, { align: 'right' });

            y += 4.5; // 余白

            // 4. テーブルデータの構築
            const headers = [['顧客名', '許認可種別 / 番号', '期限（満了日）', '残り日数', '案内日', '案内まで', '状態']];

            // 画面と同様の残り日数計算等
            const calculateDays = (dateStr) => {
                if (!dateStr) return null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                let targetDate;
                if (typeof dateStr.toDate === 'function') {
                    targetDate = dateStr.toDate();
                } else {
                    targetDate = new Date(dateStr);
                }
                targetDate.setHours(0, 0, 0, 0);
                return Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
            };

            const formatRemainingDays = (days, status) => {
                const terminalStatuses = ['完了', '返却済', '取下げ', '失効', '取消'];
                if (status && terminalStatuses.includes(status)) return 'ー';
                if (days === null) return 'ー';
                if (days < 0) return `${Math.abs(days)}日超過`;
                return `${days}日`;
            };

            const formatDaysUntilNotice = (days) => {
                if (days === null) return 'ー';
                if (days < 0) return `${Math.abs(days)}日超過`;
                return `${days}日`;
            };

            const formatLicenseNumber = (item) => {
                const num1 = (item.license_number_1 || '').trim();
                const num2 = (item.license_number_2 || '').trim();
                if (!num1 && !num2) return 'ー';
                if (!num1) return num2;
                if (!num2) return num1;
                return `${num1} _ ${num2}`;
            };

            const formatWareki = (dateStr) => {
                if (!dateStr) return '';
                try {
                    let date;
                    if (typeof dateStr.toDate === 'function') {
                        date = dateStr.toDate();
                    } else {
                        date = new Date(dateStr);
                    }
                    if (isNaN(date.getTime())) return '';
                    const formatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
                        era: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    return formatter.format(date);
                } catch (e) {
                    return '';
                }
            };

            const rows = filteredData.map(item => {
                // 1. 顧客名 + 外務担当者
                const customer = customers.find(c => c.customer_id === item.customer_id);
                let customerText = customer ? (customer.customer_name || '―') : '―';
                const staff = customer && customer.primary_staff_id
                    ? staffMembers.find(s => s.staff_id === Number(customer.primary_staff_id))
                    : null;
                const staffName = staff ? staff.staff_name : '';
                if (staffName) {
                    customerText += `\n(${staffName})`;
                }

                // 2. 許認可種別 / 番号
                const licenseType = licenseTypes.find(lt => lt.license_type_id === item.license_type_id);
                const gov = item.government_office ? `[${item.government_office}] ` : '';
                const typeName = licenseType ? licenseType.license_type_name : '―';
                const licNum = formatLicenseNumber(item);
                const licText = `${gov}${typeName}\n${licNum}`;

                // 3. 期限（満了日）
                const expDate = utils.formatDate(item.expiry_date);
                const expWareki = formatWareki(item.expiry_date);
                const expText = expWareki ? `${expDate}\n(${expWareki})` : expDate;

                // 4. 残り日数
                const remDays = calculateDays(item.expiry_date);
                const remText = formatRemainingDays(remDays, item.status);

                // 5. 案内日
                const noticeDate = utils.formatDate(item.notice_date);
                const noticeWareki = formatWareki(item.notice_date);
                const noticeText = noticeWareki ? `${noticeDate}\n(${noticeWareki})` : noticeDate;

                // 6. 案内まで
                const noticeDays = calculateDays(item.notice_date);
                const noticeDaysText = formatDaysUntilNotice(noticeDays);

                // 7. 状態
                const statusText = item.status || '―';

                return [customerText, licText, expText, remText, noticeText, noticeDaysText, statusText];
            });

            // 5. autoTable 実行
            doc.autoTable({
                startY: y,
                margin: { left: this.marginL, right: this.marginR, bottom: this.marginB },
                head: headers,
                body: rows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8,
                    cellPadding: 2,
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
                    0: { cellWidth: 55 },                   // 顧客名
                    1: { cellWidth: 65 },                   // 許認可種別 / 番号
                    2: { cellWidth: 32, halign: 'center' }, // 期限
                    3: { cellWidth: 25, halign: 'center' }, // 残り日数
                    4: { cellWidth: 32, halign: 'center' }, // 案内日
                    5: { cellWidth: 32, halign: 'center' }, // 案内まで
                    6: { cellWidth: 26, halign: 'center' }  // 状態
                }
            });

            // 2パス描画：全ページの描画完了後にフッター（ページ番号・仕切り線）を一括描画する
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                this.drawFooter(i, totalPages);
            }
        }
    }

    window.LicenseListReport = LicenseListReport;
})();
