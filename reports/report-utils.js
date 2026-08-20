/**
 * LAPIS3 帳票共通ユーティリティ (Report Utils)
 * 日付整形、状態判定、共通カラー定義、テキスト折り返し等の補助関数を提供します。
 */

(function () {
    'use strict';

    window.ReportUtils = {
        // ===== デザインテーマカラー (RGB配列) =====
        THEME: {
            NAVY: [27, 42, 74],        // #1B2A4A (メインヘッダーなど)
            SUB_HEADER: [61, 90, 128],  // #3D5A80 (テーブルヘッダーなど)
            LABEL_BG: [232, 236, 240],    // #E8ECF0 (二次元テーブルのラベル背景)
            LIGHT_BG: [240, 244, 248],    // #F0F4F8 (偶数行の背景など)
            BORDER: [176, 184, 196],      // #B0B8C4 (罫線など)
            TEXT_MAIN: [30, 41, 59],      // #1E293B (標準テキスト)
            TEXT_MUTED: [100, 116, 139],  // #64748B (補足情報など)
            RED: [239, 68, 68],           // #EF4444 (失効など)
            ORANGE: [217, 119, 6],        // #D97706 (期限接近など)
            GREEN: [22, 163, 74]          // #16A34A (有効など)
        },

        /**
         * 日付データを YYYY/MM/DD 形式の文字列に変換する
         * @param {*} dateVal - Firestore Timestamp, ISO文字列, Dateオブジェクト等
         * @param {string} fallback - 日付が不正・未設定の場合の代替文字
         */
        formatDate(dateVal, fallback = '―') {
            if (!dateVal) return fallback;
            let d = null;
            if (typeof dateVal.toDate === 'function') {
                d = dateVal.toDate();
            } else if (dateVal instanceof Date) {
                d = dateVal;
            } else if (typeof dateVal === 'string' || typeof dateVal === 'number') {
                d = new Date(dateVal);
            }

            if (!d || isNaN(d.getTime())) return fallback;

            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}/${month}/${day}`;
        },

        /**
         * 許認可の「有効期限」から残り日数を計算する
         * @param {*} expiryDate - 有効期限
         */
        calculateRemainingDays(expiryDate) {
            if (!expiryDate) return null;
            let d = null;
            if (typeof expiryDate.toDate === 'function') {
                d = expiryDate.toDate();
            } else if (expiryDate instanceof Date) {
                d = expiryDate;
            } else {
                d = new Date(expiryDate);
            }

            if (!d || isNaN(d.getTime())) return null;

            d.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        },

        /**
         * 有効期限から「状態」を判定する
         * @param {*} expiryDate - 有効期限
         */
        getLicenseStatus(expiryDate) {
            const days = this.calculateRemainingDays(expiryDate);
            if (days === null) return '有効'; // 期限のないものは「有効」扱い
            if (days < 0) return '失効';
            if (days <= 90) return '期限接近';
            return '有効';
        },

        /**
         * ライセンス番号を整形する
         */
        formatLicenseNumber(l) {
            if (!l) return '―';
            const n1 = l.license_number_1 || '';
            const n2 = l.license_number_2 || '';
            if (!n1 && !n2) return '―';
            return n1 + (n2 ? '-' + n2 : '');
        },

        /**
         * 文字列を指定された幅(mm)に収まるように切り詰めて「...」を付与する (はみ出し防止用)
         * @param {jsPDF} doc - jsPDF インスタンス
         * @param {string} text - 対象の文字列
         * @param {number} maxWidth - 最大幅 (mm)
         * @param {number} fontSize - フォントサイズ (pt)
         */
        truncateText(doc, text, maxWidth, fontSize) {
            if (!text) return '';
            doc.setFontSize(fontSize);
            // getTextWidth は mm 単位の幅を返す
            let w = doc.getTextWidth(text);
            if (w <= maxWidth) return text;

            let truncated = text;
            while (doc.getTextWidth(truncated + '...') > maxWidth && truncated.length > 0) {
                truncated = truncated.slice(0, -1);
            }
            return truncated + '...';
        },

        /**
         * 文字列を自動折り返しして行の配列を返す (はみ出し防止用)
         * @param {jsPDF} doc - jsPDF インスタンス
         * @param {string} text - 対象の文字列
         * @param {number} maxWidth - 最大幅 (mm)
         * @param {number} fontSize - フォントサイズ (pt)
         */
        splitTextToSize(doc, text, maxWidth, fontSize) {
            if (!text) return [];
            doc.setFontSize(fontSize);
            return doc.splitTextToSize(text, maxWidth);
        },

        /**
         * jsPDF.text の安全なラッパー
         * undefined / null を安全にフォールバック（デフォルト: '―'）し、型を保証して描画する
         * @param {jsPDF} doc - jsPDF インスタンス
         * @param {string|number|Array} text - 描画対象
         * @param {number} x - X座標
         * @param {number} y - Y座標
         * @param {Object} [options] - jsPDF オプション (align, renderingMode 等)
         * @param {string} [fallback='―'] - text が undefined / null / 空文字の場合の代替文字 (空文字指定で非表示も可)
         */
        safeText(doc, text, x, y, options = undefined, fallback = '―') {
            if (!doc) return;
            let safeVal = text;
            if (safeVal === undefined || safeVal === null || safeVal === '') {
                safeVal = fallback;
            }
            if (typeof safeVal === 'number') {
                safeVal = String(safeVal);
            }
            if (Array.isArray(safeVal)) {
                safeVal = safeVal.map(item => (item === undefined || item === null ? fallback : String(item)));
            }
            if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
                console.warn('safeText: 無効な座標です', { x, y, text: safeVal });
                return;
            }
            if (safeVal === '') return; // 空文字の場合は描画スキップ
            doc.text(safeVal, x, y, options);
        }
    };
})();
