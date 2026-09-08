/**
 * 書類返却通知書 帳票クラス (Document Return Report)
 * 高コントラスト・高視認性・長文自動折り返し・ポップな明瞭デザインを適用したPDF生成処理を実装します。
 */

(function () {
    'use strict';

    // 返却物コード定義マスタ
    const RETURN_ITEM_TYPES = {
        permit_notice: "許可通知書",
        copy:          "副本",
        invoice:       "請求書",
        other:         "その他"
    };

    // 返却方法マッピング定義
    const DELIVERY_METHODS = {
        takkyubin:        { name: "宅急便",           hasTracking: true,  hasArrival: true },
        letterpack_plus:  { name: "レターパックプラス", hasTracking: true,  hasArrival: true },
        letterpack_light: { name: "レターパックライト", hasTracking: true,  hasArrival: true },
        kani_kakitome:    { name: "簡易書留",         hasTracking: true,  hasArrival: true },
        ordinary_mail:    { name: "普通郵便",         hasTracking: false, hasArrival: false },
        hand_delivery:    { name: "直接手渡し",       hasTracking: false, hasArrival: false },
        other:            { name: "その他",           hasTracking: true,  hasArrival: true }
    };

    class DocumentReturnReport extends window.BaseReport {
        constructor() {
            super('書類返却通知書');
        }

        /**
         * 日付文字列 (YYYY-MM-DD or YYYY/MM/DD) を "M月D日" 形式にフォーマットする
         */
        formatMonthDay(dateStr) {
            if (!dateStr) return '';
            const normalized = String(dateStr).replace(/-/g, '/');
            const parts = normalized.split('/');
            if (parts.length >= 3) {
                const month = parseInt(parts[1], 10);
                const day = parseInt(parts[2], 10);
                return `${month}月${day}日`;
            }
            return dateStr;
        }

        /**
         * 書類返却通知書 PDF を生成する
         * @param {Object} customer - 顧客情報
         * @param {Object} record - 書類返却レコード
         * @param {Object} officeInfo - 自事務所情報
         */
        async generate(customer, record, officeInfo = null) {
            // 1. PDFの初期化 (A4縦, Portrait)
            await this.init({ orientation: 'portrait' });
            const doc = this.doc;
            const utils = window.ReportUtils;

            const leftX = this.marginL; // 15mm
            const rightX = this.pageW - this.marginR; // 195mm
            const contentWidth = this.contentW; // 180mm

            // デフォルト事務所情報
            const office = officeInfo || {
                name: '行政書士 中村事務所',
                postalCode: '〒160-0023',
                address: '東京都新宿区西新宿7-19-7-402',
                tel: '03-5386-3001',
                fax: '03-5386-3002'
            };

            let y = 16;

            // ==========================================
            // 右上肩書き (書類返却通知書)
            // ==========================================
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139); // スレートグレー
            doc.text('［書類返却通知書］', rightX, y, { align: 'right' });
            y += 6;

            // 返却方法情報の取得
            const methodKey = record ? (record.deliveryMethod || record.delivery_method) : 'takkyubin';
            const methodInfo = DELIVERY_METHODS[methodKey] || DELIVERY_METHODS.other;
            let methodName = methodInfo.name;
            if (methodKey === 'other' && record) {
                const otherVal = record.deliveryMethodOther || record.delivery_method_other;
                if (otherVal) methodName = otherVal;
            }

            // ==========================================
            // 1. 主見出し「書類を発送いたしました」ヘッダー帯 (鮮明な純白文字 & ネイビー背景)
            // ==========================================
            const bannerY = y;
            const bannerH = 15;
            doc.setFillColor(30, 64, 175); // 鮮やかなロイヤルブルー (#1e40af)
            doc.rect(leftX, bannerY, contentWidth, bannerH, 'F');

            const headerTitle = methodKey === 'hand_delivery' 
                ? '書類をお手渡し致しました'
                : `書類を発送致しました (${methodName})`;

            doc.setFontSize(20);
            doc.setTextColor(255, 255, 255); // 純白
            doc.text(headerTitle, this.pageW / 2, bannerY + 10, { align: 'center' });

            y += bannerH + 10;

            // ==========================================
            // 2. 送信先 (宛先 19pt 大文字太字) & 自事務所情報
            // ==========================================
            const recipientY = y;
            
            // 宛先 (左側)
            const rawCustomerName = (customer && customer.customer_name) ? customer.customer_name : 'お客様';
            const hasContact = customer && customer.contact_name && customer.contact_name.trim() !== '';
            
            doc.setTextColor(15, 23, 42); // 濃い黒 (#0f172a)
            
            if (hasContact) {
                const titleFontSize = rawCustomerName.length > 25 ? 16 : rawCustomerName.length > 20 ? 17 : 18;
                doc.setFontSize(titleFontSize);
                doc.text(rawCustomerName, leftX, y);
                y += 8.5;
                
                const contactName = `${customer.contact_name} 様`;
                const contactFontSize = contactName.length > 25 ? 16 : contactName.length > 20 ? 17 : 18;
                doc.setFontSize(contactFontSize);
                doc.text(contactName, leftX, y);
                y += 8.5;
            } else {
                const customerNameText = `${rawCustomerName} 御中`;
                const textFontSize = customerNameText.length > 25 ? 16 : customerNameText.length > 20 ? 17 : 18;
                doc.setFontSize(textFontSize);
                doc.text(customerNameText, leftX, y);
                y += 8.5;
            }

            // 自社情報 (右側)
            let officeY = recipientY;
            doc.setFontSize(10.5);
            doc.setTextColor(15, 23, 42); // 統一黒
            doc.text(`発行日: ${record && record.shipDate ? record.shipDate.replace(/-/g, '/') : utils.formatDate(new Date())}`, rightX, officeY, { align: 'right' });
            officeY += 6.5;

            doc.setFontSize(12.5);
            doc.setTextColor(15, 23, 42); // 統一黒
            doc.text(office.name, rightX, officeY, { align: 'right' });
            officeY += 6.5;

            doc.setFontSize(10);
            doc.setTextColor(15, 23, 42); // 統一黒
            doc.text(office.postalCode + ' ' + office.address, rightX, officeY, { align: 'right' });
            officeY += 5.5;
            doc.text(`TEL: ${office.tel}  FAX: ${office.fax}`, rightX, officeY, { align: 'right' });
            officeY += 5.5;

            const staffName = (record && record.staffName) ? record.staffName : (record && record.staff_name ? record.staff_name : '担当者');
            doc.setFontSize(12);
            doc.setTextColor(15, 23, 42); // 統一黒
            doc.text(`担当: ${staffName}`, rightX, officeY, { align: 'right' });

            y = Math.max(y + 6, officeY + 10);

            // 仕切り線
            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.5);
            doc.line(leftX, y, rightX, y);
            y += 8;

            // ==========================================
            // 3. 本文 (大文字 13pt & 自動長文折り返し splitTextToSize)
            // ==========================================
            doc.setFontSize(13);
            doc.setTextColor(15, 23, 42); // 視認性の高い濃紺ブラック

            const shipDateVal = record ? (record.shipDate || record.ship_date) : null;
            const shipDateStr = shipDateVal ? this.formatMonthDay(shipDateVal) : '本日';

            // 動的本文: record.body_message（スネークケース統一）を優先採用
            // 未指定時は後方互換として従来の固定文面をフォールバック生成
            let bodyMessage = record ? (record.body_message ?? record.bodyMessage) : null;
            if (!bodyMessage) {
                if (methodKey === 'hand_delivery') {
                    bodyMessage = `いつも大変お世話になっております。\n届出・申請の手続きが完了致しましたので、${shipDateStr}にお手渡しにて書類をお渡し致しました。`;
                } else {
                    bodyMessage = `いつも大変お世話になっております。\n届出・申請の手続きが完了致しましたので、お預かり書類等を${shipDateStr}発送の${methodName}にてお送り致しました。`;
                }
            }

            // doc.splitTextToSize による確実な右端自動改行
            const splitBody = doc.splitTextToSize(bodyMessage, contentWidth);
            splitBody.forEach(line => {
                doc.text(line, leftX, y);
                y += 7.5;
            });
            y += 5;

            // ==========================================
            // 4. 発送情報カード (高コントラスト・特大文字・はっきり見える配色)
            // ==========================================
            const arrivalDateVal = record ? (record.arrivalDate || record.arrival_date) : null;
            const trackingNumVal = record ? (record.trackingNumber || record.tracking_number) : null;
            const hasArrival = methodInfo.hasArrival && arrivalDateVal;
            const hasTracking = methodInfo.hasTracking && trackingNumVal && String(trackingNumVal).trim() !== '';

            if (hasArrival || hasTracking) {
                const cardY = y;
                const cardH = (hasArrival && hasTracking) ? 44 : 26;

                // 明るく綺麗なカード背景 (#f8fafc) & 明確な青フレーム (#93c5fd)
                doc.setFillColor(248, 250, 252);
                doc.rect(leftX, cardY, contentWidth, cardH, 'F');
                doc.setDrawColor(147, 197, 253);
                doc.setLineWidth(0.8);
                doc.rect(leftX, cardY, contentWidth, cardH, 'S');

                let cardInnerY = cardY + 9;

                if (hasArrival) {
                    doc.setFontSize(11);
                    doc.setTextColor(71, 85, 105); // 濃いスレートグレー（はっきり見える）
                    doc.text('到着予定日', leftX + 12, cardInnerY);
                    cardInnerY += 7.5;

                    doc.setFontSize(17);
                    doc.setTextColor(220, 38, 38); // インパクト大の鮮やかな赤色 (#dc2626)
                    const arrText = `${this.formatMonthDay(arrivalDateVal)} 到着予定`;
                    doc.text(arrText, leftX + 12, cardInnerY);

                    if (hasTracking) {
                        cardInnerY += 10.5;
                    }
                }

                if (hasTracking) {
                    doc.setFontSize(11);
                    doc.setTextColor(71, 85, 105);
                    doc.text('追跡番号 (お問い合わせ番号)', leftX + 12, cardInnerY);
                    cardInnerY += 7.5;

                    doc.setFontSize(17);
                    doc.setTextColor(30, 58, 138); // 深みのある濃いネイビー (#1e3a8a)
                    const trackText = String(trackingNumVal).trim();
                    doc.text(trackText, leftX + 12, cardInnerY);
                }

                y += cardH + 8;
            }

            // 請求書同封文面 (12.5pt)
            const returnedItems = (record && Array.isArray(record.returnedItems || record.returned_items)) ? (record.returnedItems || record.returned_items) : [];
            if (returnedItems.includes('invoice')) {
                doc.setFontSize(12.5);
                doc.setTextColor(15, 23, 42);
                doc.text('※ 請求書を同封しております。届きましたら内容をご確認いただけますと幸いです。', leftX, y);
                y += 8;
            }

            // 備考欄 (改行自動折り返し splitTextToSize)
            if (record && record.remarks && String(record.remarks).trim() !== '') {
                y += 1;
                doc.setFontSize(12.5);
                doc.setTextColor(30, 64, 175); // ネイビー
                doc.text('【備考】', leftX, y);
                y += 6;

                doc.setFontSize(12);
                doc.setTextColor(30, 41, 59);
                
                const remarkLines = String(record.remarks).trim().split('\n');
                remarkLines.forEach(rLine => {
                    const splitR = doc.splitTextToSize(rLine, contentWidth - 6);
                    splitR.forEach(l => {
                        doc.text(l, leftX + 4, y);
                        y += 6.5;
                    });
                });
                y += 3;
            }

            y += 2;
            doc.setFontSize(13);
            doc.setTextColor(15, 23, 42);
            doc.text('今後とも、どうぞよろしくお願い申し上げます。', leftX, y);
            y += 10;

            // ==========================================
            // 5. 【お届けする書類】ボックス (見出し14pt, 項目13pt 大文字・ポップ・高視認性)
            // ==========================================
            const boxY = y;
            const boxHeaderH = 11;
            const boxWidth = contentWidth;

            // 「その他」テキストの折り返し行数を事前計算して高さを決定
            const returnedItemsOtherVal = record ? (record.returnedItemsOther || record.returned_items_other) : null;
            const hasOther = returnedItems.includes('other');
            
            let otherLines = [];
            if (hasOther) {
                let otherText = returnedItemsOtherVal ? `その他：${returnedItemsOtherVal}` : 'その他';
                otherLines = doc.splitTextToSize(`■ ${otherText}`, boxWidth - 20);
            } else {
                otherLines = doc.splitTextToSize(`□ その他`, boxWidth - 20);
            }
            
            const boxContentH = 26 + (otherLines.length * 8);

            // ボックス見出し (背景 #e2e8f0, 文字 #1e3a8a 濃ネイビー 14pt)
            doc.setFillColor(226, 232, 240);
            doc.rect(leftX, boxY, boxWidth, boxHeaderH, 'F');
            doc.setDrawColor(30, 64, 175);
            doc.setLineWidth(0.6);
            doc.rect(leftX, boxY, boxWidth, boxHeaderH, 'S');

            doc.setFontSize(14);
            doc.setTextColor(30, 58, 138); // 濃ネイビー
            doc.text('【お届けする書類】', leftX + 6, boxY + 8);

            // ボックスコンテンツ領域
            const contentY = boxY + boxHeaderH;
            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.5);
            doc.rect(leftX, contentY, boxWidth, boxContentH, 'S');

            // 1行目: 固定アイテムの並び描画
            let itemX = leftX + 10;
            let itemY = contentY + 11.5;
            const colWidth = 38;
            const fixedKeys = ['copy', 'invoice', 'permit_notice'];

            fixedKeys.forEach((key) => {
                const isChecked = returnedItems.includes(key);
                const label = RETURN_ITEM_TYPES[key] || key;

                doc.setFontSize(13);
                if (isChecked) {
                    doc.setTextColor(15, 23, 42); // 濃い黒 (#0f172a)
                    doc.text(`■ ${label}`, itemX, itemY);
                } else {
                    doc.setTextColor(148, 163, 184); // 明るいスレートグレー
                    doc.text(`□ ${label}`, itemX, itemY);
                }
                itemX += colWidth;
            });

            // 2行目以降: 「その他」の可変長描画
            itemY += 10.5;
            doc.setFontSize(13);
            if (hasOther) {
                doc.setTextColor(15, 23, 42);
            } else {
                doc.setTextColor(148, 163, 184);
            }
            
            otherLines.forEach(line => {
                doc.text(line, leftX + 10, itemY);
                itemY += 8;
            });

            // フッター描画
            this.drawFooter(1, 1);
        }
    }

    // グローバルに公開
    window.DocumentReturnReport = DocumentReturnReport;
    window.RETURN_ITEM_TYPES = RETURN_ITEM_TYPES;
    window.DELIVERY_METHODS = DELIVERY_METHODS;
})();
