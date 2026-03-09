document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const btnExport = document.getElementById('btn-run-export');
    const backupCard = document.getElementById('backup-card');
    const errorAccess = document.getElementById('error-access');
    const progressArea = document.getElementById('progress-area');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-fill');
    const formatRadios = document.querySelectorAll('input[name="export-format"]');

    function restoreButtonDisplay() {
        const format = document.querySelector('input[name="export-format"]:checked').value;
        if (format === 'json') {
            btnExport.innerHTML = '<i data-lucide="download-cloud"></i> JSONファイルを生成してダウンロード';
        } else if (format === 'csv') {
            btnExport.innerHTML = '<i data-lucide="file-text"></i> CSVデータ（ZIP）を生成してダウンロード';
        } else if (format === 'excel') {
            btnExport.innerHTML = '<i data-lucide="file-spreadsheet"></i> Excelファイルを生成してダウンロード';
        }
        lucide.createIcons();
    }

    formatRadios.forEach(radio => {
        radio.addEventListener('change', restoreButtonDisplay);
    });

    // 対象の全主要コレクション
    const COLLECTIONS_TO_EXPORT = [
        'customers',
        'cases',
        'licenses',
        'invoices',
        'payments',
        'staff',
        'government_offices',
        'license_types',
        'offices',
        'contacts',
        'invoice_items'
    ];

    // 1. Check Authentication and Role
    const checkRoleAndInit = async () => {
        // Wait briefly for common.js auth check to set session
        setTimeout(async () => {
            const sessionData = localStorage.getItem('lapis2_session');
            if (!sessionData) {
                // Not authenticated yet
                return;
            }

            try {
                const session = JSON.parse(sessionData);
                if (!session || !session.email) {
                    throw new Error("Invalid session");
                }

                // Check role in Firestore using getDocFromFirestore (from common.js)
                const staffData = await getDocFromFirestore('staff', 'email', session.email);

                if (staffData && staffData.authority === 'admin') {
                    // Admin verified
                    backupCard.style.display = 'block';
                    btnExport.addEventListener('click', handleExport);
                } else {
                    // Access Denied
                    errorAccess.style.display = 'block';
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 3000);
                }
            } catch (err) {
                console.error("Auth role check failed:", err);
                errorAccess.style.display = 'block';
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 3000);
            }
        }, 1000); // 1s delay for auth state settling
    };

    checkRoleAndInit();

    // 2. Export Handler
    const handleExport = async () => {
        try {
            // UI Update
            btnExport.disabled = true;
            btnExport.innerHTML = '<i class="lucide-loader" style="animation: spin 1s linear infinite;"></i> データを取得中...';
            progressArea.style.display = 'block';
            updateProgress('初期化中...', 0);

            const exportedData = {
                metadata: {
                    exportedAt: new Date().toISOString(),
                    version: "LAPIS2_DB_V1",
                    collections: COLLECTIONS_TO_EXPORT
                },
                data: {}
            };

            const totalCols = COLLECTIONS_TO_EXPORT.length;

            // Fetch collections sequentially to respect quotas and avoid sudden burst
            for (let i = 0; i < totalCols; i++) {
                const colName = COLLECTIONS_TO_EXPORT[i];
                const percent = Math.round((i / totalCols) * 100);
                updateProgress(`「${colName}」のデータを取得中... (${i + 1}/${totalCols})`, percent);

                const colData = await fetchCollectionData(colName);
                exportedData.data[colName] = colData;
            }

            updateProgress(`JSONファイルの生成中...`, 95);

            // Trigger Download
            const selectedFormat = document.querySelector('input[name="export-format"]:checked').value;
            if (selectedFormat === 'json') {
                downloadJSON(exportedData);
            } else if (selectedFormat === 'csv') {
                await downloadCSVZip(exportedData.data);
            } else if (selectedFormat === 'excel') {
                downloadExcel(exportedData.data);
            }

            // Restoration
            updateProgress('エクスポート完了！', 100);
            setTimeout(() => {
                progressArea.style.display = 'none';
                btnExport.disabled = false;
                restoreButtonDisplay();
                showToast('全データのエクスポートが完了しました。', 'success');
            }, 2000);

        } catch (err) {
            console.error("Export Error:", err);
            btnExport.disabled = false;
            restoreButtonDisplay();
            alert('エクスポート中にエラーが発生しました。\n' + err.message);
        }
    };

    // 3. Firestore Data Fetcher with Timestamp serialization
    const fetchCollectionData = async (collectionName) => {
        const snapshot = await db.collection(collectionName).get();
        const docs = {};

        snapshot.forEach(doc => {
            // Type-safe deep clone with Timestamp conversion
            docs[doc.id] = serializeFirestoreData(doc.data());
        });

        return docs;
    };

    // Make Firestore special objects portable (Timestamp etc)
    const serializeFirestoreData = (data) => {
        if (data === null || data === undefined) {
            return data;
        }

        // Handle Firestore Timestamp
        // duck typing to check if it's a Firestore Timestamp (has toDate function)
        if (typeof data === 'object' && typeof data.toDate === 'function') {
            return {
                __datatype__: "timestamp",
                value: data.toDate().toISOString()
            };
        }

        // Handle Array
        if (Array.isArray(data)) {
            return data.map(item => serializeFirestoreData(item));
        }

        // Handle nested Object
        if (typeof data === 'object') {
            const newObj = {};
            for (const key in data) {
                if (data.hasOwnProperty(key)) {
                    newObj[key] = serializeFirestoreData(data[key]);
                }
            }
            return newObj;
        }

        // Primitive types (string, number, boolean)
        return data;
    };

    // 4. Export Formats Utilities
    const triggerDownload = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getFormattedTimestamp = () => {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        return `${yyyy}${mm}${dd}_${hh}${min}`;
    };

    const downloadJSON = (dataObj) => {
        const jsonStr = JSON.stringify(dataObj, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const filename = `lapis2_backup_${getFormattedTimestamp()}.json`;
        triggerDownload(blob, filename);
    };

    // Flatten logic for tabular formats
    const flattenObject = (obj, prefix = '') => {
        let result = {};
        for (const key in obj) {
            if (!obj.hasOwnProperty(key)) continue;

            const val = obj[key];
            const newKey = prefix ? `${prefix}_${key}` : key;

            if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val.__datatype__ === 'timestamp')) {
                Object.assign(result, flattenObject(val, newKey));
            } else {
                if (Array.isArray(val)) {
                    result[newKey] = JSON.stringify(val);
                } else if (val !== null && typeof val === 'object' && val.__datatype__ === 'timestamp') {
                    result[newKey] = val.value;
                } else {
                    result[newKey] = val;
                }
            }
        }
        return result;
    };

    const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        let str = String(val);
        if (str.includes(',') || str.includes('\n') || str.includes('\"')) {
            str = str.replace(/"/g, '""');
            str = `"${str}"`;
        }
        return str;
    };

    const downloadCSVZip = async (collectionsData) => {
        try {
            const zip = new JSZip();

            for (const colName in collectionsData) {
                const docsObj = collectionsData[colName];
                const docsArray = Object.values(docsObj);
                if (docsArray.length === 0) {
                    zip.file(`${colName}.csv`, '\uFEFF'); // Generate empty file with BOM
                    continue;
                }

                const flatDocs = docsArray.map(doc => flattenObject(doc));
                const headers = new Set();
                flatDocs.forEach(doc => Object.keys(doc).forEach(k => headers.add(k)));
                const headerArray = Array.from(headers);

                let csvContent = headerArray.map(escapeCSV).join(',') + '\r\n';
                flatDocs.forEach(doc => {
                    const row = headerArray.map(header => escapeCSV(doc[header]));
                    csvContent += row.join(',') + '\r\n';
                });

                zip.file(`${colName}.csv`, '\uFEFF' + csvContent); // Add UTF-8 BOM
            }

            const content = await zip.generateAsync({ type: "blob" });
            const filename = `lapis2_backup_csv_${getFormattedTimestamp()}.zip`;
            triggerDownload(content, filename);
        } catch (e) {
            console.error("ZIP Generation error", e);
            throw new Error("CSV(ZIP)の生成に失敗しました。");
        }
    };

    const downloadExcel = (collectionsData) => {
        try {
            const wb = XLSX.utils.book_new();

            for (const colName in collectionsData) {
                const docsObj = collectionsData[colName];
                const docsArray = Object.values(docsObj);

                if (docsArray.length === 0) {
                    const ws = XLSX.utils.json_to_sheet([]);
                    XLSX.utils.book_append_sheet(wb, ws, colName.substring(0, 31));
                    continue;
                }

                const flatDocs = docsArray.map(doc => flattenObject(doc));
                const ws = XLSX.utils.json_to_sheet(flatDocs);
                XLSX.utils.book_append_sheet(wb, ws, colName.substring(0, 31));
            }

            const filename = `lapis2_backup_${getFormattedTimestamp()}.xlsx`;
            XLSX.writeFile(wb, filename);
        } catch (e) {
            console.error("Excel Generation error", e);
            throw new Error("Excelファイルの生成に失敗しました。");
        }
    };

    const updateProgress = (text, percent) => {
        if (progressText) progressText.textContent = text;
        if (progressFill) progressFill.style.width = `${percent}%`;
    };

});
