/**
 * LAPIS3 帳票エンジン (Report Engine)
 * 共通のPDF生成処理を提供します。
 */

window.ReportEngine = {
    /**
     * 帳票を生成する
     * @param {string} templateUrl - ベースとなるPDFのURL
     * @param {string} fontUrl - 埋め込むフォントのURL
     * @param {Object} mappingJson - 項目と座標のマッピング定義
     * @param {Object} data - バインドするデータ
     * @returns {Promise<Uint8Array>} 生成されたPDFのバイト配列
     */
    async generateReport(templateUrl, fontUrl, mappingJson, data) {
        if (!window.PDFLib) {
            throw new Error("pdf-lib が読み込まれていません。");
        }
        if (!window.fontkit) {
            throw new Error("fontkit が読み込まれていません。");
        }

        const { PDFDocument, rgb } = window.PDFLib;

        // テンプレートPDFとフォントの取得 (エラーハンドリング付き)
        const [templateBytes, fontBytes] = await Promise.all([
            fetch(templateUrl).then(res => {
                if (!res.ok) throw new Error(`HTTP Error ${res.status} (${res.statusText}) fetching ${templateUrl}`);
                return res.arrayBuffer();
            }).catch(e => {
                console.error(`[ReportEngine] Failed to fetch PDF template from: ${new URL(templateUrl, window.location.origin).href}`, e);
                throw e;
            }),
            fetch(fontUrl).then(res => {
                if (!res.ok) throw new Error(`HTTP Error ${res.status} (${res.statusText}) fetching ${fontUrl}`);
                return res.arrayBuffer();
            }).catch(e => {
                console.error(`[ReportEngine] Failed to fetch font from: ${new URL(fontUrl, window.location.origin).href}`, e);
                throw e;
            })
        ]);

        // PDFの読み込みとフォントキットの登録 (公式の保護付きPDFを扱えるよう ignoreEncryption を付与)
        const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
        pdfDoc.registerFontkit(window.fontkit);
        
        // フォントのエンベデッド
        const customFont = await pdfDoc.embedFont(fontBytes);
        
        // 最初のページを取得（複数ページ対応が必要な場合は拡張する）
        const pages = pdfDoc.getPages();
        const page = pages[0];
        const pageHeight = page.getHeight(); // pdf-libのY座標は左下が原点(0)

        // デフォルト設定
        const defaultFontSize = 11;
        const defaultColor = rgb(0, 0, 0);

        // マッピング定義に従ってデータを描画
        for (const [key, config] of Object.entries(mappingJson)) {
            const rawValue = data[key];
            if (rawValue === undefined || rawValue === null || rawValue === false) continue;

            const size = config.size || defaultFontSize;
            
            // Y座標は直感的な「左上原点」からの距離で定義されているケースを想定。
            // もしJSONのY座標が左上原点の場合、pdf-lib用に変換する（pageHeight - y）。
            // 今回はJSONのY定義をpdf-libの左下原点仕様のまま直接使うか、
            // 「y_from_top: true」フラグで反転させるか対応。ここではYはそのままpdf-lib座標として扱う。

            if (config.type === 'checkbox') {
                if (rawValue === true) {
                    page.drawText(config.check_mark || '○', {
                        x: config.x,
                        y: config.y,
                        size: size,
                        font: customFont,
                        color: defaultColor,
                    });
                }
            } else {
                let textStr = String(rawValue);
                
                // 長い文字列の改行対応（簡易版）
                if (config.maxWidth && customFont.widthOfTextAtSize(textStr, size) > config.maxWidth) {
                    // 簡単な縮小処理（文字サイズを小さくする）
                    let currentSize = size;
                    while (customFont.widthOfTextAtSize(textStr, currentSize) > config.maxWidth && currentSize > 6) {
                        currentSize -= 0.5;
                    }
                    
                    // 改行処理が必要な場合はココにロジックを追加
                    // 現在はシンプルにフォントサイズを縮小してフィットさせる
                    page.drawText(textStr, {
                        x: config.x,
                        y: config.y + (config.yOffset || 0),
                        size: currentSize,
                        font: customFont,
                        color: defaultColor,
                    });
                } else {
                    // 通常描画
                    // 改行コードが含まれている場合は複数回に分けて描画
                    const lines = textStr.split('\n');
                    let currentY = config.y + (config.yOffset || 0);
                    const lineHeight = size * 1.2; // 行間の係数

                    for (const line of lines) {
                        page.drawText(line, {
                            x: config.x,
                            y: currentY,
                            size: size,
                            font: customFont,
                            color: defaultColor,
                        });
                        currentY -= lineHeight; // 下方向へ移動
                    }
                }
            }
        }

        // 【デバッグ用】明示的に ?debug_pdf=1 が指定された場合のみグリッドを描画する
        const isDebugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug_pdf') === '1';
        if (isDebugEnabled) {
            const { width, height } = page.getSize();
            // 50pt毎に細い線を引く
            for (let x = 50; x <= width; x += 50) {
                page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, color: rgb(1, 0.5, 0.5), thickness: 0.2 });
            }
            for (let y = 50; y <= height; y += 50) {
                page.drawLine({ start: { x: 0, y }, end: { x: width, y }, color: rgb(1, 0.5, 0.5), thickness: 0.2 });
            }
            // 100pt毎に太い線と数値を描画する
            for (let x = 0; x <= width; x += 100) {
                page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, color: rgb(1, 0, 0), thickness: 0.5 });
                page.drawText(`${x}`, { x: x + 2, y: 10, size: 8, font: customFont, color: rgb(1, 0, 0) });
            }
            for (let y = 0; y <= height; y += 100) {
                page.drawLine({ start: { x: 0, y }, end: { x: width, y }, color: rgb(1, 0, 0), thickness: 0.5 });
                page.drawText(`${y}`, { x: 2, y: y + 2, size: 8, font: customFont, color: rgb(1, 0, 0) });
            }
        }
        return await pdfDoc.save();
    },

    /**
     * 生成したPDFをダウンロードする
     */
    downloadPDF(pdfBytes, filename) {
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /**
     * 生成したPDFを別タブでプレビューする
     */
    previewPDF(pdfBytes) {
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    }
};
