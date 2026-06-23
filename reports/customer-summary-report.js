/**
 * 顧客カルテ概要票 帳票クラス (Customer Summary Report)
 * BaseReport を継承し、顧客カルテ概要票のPDF生成処理を実装します。
 */

(function () {
    'use strict';

    class CustomerSummaryReport extends window.BaseReport {
        constructor() {
            super('顧客カルテ概要');
        }

        /**
         * 顧客カルテ概要票 PDF を生成する
         * @param {Object} customer - 顧客基本情報
         * @param {Array} licenses - 許認可リスト
         * @param {Array} cases - 案件リスト
         * @param {Array} histories - 対応履歴リスト
         * @param {Array} staffMembers - スタッフマスタ
         * @param {Array} licenseTypes - 許認可種別マスタ
         */
        async generate(customer, licenses, cases, histories, staffMembers = [], licenseTypes = []) {
            // 1. PDFの初期化 (A4横, Landscape)
            await this.init();
            const doc = this.doc;
            const utils = window.ReportUtils;
            const theme = utils.THEME;

            // 2. 1ページ目の描画
            let y = this.drawHeader(this.marginT);
            const yStart = y; // 右カラムの開始位置（ヘッダー直後）として保持

            const leftX = this.marginL;
            const leftW = 160;
            const rightX = 185;
            const rightW = 97;
            const bottomLimitY = 192; // 1ページ目のコンテンツ下端

            // ==========================================
            // [左カラム] セクション1: 基本情報
            // ==========================================
            const drawSectionTitle = (title, x, yPos, w) => {
                doc.setFontSize(10.5);
                doc.setTextColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
                doc.text(title, x, yPos);
                doc.setLineWidth(0.2);
                doc.text(title, x, yPos, { renderingMode: 'fillThenStroke' });
                
                // 下線
                doc.setDrawColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
                doc.setLineWidth(0.4);
                doc.line(x, yPos + 2, x + w, yPos + 2);
            };

            drawSectionTitle('■ 基本情報', leftX, y, leftW);
            y += 5.5;

            // 基本情報グリッドの描画 (X: 15, Y: y, 幅: 160, 各行高: 7.5mm)
            const gridRowH = 7.5;
            const gridYStart = y;
            const gridRows = 7;
            const gridH = gridRows * gridRowH;

            // グリッド外枠・内線描画
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.2);
            
            // 外枠
            doc.rect(leftX, gridYStart, leftW, gridH);
            
            // 横線
            for (let i = 1; i < gridRows; i++) {
                doc.line(leftX, gridYStart + (i * gridRowH), leftX + leftW, gridYStart + (i * gridRowH));
            }

            // セル描画用のヘルパー (2列構成)
            const drawGridCell = (rowIdx, isLeft, label, value) => {
                const rowY = gridYStart + (rowIdx * gridRowH);
                const colX = isLeft ? leftX : leftX + (leftW / 2);
                const colW = leftW / 2;
                const labelW = 22; // ラベル幅
                const valW = colW - labelW;

                // ラベル背景塗りつぶし
                doc.setFillColor(theme.LABEL_BG[0], theme.LABEL_BG[1], theme.LABEL_BG[2]);
                doc.rect(colX, rowY, labelW, gridRowH, 'F');

                // ラベルとデータの境界線 (縦線)
                doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
                doc.line(colX + labelW, rowY, colX + labelW, rowY + gridRowH);

                // 2列目の開始前の仕切り線 (縦線)
                if (!isLeft) {
                    doc.line(colX, rowY, colX, rowY + gridRowH);
                }

                // ラベルテキスト描画 (中央寄せ)
                doc.setFontSize(8.5);
                doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                doc.text(label, colX + (labelW / 2), rowY + (gridRowH / 2) + 1.2, { align: 'center' });

                // データテキスト描画 (左寄せ、はみ出し防止切り詰め)
                doc.setFontSize(9.5);
                const safeVal = (value === null || value === undefined || value === '') ? '―' : String(value);
                const truncatedVal = utils.truncateText(doc, safeVal, valW - 3, 9.5);
                doc.text(truncatedVal, colX + labelW + 2, rowY + (gridRowH / 2) + 1.2);
            };

            // 住所・顧客名・フリガナ用特殊セル (1行ぶち抜き、フォント縮小対応)
            const drawGridFullWidthCell = (rowIdx, label, value) => {
                const rowY = gridYStart + (rowIdx * gridRowH);
                const labelW = 22;
                const valW = leftW - labelW;

                // ラベル背景
                doc.setFillColor(theme.LABEL_BG[0], theme.LABEL_BG[1], theme.LABEL_BG[2]);
                doc.rect(leftX, rowY, labelW, gridRowH, 'F');

                // 縦線
                doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
                doc.line(leftX + labelW, rowY, leftX + labelW, rowY + gridRowH);

                // ラベルテキスト描画
                doc.setFontSize(8.5);
                doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                doc.text(label, leftX + (labelW / 2), rowY + (gridRowH / 2) + 1.2, { align: 'center' });

                // データテキスト描画 (空値安全処理 & 動的縮小)
                const safeVal = (value === null || value === undefined || value === '') ? '―' : String(value);
                
                let currentFontSize = 9.5;
                doc.setFontSize(currentFontSize);
                const maxValW = valW - 3;

                // 横幅に収まるまで縮小 (最小7.0pt)
                while (doc.getTextWidth(safeVal) > maxValW && currentFontSize > 7.0) {
                    currentFontSize -= 0.5;
                    doc.setFontSize(currentFontSize);
                }

                const finalVal = utils.truncateText(doc, safeVal, maxValW, currentFontSize);
                
                // 既存のセルのY座標補正基準に統一
                const yOffset = (gridRowH / 2) + 1.2; 
                doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                doc.text(finalVal, leftX + labelW + 2, rowY + yOffset);
            };

            // 担当部署および担当者名解決
            // UT-015: 担当者未設定時の異常系考慮
            let staffName = 'ー';
            let deptName = 'ー';
            if (customer && customer.primary_staff_id) {
                const staff = staffMembers.find(s => Number(s.staff_id) === Number(customer.primary_staff_id));
                if (staff) {
                    staffName = staff.staff_name || 'ー';
                    deptName = staff.department || 'ー';
                }
            }

            // 顧客ID (UT-014: 顧客名空白・未設定考慮)
            const custIdStr = customer && customer.customer_id ? `CUST${String(customer.customer_id).padStart(6, '0')}` : '―';
            const custNameStr = customer ? (customer.customer_name || '―') : '―';

            // グリッド値書き込み
            drawGridCell(0, true, '顧客ID', custIdStr);
            drawGridCell(0, false, '代表者名', customer ? customer.representative_name : '');

            drawGridFullWidthCell(1, '顧客名', custNameStr);
            drawGridFullWidthCell(2, 'フリガナ', customer ? customer.customer_kana : '');

            // 住所は 郵便番号 + 住所 + ビル名
            let fullAddr = '';
            if (customer) {
                const zip = customer.postal_code ? `〒${customer.postal_code} ` : '';
                const addr = customer.address || '';
                const bld = customer.building_name ? ` ${customer.building_name}` : '';
                fullAddr = zip + addr + bld;
            }
            drawGridFullWidthCell(3, '住所', fullAddr);

            drawGridCell(4, true, '電話番号', customer ? customer.phone : '');
            drawGridCell(4, false, 'FAX番号', customer ? customer.fax : '');

            drawGridCell(5, true, 'メール', customer ? customer.email : '');
            drawGridCell(5, false, '担当者', staffName);

            drawGridCell(6, true, '担当部署', deptName);
            // 7行目右側は空き（斜線または空白）
            doc.setFillColor(theme.LIGHT_BG[0], theme.LIGHT_BG[1], theme.LIGHT_BG[2]);
            doc.rect(leftX + (leftW / 2), gridYStart + (6 * gridRowH), leftW / 2, gridRowH, 'F');
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.line(leftX + (leftW / 2), gridYStart + (6 * gridRowH), leftX + (leftW / 2), gridYStart + (7 * gridRowH));

            y += gridH + 8; // 余白を挟んで次のセクションへ

            // ==========================================
            // [左カラム] セクション2: 許認可 (主なもの)
            // ==========================================
            drawSectionTitle('■ 許認可（主なもの）', leftX, y, leftW);
            y += 5.5;

            // 許認可データのフィルタ & ソート & 抽出
            // 顧客IDに紐づく許認可
            const custLics = customer ? licenses.filter(l => Number(l.customer_id) === Number(customer.customer_id)) : [];
            
            // ソート: 有効な許認可 ＞ 期限接近順 ＞ 失効（期限切れ）の順
            custLics.sort((a, b) => {
                const now = new Date();
                const isExpiredA = a.status === '期限切れ' || (a.expiry_date && new Date(a.expiry_date) < now);
                const isExpiredB = b.status === '期限切れ' || (b.expiry_date && new Date(b.expiry_date) < now);
                
                if (isExpiredA !== isExpiredB) {
                    return isExpiredA ? 1 : -1; // 有効（false）が先、失効（true）が後
                }
                const da = a.expiry_date ? new Date(a.expiry_date) : new Date('9999-12-31');
                const db = b.expiry_date ? new Date(b.expiry_date) : new Date('9999-12-31');
                return da - db; // 期限が近い順（昇順）
            });

            // UT-002, UT-011: 最大5件抽出制限確認
            const displayLics = custLics.slice(0, 5);

            // テーブルヘッダーとボディの構築
            const licHeaders = [['許認可種別', '許認可番号', '取得年月日', '有効期限', '状態']];
            const licRows = displayLics.map(l => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                const typeName = type ? type.license_type_name : (l.license_type || '―');
                const licNum = utils.formatLicenseNumber(l);
                const acqStr = utils.formatDate(l.acquisition_date);
                const expStr = utils.formatDate(l.expiry_date);
                const status = utils.getLicenseStatus(l.expiry_date);
                return [typeName, licNum, acqStr, expStr, status];
            });

            // UT-006: 許認可0件時のフォールバック
            if (licRows.length === 0) {
                licRows.push([{ content: '許認可データはありません', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            // autoTable 実行 (左カラムの幅 160mm 内に描画)
            doc.autoTable({
                startY: y,
                margin: { left: leftX, right: this.pageW - (leftX + leftW) },
                head: licHeaders,
                body: licRows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8.5,
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
                    0: { cellWidth: 50 }, // 許認可種別
                    1: { cellWidth: 35 }, // 許認可番号
                    2: { cellWidth: 25, halign: 'center' }, // 取得年月日
                    3: { cellWidth: 25, halign: 'center' }, // 有効期限
                    4: { cellWidth: 25, halign: 'center' }  // 状態
                },
                didParseCell: function (data) {
                    // 状態列（4列目）の色分け
                    if (data.row.section === 'body' && data.column.index === 4) {
                        const val = data.cell.text[0];
                        if (val === '失効') {
                            data.cell.styles.textColor = theme.RED;
                            data.cell.styles.fontStyle = 'bold';
                        } else if (val === '期限接近') {
                            data.cell.styles.textColor = theme.ORANGE;
                            data.cell.styles.fontStyle = 'bold';
                        } else if (val === '有効') {
                            data.cell.styles.textColor = theme.GREEN;
                        }
                    }
                }
            });

            // ==========================================
            // [右カラム] セクション3: メモ欄 (二段構成)
            // ==========================================
            // 右カラム全体の境界Y: yStart から bottomLimitY まで (高さ 165mm)
            const rightStartY = yStart;
            const rightEndY = bottomLimitY;
            const rightH = rightEndY - rightStartY;

            const remarksH = 60; // システム備考枠の高さ
            const memoH = rightH - remarksH - 6; // 手書きメモ枠の高さ (隙間6mm空ける)

            // 3-1. 上段: システム備考
            drawSectionTitle('■ 備考・特記事項', rightX, rightStartY, rightW);
            const remarksBoxY = rightStartY + 5.5;
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.2);
            doc.rect(rightX, remarksBoxY, rightW, remarksH - 5.5);

            // システム備考の中身描画 (UT-009: 500文字などの長文折り返し対応)
            doc.setFontSize(8.5);
            doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
            
            const remarksText = customer && customer.remarks ? customer.remarks : '備考はありません。';
            // 枠内に収まるように折り返し行を生成 (横幅93mm、左右マージン2mm)
            const remarksLines = utils.splitTextToSize(doc, remarksText, rightW - 4, 8.5);
            
            let remarksY = remarksBoxY + 4;
            const remarksLineH = 4;
            const remarksMaxLines = Math.floor((remarksH - 5.5 - 6) / remarksLineH); // 枠内に収まる最大行数
            
            for (let i = 0; i < remarksLines.length; i++) {
                if (i >= remarksMaxLines - 1 && remarksLines.length > remarksMaxLines) {
                    // 最終行かつ超過時は「...」を付与して打ち切り
                    const lastLine = utils.truncateText(doc, remarksLines[i], rightW - 8, 8.5);
                    doc.text(lastLine, rightX + 2, remarksY);
                    break;
                }
                doc.text(remarksLines[i], rightX + 2, remarksY);
                remarksY += remarksLineH;
            }

            // 3-2. 下段: 手書きメモ欄
            const memoTitleY = rightStartY + remarksH + 1.5;
            drawSectionTitle('■ 手書きメモ欄', rightX, memoTitleY, rightW);
            
            const memoBoxY = memoTitleY + 5.5;
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.2);
            // 外枠四角形
            doc.rect(rightX, memoBoxY, rightW, memoH - 5.5);

            // 等間隔の罫線描画 (約8mm間隔)
            const lineGap = 8;
            const memoBoxRealH = memoH - 5.5;
            const lineCount = Math.floor((memoBoxRealH - 4) / lineGap);
            doc.setDrawColor(220, 225, 230); // 非常に薄いグレー
            doc.setLineWidth(0.15);

            for (let i = 1; i <= lineCount; i++) {
                const lineY = memoBoxY + (i * lineGap);
                doc.line(rightX + 1, lineY, rightX + rightW - 1, lineY);
            }

            // 1ページ目のフッター描画
            this.drawFooter(1, 2);

            // ==========================================
            // 2ページ目の描画
            // ==========================================
            y = this.addNewPage();

            // ==========================================
            // セクション4: 直近5件の案件履歴
            // ==========================================
            drawSectionTitle('■ 直近5件の案件履歴', this.marginL, y, this.contentW);
            y += 5.5;

            // 顧客IDに紐づく案件
            const queryId = customer ? Number(customer.customer_id) : 0;
            const custCases = customer ? cases.filter(c => Number(c.customer_id) === queryId) : [];

            // ソート: 案件登録日(created_at) ＞ なければ受任日(contract_date) の降順
            custCases.sort((a, b) => {
                const getTimestamp = (c) => {
                    if (!c) return 0;
                    const date = c.created_at || c.contract_date;
                    if (!date) return 0;
                    return date.toDate ? date.toDate().getTime() : new Date(date).getTime();
                };
                return getTimestamp(b) - getTimestamp(a);
            });

            // 直近5件抽出
            const displayCases = custCases.slice(0, 5);

            const caseHeaders = [['案件ID', '案件名 (許認可種別)', '業務区分 (手続名)', 'ステータス', '着手日 (受任日)', '完了日', '担当者']];
            const caseRows = displayCases.map(c => {
                const caseIdStr = c.case_id ? `CASE${String(c.case_id).padStart(6, '0')}` : '―';
                const startStr = utils.formatDate(c.contract_date);
                const complStr = utils.formatDate(c.completion_date);
                
                // 担当者名解決
                const fieldStaff = staffMembers.find(s => s.staff_id === Number(c.field_staff_id))?.staff_name || '―';
                const docStaff = staffMembers.find(s => s.staff_id === Number(c.document_staff_id))?.staff_name || '―';
                const staffStr = `${fieldStaff} / ${docStaff}`;

                return [
                    caseIdStr,
                    c.license_type || '―',
                    c.procedure_name || '―',
                    c.status || '―',
                    startStr,
                    complStr,
                    staffStr
                ];
            });

            // UT-007: 案件0件時のフォールバック
            if (caseRows.length === 0) {
                caseRows.push([{ content: '案件履歴データはありません', colSpan: 7, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            // 案件履歴テーブル描画
            doc.autoTable({
                startY: y,
                margin: { left: this.marginL, right: this.marginR },
                head: caseHeaders,
                body: caseRows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8.5,
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
                    0: { cellWidth: 25, halign: 'center' }, // 案件ID
                    1: { cellWidth: 55 },                   // 案件名
                    2: { cellWidth: 55 },                   // 業務区分
                    3: { cellWidth: 25, halign: 'center' }, // ステータス
                    4: { cellWidth: 30, halign: 'center' }, // 着手日
                    5: { cellWidth: 30, halign: 'center' }, // 完了日
                    6: { cellWidth: 47 }                    // 担当者
                }
            });

            y = doc.lastAutoTable.finalY + 8; // テーブル下から余白を挟む

            // ==========================================
            // セクション5: 最新対応履歴 (最新5件)
            // ==========================================
            drawSectionTitle('■ 最新対応履歴（最新5件）', this.marginL, y, this.contentW);
            y += 5.5;

            // 顧客IDに紐づく非論理削除の対応履歴
            const custHistories = customer ? histories.filter(h => Number(h.customer_id) === Number(customer.customer_id) && h.deleted_at === null) : [];

            // ソート: 対応日(response_date) の降順 (ロード時にソート済みだが、安全のため再ソート)
            custHistories.sort((a, b) => {
                const toMs = v => v ? (v.toDate ? v.toDate().getTime() : new Date(v).getTime()) : 0;
                return toMs(b.response_date) - toMs(a.response_date);
            });

            // UT-012: 最新5件抽出制限確認
            const displayHistories = custHistories.slice(0, 5);

            const histHeaders = [['対応日時', '対応者', '区分', '件名', '対応内容 (要約)']];
            const histRows = displayHistories.map(h => {
                // 日時は YYYY/MM/DD HH:mm 形式
                let dateStr = '―';
                if (h.response_date) {
                    const d = h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date);
                    if (d && !isNaN(d.getTime())) {
                        const year = d.getFullYear();
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        const hour = String(d.getHours()).padStart(2, '0');
                        const minute = String(d.getMinutes()).padStart(2, '0');
                        dateStr = `${year}/${month}/${day} ${hour}:${minute}`;
                    }
                }

                // 内容要約 (1行に収まるように切り詰め、改行はスペース変換)
                let contentSummary = h.content || '―';
                contentSummary = contentSummary.replace(/\r?\n/g, ' ');

                return [
                    dateStr,
                    h.created_by_name || '―',
                    h.history_type || '―',
                    h.subject || '―',
                    contentSummary
                ];
            });

            // UT-004: 対応履歴0件時のフォールバック
            if (histRows.length === 0) {
                histRows.push([{ content: '対応履歴データはありません', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            // 対応履歴テーブル描画
            doc.autoTable({
                startY: y,
                margin: { left: this.marginL, right: this.marginR },
                head: histHeaders,
                body: histRows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8.5,
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
                    0: { cellWidth: 32, halign: 'center' }, // 対応日時
                    1: { cellWidth: 25, halign: 'center' }, // 対応者
                    2: { cellWidth: 20, halign: 'center' }, // 区分
                    3: { cellWidth: 60 },                   // 件名
                    4: { cellWidth: 130 }                   // 対応内容
                },
                didDrawCell: function (data) {
                    // 対応内容セルのはみ出し防止切り詰め
                    if (data.row.section === 'body' && data.column.index === 4) {
                        const cellText = data.cell.text[0];
                        const cellWidth = data.column.width;
                        const truncated = utils.truncateText(doc, cellText, cellWidth - 4, 8.5);
                        data.cell.text[0] = truncated;
                    }
                }
            });

            // 2ページ目のフッター描画
            this.drawFooter(2, 2);
        }
    }

    window.CustomerSummaryReport = CustomerSummaryReport;
})();
