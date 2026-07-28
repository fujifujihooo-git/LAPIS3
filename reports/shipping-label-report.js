/**
 * 発送ラベルエンジン & レターパック宛名印刷 帳票クラス (Shipping Label Report Engine)
 * 
 * 将来的な宅急便・ゆうパック対応を見据え、キャリア抽象化設計を採用した発送ラベル生成モジュールです。
 * 上部の SHIPPING_LABEL_LAYOUT 定数表において全座標（x, y, w, h）、余白、フォントサイズを一元化しており、
 * プリンタの実寸や紙質に合わせたミリ単位の調整が極めて容易な構造に設計しています。
 */

(function () {
    'use strict';

    // 書類種別 固定順定義（順不同での選択時も必ずこの順で出力）
    const DOCUMENT_TYPES = [
        '届出控え',
        '請求書',
        '領収書',
        '許可通知書',
        '登録証',
        '契約書',
        '申請書',
        'その他'
    ];

    /**
     * 選択された書類リストとその他入力テキストから、固定順に従いコンマ区切りの書類名テキストを構築する
     * @param {Array<string>} selectedDocuments - 選択された書類のIDまたは名前配列
     * @param {string} otherText - 「その他」選択時のカスタム入力文字
     * @returns {string} ソート済みの結合テキスト
     */
    function buildDocumentNames(selectedDocuments = [], otherText = '') {
        if (!Array.isArray(selectedDocuments) || selectedDocuments.length === 0) {
            return '書類一式';
        }

        // 定義の固定順に従い抽出
        const ordered = DOCUMENT_TYPES.filter(type => selectedDocuments.includes(type));

        // その他（other含む）の判定補正
        if (selectedDocuments.includes('other') && !ordered.includes('その他')) {
            ordered.push('その他');
        }

        const result = ordered.map(item => {
            if (item === 'その他' || item === 'other') {
                return (otherText && typeof otherText === 'string' && otherText.trim() !== '') 
                    ? otherText.trim() 
                    : 'その他書類';
            }
            return item;
        });

        return result.join('、');
    }

    // ==========================================
    // 集中レイアウト管理設定表（ミリ単位の微調整用）
    // ==========================================
    const SHIPPING_LABEL_LAYOUT = {
        letterpack: {
            page: { format: 'a4', orientation: 'portrait', width: 210, height: 297, margin: 10 },
            // カット線および枠線のデフォルト表示
            drawCutGuide: true,
            cutLineStyle: { color: [180, 180, 180], width: 0.2, dash: [2, 2] },
            // ※ 全ラベルの左端 x を 25mm に統一し、1回の縦カットで左端を一斉にカットできるよう業務最適化
            blocks: {
                // ① 宛先ラベル (122mm × 65mm) - 約2mm下方シフトのため paddingTop を設定
                recipient: {
                    x: 25, y: 14, width: 122, height: 65, padX: 6, padY: 6, paddingTop: 8,
                    fonts: {
                        postal: { size: 14, stepY: 7 },
                        address: { size: 15, stepY: 6.5 },
                        company: { size: 16, stepY: 7.5 },
                        dept: { size: 14, stepY: 6 },
                        person: { size: 18, stepY: 8 },
                        tel: { size: 12, bottomOffset: 6 }
                    },
                    telPrefix: 'TEL '
                },
                // ② 差出人ラベル (122mm × 48mm) - 約2mm下方シフトおよび電話番号干渉防止行間微調整
                sender: {
                    x: 25, y: 87, width: 122, height: 48, padX: 6, padY: 6, paddingTop: 8,
                    fonts: {
                        postal: { size: 14, stepY: 6 },
                        building: { fontOffset: -3, gapX: 14 }, // 主従関係の明確化: 郵便番号(主情報)より常時-3pt(補助情報)を設定
                        address: { size: 14, stepY: 5.5 },
                        office: { size: 15, stepY: 6.5 },
                        staff: { size: 14, stepY: 6 },
                        tel: { size: 12, bottomOffset: 6 }
                    },
                    telPrefix: 'TEL '
                },
                // ③ 品名ラベル (153mm × 24mm) -> レターパック下部横長エリア（約2mm下方シフト）
                package: {
                    x: 20, y: 143, width: 153, height: 24, padX: 5, padY: 4, paddingTop: 6,
                    rules: { maxLines: 3, fontSizes: [14, 13, 12, 11, 10], allowSummary: true },
                    fonts: {
                        topCustomer: { size: 12, offsetY: 6 },
                        itemTitle: { size: 8, offsetX: 5, offsetY: 9 },
                        docHeader: { size: 26, offsetX: 5, offsetY: 17 },
                        docList: { size: 14, offsetX: 35, offsetY: 14, maxW: 112, stepY: 5.5 },
                        safetyCheck: { size: 9.5, bottomOffset: 2 }
                    },
                    safetyText: '✓リチウム電池なし    ✓高圧ガスなし    ✓引火性液体なし'
                },
                // ④ 返信用 差出人ラベル（お客様情報 122mm × 48mm、約2mm下方シフト）
                returnSender: {
                    x: 25, y: 175, width: 122, height: 48, padX: 6, padY: 5, paddingTop: 7,
                    fonts: {
                        postal: { size: 13, stepY: 5.5 },
                        address: { size: 13.5, stepY: 5 },
                        company: { size: 14.5, stepY: 6 },
                        dept: { size: 13, stepY: 4.5 },
                        person: { size: 16, stepY: 6 },
                        tel: { size: 11.5, bottomOffset: 5 }
                    },
                    telPrefix: 'TEL '
                },
                // ⑤ 返信用 宛先ラベル（事務所情報 122mm × 48mm ＋ 右下メモ、約2mm下方シフト）
                returnRecipient: {
                    x: 25, y: 231, width: 122, height: 48, padX: 6, padY: 5, paddingTop: 7,
                    memoWidth: 50, // 右下メモ領域を50mmに絞ることで、左側差出人（担当者名・TEL）との干渉・重なりを100%排除
                    rules: { maxLines: 2, fontSizes: [10.5, 9.5, 8.5, 7.5], allowSummary: true },
                    fonts: {
                        postal: { size: 13, stepY: 5.5 },
                        building: { fontOffset: -3, gapX: 13 }, // 主従関係の明確化: 郵便番号(主情報)より常時-3pt(補助情報)を設定
                        address: { size: 13.5, stepY: 5 },
                        office: { size: 14.5, stepY: 6 },
                        staff: { size: 13.5, stepY: 5.5 },
                        tel: { size: 11.5, bottomOffset: 5 },
                        docMemo: { size: 10.5, stepY: 4.5 }
                    },
                    telPrefix: 'TEL '
                }
            }
        }
        // 将来の宅急便(takkyubin)・ゆうパック(yu_pack)レイアウトもここに拡張可能
    };

    /**
     * jsPDFのノーマルトゥルータイプフォントに対し、擬似ボールド（太字）描画を行うヘルパー
     */
    function drawTextBold(doc, text, x, y, strokeWidth = 0.25, options = {}) {
        doc.text(text, x, y, options);
        if (strokeWidth > 0) {
            const currentLineWidth = doc.getLineWidth();
            const currentColor = doc.getTextColor();
            doc.setDrawColor(currentColor);
            doc.setLineWidth(strokeWidth);
            doc.text(text, x, y, Object.assign({}, options, { renderingMode: 'fillThenStroke' }));
            doc.setLineWidth(currentLineWidth);
            doc.text(text, x, y, Object.assign({}, options, { renderingMode: 'fill' }));
        }
    }

    /**
     * カット用の極細ガイド線を描画
     */
    function drawCutBox(doc, block, style) {
        doc.setDrawColor(style.color[0], style.color[1], style.color[2]);
        doc.setLineWidth(style.width);
        doc.setLineDashPattern(style.dash, 0);
        doc.rect(block.x, block.y, block.width, block.height);
        doc.setLineDashPattern([], 0);
    }

    class ShippingLabelReport {
        constructor() {
            this.doc = null;
            this.currentCarrier = 'letterpack';
        }

        /**
         * 発送ラベルPDFを生成する（キャリア判定による戦略的描画）
         * @param {Object} data - データペイロード
         *  - customer: 顧客情報
         *  - sender: 自事務所・担当者情報
         *  - documents: 選択書類リスト (配列またはカンマ区切り文字)
         *  - otherText: その他自由入力
         *  - includeReturnEnvelope: 返信用レターパックを出力するか (boolean, default: true)
         *  - carrier: 配送会社指定 (default: 'letterpack')
         *  - layoutOverrides: ミリ単位調整用の座標オーバーライド (任意)
         */
        async generate(data = {}, options = {}) {
            this.currentCarrier = data.carrier || 'letterpack';
            const layoutConfig = SHIPPING_LABEL_LAYOUT[this.currentCarrier] || SHIPPING_LABEL_LAYOUT.letterpack;

            // ReportEngine にて PDF 初期化
            this.doc = await window.ReportEngine.initPDF({
                orientation: layoutConfig.page.orientation,
                unit: 'mm',
                format: layoutConfig.page.format
            });

            const doc = this.doc;
            doc.setTextColor(30, 41, 59); // スレートグレー / メインテキスト

            // 1. 同一の書類文字列を構築 (③品名ラベルと⑤返信封筒宛先で必ず共有する変数)
            let documentText = '';
            if (typeof data.documents === 'string') {
                documentText = data.documents;
            } else {
                documentText = buildDocumentNames(data.documents || [], data.otherText || '');
            }

            // 運用実績データロギング: 日付・顧客情報・選択件数を記録し、将来の実態集計・アクセス傾向監視の精密なファクトデータとする
            const docCount = Array.isArray(data.documents) ? data.documents.length : (documentText ? documentText.split('、').length : 0);
            const custInfo = data.customer || {};
            const custId = custInfo.customer_id || custInfo.customerId || '未指定';
            const custName = custInfo.customer_name || custInfo.customerName || '未指定';
            const logDate = new Date().toISOString().split('T')[0];
            console.log(`📊 [発送業務 運用実態監視] 日付:${logDate} | 顧客ID:${custId} (${custName}) | 選択数:${docCount}件 | 内訳: ${documentText}`);

            // 顧客＆担当者加工ロジック
            const cust = Object.assign({}, custInfo);
            const sender = Object.assign({
                officeName: '行政書士 中村事務所',
                postalCode: '〒160-0023',
                buildingName: 'サンローゼ新宿',
                address: '東京都新宿区西新宿7-19-7-402',
                staffName: '担当者',
                phone: '03-5386-3001'
            }, data.sender || {});

            // 2. 描画の実行 (戦略パターンのルーティング)
            if (this.currentCarrier === 'letterpack') {
                this.renderLetterpackAll(doc, layoutConfig, cust, sender, documentText, data.includeReturnEnvelope !== false);
            } else {
                // キャリア拡充時ここへ追加
                this.renderLetterpackAll(doc, layoutConfig, cust, sender, documentText, data.includeReturnEnvelope !== false);
            }

            return this.doc;
        }

        /**
         * レターパック専用 面取りおよび5ブロック総合描画処理
         */
        renderLetterpackAll(doc, layout, customer, sender, documentText, includeReturn) {
            const blocks = layout.blocks;

            // ① 宛先ラベル (受取人: 顧客)
            this.renderRecipientBlock(doc, blocks.recipient, customer, layout.drawCutGuide ? layout.cutLineStyle : null);

            // ② 差出人ラベル (差出人: 事務所)
            this.renderSenderBlock(doc, blocks.sender, sender, layout.drawCutGuide ? layout.cutLineStyle : null);

            // ③ 品名ラベル (品名書類: 社名様 ＋ 書類名 ＋ 右端固定「在中」 ＋ 危険物除外)
            this.renderPackageBlock(doc, blocks.package, customer, documentText, layout.drawCutGuide ? layout.cutLineStyle : null);

            // ④＆⑤ 返信用レターパックが出力ONの場合
            if (includeReturn) {
                // ④ 返信用 差出人ラベル (返信時差出人: お客様情報)
                this.renderRecipientBlock(doc, blocks.returnSender, customer, layout.drawCutGuide ? layout.cutLineStyle : null);

                // ⑤ 返信用 宛先ラベル (返信時受取人: 自事務所情報 ＋ 右下 書類名＆右寄せ固定「在中」 ＆ 【顧客名様】)
                this.renderReturnRecipientBlock(doc, blocks.returnRecipient, sender, customer, documentText, layout.drawCutGuide ? layout.cutLineStyle : null);
            }
        }

        /**
         * ブロック①・④ 顧客宛先・顧客差出人の描画
         */
        renderRecipientBlock(doc, cfg, customer, cutStyle) {
            if (cutStyle) drawCutBox(doc, cfg, cutStyle);

            const utils = window.ReportUtils || { splitTextToSize: (d, txt) => d.splitTextToSize(txt) };
            let currY = cfg.y + (cfg.paddingTop !== undefined ? cfg.paddingTop : cfg.padY);
            const leftX = cfg.x + cfg.padX;
            const maxW = cfg.width - (cfg.padX * 2);

            // 1. 郵便番号
            let postal = customer.postal_code || customer.postalCode || '';
            if (postal && !postal.startsWith('〒')) {
                const cleaned = postal.replace(/[^\d]/g, '');
                if (cleaned.length === 7) {
                    postal = `〒${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
                } else {
                    postal = `〒${postal}`;
                }
            }
            doc.setFontSize(cfg.fonts.postal.size);
            doc.text(postal || '〒―', leftX, currY);
            currY += cfg.fonts.postal.stepY;

            // 2. 住所 (折返し処理)
            doc.setFontSize(cfg.fonts.address.size);
            const address = customer.address || '';
            const buildName = customer.building_name || customer.building || '';
            const fullAddress = buildName ? `${address} ${buildName}` : address;
            const addrLines = doc.splitTextToSize(fullAddress, maxW);
            addrLines.forEach(line => {
                doc.text(line, leftX, currY);
                currY += cfg.fonts.address.stepY;
            });
            currY += 1.5; // 余白調整

            // 3. 会社名＆宛名処理（担当者ありなら部署・役職・様、担当者なしなら御中）
            const contactName = (customer.contact_name || customer.contactName || '').trim();
            const customerName = customer.customer_name || customer.customerName || '―';
            
            doc.setFontSize(cfg.fonts.company.size);
            if (!contactName) {
                // 担当者未選択: 「株式会社〇〇建設 御中」
                doc.text(`${customerName} 御中`, leftX, currY);
            } else {
                // 担当者あり: 「株式会社〇〇建設」 -> 部署・役職 -> 「氏名 様」
                doc.text(customerName, leftX, currY);
                currY += cfg.fonts.company.stepY;

                const dept = customer.department || '';
                const pos = customer.position || '';
                const deptPos = [dept, pos].filter(Boolean).join(' ');
                if (deptPos) {
                    doc.setFontSize(cfg.fonts.dept.size);
                    doc.text(deptPos, leftX, currY);
                    currY += cfg.fonts.dept.stepY;
                }

                doc.setFontSize(cfg.fonts.person.size);
                drawTextBold(doc, `${contactName} 様`, leftX, currY, 0.35);
            }

            // 4. 電話番号（下部に固定配置）
            const phone = customer.phone || customer.tel || '';
            if (phone) {
                const telY = cfg.y + cfg.height - cfg.fonts.tel.bottomOffset;
                doc.setFontSize(cfg.fonts.tel.size);
                doc.text(`${cfg.telPrefix || 'TEL '}${phone}`, leftX, telY);
            }
        }

        /**
         * ブロック② 差出人（自事務所）の描画
         */
        renderSenderBlock(doc, cfg, sender, cutStyle) {
            if (cutStyle) drawCutBox(doc, cfg, cutStyle);

            let currY = cfg.y + (cfg.paddingTop !== undefined ? cfg.paddingTop : cfg.padY);
            const leftX = cfg.x + cfg.padX;
            const maxW = cfg.width - (cfg.padX * 2);

            // 1. 事務所 郵便番号 ＆ 建物名（同一行の右側へ一回り小さいフォントで表示）
            let postal = sender.postalCode || sender.postal_code || '';
            if (postal && !postal.startsWith('〒')) postal = `〒${postal}`;
            const postalStr = postal || '〒160-0023';
            doc.setFontSize(cfg.fonts.postal.size);
            doc.text(postalStr, leftX, currY);

            const building = sender.buildingName || sender.building || 'サンローゼ新宿';
            if (building) {
                let buildSize;
                if (cfg.fonts.building && cfg.fonts.building.fontOffset !== undefined) {
                    buildSize = cfg.fonts.postal.size + cfg.fonts.building.fontOffset; // 郵便番号(主情報)に対する相対的な業務主従サイズ差
                } else if (cfg.fonts.building && cfg.fonts.building.size !== undefined) {
                    buildSize = cfg.fonts.building.size;
                } else {
                    buildSize = cfg.fonts.postal.size - 3;
                }
                const gapX = cfg.fonts.building ? (cfg.fonts.building.gapX || 14) : 14;
                const postalW = doc.getTextWidth(postalStr);
                doc.setFontSize(buildSize);
                doc.text(building, leftX + postalW + gapX, currY);
            }
            currY += cfg.fonts.postal.stepY;

            // 2. 事務所 住所
            doc.setFontSize(cfg.fonts.address.size);
            const addrLines = doc.splitTextToSize(sender.address || '', maxW);
            addrLines.forEach(line => {
                doc.text(line, leftX, currY);
                currY += cfg.fonts.address.stepY;
            });
            currY += 1.0;

            // 3. 事務所名
            doc.setFontSize(cfg.fonts.office.size);
            doc.text(sender.officeName || '行政書士 中村事務所', leftX, currY);
            currY += cfg.fonts.office.stepY + 0.5;

            // 4. 担当スタッフ名
            const staff = sender.staffName || sender.staff_name || '';
            if (staff) {
                doc.setFontSize(cfg.fonts.staff.size);
                const prefix = (staff.startsWith('担当') || staff.startsWith('代表') || staff.includes(':') || staff.includes('：')) ? '' : '担当  ';
                doc.text(`${prefix}${staff}`, leftX, currY);
            }

            // 5. 電話番号（下部に固定配置）
            const phone = sender.phone || sender.tel || '';
            if (phone) {
                const telY = cfg.y + cfg.height - cfg.fonts.tel.bottomOffset;
                doc.setFontSize(cfg.fonts.tel.size);
                doc.text(`${cfg.telPrefix || 'TEL '}${phone}`, leftX, telY);
            }
        }

        /**
         * 修正②: 書類名テキスト専用描画メソッド (各行を順次描画し、最終行のY座標を返す)
         */
        drawDocumentText(doc, lines, startX, startY, stepY, options = {}) {
            let currY = startY;
            lines.forEach((line, idx) => {
                doc.text(line, startX, currY, options);
                if (idx < lines.length - 1) {
                    currY += stepY;
                }
            });
            return currY; // 最終行のY座標を返す
        }

        /**
         * 修正②: 「在中」文字を右端(右寄せ)に固定配置で別描画する専用メソッド
         */
        drawZaichu(doc, rightEdgeX, y) {
            doc.text('在中', rightEdgeX, y, { align: 'right' });
        }

        /**
         * 第一段階: レターパック専用の文字オーバーラップ完全防止＆要約安全装置。
         * 「重なり禁止(優先1)」「枠外禁止(優先2)」「可読性優先(優先3)」に則り、
         * 最大行数 (maxLines) を超過する際は文字サイズを極限縮小する代わりに「他◯件」へ即座に要約変換する。
         */
        applySafeLayoutRules(doc, documentText, maxW, rules = {}) {
            const maxLines = rules.maxLines || 3;
            const fontSizes = (rules.fontSizes && rules.fontSizes.length > 0) ? rules.fontSizes : [doc.getFontSize()];
            const items = typeof documentText === 'string' ? documentText.split('、').map(s => s.trim()).filter(Boolean) : [];
            const totalCount = items.length;

            if (totalCount === 0) {
                return { lines: ['書類一式'], fontSize: fontSizes[0], isSummarized: false, totalCount: 0 };
            }

            // 1. 段階的フォント縮小テーブルの範囲内で各文字サイズの行数を評価
            for (let i = 0; i < fontSizes.length; i++) {
                const fSize = fontSizes[i];
                doc.setFontSize(fSize);
                const testLines = doc.splitTextToSize(documentText, maxW);
                
                // maxLines 以内におさまる場合は縮小を留め、可読性最優先で即時に確定
                if (testLines.length <= maxLines) {
                    return { lines: testLines, fontSize: fSize, isSummarized: false, totalCount };
                }
            }

            // 2. 最小許容フォントに設定しても maxLines を突破する場合は、末尾を「他◯件」へ安全要約
            const minFontSize = fontSizes[fontSizes.length - 1];
            doc.setFontSize(minFontSize);

            if (rules.allowSummary !== false && totalCount > 1) {
                for (let k = totalCount - 1; k >= 1; k--) {
                    const remainingCount = totalCount - k;
                    const summaryText = `${items.slice(0, k).join('、')} 他${remainingCount}件`;
                    const summaryLines = doc.splitTextToSize(summaryText, maxW);
                    if (summaryLines.length <= maxLines) {
                        return { lines: summaryLines, fontSize: minFontSize, isSummarized: true, totalCount };
                    }
                }
            }

            // フォールバック: 万一1件目のみでも超過する例外は最大行数上限にクリップ
            const fallbackLines = doc.splitTextToSize(documentText, maxW);
            return { lines: fallbackLines.slice(0, maxLines), fontSize: minFontSize, isSummarized: false, totalCount };
        }

        /**
         * ブロック③ 品名ラベル（書類選択結果表示 & 安全装置導入の改行・他◯件要約ロジック）
         */
        renderPackageBlock(doc, cfg, customer, documentText, cutStyle) {
            if (cutStyle) drawCutBox(doc, cfg, cutStyle);

            // 1. 上部中央 「株式会社〇〇建設 様」 または顧客名＋様
            const customerName = customer.customer_name || customer.customerName || '―';
            const topText = `${customerName} 様`;
            doc.setFontSize(cfg.fonts.topCustomer.size);
            const textW = doc.getTextWidth(topText);
            const centerX = cfg.x + (cfg.width / 2) - (textW / 2);
            doc.text(topText, Math.max(cfg.x + 35, centerX), cfg.y + cfg.fonts.topCustomer.offsetY);

            // 2. 左側固定 「品名」 (8pt) と 「書類」 (大きめBold)
            doc.setFontSize(cfg.fonts.itemTitle.size);
            doc.text('品名', cfg.x + cfg.fonts.itemTitle.offsetX, cfg.y + cfg.fonts.itemTitle.offsetY);

            doc.setFontSize(cfg.fonts.docHeader.size);
            drawTextBold(doc, '書類', cfg.x + cfg.fonts.docHeader.offsetX, cfg.y + cfg.fonts.docHeader.offsetY, 0.4);

            // 3. 右側 書類選択結果表示（安全装置適用： 重なり禁止・枠外禁止・可読性優先 ＆ 在中右寄せ固定）
            const docX = cfg.x + cfg.fonts.docList.offsetX;
            let docY = cfg.y + cfg.fonts.docList.offsetY;
            
            // 在中の配置スペース(右端から約18mm)を必ず確保した折り返し横幅を設定
            const maxDocW = Math.min(cfg.fonts.docList.maxW || (cfg.width - cfg.fonts.docList.offsetX - 3), cfg.width - cfg.fonts.docList.offsetX - 18);
            
            // 第一段階安全装置: 帳票は情報伝達装置であるため、極力全件表示できるよう 10pt まで段階的にフォントダウンを実施
            const defaultRules = { maxLines: 3, fontSizes: [14, 13, 12, 11, 10], allowSummary: true };
            const safeResult = this.applySafeLayoutRules(doc, documentText, maxDocW, cfg.rules || defaultRules);
            const docLines = safeResult.lines;
            doc.setFontSize(safeResult.fontSize);
            
            // 修正③: 複数行時(lineCount >= 2)の縦位置補正 (約2〜3mm上方移動し下部要素との距離を確保)
            if (docLines.length >= 2) {
                const shiftUp = docLines.length >= 3 ? 3.0 : 2.5;
                docY -= shiftUp;
            }

            // 別描画：書類名テキストを順次描画し最終行のY座標を獲得
            const lastDocY = this.drawDocumentText(doc, docLines, docX, docY, cfg.fonts.docList.stepY);
            
            // 別描画：右端(rightEdgeX)へ常時固定で「在中」を最終行と同一高さで印字
            const rightEdgeX = cfg.x + cfg.width - (cfg.padX || 5);
            this.drawZaichu(doc, rightEdgeX, lastDocY);

            // 4. 下部固定 危険物チェック「☑リチウム電池なし...」
            const safetyY = cfg.y + cfg.height - cfg.fonts.safetyCheck.bottomOffset;
            doc.setFontSize(cfg.fonts.safetyCheck.size);
            const sTextW = doc.getTextWidth(cfg.safetyText);
            const sCenterX = cfg.x + (cfg.width / 2) - (sTextW / 2);
            doc.text(cfg.safetyText, Math.max(cfg.x + 5, sCenterX), safetyY);
        }

        /**
         * ブロック⑤ 返信用 宛先（自事務所 ＋ 右下 書類名＆右寄せ固定「在中」 ＆ 【顧客名】追加表示）
         * 重要：メモ横幅を50mmに制御し左側住所との干渉ゼロ化、超過時は「他◯件」に要約
         */
        renderReturnRecipientBlock(doc, cfg, sender, customer, documentText, cutStyle) {
            // まずは通常の事務所アドレスをベースに描画
            this.renderSenderBlock(doc, cfg, sender, cutStyle);

            // 右下への追加表示 書類名 ＆ 右端固定「在中」 ＆ 「【株式会社〇〇建設様】」
            const customerName = customer.customer_name || customer.customerName || '顧客';
            const customerTag = `【${customerName}様】`;

            const rightEdgeX = cfg.x + cfg.width - cfg.padX;
            const bottomY = cfg.y + cfg.height - 5;
            
            // 在中余白を見込みつつ、左側担当者・TELとの干渉を物理遮断する安全帯 (既定50mm)
            const maxMemoW = cfg.memoWidth || Math.min(cfg.width * 0.5, 50);
            
            // 第一段階安全装置: 最大2行、極力省略しないよう 7.5pt まで縮小試験を敢行し、最終段階でのみ「他◯件」へ要約
            const defaultRules = { maxLines: 2, fontSizes: [10.5, 9.5, 8.5, 7.5], allowSummary: true };
            const safeResult = this.applySafeLayoutRules(doc, documentText, maxMemoW, cfg.rules || defaultRules);
            const memoLines = safeResult.lines;
            doc.setFontSize(safeResult.fontSize);
            
            // 修正③: 複数行時(lineCount >= 2)の縦位置上方補正（約2〜3mm上へ動的シフトして密着感を防止）
            const lineCount = memoLines.length;
            const shiftUp = lineCount >= 3 ? 3.0 : (lineCount === 2 ? 2.5 : 0);
            
            // 底面の【顧客名様】エリアから逆算した書類開始座標を shiftUp だけ確実に引き上げる
            const docStartY = bottomY - (lineCount * cfg.fonts.docMemo.stepY) - shiftUp;
            const memoStartX = rightEdgeX - maxMemoW - 12; // 右下メモ内の書類名左端起点
            
            // 1. 書類名の描画（可読性の高い要約結果を描画）
            const lastDocY = this.drawDocumentText(doc, memoLines, memoStartX, docStartY, cfg.fonts.docMemo.stepY);
            
            // 2. 「在中」を書類最終行と同一Y座標の右端(rightEdgeX)へ固定配置
            this.drawZaichu(doc, rightEdgeX, lastDocY);
            
            // 3. 【顧客名様】を底面右寄せで独立配置（縦シフト効果で書類や在中と100%重ならない）
            doc.text(customerTag, rightEdgeX, bottomY, { align: 'right' });
        }

        /**
         * ブラウザ上でプレビュー表示を行う
         */
        preview(previewWindow = null) {
            window.ReportEngine.previewPDF(this.doc, previewWindow);
        }

        /**
         * PDFをダウンロード保存する
         */
        download(filename = 'shipping-label.pdf') {
            window.ReportEngine.downloadPDF(this.doc, filename);
        }
    }

    // グローバル公開
    window.ShippingLabelReport = ShippingLabelReport;
    window.SHIPPING_LABEL_LAYOUT = SHIPPING_LABEL_LAYOUT;
    window.buildDocumentNames = buildDocumentNames;

    // Node.js テスト環境向けエクスポート
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ShippingLabelReport,
            SHIPPING_LABEL_LAYOUT,
            buildDocumentNames,
            DOCUMENT_TYPES
        };
    }
})();
