/**
 * 顧客カルテPDF (CustomerCarteReport)
 * 
 * 担当者向けメイン帳票: 画面（概要タブ）の見慣れた情報構造を忠実に紙（A4縦）へ再現。
 * サマリー開発の成果（状態サマリー帯、要対応事項、期限警告）を統合したハイブリッドカルテ。
 * 可変ページ対応（許認可は全件表示、案件・履歴は直近表示）。
 */
(function () {
    'use strict';

    const RECENT_CASE_LIMIT = 10;  // 案件は履歴データ → 概要帳票として直近10件に制限
    const RECENT_HISTORY_LIMIT = 5;
    const LICENSE_EXPIRY_WARNING_DAYS = 90;

    class CustomerCarteReport extends window.BaseReport {
        constructor() {
            super();
        }

        /**
         * 顧客カルテ PDF を生成する
         */
        async generate(customer, licenses, cases, histories, staffMembers, licenseTypes, dispData, governmentOffices) {
            await this.init({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const doc = this.doc;
            const theme = window.ReportUtils.THEME;
            const utils = window.ReportUtils;
            const contentW = this.pageW - this.marginL - this.marginR; // 180mm

            // 安全なフォールバック
            const custLicenses = Array.isArray(licenses) ? licenses : [];
            const custCases = Array.isArray(cases) ? cases : [];
            const custHistories = Array.isArray(histories) ? histories : [];
            licenseTypes = Array.isArray(licenseTypes) ? licenseTypes : [];
            staffMembers = Array.isArray(staffMembers) ? staffMembers : [];
            dispData = dispData || {};
            governmentOffices = Array.isArray(governmentOffices) ? governmentOffices : [];

            // 顧客基本情報
            const custName = customer ? (customer.customer_name || '名称未設定') : '名称未設定';
            const custIdStr = customer ? (customer.customer_id != null ? String(customer.customer_id) : '―') : '―';

            // 進行中案件（ステータスが「完了」「取下げ」以外）
            const activeCases = custCases.filter(c => c.status !== '完了' && c.status !== '取下げ');

            // 案件ソート（受任日降順）
            const allCasesSorted = [...custCases].sort((a, b) => {
                const toMs = v => {
                    if (!v) return 0;
                    const date = v.contract_date || v.created_at;
                    if (!date) return 0;
                    return date.toDate ? date.toDate().getTime() : new Date(date).getTime();
                };
                return toMs(b) - toMs(a);
            });

            // 対応履歴ソート（対応日降順）
            custHistories.sort((a, b) => {
                const toMs = v => v ? (v.toDate ? v.toDate().getTime() : new Date(v).getTime()) : 0;
                return toMs(b.response_date) - toMs(a.response_date);
            });

            // 期限接近許認可（要対応事項用）
            const warningLicenses = custLicenses.filter(l => {
                const days = utils.calculateRemainingDays(l.expiry_date);
                return days !== null && days >= 0 && days <= LICENSE_EXPIRY_WARNING_DAYS;
            });

            // 要対応事項の構築
            const actionItems = this._buildActionItems(activeCases, warningLicenses, licenseTypes, governmentOffices, utils);

            // 最終接触日
            const lastContactDate = custHistories.length > 0
                ? utils.formatDate(custHistories[0].response_date)
                : '未記録';

            // =========================================================
            //  1ページ目: 顧客理解（基本属性・要対応・メモ・直近対応履歴）
            // =========================================================
            let y = this._drawCarteHeader(doc, theme, utils, custName, custIdStr, customer, dispData);

            // ── 状態サマリー帯 ──
            y = this._drawStatusBand(doc, theme, y, contentW, {
                customerType: customer ? (customer.customer_type || '―') : '―',
                licenseCount: custLicenses.length,
                activeCaseCount: activeCases.length,
                actionItemCount: actionItems.length,
                lastContactDate: lastContactDate
            });

            // ── 要対応事項 ──
            y = this._drawActionItems(doc, theme, utils, y, contentW, actionItems);

            // ── 基本情報（概要タブ全15項目完全網羅） ──
            y = this._drawBasicInfoTable(doc, theme, utils, y, contentW, customer, dispData);

            // ── メモ・特記事項 ──
            y = this._drawRemarks(doc, theme, utils, y, contentW, customer);

            // ── 直近の対応履歴（顧客理解の情報として1ページ目へ統合） ──
            y = this._drawHistoryList(doc, theme, utils, y, contentW, custHistories);

            // =========================================================
            //  2ページ目以降: 業務情報（保有許認可・直近案件）
            // =========================================================
            doc.addPage();
            y = this._drawSubHeader(doc, theme, custName, '保有許認可・直近案件');

            // ── 保有許認可（全件表示） ──
            y = this._drawLicenseTable(doc, theme, utils, y, contentW, custLicenses, licenseTypes, governmentOffices);

            // ── 直近の案件 ──
            y = this._drawCaseTable(doc, theme, utils, y, contentW, allCasesSorted, staffMembers, governmentOffices);

            // =========================================================
            //  全ページのフッター（総ページ数自動判定）
            // =========================================================
            const totalPages = doc.internal.getNumberOfPages();
            for (let p = 1; p <= totalPages; p++) {
                doc.setPage(p);
                this.drawFooter(p, totalPages);
            }

            return doc;
        }

        // =========================================================
        //  Private: ヘッダー描画 (1ページ目)
        // =========================================================
        _drawCarteHeader(doc, theme, utils, custName, custIdStr, customer, dispData) {
            const leftX = this.marginL;
            const rightX = this.pageW - this.marginR;
            let y = this.marginT;

            // 帳票カテゴリ・タイトル
            doc.setFontSize(8);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            doc.text('LAPIS3 顧客管理システム', leftX, y);

            // 出力日時・出力者
            const now = new Date();
            const nowStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            let staffName = '―';
            try {
                const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                if (session.staff_name) staffName = session.staff_name;
            } catch (e) { }
            doc.text(`出力: ${nowStr} / ${staffName}`, rightX, y, { align: 'right' });

            y += 5;

            // メインタイトル
            doc.setFontSize(14);
            doc.setTextColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.text('顧客カルテ', leftX, y);
            doc.setLineWidth(0.2);
            doc.text('顧客カルテ', leftX, y, { renderingMode: 'fillThenStroke' });

            doc.setFontSize(9);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            doc.text('Customer Carte', leftX + 28, y);

            y += 6;

            // 顧客名（特大）
            doc.setFontSize(16);
            doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
            const maxNameW = this.pageW - this.marginL - this.marginR - 55; // 右側メタ情報用の余白
            const nameLines = utils.splitTextToSize(doc, custName, maxNameW, 16);

            let nameY = y + 2;
            for (let i = 0; i < nameLines.length && i < 2; i++) {
                doc.text(nameLines[i], leftX, nameY);
                doc.setLineWidth(0.15);
                doc.text(nameLines[i], leftX, nameY, { renderingMode: 'fillThenStroke' });
                nameY += 6.5;
            }

            // 右側メタ情報（顧客コード、法人番号）
            doc.setFontSize(8.5);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            doc.text(`顧客コード: ${custIdStr}`, rightX, y + 1, { align: 'right' });
            const corpNum = (customer && customer.corporate_number) ? customer.corporate_number : '―';
            doc.text(`法人番号: ${corpNum}`, rightX, y + 6, { align: 'right' });

            y = Math.max(nameY, y + 10) + 1;

            // タイトル下アクセントバー
            doc.setDrawColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.setLineWidth(0.8);
            doc.line(leftX, y, rightX, y);
            y += 4;

            return y;
        }

        // =========================================================
        //  Private: 状態サマリー帯
        // =========================================================
        _drawStatusBand(doc, theme, y, contentW, data) {
            const leftX = this.marginL;
            const bandH = 15;
            const bandW = contentW;

            // 背景
            doc.setFillColor(240, 244, 250);
            doc.setDrawColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.setLineWidth(0.3);
            doc.roundedRect(leftX, y, bandW, bandH, 1.5, 1.5, 'FD');

            const cols = [
                { label: '顧客区分', value: data.customerType },
                { label: '許認可', value: `${data.licenseCount} 件` },
                { label: '進行中案件', value: `${data.activeCaseCount} 件` },
                { label: '要対応', value: `${data.actionItemCount} 件`, highlight: data.actionItemCount > 0 },
                { label: '最終接触', value: data.lastContactDate }
            ];

            const colW = bandW / cols.length;
            const centerY = y + bandH / 2;

            cols.forEach((col, i) => {
                const cx = leftX + (i * colW) + (colW / 2);

                doc.setFontSize(7.5);
                doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
                doc.text(col.label, cx, centerY - 2.5, { align: 'center' });

                doc.setFontSize(10.5);
                if (col.highlight) {
                    doc.setTextColor(theme.RED[0], theme.RED[1], theme.RED[2]);
                } else {
                    doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                }
                doc.text(col.value, cx, centerY + 4, { align: 'center' });
                doc.setLineWidth(0.1);
                doc.text(col.value, cx, centerY + 4, { align: 'center', renderingMode: 'fillThenStroke' });

                if (i < cols.length - 1) {
                    doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
                    doc.setLineWidth(0.15);
                    doc.line(leftX + ((i + 1) * colW), y + 2.5, leftX + ((i + 1) * colW), y + bandH - 2.5);
                }
            });

            return y + bandH + 5;
        }

        // =========================================================
        //  Private: 要対応事項セクション描画
        // =========================================================
        _drawActionItems(doc, theme, utils, y, contentW, actionItems) {
            const leftX = this.marginL;
            this._drawSectionTitle(doc, theme, `■ 要対応事項（${actionItems.length}件）`, leftX, y, contentW);
            y += 5;

            if (actionItems.length === 0) {
                doc.setFontSize(8.5);
                doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
                doc.text('現在、要対応の事項はありません。', leftX + 3, y + 2.5);
                return y + 7;
            }

            const headers = [['期限', '残日数', '対応内容', '区分']];
            const rows = actionItems.map(item => {
                const daysStr = item.daysLeft !== null ? `${item.daysLeft}日` : '―';
                return [item.dateStr, daysStr, item.description, item.source];
            });

            doc.autoTable({
                startY: y,
                margin: { left: leftX, right: this.marginR },
                head: headers,
                body: rows,
                theme: 'striped',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8,
                    cellPadding: 1.6,
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
                    0: { cellWidth: 26, halign: 'center' },
                    1: { cellWidth: 18, halign: 'center' },
                    2: { cellWidth: 'auto' },
                    3: { cellWidth: 20, halign: 'center' }
                },
                didParseCell: (data) => {
                    if (data.row.section === 'body') {
                        if (data.column.index === 1) {
                            const item = actionItems[data.row.index];
                            if (item && item.urgent) {
                                data.cell.styles.textColor = theme.RED;
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                        if (data.column.index === 3) {
                            const val = data.cell.text[0];
                            if (val === '許認可') {
                                data.cell.styles.textColor = theme.ORANGE;
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                }
            });

            return doc.lastAutoTable.finalY + 5;
        }

        // =========================================================
        //  Private: 基本情報テーブル（概要タブ全15項目完全網羅）
        // =========================================================
        _drawBasicInfoTable(doc, theme, utils, y, contentW, customer, dispData) {
            const leftX = this.marginL;
            this._drawSectionTitle(doc, theme, '■ 基本情報', leftX, y, contentW);
            y += 5;

            const rowH = 6;
            // 4列レイアウト: ラベル1(24mm) : 値1(66mm) : ラベル2(24mm) : 値2(66mm) = 180mm
            const lW1 = 24;
            const vW1 = 66;
            const lW2 = 24;
            const vW2 = 66;
            const col2X = leftX + lW1 + vW1;

            const drawTwoCells = (rowY, l1, v1, l2, v2) => {
                // 左セル
                doc.setFillColor(theme.LABEL_BG[0], theme.LABEL_BG[1], theme.LABEL_BG[2]);
                doc.rect(leftX, rowY, lW1, rowH, 'F');
                doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
                doc.setLineWidth(0.12);
                doc.rect(leftX, rowY, lW1 + vW1, rowH);
                doc.line(leftX + lW1, rowY, leftX + lW1, rowY + rowH);

                doc.setFontSize(7.5);
                doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                doc.text(l1, leftX + lW1 / 2, rowY + rowH / 2 + 0.8, { align: 'center' });

                doc.setFontSize(8);
                const safeV1 = (v1 === null || v1 === undefined || v1 === '') ? '―' : String(v1);
                doc.text(utils.truncateText(doc, safeV1, vW1 - 3, 8), leftX + lW1 + 1.5, rowY + rowH / 2 + 0.8);

                // 右セル
                doc.setFillColor(theme.LABEL_BG[0], theme.LABEL_BG[1], theme.LABEL_BG[2]);
                doc.rect(col2X, rowY, lW2, rowH, 'F');
                doc.rect(col2X, rowY, lW2 + vW2, rowH);
                doc.line(col2X + lW2, rowY, col2X + lW2, rowY + rowH);

                doc.setFontSize(7.5);
                doc.text(l2, col2X + lW2 / 2, rowY + rowH / 2 + 0.8, { align: 'center' });

                doc.setFontSize(8);
                const safeV2 = (v2 === null || v2 === undefined || v2 === '') ? '―' : String(v2);
                doc.text(utils.truncateText(doc, safeV2, vW2 - 3, 8), col2X + lW2 + 1.5, rowY + rowH / 2 + 0.8);
            };

            const drawFullCell = (rowY, label, val) => {
                const labelW = lW1;
                const valW = contentW - labelW;

                doc.setFillColor(theme.LABEL_BG[0], theme.LABEL_BG[1], theme.LABEL_BG[2]);
                doc.rect(leftX, rowY, labelW, rowH, 'F');
                doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
                doc.setLineWidth(0.12);
                doc.rect(leftX, rowY, contentW, rowH);
                doc.line(leftX + labelW, rowY, leftX + labelW, rowY + rowH);

                doc.setFontSize(7.5);
                doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
                doc.text(label, leftX + labelW / 2, rowY + rowH / 2 + 0.8, { align: 'center' });

                doc.setFontSize(8);
                const safeVal = (val === null || val === undefined || val === '') ? '―' : String(val);
                doc.text(utils.truncateText(doc, safeVal, valW - 3, 8), leftX + labelW + 1.5, rowY + rowH / 2 + 0.8);
            };

            // 住所文字列生成
            let rawAddr = '';
            if (customer) {
                const addr = customer.address || '';
                const bld = customer.building_name ? ` ${customer.building_name}` : '';
                const zip = customer.postal_code ? `〒${customer.postal_code} ` : '';
                rawAddr = zip + addr + bld;
            }

            // 行1: フリガナ（全幅）
            drawFullCell(y, 'フリガナ', customer ? customer.customer_kana : '');
            y += rowH;

            // 行2: 郵便番号 / 法人番号
            drawTwoCells(y, '郵便番号', customer ? customer.postal_code : '', '法人番号', customer ? customer.corporate_number : '');
            y += rowH;

            // 行3: 所在地（全幅）
            drawFullCell(y, '所在地', rawAddr || '―');
            y += rowH;

            // 行4: 代表者名 / 顧客区分
            drawTwoCells(y, '代表者名', customer ? customer.representative_name : '', '顧客区分', customer ? customer.customer_type : '');
            y += rowH;

            // 行5: 資本金 / 設立日
            drawTwoCells(y, '資本金', dispData.capitalStr, '設立日', dispData.foundedDate);
            y += rowH;

            // 行6: 決算期 / 外務担当者
            drawTwoCells(y, '決算期', dispData.fiscalStr, '外務担当者', dispData.salesStaffName);
            y += rowH;

            // 行7: 電話番号 / FAX番号
            drawTwoCells(y, '電話番号', customer ? customer.phone : '', 'FAX番号', customer ? customer.fax : '');
            y += rowH;

            // 行8: メールアドレス（全幅）
            drawFullCell(y, 'メールアドレス', customer ? customer.email : '');
            y += rowH;

            // 行9: 主担当者 / 所属拠点
            drawTwoCells(y, '主担当者', dispData.primaryContactName, '所属拠点', dispData.primaryOfficeName);
            y += rowH;

            // 行10: 担当メール（全幅）
            drawFullCell(y, '担当メール', dispData.primaryEmail);
            y += rowH + 5;

            return y;
        }

        _drawRemarks(doc, theme, utils, y, contentW, customer) {
            const leftX = this.marginL;
            this._drawSectionTitle(doc, theme, '■ メモ・特記事項', leftX, y, contentW);
            y += 4.5;

            const remarksText = customer && customer.remarks ? customer.remarks : '特記事項はありません。';
            const lines = utils.splitTextToSize(doc, remarksText, contentW - 4, 8);
            const lineH = 4.0;
            // 内容行数に応じて最小16mm〜最大24mmで最適化（短文時は余白を抑え、後続の対応履歴エリアを確保）
            const boxH = Math.max(16, Math.min(24, (lines.length * lineH) + 5));

            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.15);
            doc.rect(leftX, y, contentW, boxH);

            doc.setFontSize(8);
            doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
            const maxLines = Math.floor((boxH - 3) / lineH);

            let textY = y + 3.8;
            for (let i = 0; i < lines.length && i < maxLines; i++) {
                if (i === maxLines - 1 && lines.length > maxLines) {
                    const lastLine = utils.truncateText(doc, lines[i], contentW - 8, 8);
                    doc.text(lastLine, leftX + 2, textY);
                } else {
                    doc.text(lines[i], leftX + 2, textY);
                }
                textY += lineH;
            }

            if (lines.length > maxLines) {
                doc.setFontSize(7);
                doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
                doc.text(`※長文のため一部省略（全${lines.length}行中${maxLines}行表示・詳細は画面をご確認ください）`, leftX + contentW - 2, y + boxH - 1.5, { align: 'right' });
            }

            return y + boxH + 4.5;
        }

        // =========================================================
        //  Private: 2ページ目以降のヘッダー
        // =========================================================
        _drawSubHeader(doc, theme, custName, pageTitle) {
            const leftX = this.marginL;
            const rightX = this.pageW - this.marginR;
            let y = this.marginT;

            doc.setFontSize(8);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            doc.text(`顧客カルテ / ${custName}`, leftX, y);
            doc.text(pageTitle, rightX, y, { align: 'right' });

            y += 2.5;
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.2);
            doc.line(leftX, y, rightX, y);
            y += 4;

            return y;
        }

        // =========================================================
        //  Private: 保有許認可（全件表示・可変長）
        // =========================================================
        _drawLicenseTable(doc, theme, utils, y, contentW, custLicenses, licenseTypes, governmentOffices) {
            const leftX = this.marginL;

            // 期限リスク順ソート: 期限切れ → 期限接近 → 有効
            const sorted = [...custLicenses].sort((a, b) => {
                const now = new Date();
                const isExpiredA = a.status === '期限切れ' || (a.expiry_date && new Date(a.expiry_date) < now);
                const isExpiredB = b.status === '期限切れ' || (b.expiry_date && new Date(b.expiry_date) < now);
                if (isExpiredA !== isExpiredB) return isExpiredA ? 1 : -1;
                const da = a.expiry_date ? new Date(a.expiry_date) : new Date('9999-12-31');
                const db = b.expiry_date ? new Date(b.expiry_date) : new Date('9999-12-31');
                return da - db;
            });

            this._drawSectionTitle(doc, theme, `■ 保有許認可（全${custLicenses.length}件）`, leftX, y, contentW);
            y += 4.5;

            const getOfficeName = (license) => {
                if (!license) return '';
                if (license.government_office_id) {
                    const office = governmentOffices.find(o => Number(o.office_id) === Number(license.government_office_id));
                    if (office) return office.office_name;
                }
                return license.government_office || '';
            };

            const headers = [['許認可種別 / 管轄官庁', '許可番号', '開始日', '有効期限', '状態']];
            const rows = sorted.map(l => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                const typeName = type ? type.license_type_name : (l.license_type || '―');
                const officeName = getOfficeName(l);
                const dispTypeName = officeName ? `${typeName} (${officeName})` : typeName;
                const licNum = utils.formatLicenseNumber(l);
                const startStr = utils.formatDate(l.start_date);
                const expStr = utils.formatDate(l.expiry_date);
                const status = utils.getLicenseStatus(l.expiry_date);
                return [dispTypeName, licNum, startStr, expStr, status];
            });

            if (rows.length === 0) {
                rows.push([{ content: '保有許認可データはありません', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            doc.autoTable({
                startY: y,
                margin: { left: leftX, right: this.marginR },
                head: headers,
                body: rows,
                theme: 'striped',
                pageBreak: 'auto',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8,
                    cellPadding: 1.6,
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
                    0: { cellWidth: 62 },
                    1: { cellWidth: 38, halign: 'center' },
                    2: { cellWidth: 26, halign: 'center' },
                    3: { cellWidth: 26, halign: 'center' },
                    4: { cellWidth: 28, halign: 'center' }
                },
                didParseCell: (data) => {
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

            return doc.lastAutoTable.finalY + 5;
        }

        // =========================================================
        //  Private: 直近の案件（直近10件・概要タブ準拠）
        //  案件は履歴データのため概要帳票では直近10件に制限。
        //  許認可で領域不足の場合は pageBreak: 'auto' で自動改ページ。
        // =========================================================
        _drawCaseTable(doc, theme, utils, y, contentW, allCasesSorted, staffMembers, governmentOffices) {
            const leftX = this.marginL;
            const displayCases = allCasesSorted.slice(0, RECENT_CASE_LIMIT);
            const title = allCasesSorted.length > RECENT_CASE_LIMIT
                ? `■ 直近の案件（全${allCasesSorted.length}件中 直近${displayCases.length}件）`
                : `■ 直近の案件（${displayCases.length}件）`;

            this._drawSectionTitle(doc, theme, title, leftX, y, contentW);
            y += 4.5;

            const getOfficeName = (c) => {
                if (!c) return '';
                if (c.government_office_id) {
                    const office = governmentOffices.find(o => Number(o.office_id) === Number(c.government_office_id));
                    if (office) return office.office_name;
                }
                return c.government_office || '';
            };

            const headers = [['案件名 / 管轄官庁', 'ステータス', '受任日', '見積合計（税込）', '完了日']];
            const rows = displayCases.map(c => {
                const officeName = getOfficeName(c);
                const caseName = c.license_type || c.procedure_name || '―';
                const dispCaseName = officeName ? `${caseName} (${officeName})` : caseName;

                const startStr = utils.formatDate(c.contract_date);
                const complStr = utils.formatDate(c.completion_date);

                // 見積合計
                let totalEstimate;
                if (c.total_amount !== undefined && c.total_amount !== null && c.total_amount !== '') {
                    totalEstimate = Number(c.total_amount);
                } else {
                    const taxable = Number(c.estimated_fee || 0);
                    const tax = Math.floor(taxable * 0.1);
                    const nontaxable = Number(c.suspense_receipt_amount || 0);
                    totalEstimate = taxable + tax + nontaxable;
                }
                const feeStr = totalEstimate > 0 ? `${totalEstimate.toLocaleString()} 円` : '―';

                return [dispCaseName, c.status || '―', startStr, feeStr, complStr];
            });

            if (rows.length === 0) {
                rows.push([{ content: '案件データはありません', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            doc.autoTable({
                startY: y,
                margin: { left: leftX, right: this.marginR },
                head: headers,
                body: rows,
                theme: 'striped',
                pageBreak: 'auto',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8,
                    cellPadding: 1.6,
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
                    0: { cellWidth: 62 },
                    1: { cellWidth: 24, halign: 'center' },
                    2: { cellWidth: 26, halign: 'center' },
                    3: { cellWidth: 38, halign: 'right' },
                    4: { cellWidth: 30, halign: 'center' }
                }
            });

            let finalY = doc.lastAutoTable.finalY;
            if (allCasesSorted.length > RECENT_CASE_LIMIT) {
                const remaining = allCasesSorted.length - RECENT_CASE_LIMIT;
                doc.setFontSize(7.5);
                doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
                doc.text(`※ 他 ${remaining}件の案件があります（全件は案件一覧にて確認可能）`, leftX + contentW, finalY + 3.5, { align: 'right' });
                finalY += 4;
            }

            return finalY + 5;
        }

        // =========================================================
        //  Private: 直近の対応履歴（直近5件・1〜2行表示）
        // =========================================================
        _drawHistoryList(doc, theme, utils, y, contentW, custHistories) {
            const leftX = this.marginL;
            const displayHistories = custHistories.slice(0, RECENT_HISTORY_LIMIT);
            const title = custHistories.length > RECENT_HISTORY_LIMIT
                ? `■ 直近の対応履歴（全${custHistories.length}件中 直近${displayHistories.length}件）`
                : `■ 直近の対応履歴（${displayHistories.length}件）`;

            this._drawSectionTitle(doc, theme, title, leftX, y, contentW);
            y += 4.5;

            const headers = [['対応日時', '区分', '担当者', '件名 / 内容']];
            const rows = displayHistories.map(h => {
                let dateStr = '―';
                if (h.response_date) {
                    const d = h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date);
                    if (d && !isNaN(d.getTime())) {
                        dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    }
                }

                const author = h.created_by_name || '―';
                const subject = h.subject ? `【${h.subject}】` : '';
                let rawContent = h.content || '';
                rawContent = rawContent.replace(/\r?\n/g, ' ').trim();
                // 1〜2行で収まるよう70文字程度で簡潔に
                const summary = rawContent.length > 70 ? rawContent.substring(0, 68) + '…' : rawContent;
                const combined = subject ? `${subject} ${summary}` : (summary || '―');

                return [dateStr, h.history_type || '―', author, combined];
            });

            if (rows.length === 0) {
                rows.push([{ content: '対応履歴データはありません', colSpan: 4, styles: { halign: 'center', fontStyle: 'italic', textColor: theme.TEXT_MUTED } }]);
            }

            doc.autoTable({
                startY: y,
                margin: { left: leftX, right: this.marginR },
                head: headers,
                body: rows,
                theme: 'striped',
                pageBreak: 'avoid',
                styles: {
                    font: 'NotoSansJP',
                    fontSize: 8,
                    cellPadding: 1.4,
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
                    0: { cellWidth: 28, halign: 'center' },
                    1: { cellWidth: 16, halign: 'center' },
                    2: { cellWidth: 22, halign: 'center' },
                    3: { cellWidth: 'auto' }
                }
            });

            let finalY = doc.lastAutoTable.finalY;
            if (custHistories.length > RECENT_HISTORY_LIMIT) {
                const remaining = custHistories.length - RECENT_HISTORY_LIMIT;
                doc.setFontSize(7.5);
                doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
                doc.text(`※ 他 ${remaining}件の対応履歴があります（全件は履歴一覧にて確認可能）`, leftX + contentW, finalY + 3.5, { align: 'right' });
                finalY += 4;
            }

            return finalY + 5;
        }

        // =========================================================
        //  Private: 要対応事項の構築
        // =========================================================
        _buildActionItems(activeCases, warningLicenses, licenseTypes, governmentOffices, utils) {
            const items = [];

            // 案件由来: 未完了で期限がある案件
            activeCases.forEach(c => {
                const deadline = c.deadline || c.due_date || null;
                if (deadline) {
                    const dateStr = utils.formatDate(deadline);
                    const daysLeft = utils.calculateRemainingDays(deadline);
                    items.push({
                        date: deadline,
                        dateStr: dateStr,
                        daysLeft: daysLeft,
                        description: `案件対応: ${c.license_type || c.procedure_name || '案件'} (期日: ${dateStr})`,
                        source: '案件',
                        urgent: daysLeft !== null && daysLeft <= 30
                    });
                }
            });

            // 許認可由来: 期限接近 (<= 90日)
            warningLicenses.forEach(l => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                const typeName = type ? type.license_type_name : (l.license_type || '許認可');
                const dateStr = utils.formatDate(l.expiry_date);
                const daysLeft = utils.calculateRemainingDays(l.expiry_date);
                let desc = `更新期限接近: ${typeName}`;
                if (daysLeft !== null) {
                    desc += ` (残り${daysLeft}日)`;
                }
                items.push({
                    date: l.expiry_date,
                    dateStr: dateStr,
                    daysLeft: daysLeft,
                    description: desc,
                    source: '許認可',
                    urgent: daysLeft !== null && daysLeft <= 30
                });
            });

            // 期限昇順ソート（近い順）
            items.sort((a, b) => {
                const da = a.daysLeft !== null ? a.daysLeft : 9999;
                const db = b.daysLeft !== null ? b.daysLeft : 9999;
                return da - db;
            });

            return items;
        }

        // =========================================================
        //  Private: セクション見出し
        // =========================================================
        _drawSectionTitle(doc, theme, title, x, y, width) {
            doc.setFontSize(9.5);
            doc.setTextColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.text(title, x, y);
            doc.setLineWidth(0.15);
            doc.text(title, x, y, { renderingMode: 'fillThenStroke' });

            doc.setDrawColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.setLineWidth(0.4);
            doc.line(x, y + 1.5, x + width, y + 1.5);
        }
    }

    window.CustomerCarteReport = CustomerCarteReport;
})();
