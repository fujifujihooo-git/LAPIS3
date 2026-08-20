/**
 * 宛名ラベル 帳票クラス (Address Label Report)
 */
(function () {
    'use strict';

    class AddressLabelReport {
        constructor() {
            this.doc = null;
        }

        /**
         * 宛名ラベル PDF を生成し、初期化を行う
         * @param {Object} data - 宛名データ
         * @param {Object} options - オプション (例: { debugFontMetrics: true })
         */
        async generate(data, options = {}) {
            // A4横 (Landscape), mm単位
            this.doc = await window.ReportEngine.initPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            });

            const labelW = 115;
            const labelH = 60;

            // 確定したA4横の2x2面付け座標パラメータ
            const startX = 25;
            const startY = 30;
            const gapX = 17;
            const gapY = 30;

            const positions = [
                { x: startX, y: startY },
                { x: startX + labelW + gapX, y: startY },
                { x: startX, y: startY + labelH + gapY },
                { x: startX + labelW + gapX, y: startY + labelH + gapY }
            ];

            const allMetrics = [];

            // 4面に描画（在中文言は個別指定があれば面ごとに別）
            for (let i = 0; i < 4; i++) {
                const pos = positions[i];
                const labelData = (data.labels && data.labels[i]) ? data.labels[i] : null;
                if (labelData) {
                    const metrics = this.drawLabel(pos.x, pos.y, labelW, labelH, labelData, options);
                    if (metrics) allMetrics.push({ index: i, metrics });
                }
            }

            return { metrics: allMetrics };
        }

        /**
         * 1枚のラベルを描画する
         */
        drawLabel(lx, ly, lw, lh, labelData, options = {}) {
            const doc = this.doc;
            const utils = window.ReportUtils;
            const fontMetrics = [];

            const logFontMetric = (name, initial, final) => {
                const ratio = ((final - initial) / initial * 100).toFixed(1);
                const metric = { name, initial, final, ratio: Number(ratio) };
                fontMetrics.push(metric);
                if (options.debugFontMetrics) {
                    const sign = metric.ratio > 0 ? '+' : '';
                    console.log(`  [FontSizeLog] ${name}: ${initial}pt -> ${final.toFixed(1)}pt (${sign}${metric.ratio}%)`);
                }
            };

            // 1. ラベルの外枠（切り取り線として薄いグレーの破線を描画）
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.2);
            doc.setLineDashPattern([2, 2], 0); // 破線
            doc.rect(lx, ly, lw, lh);
            doc.setLineDashPattern([], 0); // 実線に戻す

            // 内側パディング
            const padX = 8;
            const padY = 8;
            const drawW = lw - (padX * 2);

            let currY = ly + padY;

            // 2. 郵便番号 (12pt)
            doc.setFontSize(12);
            doc.setTextColor(30, 41, 59); // TEXT_MAIN相当
            
            let postalStr = '';
            if (labelData.postalCode) {
                const cleaned = String(labelData.postalCode).replace(/[^\d]/g, '');
                if (cleaned.length === 7) {
                    postalStr = `〒${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
                } else {
                    postalStr = `〒${labelData.postalCode}`;
                }
            }
            doc.text(postalStr, lx + padX, currY);
            currY += 6.2;

            // 3. 住所 (11pt: 最適安全値、長い住所は自動折返し)
            const addrFontSize = 11;
            doc.setFontSize(addrFontSize);
            logFontMetric('住所', 11, addrFontSize);

            const addrLines = utils.splitTextToSize(doc, labelData.address || '', drawW, addrFontSize);
            addrLines.forEach(line => {
                doc.text(line, lx + padX, currY);
                currY += 5.8; // 行間 (11pt用に調整)
            });
            currY += 1.5; // 余白調整

            // 4. 宛名 (顧客名、営業所、部署・役職、担当者)
            if (labelData.targetType === '会社宛（御中）') {
                const initialSize = 16;
                let nameFontSize = initialSize;
                doc.setFontSize(nameFontSize);
                const suffix = ' 御中';
                const fullText = (labelData.customerName || '') + suffix;
                while (doc.getTextWidth(fullText) > drawW && nameFontSize > 8) {
                    nameFontSize -= 0.5;
                    doc.setFontSize(nameFontSize);
                }
                logFontMetric('御中（会社宛）', initialSize, nameFontSize);
                doc.text(fullText, lx + padX, currY);

            } else if (labelData.targetType === '会社宛（代表者）') {
                const initialCompSize = 13;
                let nameFontSize = initialCompSize;
                doc.setFontSize(nameFontSize);
                while (doc.getTextWidth(labelData.customerName || '') > drawW && nameFontSize > 8) {
                    nameFontSize -= 0.5;
                    doc.setFontSize(nameFontSize);
                }
                logFontMetric('会社名', initialCompSize, nameFontSize);
                doc.text(labelData.customerName || '', lx + padX, currY);
                currY += 6.0;

                const initialRepSize = 15;
                let repFontSize = initialRepSize;
                doc.setFontSize(repFontSize);
                
                let repName = labelData.representativeName || '';
                let fullRepText = '';
                if (repName.includes('代表') || repName.includes('社長') || repName.includes('取締役')) {
                    fullRepText = repName + ' 様';
                } else {
                    fullRepText = '代表取締役 ' + repName + ' 様';
                }

                while (doc.getTextWidth(fullRepText) > drawW && repFontSize > 8) {
                    repFontSize -= 0.5;
                    doc.setFontSize(repFontSize);
                }
                logFontMetric('代表者名', initialRepSize, repFontSize);
                doc.text(fullRepText, lx + padX, currY);

            } else if (labelData.targetType === '営業所宛') {
                const initialCompSize = 13;
                let nameFontSize = initialCompSize;
                doc.setFontSize(nameFontSize);
                while (doc.getTextWidth(labelData.customerName || '') > drawW && nameFontSize > 8) {
                    nameFontSize -= 0.5;
                    doc.setFontSize(nameFontSize);
                }
                logFontMetric('会社名', initialCompSize, nameFontSize);
                doc.text(labelData.customerName || '', lx + padX, currY);
                currY += 6.0;

                // 営業所名 + 御中 (15pt維持)
                const initialOfficeSize = 15;
                let officeFontSize = initialOfficeSize;
                doc.setFontSize(officeFontSize);
                const suffix = ' 御中';
                const fullText = (labelData.officeName || '') + suffix;
                while (doc.getTextWidth(fullText) > drawW && officeFontSize > 8) {
                    officeFontSize -= 0.5;
                    doc.setFontSize(officeFontSize);
                }
                logFontMetric('営業所名', initialOfficeSize, officeFontSize);
                doc.text(fullText, lx + padX, currY);

            } else if (labelData.targetType === '担当者宛') {
                const initialCompSize = 13;
                let nameFontSize = initialCompSize;
                doc.setFontSize(nameFontSize);
                while (doc.getTextWidth(labelData.customerName || '') > drawW && nameFontSize > 8) {
                    nameFontSize -= 0.5;
                    doc.setFontSize(nameFontSize);
                }
                logFontMetric('会社名', initialCompSize, nameFontSize);
                doc.text(labelData.customerName || '', lx + padX, currY);
                currY += 5.5;

                // 部署名・役職名 (10.5pt: 垂直干渉防止の最適値)
                const deptFontSize = 10.5;
                doc.setFontSize(deptFontSize);
                logFontMetric('部署・役職', 10.5, deptFontSize);
                const deptPosText = [labelData.department || '', labelData.position || ''].filter(Boolean).join(' ');
                const deptLines = utils.splitTextToSize(doc, deptPosText, drawW, deptFontSize);
                deptLines.forEach(line => {
                    doc.text(line, lx + padX, currY);
                    currY += 5.0;
                });
                currY += 0.5;

                const initialContactSize = 15;
                let contactFontSize = initialContactSize;
                doc.setFontSize(contactFontSize);
                const suffix = ' 様';
                const fullText = (labelData.contactName || '') + suffix;
                while (doc.getTextWidth(fullText) > drawW && contactFontSize > 8) {
                    contactFontSize -= 0.5;
                    doc.setFontSize(contactFontSize);
                }
                logFontMetric('担当者名', initialContactSize, contactFontSize);
                doc.text(fullText, lx + padX, currY);
            }

            // 下部要素（電話番号・在中文言）の位置定義
            const telY = ly + lh - 14.5;
            const rectY = ly + lh - 9.5;

            // 干渉チェック: currY (直近描画テキストの下端) が telY に干渉していないか
            if (options.debugFontMetrics && currY > telY - 2) {
                console.warn(`  [LayoutWarning] 印字領域が電話番号描画ライン(TEL Y: ${telY.toFixed(1)})に近接/侵入しています (Text end Y: ${currY.toFixed(1)})`);
            }

            // 5. 電話番号 (下部に固定配置)
            this.drawTelephone(doc, labelData.phone, lx + padX, telY);

            // 6. 在中文言 (12pt, 枠連動)
            const enclosure = labelData.enclosure;
            if (enclosure && enclosure.text && enclosure.text !== 'なし') {
                let encText = '';
                if (enclosure.code === 'other') {
                    encText = enclosure.text;
                } else {
                    encText = `【${enclosure.text} 在中】`;
                }

                doc.setFontSize(12);
                const textW = doc.getTextWidth(encText);
                const rectW = textW + 5;
                const rectH = 6.2;
                const rectX = lx + (lw / 2) - (rectW / 2);

                doc.setDrawColor(30, 41, 59);
                doc.setLineWidth(0.35);
                doc.rect(rectX, rectY, rectW, rectH);

                const textX = lx + (lw / 2);
                const textY = rectY + 4.4;

                doc.text(encText, textX, textY, { align: 'center' });
                doc.setLineWidth(0.18);
                doc.text(encText, textX, textY, { align: 'center', renderingMode: 'fillThenStroke' });
            }



            return {
                lastY: currY,
                fontMetrics
            };
        }

        /**
         * 電話番号を独立して描画する (将来的な非表示化に対応)
         */
        drawTelephone(doc, phone, x, y) {
            if (phone) {
                doc.setFontSize(9);
                doc.setTextColor(30, 41, 59);
                doc.text(`TEL ${phone}`, x, y);
            }
        }

        /**
         * プレビュー表示
         */
        preview(previewWindow = null) {
            window.ReportEngine.previewPDF(this.doc, previewWindow);
        }
    }

    window.AddressLabelReport = AddressLabelReport;
})();
