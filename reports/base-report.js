/**
 * LAPIS3 帳票共通親クラス (Base Report)
 * 共通のヘッダー・フッター描画、ページ制御、ダウンロード/プレビュー機能を提供します。
 */

(function () {
    'use strict';

    class BaseReport {
        /**
         * @param {string} title - 帳票のメインタイトル (左上表示)
         */
        constructor(title) {
            this.title = title;
            this.doc = null;
            this.pageW = 297;  // A4横のデフォルト幅 (mm)
            this.pageH = 210;  // A4横のデフォルト高さ (mm)
            this.marginL = 15; // 左余白 (mm)
            this.marginR = 15; // 右余白 (mm)
            this.marginT = 15; // 上余白 (mm)
            this.marginB = 15; // 下余白 (mm)
            this.contentW = this.pageW - this.marginL - this.marginR;
        }

        /**
         * 帳票の初期化を行う (PDFインスタンスの作成とフォントの適用)
         * @param {Object} options - jsPDF 初期化オプション
         */
        async init(options = {}) {
            const defaultOptions = {
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            };
            const opts = Object.assign({}, defaultOptions, options);
            
            // 帳票エンジンから jsPDF インスタンスを生成
            this.doc = await window.ReportEngine.initPDF(opts);

            // ページ幅と高さの再設定（Landscape/Portrait考慮）
            this.pageW = this.doc.internal.pageSize.getWidth();
            this.pageH = this.doc.internal.pageSize.getHeight();
            this.contentW = this.pageW - this.marginL - this.marginR;
        }

        /**
         * 共通ヘッダーを描画する
         * @param {number} yStart - ヘッダー描画を開始する Y 座標 (mm)
         * @returns {number} ヘッダー描画終了後の次の描画開始 Y 座標 (mm)
         */
        drawHeader(yStart = 15) {
            const doc = this.doc;
            const theme = window.ReportUtils.THEME;
            const rightX = this.pageW - this.marginR;
            let y = yStart;

            // 1. タイトル描画 (左上)
            doc.setFontSize(16);
            doc.setTextColor(theme.NAVY[0], theme.NAVY[1], theme.NAVY[2]);
            doc.text(this.title, this.marginL, y);
            // 疑似太字 (Stroke描画)
            doc.setLineWidth(0.2);
            doc.text(this.title, this.marginL, y, { renderingMode: 'fillThenStroke' });

            // 2. 右上システム名
            doc.setFontSize(12);
            doc.text('LAPIS3', rightX, y - 2, { align: 'right' });
            doc.setLineWidth(0.15);
            doc.text('LAPIS3', rightX, y - 2, { align: 'right', renderingMode: 'fillThenStroke' });
            
            doc.setFontSize(8.5);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            doc.text('顧客管理システム', rightX, y + 2.5, { align: 'right' });

            y += 6;

            // 3. ヘッダー下部仕切り線
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.4);
            doc.line(this.marginL, y, rightX, y);

            y += 4.5;

            // 4. 出力日・出力者
            const todayStr = window.ReportUtils.formatDate(new Date());
            doc.setFontSize(9);
            doc.setTextColor(theme.TEXT_MAIN[0], theme.TEXT_MAIN[1], theme.TEXT_MAIN[2]);
            doc.text(`出力日: ${todayStr}`, this.marginL, y);

            // セッション情報から出力者を解決
            let staffName = '未設定';
            try {
                const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                if (session.staff_name) {
                    staffName = session.staff_name;
                }
            } catch (e) {
                console.warn('[BaseReport] Failed to load session information', e);
            }
            doc.text(`出力者: ${staffName}`, rightX, y, { align: 'right' });

            y += 6; // 次の描画開始座標を返す
            return y;
        }

        /**
         * 共通フッター（ページ番号など）を描画する
         * @param {number} currentPage - 現在のページ番号 (1-indexed)
         * @param {number} totalPages - 総ページ数
         */
        drawFooter(currentPage, totalPages) {
            const doc = this.doc;
            const theme = window.ReportUtils.THEME;
            const footerY = this.pageH - this.marginB;

            // フッター上部の細い仕切り線
            doc.setDrawColor(theme.BORDER[0], theme.BORDER[1], theme.BORDER[2]);
            doc.setLineWidth(0.25);
            doc.line(this.marginL, footerY - 5, this.pageW - this.marginR, footerY - 5);

            // ページ番号
            doc.setFontSize(9);
            doc.setTextColor(theme.TEXT_MUTED[0], theme.TEXT_MUTED[1], theme.TEXT_MUTED[2]);
            const pageStr = `${currentPage} / ${totalPages}`;
            doc.text(pageStr, this.pageW / 2, footerY, { align: 'center' });
        }

        /**
         * 新しいページを追加し、ヘッダーを自動で描画する
         * @returns {number} 次の描画開始 Y 座標 (mm)
         */
        addNewPage() {
            this.doc.addPage();
            return this.drawHeader(this.marginT);
        }

        /**
         * 生成した PDF をダウンロードする
         * @param {string} filename - ファイル名
         */
        download(filename) {
            window.ReportEngine.downloadPDF(this.doc, filename);
        }

        /**
         * 生成した PDF を別タブでプレビューする
         */
        preview() {
            window.ReportEngine.previewPDF(this.doc);
        }
    }

    window.BaseReport = BaseReport;
})();
