document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const btnSimulate = document.getElementById('btn-simulate');
    const btnExecute = document.getElementById('btn-run-import');
    const fileInput = document.getElementById('file-input');
    const importCard = document.getElementById('import-card');
    const errorAccess = document.getElementById('error-access');
    const summaryArea = document.getElementById('summary-area');
    const summaryText = document.getElementById('summary-text');
    const progressArea = document.getElementById('progress-area');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');

    let parsedDataStore = null; // { collectionName: [docs...] }
    let simulationResult = null; // Store dry-run results

    // Tier Loading Order (Master -> Parent -> Child -> Grandchild -> ...)
    const TIER_ORDER = [
        // Tier 1: システムマスタ・採番マスタ
        'staff', 'government_offices', 'license_types', 'counters',
        // Tier 2: 顧客基本情報
        'customers',
        // Tier 3: 顧客依存マスタ (事業所、連絡先、許認可、対応履歴)
        'offices', 'contacts', 'customer_licenses', 'customer_histories',
        // Tier 4: 案件・請求・入金 (案件、請求、入金、履歴ログ)
        'cases', 'invoices', 'receipts', 'license_history', 'case_status_history',
        // Tier 5: 請求依存の明細・紐付け (請求明細、入金消込)
        'invoice_items', 'receiptAllocations'
    ];

    // Collections that require customer_id
    const REQUIRES_CUSTOMER = ['offices', 'contacts', 'cases', 'customer_licenses', 'customer_histories', 'receipts'];
    // Collections that require case_id
    const REQUIRES_CASE = ['invoices', 'invoice_items', 'case_status_history'];

    // 1. Authentication & Role Check
    const checkRoleAndInit = async () => {
        setTimeout(async () => {
            const sessionData = localStorage.getItem('lapis3_session');
            if (!sessionData) return;

            try {
                const session = JSON.parse(sessionData);
                if (!session || !session.email) throw new Error("Invalid session");

                const staffData = await getDocFromFirestore('staff', 'email', session.email);
                if (staffData && staffData.authority === 'admin') {
                    importCard.style.display = 'block';
                    btnSimulate.addEventListener('click', handleSimulate);

                    // Safety Guard: Disable production web console imports
                    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
                    if (isLocal) {
                        btnExecute.addEventListener('click', handleExecute);
                    } else {
                        btnExecute.disabled = true;
                        btnExecute.innerText = "本番インポート無効化 (ローカル検証専用)";
                        const warningMsg = document.createElement('p');
                        warningMsg.style.color = 'red';
                        warningMsg.style.fontSize = '12px';
                        warningMsg.style.marginTop = '10px';
                        warningMsg.innerText = "【警告】誤操作防止のため、本番ホスティング環境でのUI復元は無効化されています。DR復帰はローカルエミュレータで検証の上、特権コマンドで実行してください。";
                        btnExecute.parentNode.appendChild(warningMsg);
                    }
                } else {
                    errorAccess.style.display = 'block';
                    setTimeout(() => { window.location.href = 'index.html'; }, 3000);
                }
            } catch (err) {
                console.error("Auth role check failed:", err);
                errorAccess.style.display = 'block';
                setTimeout(() => { window.location.href = 'index.html'; }, 3000);
            }
        }, 1000);
    };

    checkRoleAndInit();

    // 2. Parsers
    const parseJSON = (text) => {
        const obj = JSON.parse(text);

        // Version Compatibility check (UT-BK-018)
        if (obj.metadata && obj.metadata.version) {
            const SUPPORTED_MAJOR_VERSIONS = ["LAPIS3_DB_V1"];
            if (!SUPPORTED_MAJOR_VERSIONS.includes(obj.metadata.version)) {
                throw new Error(`互換性のないバックアップバージョンです: "${obj.metadata.version}"。システムが対応しているバージョンは [${SUPPORTED_MAJOR_VERSIONS.join(', ')}] です。`);
            }
        } else {
            throw new Error("不正なバックアップファイルフォーマットです (metadata.versionが見つかりません)");
        }

        if (!obj.data) throw new Error("不正なバックアップファイルフォーマットです (dataオブジェクトが見つかりません)");

        const result = {};
        for (const [colName, docs] of Object.entries(obj.data)) {
            // Un-serialize timestamps for JSON only
            result[colName] = Object.entries(docs).map(([id, data]) => {
                data._docId = id; // Preserve ID
                return restoreFirestoreDatatypes(data);
            });
        }
        return result;
    };

    const restoreFirestoreDatatypes = (data) => {
        if (data === null || data === undefined) return data;

        if (Array.isArray(data)) {
            return data.map(restoreFirestoreDatatypes);
        }

        if (typeof data === 'object') {
            if (data.__datatype__ === 'timestamp' && data.value) {
                return firebase.firestore.Timestamp.fromDate(new Date(data.value));
            }
            const newObj = {};
            for (const key in data) {
                newObj[key] = restoreFirestoreDatatypes(data[key]);
            }
            return newObj;
        }
        return data;
    };

    const parseCSVFile = (csvText) => {
        return new Promise((resolve, reject) => {
            Papa.parse(csvText.trim(), {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    resolve(results.data.map(heuristicsCast));
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    };

    const heuristicsCast = (row) => {
        const casted = {};
        for (let key in row) {
            let val = row[key];
            if (val === '') {
                casted[key] = null;
                continue;
            }
            // Try parse JSON array
            if (val.startsWith('[') && val.endsWith(']')) {
                try { casted[key] = JSON.parse(val); continue; } catch (e) { }
            }
            // Number casting (ignore phone numbers/zip codes starting with 0)
            if (!isNaN(val) && !(typeof val === 'string' && val.startsWith('0') && val.length > 1)) {
                casted[key] = Number(val);
                continue;
            }
            // ISO Date casting
            if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                casted[key] = firebase.firestore.Timestamp.fromDate(new Date(val));
                continue;
            }
            casted[key] = val;
        }
        return casted;
    };

    const handleFileParse = async (file) => {
        updateProgress('ファイルを読み込み中...', 10);
        return new Promise((resolve, reject) => {
            const ext = file.name.split('.').pop().toLowerCase();
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    let result = {};
                    if (ext === 'json') {
                        result = parseJSON(e.target.result);
                    }
                    else if (ext === 'zip') {
                        updateProgress('ZIP展開中...', 30);
                        const zip = await JSZip.loadAsync(e.target.result);
                        for (const filename of Object.keys(zip.files)) {
                            if (!filename.endsWith('.csv')) continue;
                            const colName = filename.replace('.csv', '');
                            const csvText = await zip.files[filename].async('string');
                            if (csvText.trim().length > 0) {
                                result[colName] = await parseCSVFile(csvText);
                            } else {
                                result[colName] = [];
                            }
                        }
                    }
                    else if (ext === 'xlsx') {
                        updateProgress('Excel展開中...', 30);
                        const wb = XLSX.read(e.target.result, { type: 'array' });
                        for (const sheetName of wb.SheetNames) {
                            const ws = wb.Sheets[sheetName];
                            const rows = XLSX.utils.sheet_to_json(ws);
                            result[sheetName] = rows.map(heuristicsCast);
                        }
                    }
                    else {
                        throw new Error('未対応のファイル型式です。JSON, ZIP(CSV), a Excelを選択してください。');
                    }
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('ファイル読み込みエラー'));

            if (ext === 'zip' || ext === 'xlsx') {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file); // JSON
            }
        });
    };

    // 3. Dry Run Engine
    const handleSimulate = async () => {
        const file = fileInput.files[0];
        if (!file) {
            alert("バックアップファイルを選択してください。");
            return;
        }

        btnSimulate.disabled = true;
        btnExecute.disabled = true;
        summaryArea.style.display = 'none';
        progressArea.style.display = 'block';

        try {
            parsedDataStore = await handleFileParse(file);

            updateProgress('データベースと照合中 (シミュレーション)...', 50);

            simulationResult = {
                collections: {},
                totalNew: 0,
                totalOverwritten: 0,
                totalErrors: 0,
                errorsList: []
            };

            // Pre-fetch all current DB IDs for fast check
            const dbRefStore = {};
            for (const colName of Object.keys(parsedDataStore)) {
                const snap = await db.collection(colName).get();
                dbRefStore[colName] = new Set(snap.docs.map(d => d.id));
            }

            // In-Memory Virtual Stores for dependency validation
            const virtualIds = {
                customers: new Set(dbRefStore['customers'] || []),
                cases: new Set(dbRefStore['cases'] || []),
                invoices: new Set(dbRefStore['invoices'] || []),
                receipts: new Set(dbRefStore['receipts'] || []),
                customer_licenses: new Set(dbRefStore['customer_licenses'] || [])
            };

            // Verify in Tier Order
            const processedCols = new Set();
            for (const col of TIER_ORDER) {
                if (!parsedDataStore[col]) continue;
                processedCols.add(col);
                evaluateCollection(col, parsedDataStore[col], dbRefStore[col], virtualIds);
            }
            // Evaluate any custom collections not in TIER_ORDER
            for (const col of Object.keys(parsedDataStore)) {
                if (!processedCols.has(col)) {
                    evaluateCollection(col, parsedDataStore[col], dbRefStore[col], virtualIds);
                }
            }

            renderSummary();
            updateProgress('シミュレーション完了', 100);

            if (simulationResult.totalErrors === 0 && Object.keys(parsedDataStore).length > 0) {
                btnExecute.disabled = false; // Enable if no errors
            }

        } catch (err) {
            console.error(err);
            alert("シミュレーション中にエラーが発生しました。\n" + err.message);
        } finally {
            btnSimulate.disabled = false;
            setTimeout(() => {
                if (progressArea) progressArea.style.display = 'none';
                if (progressFill) progressFill.style.width = '0%';
            }, 1500);
        }
    };

    const evaluateCollection = (colName, docs, existingIdsSet, virtualIds) => {
        simulationResult.collections[colName] = { new: 0, overwritten: 0, errors: 0 };
        const safeExistingSet = existingIdsSet || new Set();

        for (const doc of docs) {
            let docId = doc._docId;

            // Try reconstruct ID if missing (_docId is usually present from JSON)
            if (!docId) {
                if (colName === 'customers' && doc.customer_id) docId = `cust_${doc.customer_id}`;
                else if (colName === 'cases' && doc.case_id) docId = `case_${doc.case_id}`;
                else if (colName === 'staff' && doc.staff_id) docId = `stf_${doc.staff_id}`;
                else if (colName === 'customer_licenses' && doc.license_id) docId = `lic_${doc.license_id}`;
                else if (colName === 'licenses' && doc.license_id) docId = `lic_${doc.license_id}`;
                else if (colName === 'invoices' && doc.invoice_id) docId = `inv_${doc.invoice_id}`;
                else if (colName === 'receipts' && doc.receiptId) docId = doc.receiptId;
                else if (colName === 'offices' && doc.office_id) docId = `off_${doc.office_id}`;
                else if (colName === 'contacts' && doc.contact_id) docId = `cnt_${doc.contact_id}`;
                else if (colName === 'government_offices' && doc.id) docId = `gov_${doc.id}`;
                else if ((colName === 'case_status_history' || colName === 'license_history') && doc.history_id) docId = `hist_${doc.history_id}`;
                else docId = db.collection(colName).doc().id; // auto id
            }
            doc._docId = docId;

            let hasError = false;

            // Orphan Check
            if (REQUIRES_CUSTOMER.includes(colName) && doc.customer_id) {
                const targetId = `cust_${doc.customer_id}`;
                if (!virtualIds.customers.has(targetId)) {
                    simulationResult.errorsList.push(`[${colName}] 親の顧客が存在しません (customer_id: ${doc.customer_id})`);
                    hasError = true;
                }
            }

            if (REQUIRES_CASE.includes(colName) && doc.case_id) {
                const targetId = `case_${doc.case_id}`;
                if (!virtualIds.cases.has(targetId)) {
                    simulationResult.errorsList.push(`[${colName}] 親の案件が存在しません (case_id: ${doc.case_id})`);
                    hasError = true;
                }
            }

            // license_history specific check
            if (colName === 'license_history') {
                if (doc.license_id) {
                    const searchVal = String(doc.license_id);
                    if (!virtualIds.customer_licenses.has(searchVal) && !virtualIds.customer_licenses.has(`lic_${searchVal}`)) {
                        simulationResult.errorsList.push(`[license_history] 親の許認可が存在しません (license_id: ${doc.license_id})`);
                        hasError = true;
                    }
                } else {
                    simulationResult.errorsList.push(`[license_history] license_idがありません`);
                    hasError = true;
                }
            }

            // receiptAllocations specific check
            if (colName === 'receiptAllocations') {
                if (doc.invoiceId) {
                    if (!virtualIds.invoices.has(doc.invoiceId)) {
                        simulationResult.errorsList.push(`[receiptAllocations] 親の請求が存在しません (invoiceId: ${doc.invoiceId})`);
                        hasError = true;
                    }
                } else {
                    simulationResult.errorsList.push(`[receiptAllocations] invoiceIdがありません`);
                    hasError = true;
                }
                if (doc.receiptId) {
                    if (!virtualIds.receipts.has(doc.receiptId)) {
                        simulationResult.errorsList.push(`[receiptAllocations] 親の入金が存在しません (receiptId: ${doc.receiptId})`);
                        hasError = true;
                    }
                } else {
                    simulationResult.errorsList.push(`[receiptAllocations] receiptIdがありません`);
                    hasError = true;
                }
            }

            if (hasError) {
                simulationResult.collections[colName].errors++;
                simulationResult.totalErrors++;
            } else {
                // Upsert detection
                if (safeExistingSet.has(docId)) {
                    simulationResult.collections[colName].overwritten++;
                    simulationResult.totalOverwritten++;
                } else {
                    simulationResult.collections[colName].new++;
                    simulationResult.totalNew++;
                }

                // Register to virtual IDs for children to find
                if (colName === 'customers') virtualIds.customers.add(docId);
                if (colName === 'cases') virtualIds.cases.add(docId);
                if (colName === 'invoices') virtualIds.invoices.add(docId);
                if (colName === 'receipts') virtualIds.receipts.add(docId);
                if (colName === 'customer_licenses') virtualIds.customer_licenses.add(docId);
            }
        }
    };

    const renderSummary = () => {
        let text = `【総合結果】\n新規登録: ${simulationResult.totalNew} 件\n上書き: ${simulationResult.totalOverwritten} 件\nエラー: ${simulationResult.totalErrors} 件\n\n`;
        text += `【コレクション別】\n`;
        for (const [col, stats] of Object.entries(simulationResult.collections)) {
            if (stats.new > 0 || stats.overwritten > 0 || stats.errors > 0) {
                text += `- ${col}: 新規 ${stats.new}, 上書き ${stats.overwritten}, エラー ${stats.errors}\n`;
            }
        }

        if (simulationResult.errorsList.length > 0) {
            text += `\n【エラー詳細 (最大10件)】\n`;
            text += simulationResult.errorsList.slice(0, 10).join('\n');
            if (simulationResult.errorsList.length > 10) text += `\n...他 ${simulationResult.errorsList.length - 10} 件`;
            text += `\n\n⚠️ エラーを解消するまでインポートは実行できません。`;
            summaryText.style.color = "#b91c1c";
        } else if (simulationResult.totalNew === 0 && simulationResult.totalOverwritten === 0) {
            text += `\nインポート対象のデータが含まれていません。`;
            summaryText.style.color = "#0f172a";
        } else {
            text += `\n✅ 依存関係エラーなし。このままインポートを実行できます。`;
            summaryText.style.color = "#15803d";
        }

        summaryText.textContent = text;
        summaryArea.style.display = 'block';
    };

    // 4. Execute Import
    const handleExecute = async () => {
        if (!parsedDataStore || simulationResult.totalErrors > 0) return;

        const confirmMsg = `計 ${simulationResult.totalNew + simulationResult.totalOverwritten} 件のデータをインポート（上書き含む）します。\nよろしいですか？`;
        if (!confirm(confirmMsg)) return;

        btnSimulate.disabled = true;
        btnExecute.disabled = true;
        progressArea.style.display = 'block';
        updateProgress('バッチ書き込み準備中...', 10);

        try {
            const BATCH_LIMIT = 400; // Safe limit below 500
            let currentBatch = db.batch();
            let batchCount = 0;
            let totalProcessed = 0;

            const totalDocs = simulationResult.totalNew + simulationResult.totalOverwritten;

            // Strict Tier Order Insert
            const processedCols = new Set();
            for (const col of TIER_ORDER) {
                if (!parsedDataStore[col]) continue;
                processedCols.add(col);

                for (const doc of parsedDataStore[col]) {
                    // Skip errors (already prevented by Execute disable, but safe guard)
                    let docId = doc._docId;
                    let cleanDoc = { ...doc };
                    delete cleanDoc._docId;

                    // 顧客データにsearch_name/search_kanaを自動付与
                    if (col === 'customers') {
                        cleanDoc.search_name = generateSearchName(cleanDoc.customer_name);
                        cleanDoc.search_kana = generateSearchKana(cleanDoc.customer_kana);
                    }

                    const ref = db.collection(col).doc(docId);
                    currentBatch.set(ref, cleanDoc);
                    batchCount++;
                    totalProcessed++;

                    if (batchCount >= BATCH_LIMIT) {
                        updateProgress(`書き込み中... (${totalProcessed} / ${totalDocs} 件)`, 10 + (totalProcessed / totalDocs) * 80);
                        await currentBatch.commit();
                        currentBatch = db.batch(); // New batch
                        batchCount = 0;
                    }
                }
            }

            // Un-ordered cols
            for (const col of Object.keys(parsedDataStore)) {
                if (processedCols.has(col)) continue;
                for (const doc of parsedDataStore[col]) {
                    let docId = doc._docId;
                    let cleanDoc = { ...doc };
                    delete cleanDoc._docId;

                    // 顧客データにsearch_name/search_kanaを自動付与
                    if (col === 'customers') {
                        cleanDoc.search_name = generateSearchName(cleanDoc.customer_name);
                        cleanDoc.search_kana = generateSearchKana(cleanDoc.customer_kana);
                    }

                    const ref = db.collection(col).doc(docId);
                    currentBatch.set(ref, cleanDoc);
                    batchCount++;
                    totalProcessed++;

                    if (batchCount >= BATCH_LIMIT) {
                        updateProgress(`書き込み中... (${totalProcessed} / ${totalDocs} 件)`, 10 + (totalProcessed / totalDocs) * 80);
                        await currentBatch.commit();
                        currentBatch = db.batch();
                        batchCount = 0;
                    }
                }
            }

            // Commit remainder
            if (batchCount > 0) {
                updateProgress(`最終バッチの書き込み中...`, 95);
                await currentBatch.commit();
            }

            updateProgress('インポート完了！', 100);
            alert("データのインポートが完了しました。");

        } catch (err) {
            console.error("Import Error:", err);
            alert("インポート実行中にエラーが発生しました。\n" + err.message);
        } finally {
            setTimeout(() => {
                window.location.reload(); // Reload to clear states and refresh UI
            }, 1000);
        }
    };

    const updateProgress = (text, percent) => {
        if (progressText) progressText.textContent = text;
        if (progressFill) progressFill.style.width = `${percent}%`;
    };
});
