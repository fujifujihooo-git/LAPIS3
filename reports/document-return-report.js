/**
 * 書類返却通知書 帳票クラス (Document Return Report)
 * PDFテンプレート(Book1.pdf)を読み込み、pdf-libでテキストを重ね書きします。
 */

(function () {
    'use strict';

    // 返却物コード定義マスタ
    const RETURN_ITEM_TYPES = {
        permit_notice: "許可通知書",
        copy:          "副本",
        original:      "原本",
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

    class DocumentReturnReport {
        constructor() {
            this.title = '書類返却通知書';
            this.docBytes = null;
        }

        /**
         * 依存ライブラリ (pdf-lib, fontkit) を遅延ロード
         */
        async _loadDependencies() {
            const loadScript = (src) => {
                return new Promise((resolve, reject) => {
                    if (document.querySelector(`script[src="${src}"]`)) return resolve();
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            };
            if (!window.PDFLib) {
                await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
            }
            if (!window.fontkit) {
                await loadScript('https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js');
            }
        }

        /**
         * 日付文字列を "YYYY年M月D日" または "M月D日" 形式にフォーマット
         */
        formatDateParts(dateStr, includeYear = false) {
            if (!dateStr) return '';
            const normalized = String(dateStr).replace(/-/g, '/');
            const parts = normalized.split('/');
            if (parts.length >= 3) {
                const year = parts[0];
                const month = parseInt(parts[1], 10);
                const day = parseInt(parts[2], 10);
                return includeYear ? `${year}年${month}月${day}日` : `${month}月${day}日`;
            }
            return dateStr;
        }

        async generate(customer, record, officeInfo = null) {
            await this._loadDependencies();
            const { PDFDocument, rgb } = window.PDFLib;
            const utils = window.ReportUtils || {};

            // 1. PDFテンプレートの読み込み
            const templateBytes = await fetch('./Book1.pdf').then(res => res.arrayBuffer());
            const pdfDoc = await PDFDocument.load(templateBytes);
            
            // 2. フォントの読み込みと登録
            pdfDoc.registerFontkit(window.fontkit);
            const fontBytes = await fetch('./fonts/NotoSansJP-Regular.ttf').then(res => res.arrayBuffer());
            const customFont = await pdfDoc.embedFont(fontBytes);

            const pages = pdfDoc.getPages();
            const page = pages[0]; // 1ページ目

            // 3. データ抽出
            const methodKey = record ? (record.deliveryMethod || record.delivery_method) : 'takkyubin';
            const methodInfo = DELIVERY_METHODS[methodKey] || DELIVERY_METHODS.other;
            let methodName = methodInfo.name;
            if (methodKey === 'other' && record) {
                const otherVal = record.deliveryMethodOther || record.delivery_method_other;
                if (otherVal) methodName = otherVal;
            }

            const rawCustomerName = (customer && customer.customer_name) ? customer.customer_name : 'お客様';
            const contactName = (customer && customer.contact_name) ? customer.contact_name : '';
            const faxNum = (customer && customer.fax) ? customer.fax : '';
            const telNum = (customer && customer.tel) ? customer.tel : '';
            
            const shipDateVal = record ? (record.shipDate || record.ship_date) : utils.formatDate ? utils.formatDate(new Date()) : '';
            const shipDateFullStr = this.formatDateParts(shipDateVal, true);
            const shipDateShortStr = this.formatDateParts(shipDateVal, false);

            const arrivalDateVal = record ? (record.arrivalDate || record.arrival_date) : null;
            const trackingNumVal = record ? (record.trackingNumber || record.tracking_number) : null;
            const hasArrival = methodInfo.hasArrival && arrivalDateVal;
            const hasTracking = methodInfo.hasTracking && trackingNumVal && String(trackingNumVal).trim() !== '';

            // 4. テキストの描画 (※座標は pdf-lib では左下が 0,0。A4は 595.28 x 841.89)
            // 目安の座標（後で実際のPDFに合わせて微調整が必要）
            const draw = (text, x, y, size = 12, color = rgb(0,0,0)) => {
                if(!text) return;
                page.drawText(text, { x, y, size, font: customFont, color });
            };

            // --- 宛先ブロック ---
            draw(rawCustomerName + ' 御中', 150, 650, 16);
            if(contactName) draw(contactName + ' 様', 180, 620, 16);
            draw(faxNum, 150, 588, 14);
            draw(telNum, 150, 560, 14);

            // --- 送信情報 ---
            draw('1', 180, 532, 14); // 枚数
            draw(shipDateFullStr, 350, 532, 14); // 送信日

            // --- 本文ブロック ---
            let bodyY = 480;
            const lineH = 20;
            draw('いつもお世話になっております。', 80, bodyY, 12);
            bodyY -= lineH;

            let bodyMsg = `届出・申請が完了し、お預かりしておりました書類の整理ができましたので、\n${shipDateShortStr} 発送の${methodName}にてお返し致します。`;
            if (methodKey === 'hand_delivery') {
                bodyMsg = `届出・申請の手続きが完了いたしましたので、\n${shipDateShortStr}にお手渡しにて書類をお渡し致しました。`;
            }
            
            bodyMsg.split('\n').forEach(line => {
                draw(line, 80, bodyY, 12);
                bodyY -= lineH;
            });

            // 到着予定＆追跡番号 (赤字)
            if (hasArrival || hasTracking) {
                let trackText = '';
                if (hasArrival) trackText += `${this.formatDateParts(arrivalDateVal, false)} 到着予定  `;
                if (hasTracking) trackText += `【送り状番号 ${trackingNumVal} 】`;
                
                draw(trackText, 80, bodyY, 14, rgb(0.8, 0.1, 0.1));
                bodyY -= lineH;
            }

            // 同封物
            const returnedItems = (record && Array.isArray(record.returnedItems || record.returned_items)) ? (record.returnedItems || record.returned_items) : [];
            if (returnedItems.includes('invoice')) {
                draw('請求書を同封致します。届きましたらご確認ください。', 80, bodyY, 12);
                bodyY -= lineH;
            }

            // 備考
            if (record && record.remarks && String(record.remarks).trim() !== '') {
                draw('【備考】', 80, bodyY, 12);
                bodyY -= lineH;
                const remarks = String(record.remarks).trim().split('\n');
                remarks.forEach(line => {
                    draw(line, 90, bodyY, 11);
                    bodyY -= 15;
                });
            }

            bodyY -= 10;
            draw('今後とも、どうぞよろしくお願い申し上げます。', 80, bodyY, 12);
            bodyY -= lineH;
            draw('どうもありがとうございました。', 80, bodyY, 12);

            // --- 差出人情報 ---
            const staffName = (record && record.staffName) ? record.staffName : (record && record.staff_name ? record.staff_name : '担当者');
            draw(staffName, 430, 150, 14);

            // 5. PDFバイト配列を保存
            this.docBytes = await pdfDoc.save();
        }

        preview(previewWindow = null) {
            if (this.docBytes && window.ReportEngine && typeof window.ReportEngine.previewPDF === 'function') {
                window.ReportEngine.previewPDF(this.docBytes, previewWindow);
            } else {
                console.warn("プレビューエンジンが利用できません");
            }
        }

        download(filename = '書類返却通知書.pdf') {
            if (this.docBytes && window.ReportEngine && typeof window.ReportEngine.downloadPDF === 'function') {
                window.ReportEngine.downloadPDF(this.docBytes, filename);
            }
        }
    }

    // グローバルに公開
    window.DocumentReturnReport = DocumentReturnReport;
    window.RETURN_ITEM_TYPES = RETURN_ITEM_TYPES;
    window.DELIVERY_METHODS = DELIVERY_METHODS;
})();
