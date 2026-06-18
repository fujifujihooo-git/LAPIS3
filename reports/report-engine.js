/**
 * LAPIS3 帳票エンジン (Report Engine)
 * jsPDF + jspdf-autotable のロード管理、および日本語フォントの遅延ロードとキャッシュを提供します。
 */

(function () {
    'use strict';

    // 内部でのキャッシュ保持用
    let fontBase64Cache = null;
    let fontLoadPromise = null;

    window.ReportEngine = {
        /**
         * 必要な外部スクリプト（jsPDF, jspdf-autotable）を動的にロードする
         */
        async loadLibraries() {
            const jsPDFUrl = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            const autoTableUrl = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

            // 1. jsPDF を先にロードして完了を待つ
            await this.loadScript(jsPDFUrl);

            // window.jsPDF をグローバルに設定（jspdf-autotable が認識できるようにする）
            if (window.jspdf && window.jspdf.jsPDF) {
                window.jsPDF = window.jspdf.jsPDF;
            }

            // 2. その後に jspdf-autotable をロードする
            await this.loadScript(autoTableUrl);
        },

        /**
         * スクリプトをロードするヘルパー
         */
        loadScript(url) {
            return new Promise((resolve, reject) => {
                // すでに同等のスクリプトが存在する場合はスキップ
                if (document.querySelector(`script[src="${url}"]`)) {
                    resolve();
                    return;
                }
                // グローバル変数でチェック (jsPDF / jspdf-autotable)
                if (url.includes('jspdf.umd') && window.jspdf) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = url;
                script.onload = resolve;
                script.onerror = () => reject(new Error(`スクリプトの読み込みに失敗しました: ${url}`));
                document.head.appendChild(script);
            });
        },

        /**
         * 日本語フォント (NotoSansJP-Regular.ttf) を遅延ロードし、Base64キャッシュに格納する
         * @param {string} fontUrl - フォントのURL (デフォルト: report-system/report-templates/NotoSansJP-Regular.ttf)
         */
        loadFont(fontUrl = 'report-system/report-templates/NotoSansJP-Regular.ttf') {
            if (fontBase64Cache) {
                return Promise.resolve(fontBase64Cache);
            }

            // 二重ロード防止のためのPromiseキャッシュ
            if (fontLoadPromise) {
                return fontLoadPromise;
            }

            fontLoadPromise = (async () => {
                try {
                    const res = await fetch(fontUrl);
                    if (!res.ok) {
                        throw new Error(`Font fetch failed: status ${res.status}`);
                    }
                    const buf = await res.arrayBuffer();

                    // ArrayBuffer → Base64 変換 (Chunkサイズによるメモリオーバーフロー対策)
                    const bytes = new Uint8Array(buf);
                    let binary = '';
                    const chunkSize = 8192;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                    }
                    fontBase64Cache = btoa(binary);
                    return fontBase64Cache;
                } catch (e) {
                    fontLoadPromise = null; // エラー時はリトライできるようにクリア
                    console.error('[ReportEngine] Failed to load Japanese font:', e);
                    throw new Error('PDF出力に必要なフォントの読み込みに失敗しました');
                }
            })();

            return fontLoadPromise;
        },

        /**
         * jsPDF インスタンスの初期化と日本語フォント登録を行う
         * @param {Object} options - jsPDF 初期化オプション
         * @returns {Promise<jsPDF>} 初期化済みの jsPDF インスタンス
         */
        async initPDF(options = {}) {
            // ページが file:// プロトコルで直接開かれている場合は事前チェックでブロックし、わかりやすい警告を出す
            if (window.location && window.location.protocol === 'file:') {
                const errorMsg = 'ローカルのHTMLファイル (file://) から直接PDFを出力することはできません。Webサーバー (http://...) 経由で実行してください。';
                alert(errorMsg);
                throw new Error(errorMsg);
            }

            const defaultOptions = {
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            };
            const opts = Object.assign({}, defaultOptions, options);

            // 1. ライブラリロード
            await this.loadLibraries();

            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                throw new Error('jsPDF が正しくロードされていません。');
            }

            const doc = new jsPDF(opts);

            // 2. 日本語フォント取得
            let fontData;
            try {
                fontData = await this.loadFont();
            } catch (err) {
                // UT-016: フォントロード失敗時の挙動
                alert('PDF出力に必要なフォントの読み込みに失敗しました');
                throw err;
            }

            // 3. フォント登録
            doc.addFileToVFS('NotoSansJP-Regular.ttf', fontData);
            doc.addFont('NotoSansJP-Regular.ttf', 'NotoSansJP', 'normal');
            doc.setFont('NotoSansJP');

            return doc;
        },

        /**
         * 生成した PDF をブラウザ上でダウンロードする
         * @param {jsPDF} doc - jsPDF インスタンス
         * @param {string} filename - 保存するファイル名
         */
        downloadPDF(doc, filename) {
            if (!doc || typeof doc.save !== 'function') {
                throw new Error('有効な jsPDF インスタンスではありません。');
            }
            doc.save(filename);
        },

        /**
         * 生成した PDF を別タブでプレビューする
         * @param {jsPDF} doc - jsPDF インスタンス
         */
        previewPDF(doc) {
            if (!doc || typeof doc.output !== 'function') {
                throw new Error('有効な jsPDF インスタンスではありません。');
            }
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        }
    };
})();
