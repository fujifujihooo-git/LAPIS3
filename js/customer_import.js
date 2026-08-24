/**
 * LAPIS3 顧客CSVインポート機能モジュール
 * 
 * 責務:
 *   - Phase 2: モーダル開閉・表示制御
 *   - Phase 3: CSVファイルの読込・文字コード自動判定 (UTF-8 / Shift-JIS)・パース・ヘッダー解決
 *   - Phase 4: バリデーション＆重複判定（法人番号・顧客名・CSV内）・プレビュー描画
 *   - Phase 5: Firestoreへの100件分割バッチ一括登録 (予定)
 */

(function (window) {
    'use strict';

    // --- ヘッダーエイリアスマッピング定義 ---
    const HEADER_ALIASES = {
        customer_name: ['customer_name', 'name', '顧客名', '会社名', '氏名', '名前'],
        customer_kana: ['customer_kana', 'kana', 'フリガナ', 'カナ', '顧客名カナ', '会社名カナ'],
        customer_type: ['customer_type', '区分', '顧客区分', '種別'],
        representative_name: ['representative_name', '代表者名', '代表者', '代表'],
        corporate_number: ['corporate_number', '法人番号'],
        postal_code: ['postal_code', '郵便番号', '〒', 'zip'],
        address: ['address', '住所', '所在地', '本社所在地'],
        building_name: ['building_name', '建物名', 'ビル名', '建物'],
        phone: ['phone', '電話番号', '電話', 'tel', '連絡先'],
        fax: ['fax', 'fax番号'],
        email: ['email', 'メールアドレス', 'メール', 'mail', 'e-mail'],
        remarks: ['remarks', 'memo', '備考', '特記事項', 'メモ']
    };

    const CustomerImporter = {
        // --- 内部状態 ---
        _initialized: false,
        _modalEl: null,
        _btnCloseEl: null,
        _btnCancelEl: null,
        _btnOpenEl: null,
        _dropzoneEl: null,
        _fileInputEl: null,
        _btnReselectEl: null,
        _btnExecuteEl: null,
        _onCompleteCallback: null,

        // --- Phase 3 / Phase 4 解析・判定結果 ---
        _fileName: '',
        _detectedEncoding: '',
        _rawHeaderRow: [],
        _parsedRows: [],     // [ { _rowNumber: 2, customer_name: '...', ... }, ... ]
        _validatedRows: [],  // [ { rowNumber: 2, status: 'ok'|'warning'|'error', messages: [...], data: {...}, raw: {...} }, ... ]
        _currentFilter: 'all', // 'all' | 'warn' | 'error'

        /**
         * 初期化処理
         * @param {Object} options - { onComplete: Function }
         */
        init: function (options) {
            if (this._initialized) {
                return;
            }

            options = options || {};
            this._onCompleteCallback = options.onComplete || null;

            // DOM要素取得
            this._modalEl = document.getElementById('modal-customer-import');
            this._btnOpenEl = document.getElementById('btn-import-csv');
            this._btnCloseEl = document.getElementById('btn-close-import-modal');
            this._btnCancelEl = document.getElementById('btn-cancel-import');
            this._dropzoneEl = document.getElementById('import-dropzone');
            this._fileInputEl = document.getElementById('input-csv-file');
            this._btnReselectEl = document.getElementById('btn-reselect-csv');
            this._btnExecuteEl = document.getElementById('btn-execute-import');

            if (!this._modalEl) {
                console.warn('[CustomerImporter] Modal element (#modal-customer-import) not found.');
                return;
            }

            // イベントバインド
            this._bindEvents();

            this._initialized = true;
            console.log('[CustomerImporter] Initialized successfully (Phase 4: Validation & Preview Ready)');
        },

        /**
         * イベントリスナーの登録（多重登録防止）
         */
        _bindEvents: function () {
            const self = this;

            // 1. 開くボタン
            if (this._btnOpenEl) {
                this._btnOpenEl.addEventListener('click', function () {
                    self.openModal();
                });
            }

            // 2. 閉じるボタン（×）
            if (this._btnCloseEl) {
                this._btnCloseEl.addEventListener('click', function () {
                    self.closeModal();
                });
            }

            // 3. キャンセルボタン
            if (this._btnCancelEl) {
                this._btnCancelEl.addEventListener('click', function () {
                    self.closeModal();
                });
            }

            // 4. 背景（オーバーレイ）クリックで閉じる
            if (this._modalEl) {
                this._modalEl.addEventListener('click', function (e) {
                    if (e.target === self._modalEl) {
                        self.closeModal();
                    }
                });
            }

            // 5. ESCキーで閉じる
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' || e.keyCode === 27) {
                    if (self._modalEl && self._modalEl.style.display === 'flex') {
                        self.closeModal();
                    }
                }
            });

            // 6. ファイル選択＆ドラッグ＆ドロップ（Phase 3）
            if (this._dropzoneEl && this._fileInputEl) {
                this._dropzoneEl.addEventListener('click', function () {
                    self._fileInputEl.click();
                });

                this._fileInputEl.addEventListener('change', function (e) {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                        self.handleFileSelect(files[0]);
                    }
                });

                this._dropzoneEl.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._dropzoneEl.style.borderColor = 'var(--primary)';
                    self._dropzoneEl.style.background = '#eef2ff';
                });

                this._dropzoneEl.addEventListener('dragleave', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._dropzoneEl.style.borderColor = '#cbd5e1';
                    self._dropzoneEl.style.background = '#f8fafc';
                });

                this._dropzoneEl.addEventListener('drop', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._dropzoneEl.style.borderColor = '#cbd5e1';
                    self._dropzoneEl.style.background = '#f8fafc';

                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                        self.handleFileSelect(files[0]);
                    }
                });
            }

            // 7. ファイル再選択ボタン（Phase 4）
            if (this._btnReselectEl) {
                this._btnReselectEl.addEventListener('click', function () {
                    self.resetState();
                });
            }

            // 8. プレビュー絞り込みラジオボタン（Phase 4）
            const filterRadios = document.querySelectorAll('input[name="preview-filter"]');
            filterRadios.forEach(radio => {
                radio.addEventListener('change', function (e) {
                    self._currentFilter = e.target.value;
                    self.renderPreviewTable();
                });
            });

            // 9. 登録実行ボタン（Phase 5用フック）
            if (this._btnExecuteEl) {
                this._btnExecuteEl.addEventListener('click', function () {
                    self.handleExecuteImport();
                });
            }

            // 10. 雛形CSVダウンロードリンク
            const linkDownload = document.getElementById('link-download-template');
            if (linkDownload) {
                linkDownload.addEventListener('click', function (e) {
                    e.preventDefault();
                    self.downloadTemplateCsv();
                });
            }
        },

        /**
         * 雛形CSVファイル（UTF-8 BOM付き）のダウンロード
         */
        downloadTemplateCsv: function () {
            const header = '顧客名,フリガナ,区分,代表者名,法人番号,郵便番号,住所,建物名,電話番号,FAX番号,メールアドレス,備考';
            const sampleRow = '株式会社アイウ建設,カブシキガイシャアイウケンセツ,法人,愛羽 太郎,9876543210123,100-0001,東京都千代田区千代田1-1,サンプルビル5F,03-1111-2222,03-1111-2223,info@aiu-kensetsu.co.jp,移行データ例';
            const csvContent = `${header}\r\n${sampleRow}\r\n`;

            // Excelで文字化けしないよう UTF-8 BOM を付与
            const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
            const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = 'customer_import_template.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        /**
         * モーダル表示
         */
        openModal: function () {
            if (!this._modalEl) return;
            this.resetState();
            this._modalEl.style.display = 'flex';
        },

        /**
         * モーダル非表示
         */
        closeModal: function () {
            if (!this._modalEl) return;
            this._modalEl.style.display = 'none';
            this.resetState();
        },

        /**
         * 状態リセット
         */
        resetState: function () {
            const stepUpload = document.getElementById('import-step-upload');
            const stepPreview = document.getElementById('import-step-preview');
            const stepProgress = document.getElementById('import-step-progress');

            if (stepUpload) stepUpload.style.display = 'block';
            if (stepPreview) stepPreview.style.display = 'none';
            if (stepProgress) stepProgress.style.display = 'none';
            if (this._btnExecuteEl) {
                this._btnExecuteEl.style.display = 'none';
                this._btnExecuteEl.disabled = false;
            }
            if (this._fileInputEl) this._fileInputEl.value = '';

            // フィルタをすべてに戻す
            const defaultFilter = document.querySelector('input[name="preview-filter"][value="all"]');
            if (defaultFilter) defaultFilter.checked = true;

            this._fileName = '';
            this._detectedEncoding = '';
            this._rawHeaderRow = [];
            this._parsedRows = [];
            this._validatedRows = [];
            this._currentFilter = 'all';
        },

        // =========================================================================
        // Phase 3 & 4: CSV読込・文字コード判定・パース・バリデーション＆重複判定
        // =========================================================================

        /**
         * ファイル選択ハンドラ
         * @param {File} file
         */
        handleFileSelect: async function (file) {
            if (!file) return;
            const self = this;
            this._fileName = file.name;

            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // 1. 文字コード判定 (UTF-8 BOM -> UTF-8 -> Shift-JIS)
                    const encInfo = self.detectEncoding(uint8Array);
                    self._detectedEncoding = encInfo.encodingName;

                    // 2. デコード
                    const text = self.decodeText(uint8Array, encInfo);

                    // 3. CSVパース (RFC4180準拠)
                    const rawRows = self.parseCSV(text);

                    // 4. ヘッダー解決＆行オブジェクト配列生成
                    self._parsedRows = self.mapHeadersAndBuildObjects(rawRows);

                    console.log(`[CustomerImporter] Parse Success: ${file.name} (${self._detectedEncoding}), Rows: ${self._parsedRows.length}`);

                    // 5. Phase 4: Firestore既存顧客インデックス取得（1回のみ）＆重複判定・バリデーション
                    const existingIndex = await self.fetchExistingCustomerIndexes();
                    self._validatedRows = self.validateAndDetectDuplicates(self._parsedRows, existingIndex);

                    // 6. Phase 4: プレビュー画面描画
                    self.showPreviewScreen();

                } catch (err) {
                    console.error('[CustomerImporter] File read/parse error:', err);
                    alert('CSVファイルの解析に失敗しました: ' + err.message);
                    self.resetState();
                }
            };

            reader.onerror = function () {
                alert('ファイルの読み込みに失敗しました。');
                self.resetState();
            };

            reader.readAsArrayBuffer(file);
        },

        /**
         * 文字コード判定
         * @param {Uint8Array} uint8Array
         * @returns {{ encoding: string, encodingName: string, hasBom: boolean }}
         */
        detectEncoding: function (uint8Array) {
            // 1. UTF-8 BOM チェック (0xEF, 0xBB, 0xBF)
            if (uint8Array.length >= 3 && uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
                return { encoding: 'utf-8', encodingName: 'UTF-8 (BOM付き)', hasBom: true };
            }

            // 2. UTF-8 strict デコード試行
            try {
                const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                utf8Decoder.decode(uint8Array);
                return { encoding: 'utf-8', encodingName: 'UTF-8', hasBom: false };
            } catch (e) {
                // 3. UTF-8 で不正バイト列検知時は Shift-JIS (CP932)
                return { encoding: 'shift_jis', encodingName: 'Shift-JIS (CP932)', hasBom: false };
            }
        },

        /**
         * バイト配列のテキストデコード
         * @param {Uint8Array} uint8Array
         * @param {Object} encInfo
         * @returns {string}
         */
        decodeText: function (uint8Array, encInfo) {
            if (encInfo.hasBom) {
                const subArray = uint8Array.subarray(3);
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(subArray);
            } else if (encInfo.encoding === 'shift_jis') {
                const decoder = new TextDecoder('shift_jis');
                return decoder.decode(uint8Array);
            } else {
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(uint8Array);
            }
        },

        /**
         * RFC4180準拠のCSVパーサー
         * @param {string} text
         * @returns {Array<Array<string>>}
         */
        parseCSV: function (text) {
            const rows = [];
            let currentRow = [];
            let currentCell = '';
            let inQuotes = false;
            let i = 0;
            const len = text.length;

            while (i < len) {
                const char = text[i];
                const nextChar = text[i + 1];

                if (inQuotes) {
                    if (char === '"') {
                        if (nextChar === '"') {
                            currentCell += '"';
                            i += 2;
                            continue;
                        } else {
                            inQuotes = false;
                            i++;
                            continue;
                        }
                    } else {
                        currentCell += char;
                        i++;
                        continue;
                    }
                } else {
                    if (char === '"') {
                        inQuotes = true;
                        i++;
                        continue;
                    } else if (char === ',') {
                        currentRow.push(currentCell);
                        currentCell = '';
                        i++;
                        continue;
                    } else if (char === '\r') {
                        if (nextChar === '\n') {
                            i++;
                        }
                        currentRow.push(currentCell);
                        currentCell = '';
                        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0].trim() === '')) {
                            rows.push(currentRow);
                        }
                        currentRow = [];
                        i++;
                        continue;
                    } else if (char === '\n') {
                        currentRow.push(currentCell);
                        currentCell = '';
                        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0].trim() === '')) {
                            rows.push(currentRow);
                        }
                        currentRow = [];
                        i++;
                        continue;
                    } else {
                        currentCell += char;
                        i++;
                        continue;
                    }
                }
            }

            if (currentCell.length > 0 || currentRow.length > 0) {
                currentRow.push(currentCell);
                if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0].trim() === '')) {
                    rows.push(currentRow);
                }
            }

            return rows;
        },

        /**
         * ヘッダー行を解決し、行オブジェクトの配列を構築する
         * @param {Array<Array<string>>} rawRows
         * @returns {Array<Object>}
         */
        mapHeadersAndBuildObjects: function (rawRows) {
            if (!rawRows || rawRows.length === 0) {
                throw new Error('CSVファイルにデータ行が存在しません。');
            }

            const headerRow = rawRows[0];
            this._rawHeaderRow = headerRow;
            const dataRows = rawRows.slice(1);

            if (dataRows.length === 0) {
                throw new Error('ヘッダー行のみで、取り込み対象のデータ行が存在しません。');
            }

            const columnMap = {};
            headerRow.forEach((rawColName, colIdx) => {
                const cleanName = (rawColName || '').trim().toLowerCase();
                for (const [standardKey, aliases] of Object.entries(HEADER_ALIASES)) {
                    if (aliases.some(alias => alias.toLowerCase() === cleanName)) {
                        columnMap[colIdx] = standardKey;
                        break;
                    }
                }
            });

            const resultObjects = dataRows.map((row, rowIdx) => {
                const rowObj = {
                    _rowNumber: rowIdx + 2
                };

                row.forEach((cellVal, colIdx) => {
                    const standardKey = columnMap[colIdx];
                    if (standardKey) {
                        rowObj[standardKey] = (cellVal || '').trim();
                    }
                });

                return rowObj;
            });

            return resultObjects;
        },

        // =========================================================================
        // Phase 4: バリデーション＆重複判定＆プレビュー描画ロジック
        // =========================================================================

        /**
         * 1行データの正規化（全角半角、ハイフン、トリム）
         * @param {Object} rawRow
         * @returns {Object}
         */
        normalizeCustomerRow: function (rawRow) {
            const normalized = {};

            // 全角数字 -> 半角数字変換ヘルパー
            const toHalfDigits = (str) => {
                if (!str) return '';
                return String(str).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            };

            // ハイフン正規化ヘルパー (全角長音、ダッシュ、全角ハイフン -> 半角ハイフン)
            const normalizeHyphens = (str) => {
                if (!str) return '';
                return String(str).replace(/[ー―‐－–—]/g, '-');
            };

            // 1. 顧客名
            normalized.customer_name = (rawRow.customer_name || '').trim();

            // 2. フリガナ
            normalized.customer_kana = (rawRow.customer_kana || '').trim();

            // 3. 代表者名
            normalized.representative_name = (rawRow.representative_name || '').trim();

            // 4. 法人番号（全角半角化 + 数字以外除去）
            const rawCorp = toHalfDigits(rawRow.corporate_number || '').trim();
            normalized.corporate_number = rawCorp.replace(/\D/g, '');

            // 5. 郵便番号（全角半角化 + ハイフン正規化 + 7桁整形）
            let rawZip = normalizeHyphens(toHalfDigits(rawRow.postal_code || '')).trim();
            if (/^\d{7}$/.test(rawZip)) {
                rawZip = rawZip.slice(0, 3) + '-' + rawZip.slice(3);
            }
            normalized.postal_code = rawZip;

            // 6. 住所・建物名
            normalized.address = (rawRow.address || '').trim();
            normalized.building_name = (rawRow.building_name || '').trim();

            // 7. 電話番号・FAX
            normalized.phone = normalizeHyphens(toHalfDigits(rawRow.phone || '')).trim();
            normalized.fax = normalizeHyphens(toHalfDigits(rawRow.fax || '')).trim();

            // 8. メールアドレス
            normalized.email = (rawRow.email || '').trim();

            // 9. 備考
            normalized.remarks = (rawRow.remarks || '').trim();

            // 10. 顧客区分（customer_type）
            // 未指定時の処理はバリデーション内で判定
            normalized.customer_type = (rawRow.customer_type || '').trim();

            return normalized;
        },

        /**
         * Firestoreから既存顧客のインデックス情報を一括取得（1回のみ）
         * @returns {Promise<{ corporateNumberMap: Map, customerNameSet: Set }>}
         */
        fetchExistingCustomerIndexes: async function () {
            const corporateNumberMap = new Map(); // corporate_number -> { customer_id, customer_name }
            const customerNameSet = new Set();       // customer_name -> true

            try {
                if (typeof db !== 'undefined' && db && db.collection) {
                    const snapshot = await db.collection('customers').get();
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        if (d.corporate_number) {
                            const cleanCorp = String(d.corporate_number).replace(/\D/g, '');
                            if (cleanCorp.length === 13) {
                                corporateNumberMap.set(cleanCorp, {
                                    customer_id: d.customer_id,
                                    customer_name: d.customer_name || ''
                                });
                            }
                        }
                        if (d.customer_name) {
                            customerNameSet.add(d.customer_name.trim());
                        }
                    });
                    console.log(`[CustomerImporter] Loaded existing index: ${corporateNumberMap.size} corp numbers, ${customerNameSet.size} customer names`);
                }
            } catch (err) {
                console.warn('[CustomerImporter] Failed to fetch existing customer indexes (offline or permissions):', err);
            }

            return { corporateNumberMap, customerNameSet };
        },

        /**
         * バリデーション＆重複判定（法人番号・顧客名・CSV内）
         * @param {Array<Object>} parsedRows
         * @param {Object} existingIndex - { corporateNumberMap, customerNameSet }
         * @returns {Array<Object>} validatedRows
         */
        validateAndDetectDuplicates: function (parsedRows, existingIndex) {
            const self = this;
            const corporateNumberMap = existingIndex.corporateNumberMap || new Map();
            const customerNameSet = existingIndex.customerNameSet || new Set();

            // CSVファイル内での出現頻度を事前カウント
            const csvCorpCount = new Map();
            const csvNameCount = new Map();

            parsedRows.forEach(row => {
                const norm = self.normalizeCustomerRow(row);
                if (norm.corporate_number && norm.corporate_number.length === 13) {
                    csvCorpCount.set(norm.corporate_number, (csvCorpCount.get(norm.corporate_number) || 0) + 1);
                }
                if (norm.customer_name) {
                    csvNameCount.set(norm.customer_name, (csvNameCount.get(norm.customer_name) || 0) + 1);
                }
            });

            // 各行の判定
            const validatedList = parsedRows.map(row => {
                const norm = self.normalizeCustomerRow(row);
                let status = 'ok';
                const messages = [];

                // 1. 顧客名チェック (必須)
                if (!norm.customer_name) {
                    status = 'error';
                    messages.push('顧客名が未入力です');
                } else {
                    // 既存顧客名との完全一致チェック (警告)
                    if (customerNameSet.has(norm.customer_name)) {
                        if (status !== 'error') status = 'warning';
                        messages.push('既存顧客と同名です（要確認）');
                    }
                    // CSVファイル内での同名重複チェック (警告)
                    if ((csvNameCount.get(norm.customer_name) || 0) > 1) {
                        if (status !== 'error') status = 'warning';
                        messages.push('CSVファイル内に同一顧客名が存在します');
                    }
                }

                // 2. 法人番号チェック (任意入力)
                if (norm.corporate_number) {
                    if (norm.corporate_number.length !== 13) {
                        status = 'error';
                        messages.push('法人番号は半角数字13桁で入力してください');
                    } else {
                        // 既存顧客の法人番号と重複チェック (警告)
                        if (corporateNumberMap.has(norm.corporate_number)) {
                            if (status !== 'error') status = 'warning';
                            const exist = corporateNumberMap.get(norm.corporate_number);
                            messages.push(`既存顧客と法人番号が一致（ID: ${exist.customer_id} / ${exist.customer_name}）`);
                        }
                        // CSVファイル内での法人番号重複チェック (警告)
                        if ((csvCorpCount.get(norm.corporate_number) || 0) > 1) {
                            if (status !== 'error') status = 'warning';
                            messages.push('CSVファイル内で法人番号が重複しています');
                        }
                    }
                }

                // 3. 顧客区分（customer_type）の判定
                // 全角・半角スペースを除去
                norm.customer_type = (norm.customer_type || '').replace(/[\s　]+/g, '');
                if (!norm.customer_type) {
                    if (norm.corporate_number && norm.corporate_number.length === 13) {
                        norm.customer_type = '法人';
                    } else {
                        norm.customer_type = '未設定';
                        if (status !== 'error') status = 'warning';
                        messages.push('区分未指定（法人番号なし）のため「未設定」として登録します');
                    }
                } else if (!['法人', '個人'].includes(norm.customer_type)) {
                    // 「法人」「個人」以外の文字列（例: 個人事業主, 法人会社等）が入力された場合
                    const rawType = norm.customer_type;
                    norm.customer_type = '未設定';
                    if (status !== 'error') status = 'warning';
                    messages.push(`区分「${rawType}」は未定義のため「未設定」として登録します`);
                }

                // 4. メールアドレス形式チェック (任意入力: 不正時は警告として登録可)
                if (norm.email) {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(norm.email)) {
                        if (status !== 'error') status = 'warning';
                        messages.push('メールアドレスの形式が不正です（登録後に確認・修正してください）');
                    }
                }

                return {
                    rowNumber: row._rowNumber,
                    status: status, // 'ok' | 'warning' | 'error'
                    messages: messages,
                    data: norm,
                    raw: row
                };
            });

            return validatedList;
        },

        /**
         * プレビュー画面の表示切替
         */
        showPreviewScreen: function () {
            const stepUpload = document.getElementById('import-step-upload');
            const stepPreview = document.getElementById('import-step-preview');
            const fileNameEl = document.getElementById('preview-file-name');
            const encodingEl = document.getElementById('preview-file-encoding');

            if (stepUpload) stepUpload.style.display = 'none';
            if (stepPreview) stepPreview.style.display = 'block';

            if (fileNameEl) fileNameEl.textContent = this._fileName;
            if (encodingEl) encodingEl.textContent = this._detectedEncoding;

            this.updateSummaryCounts();
            this.renderPreviewTable();
        },

        /**
         * サマリーカードの件数更新
         */
        updateSummaryCounts: function () {
            const total = this._validatedRows.length;
            const okCount = this._validatedRows.filter(r => r.status === 'ok').length;
            const warnCount = this._validatedRows.filter(r => r.status === 'warning').length;
            const errorCount = this._validatedRows.filter(r => r.status === 'error').length;
            const importableCount = okCount + warnCount;

            const totalEl = document.getElementById('summary-total-count');
            const okEl = document.getElementById('summary-ok-count');
            const warnEl = document.getElementById('summary-warn-count');
            const errorEl = document.getElementById('summary-error-count');

            const filterAllEl = document.getElementById('filter-count-all');
            const filterWarnEl = document.getElementById('filter-count-warn');
            const filterErrorEl = document.getElementById('filter-count-error');
            const errorNoticeEl = document.getElementById('import-error-notice');

            if (totalEl) totalEl.textContent = total;
            if (okEl) okEl.textContent = okCount;
            if (warnEl) warnEl.textContent = warnCount;
            if (errorEl) errorEl.textContent = errorCount;

            if (filterAllEl) filterAllEl.textContent = total;
            if (filterWarnEl) filterWarnEl.textContent = warnCount;
            if (filterErrorEl) filterErrorEl.textContent = errorCount;

            // エラーが存在する場合は除外案内を表示
            if (errorNoticeEl) {
                errorNoticeEl.style.display = errorCount > 0 ? 'block' : 'none';
            }

            // 登録実行ボタンの表示・テキスト制御
            if (this._btnExecuteEl) {
                if (importableCount > 0) {
                    this._btnExecuteEl.style.display = 'inline-block';
                    if (errorCount > 0) {
                        this._btnExecuteEl.textContent = `🟢 ${importableCount}件を登録実行 (エラー除外)`;
                    } else {
                        this._btnExecuteEl.textContent = `🟢 ${importableCount}件を登録実行`;
                    }
                } else {
                    this._btnExecuteEl.style.display = 'none';
                }
            }
        },

        /**
         * プレビューテーブルの描画（フィルタリング適用）
         */
        renderPreviewTable: function () {
            const tbody = document.getElementById('import-preview-body');
            if (!tbody) return;

            tbody.innerHTML = '';

            const filteredRows = this._validatedRows.filter(row => {
                if (this._currentFilter === 'warn') return row.status === 'warning';
                if (this._currentFilter === 'error') return row.status === 'error';
                return true; // 'all'
            });

            if (filteredRows.length === 0) {
                const emptyTr = document.createElement('tr');
                emptyTr.innerHTML = `<td colspan="7" style="text-align: center; color: #94a3b8; padding: 24px;">該当するデータはありません</td>`;
                tbody.appendChild(emptyTr);
                return;
            }

            filteredRows.forEach(row => {
                const tr = document.createElement('tr');

                // 判定バッジスタイル
                let badgeHtml = '';
                let rowBg = '';
                if (row.status === 'ok') {
                    badgeHtml = '<span class="badge" style="background: #dcfce7; color: #166534; font-weight: 600; padding: 3px 8px; border-radius: 4px;">🟢 正常</span>';
                } else if (row.status === 'warning') {
                    badgeHtml = '<span class="badge" style="background: #fef3c7; color: #92400e; font-weight: 600; padding: 3px 8px; border-radius: 4px;">🟡 警告</span>';
                    rowBg = 'background: #fffdf5;';
                } else {
                    badgeHtml = '<span class="badge" style="background: #fee2e2; color: #991b1b; font-weight: 600; padding: 3px 8px; border-radius: 4px;">🔴 エラー</span>';
                    rowBg = 'background: #fef5f5;';
                }

                if (rowBg) tr.setAttribute('style', rowBg);

                // メッセージリスト
                let reasonHtml = '';
                if (row.messages && row.messages.length > 0) {
                    reasonHtml = row.messages.map(m => `<div style="font-size: 0.75rem; line-height: 1.3; color: ${row.status === 'error' ? '#b91c1c' : '#b45309'};">• ${m}</div>`).join('');
                } else {
                    reasonHtml = '<span style="color: #94a3b8; font-size: 0.75rem;">登録可能</span>';
                }

                tr.innerHTML = `
                    <td style="text-align: center; font-family: monospace; color: #64748b;">${row.rowNumber}</td>
                    <td style="text-align: center;">${badgeHtml}</td>
                    <td><strong>${row.data.customer_name || '<span style="color:#ef4444">(空欄)</span>'}</strong><br><small style="color: #64748b;">${row.data.customer_kana || ''}</small></td>
                    <td><span style="font-size: 0.8rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${row.data.customer_type || '-'}</span></td>
                    <td style="font-family: monospace;">${row.data.corporate_number || '-'}</td>
                    <td>${row.data.phone || '-'}</td>
                    <td>${reasonHtml}</td>
                `;

                tbody.appendChild(tr);
            });
        },

        /**
         * 登録実行ハンドラ（Phase 5-C: UI結合・プログレスバー・チャンク進捗・完了ダイアログ）
         */
        handleExecuteImport: async function () {
            const importable = this._validatedRows.filter(r => r.status === 'ok' || r.status === 'warning');
            const totalImportable = importable.length;

            if (totalImportable === 0) {
                alert('登録可能なデータがありません。');
                return null;
            }

            const errorCount = this._validatedRows.filter(r => r.status === 'error').length;
            let confirmMsg = `登録可能な ${totalImportable} 件の顧客データを一括登録します。\n`;
            if (errorCount > 0) {
                confirmMsg += `（※ 🔴 エラーの ${errorCount} 件は自動除外されます）\n`;
            }
            confirmMsg += `\n登録を実行してよろしいですか？`;

            if (!confirm(confirmMsg)) {
                return null;
            }

            const stepPreview = document.getElementById('import-step-preview');
            const stepProgress = document.getElementById('import-step-progress');
            const progressBar = document.getElementById('import-progress-bar');
            const progressText = document.getElementById('import-progress-text');
            const btnClose = this._btnCloseEl;
            const btnCancel = this._btnCancelEl;

            // UI切り替え: プレビュー非表示 -> 進捗バー表示
            if (stepPreview) stepPreview.style.display = 'none';
            if (stepProgress) stepProgress.style.display = 'block';

            // 登録中の誤操作防止 (ボタン非活性・非表示)
            if (this._btnExecuteEl) this._btnExecuteEl.style.display = 'none';
            if (btnClose) btnClose.style.display = 'none';
            if (btnCancel) btnCancel.style.display = 'none';

            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = `0 / ${totalImportable} 件完了 (準備中...)`;

            try {
                // コールバック経由で進捗更新
                const result = await this.executeBatchImport(importable, (processed, total, currentChunk, totalChunks) => {
                    const percent = Math.min(100, Math.round((processed / total) * 100));
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) {
                        progressText.textContent = `${processed} / ${total} 件完了 (${currentChunk}/${totalChunks} チャンク)`;
                    }
                });

                // 詳細完了ダイアログの構築
                let alertTitle = result.failedCount === 0 ? '【顧客CSVインポート完了】' : '【顧客CSVインポート完了（一部失敗）】';
                let alertMsg = `${alertTitle}\n\n`;
                alertMsg += `バッチID: ${result.batchId}\n`;
                alertMsg += `総件数: ${result.total}件\n`;
                alertMsg += `成功: ${result.successCount}件\n`;
                alertMsg += `失敗: ${result.failedCount}件\n\n`;

                if (result.successCount > 0) {
                    alertMsg += `採番範囲:\nID ${result.startId} 〜 ${result.endId}\n`;
                }
                if (result.failedCount > 0) {
                    alertMsg += `\n※ 失敗したデータは再度ご確認の上インポートしてください。`;
                }

                alert(alertMsg);

                // トースト表示
                if (typeof showToast === 'function') {
                    showToast(`${result.successCount}件の顧客データをインポートしました`, result.failedCount > 0 ? 'warning' : 'success');
                }

                // モーダルを閉じる
                this.closeModal();

                // 完了コールバック発火（一覧画面の再検索等）
                if (typeof this._onCompleteCallback === 'function') {
                    this._onCompleteCallback(result);
                }

                return result;

            } catch (err) {
                console.error('[CustomerImporter] Batch import error:', err);
                alert('インポート処理中に重大なエラーが発生しました: ' + err.message);
                
                // エラー時はプレビューに戻す
                if (stepProgress) stepProgress.style.display = 'none';
                if (stepPreview) stepPreview.style.display = 'block';
                if (this._btnExecuteEl) {
                    this._btnExecuteEl.style.display = 'inline-block';
                    this._btnExecuteEl.disabled = false;
                }
                if (btnClose) btnClose.style.display = 'block';
                if (btnCancel) btnCancel.style.display = 'inline-block';

                throw err;
            }
        },

        /**
         * Firestore 100件分割バッチ一括登録コアロジック
         * @param {Array<Object>} importableRows - validatedRows のうち登録可能な行リスト
         * @param {Function} onProgress - チャンク毎の進捗コールバック (processed, total, currentChunk, totalChunks)
         * @returns {Promise<{ total: number, successCount: number, failedCount: number, startId: number, endId: number, batchId: string, errors: Array }>}
         */
        executeBatchImport: async function (importableRows, onProgress) {
            const total = importableRows.length;
            if (total === 0) {
                return { total: 0, successCount: 0, failedCount: 0, startId: null, endId: null, batchId: null, errors: [] };
            }

            if (typeof db === 'undefined' || !db || !db.batch) {
                throw new Error('Firestore インスタンス (db) が初期化されていません。');
            }

            // 1. 一括連番採番（Phase 5-A トランザクション採番）
            const startId = await getNextSequenceBatch('customers', total);
            const now = new Date().toISOString();

            // 2. インポート実行単位の一意なバッチIDを発行（例: imp_20260821_154500_abc12）
            const batchTimestamp = now.replace(/\D/g, '').slice(0, 14);
            const batchRandom = Math.random().toString(36).substring(2, 7);
            const batchId = `imp_${batchTimestamp}_${batchRandom}`;

            // 3. handleSave() と完全一致するドキュメント配列を生成（+ import_batch_id 付与）
            const customerDocs = importableRows.map((item, idx) => {
                const customerId = startId + idx;
                const rowData = item.data;

                // 検索キー自動生成 (search_utils.js)
                const searchName = typeof generateSearchName === 'function'
                    ? generateSearchName(rowData.customer_name)
                    : (rowData.customer_name || '').toLowerCase();
                const searchKana = typeof generateSearchKana === 'function'
                    ? generateSearchKana(rowData.customer_kana)
                    : (rowData.customer_kana || '').toLowerCase();

                return {
                    customer_id: customerId, // 数値型 (Number)
                    customer_name: rowData.customer_name || '',
                    customer_kana: rowData.customer_kana || '',
                    customer_type: rowData.customer_type || '未設定',
                    representative_name: rowData.representative_name || '',
                    postal_code: rowData.postal_code || '',
                    address: rowData.address || '',
                    building_name: rowData.building_name || '',
                    phone: rowData.phone || '',
                    fax: rowData.fax || '',
                    email: rowData.email || '',
                    status: '稼働中',         // 初期値
                    nenga: 'なし',            // 初期値
                    chugen: 'なし',           // 初期値
                    fax_ok: '送信OK',         // 初期値
                    remarks: rowData.remarks || '',
                    fiscal_year_end_month: null,
                    fiscal_year_end_day: null,
                    founded_date: '',
                    capital: null,
                    employee_count: null,
                    corporate_number: rowData.corporate_number || '',
                    primary_staff_id: null,
                    last_updated: now,
                    created_date: now,
                    search_name: searchName,
                    search_kana: searchKana,
                    import_batch_id: batchId // ★ ロールバック・監査用バッチ識別子
                };
            });

            // 4. 100件単位の分割バッチ書き込み (Chunked Batch)
            const CHUNK_SIZE = 100;
            const totalChunks = Math.ceil(total / CHUNK_SIZE);
            let successCount = 0;
            let failedCount = 0;
            const errors = [];

            for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
                const chunk = customerDocs.slice(i, i + CHUNK_SIZE);
                const batch = db.batch();

                chunk.forEach(docData => {
                    const docRef = db.collection('customers').doc(`cust_${docData.customer_id}`);
                    batch.set(docRef, docData);
                });

                try {
                    await batch.commit();
                    successCount += chunk.length;
                    if (typeof onProgress === 'function') {
                        onProgress(successCount, total, chunkIndex, totalChunks);
                    }
                } catch (chunkErr) {
                    console.error(`[CustomerImporter] Chunk commit failed at chunk #${chunkIndex} (offset ${i}):`, chunkErr);
                    failedCount += chunk.length;
                    errors.push({
                        chunkIndex: chunkIndex,
                        offset: i,
                        count: chunk.length,
                        error: chunkErr.message
                    });
                    // 部分成功方針: 失敗時は以降のチャンクを中断して結果を返す
                    break;
                }
            }

            return {
                total: total,
                successCount: successCount,
                failedCount: failedCount,
                startId: startId,
                endId: startId + successCount - 1,
                batchId: batchId,
                errors: errors
            };
        }
    };

    // グローバル公開
    window.CustomerImporter = CustomerImporter;

    // DOM読み込み完了時に自動初期化
    document.addEventListener('DOMContentLoaded', function () {
        CustomerImporter.init();
    });

})(window);
