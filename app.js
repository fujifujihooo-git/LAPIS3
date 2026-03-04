document.addEventListener('DOMContentLoaded', async () => {
    console.log('LAPIS2 Dashboard Initialized (Firestore Mode)');

    // --- Selectors ---
    const caseListBody = document.getElementById('case-list-body');
    const filterStatus = document.getElementById('filter-status');
    const filterLicense = document.getElementById('filter-license');
    const filterStaff = document.getElementById('filter-staff');
    const filterCustomer = document.getElementById('filter-customer');
    const filterDeadlineNear = document.getElementById('filter-deadline-near');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const filterDateType = document.getElementById('filter-date-type');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');

    // Data Management Selectors
    // Data Management Selectors (Top)
    const btnExportTop = document.getElementById('btn-export-top');
    const btnImportTriggerTop = document.getElementById('btn-import-trigger-top');
    const inputImportTop = document.getElementById('input-import-top');

    // Data Management Selectors (Bottom)
    const btnExportBottom = document.getElementById('btn-export-bottom');
    const btnImportTriggerBottom = document.getElementById('btn-import-trigger-bottom');
    const inputImportBottom = document.getElementById('input-import-bottom');

    // Stats Selectors
    const statTotal = document.getElementById('stat-total');
    const statActive = document.getElementById('stat-active');
    const statReady = document.getElementById('stat-ready');
    const statCompleted = document.getElementById('stat-completed');

    // --- State ---
    const ACTIVE_STATUSES = [
        '相談', '受任', '作成中',
        '申請準備完了', '受付（受理）', '補正対応中'
    ];

    let cases = [];
    let customers = [];
    let staffMembers = [];

    /**
     * @typedef {'asc' | 'desc' | null} SortOrder
     * @typedef {Object} SortState
     * @property {'status' | 'acceptance_date' | 'remaining_days' | null} key
     * @property {SortOrder} order
     */
    let currentSort = { key: null, order: null };

    // --- Functions ---

    // Initialize Data from Firestore
    async function init() {
        console.log('Fetching initial data from Firestore...');
        try {
            // Fetch Masters (Staff & License Types only)
            const [staffData, licenseTypesData] = await Promise.all([
                getAllFromFirestore('staff'),
                getAllFromFirestore('license_types')
            ]);

            staffMembers = staffData;
            // customers are not fetched initially to save quota.
            // Case documents contain 'customer_name' for display.

            renderStaffOptions();
            await renderLicenseTypeOptions();

            // Initial Fetch: Recent 50 cases
            const snapshot = await db.collection('cases')
                .orderBy('created_date', 'desc')
                .limit(50)
                .get();

            cases = snapshot.docs.map(d => d.data());
            console.log(`Initial data loaded: ${cases.length} cases`);

            renderStats(cases);
            renderTable(cases);
        } catch (err) {
            console.error('Initialization failed:', err);
            showToast('データの読み込みに失敗しました', 'danger');
        }
    }

    // New Search Function
    async function executeSearch() {
        const statusVal = filterStatus.value;
        const licenseVal = filterLicense.value;
        const staffVal = filterStaff.value;
        const custName = filterCustomer ? filterCustomer.value.trim() : '';
        const deadlineNear = filterDeadlineNear.checked;
        const dateTypeVal = filterDateType ? filterDateType.value : '';
        const dateStartVal = filterDateStart ? filterDateStart.value : '';
        const dateEndVal = filterDateEnd ? filterDateEnd.value : '';

        console.log('[DEBUG] executeSearch called');
        console.log('[DEBUG] Params:', { statusVal, licenseVal, staffVal, custName, deadlineNear, dateTypeVal, dateStartVal, dateEndVal });

        caseListBody.innerHTML = '<tr><td colspan="6" style="text-align:center">検索中...</td></tr>';

        try {
            let results = [];

            // Strategy 1: Customer Name Search (Prioritized)
            if (custName) {
                // 全顧客を取得して部分一致検索（Firestoreは部分一致検索をサポートしていないため）
                const cSnap = await db.collection('customers').get();
                const allCustomers = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // 顧客名またはカナで部分一致フィルタリング
                const custNameLower = custName.toLowerCase();
                console.log('[DEBUG] Customer Search Term:', custNameLower);
                console.log('[DEBUG] Total Customers Fetched:', allCustomers.length);

                const matchingCustomers = allCustomers.filter(c => {
                    const nameLower = (c.customer_name || '').toLowerCase();
                    const kanaLower = (c.customer_kana || '').toLowerCase();
                    return nameLower.includes(custNameLower) || kanaLower.includes(custNameLower);
                });

                console.log('[DEBUG] Matching Customers:', matchingCustomers.length);

                if (matchingCustomers.length === 0) {
                    caseListBody.innerHTML = '<tr><td colspan="6" style="text-align:center">該当する顧客が見つかりません</td></tr>';
                    return;
                }

                if (matchingCustomers.length > 10) {
                    alert('該当する顧客が多すぎます。検索条件を詳しくしてください。');
                    caseListBody.innerHTML = '<tr><td colspan="6" style="text-align:center">検索条件を絞ってください</td></tr>';
                    return;
                }

                const targetCustIds = matchingCustomers.map(c => c.customer_id);

                // Step 2: Find Cases for these Customers
                const caseSnap = await db.collection('cases')
                    .where('customer_id', 'in', targetCustIds)
                    .get();

                results = caseSnap.docs.map(d => d.data());

            } else {
                // Strategy 2: Standard Filter Query
                let query = db.collection('cases');

                if (statusVal) {
                    query = query.where('status', '==', statusVal);
                } else {
                    // 全期間の「仕掛中」をすべてDBから取得（件数制限なし）
                    query = query.where('status', 'in', ACTIVE_STATUSES);
                }

                // Note: DB側で 'license_type' 等のwhereや orderBy を混ぜると複合インデックスが要求されるため、
                // インデックス節約と過去案件の確実な取得を両立すべく、ステータス単体のみで全件取得し JS側でフィルタ・ソートします。

                const snap = await query.get();
                results = snap.docs.map(d => d.data());

                // 元々 orderBy('created_date', 'desc') だったため JSで降順ソート
                results.sort((a, b) => {
                    const da = a.created_date ? new Date(a.created_date).getTime() : 0;
                    const db = b.created_date ? new Date(b.created_date).getTime() : 0;
                    return db - da; // 降順
                });
            }

            // In-Memory Filtering for remaining conditions (AND logic)
            // Note: Strategy 2 applied some filters, but Strategy 1 (Customer) did not apply any.
            // So we must re-check ALL filters in memory to be safe and consistent.

            if (statusVal) {
                results = results.filter(c => c.status === statusVal);
            } else {
                // ステータス指定がない場合は「仕掛中」のアクティブステータスのみに絞る
                results = results.filter(c => ACTIVE_STATUSES.includes(c.status));
            }
            if (licenseVal) {
                results = results.filter(c => c.license_type === licenseVal);
            }
            if (staffVal) {
                const sId = parseInt(staffVal);
                // Allow matches for either field or document staff
                results = results.filter(c => c.field_staff_id === sId || c.document_staff_id === sId);
            }
            if (deadlineNear) {
                // Filter for cases with deadline within 30 days
                results = results.filter(c => {
                    const d = calculateRemainingDays(c.application_scheduled_date);
                    return d !== null && d <= 30;
                });
            }

            // 日付種別＋期間フィルタ（インメモリ）
            if (dateTypeVal && (dateStartVal || dateEndVal)) {
                results = results.filter(c => {
                    const rawVal = c[dateTypeVal];
                    if (!rawVal) return false;
                    // 文字列 "YYYY/MM/DD" or "YYYY-MM-DD" を正規化して比較
                    const dateStr = String(rawVal).replace(/\//g, '-').split('T')[0];
                    if (dateStartVal && dateStr < dateStartVal) return false;
                    if (dateEndVal && dateStr > dateEndVal) return false;
                    return true;
                });
            }

            cases = results;

            // 検索実行時はカードの選択状態をリセットし、検索結果でカード数値を再描画する
            activeCardId = null;
            if (typeof updateCardStyles === 'function') updateCardStyles();
            renderStats(cases);
            renderTable(cases);

        } catch (err) {
            console.error('Search failed:', err);
            // Fallback for index errors
            if (err.code === 'failed-precondition') {
                alert('検索条件の組み合わせに必要なインデックスが未作成です。管理コンソールで作成してください。');
            } else {
                alert('検索に失敗しました。');
            }
            caseListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red">エラーが発生しました</td></tr>';
        }
    }

    // Render Staff Options for Filter (Unchanged)
    function renderStaffOptions() {
        if (!filterStaff) return;
        filterStaff.innerHTML = '<option value="">すべて</option>';
        const activeStaff = staffMembers.filter(s => s.status === '在籍')
            .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));

        activeStaff.forEach(s => {
            const option = document.createElement('option');
            option.value = s.staff_id;
            option.textContent = s.staff_name;
            filterStaff.appendChild(option);
        });
    }

    // Render License Type Options for Filter (Unchanged)
    async function renderLicenseTypeOptions() {
        if (!filterLicense) return;
        filterLicense.innerHTML = '<option value="">すべて</option>';
        const licenseTypes = await getAllFromFirestore('license_types');
        const activeTypes = licenseTypes.filter(lt => lt.status === '有効' || lt.status === 'active');

        activeTypes.sort((a, b) => {
            const orderA = a.sort_order !== undefined ? a.sort_order : 999;
            const orderB = b.sort_order !== undefined ? b.sort_order : 999;
            if (orderA !== orderB) return orderA - orderB;
            return a.license_type_name.localeCompare(b.license_type_name, 'ja');
        });

        const addedNames = new Set();
        activeTypes.forEach(lt => {
            if (!addedNames.has(lt.license_type_name)) {
                const option = document.createElement('option');
                option.value = lt.license_type_name;
                option.textContent = lt.license_type_name;
                filterLicense.appendChild(option);
                addedNames.add(lt.license_type_name);
            }
        });
    }

    // --- Core Logic (Filtering & Rendering) ---
    // handleFilter removed, replaced by executeSearch

    function renderTable(data) {
        if (!caseListBody) return;
        caseListBody.innerHTML = '';

        // Sorting
        const sorted = sortCasesCommon(data, currentSort);

        if (sorted.length === 0) {
            caseListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">該当する案件はありません</td></tr>';
            return;
        }

        sorted.forEach(c => {
            const tr = document.createElement('tr');
            const days = calculateRemainingDays(c.application_scheduled_date);
            const daysClass = getRemainingDaysClass(days, c.status);

            const fieldStaff = staffMembers.find(s => s.staff_id === Number(c.field_staff_id))?.staff_name || '-';
            const docStaff = staffMembers.find(s => s.staff_id === Number(c.document_staff_id))?.staff_name || '-';

            const safeDateStr = (val) => {
                if (!val) return '-';
                if (typeof val.toDate === 'function') {
                    const d = val.toDate();
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    return `${y}-${m}-${day}`;
                }
                return String(val).split('T')[0]; // 文字列の場合の時間部分をカット
            };

            tr.innerHTML = `
                <td><span class="badge status-${getStatusKey(c.status)}">${c.status || '-'}</span></td>
                <td>${safeDateStr(c.contract_date)}</td>
                <td class="customer-cell">
                    <a href="customer_detail.html?id=${c.customer_id}">${c.customer_name || '-'}</a>
                </td>
                <td>
                    <div style="font-weight: 600;">${c.license_type || '-'}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${c.procedure_name || '-'}</div>
                </td>
                <td>
                    <span class="days-badge ${daysClass}">${formatRemainingDays(days, c.status)}</span>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${c.application_scheduled_date || '-'}</div>
                </td>
                <td>
                    <div>${fieldStaff}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid rgba(0,0,0,0.05);">${docStaff}</div>
                </td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', (e) => {
                if (e.target.closest('a')) return;
                window.location.href = `detail.html?id=${c.case_id}`;
            });
            caseListBody.appendChild(tr);
        });
    }

    function renderStats(data) {
        const activeCount = data.filter(c => ACTIVE_STATUSES.includes(c.status)).length;
        const urgentCount = data.filter(c => {
            if (!ACTIVE_STATUSES.includes(c.status)) return false;
            const d = calculateRemainingDays(c.application_scheduled_date);
            return d !== null && d <= 7;
        }).length;
        const readyCount = data.filter(c => c.status === '申請準備完了').length;

        if (statTotal) statTotal.textContent = data.length;
        if (statActive) statActive.textContent = activeCount;
        const statUrgent = document.getElementById('stat-urgent');
        if (statUrgent) statUrgent.textContent = urgentCount;
        if (statReady) statReady.textContent = readyCount;

        console.group('【デバッグ】初期データ集計（レンダリング用）');
        console.log(`全データ件数 (DBから取得済): ${data.length}件`);
        console.log(`- 進行中 (完了等以外): ${activeCount}件`);
        console.log(`- 至急対応 (残り7日以内): ${urgentCount}件`);
        console.log(`- 申請準備完了: ${readyCount}件`);
        console.groupEnd();
    }

    function getStatusKey(status) {
        const map = {
            '相談': 'sodan',
            '受任': 'junin',
            '作成中': 'sakusei',
            '作成完了': 'ready',
            '受付（受理）': 'uketuke',
            '補正': 'hosei',
            '完了': 'kanryo',
            '取下げ': 'torisage',
            '返却（県局）': 'henkyoku'
        };
        return map[status] || 'sodan';
    }

    // --- Import / Export Functions ---

    const COLLECTION_List = [
        'customers', 'cases', 'staff', 'government_offices',
        'license_types', 'invoice_items', 'payments',
        'customer_licenses', 'contacts', 'invoices', 'sales'
    ];

    const ID_PREFIX_MAP = {
        'customers': 'cust_',
        'staff': 'staff_',
        'cases': 'case_',
        'government_offices': 'off_',
        'license_types': 'lic_',
        'invoices': 'inv_',
        'customer_licenses': 'cl_',
        'contacts': 'ct_',
        'sales': 'sale_'
    };

    async function exportData() {
        if (!confirm('全データをダウンロードしますか？\n（データ量が多い場合、少し時間がかかります）')) return;

        const exportData = {};
        let totalCount = 0;

        try {
            console.log('Exporting data...');

            // Helper to get from server, then cache if failed
            const getWithFallback = async (colName) => {
                try {
                    const snap = await db.collection(colName).get();
                    return snap.docs;
                } catch (err) {
                    console.warn(`Server fetch failed for ${colName}, trying cache...`, err);
                    try {
                        const snap = await db.collection(colName).get({ source: 'cache' });
                        return snap.docs;
                    } catch (cacheErr) {
                        console.error(`Cache fetch also failed for ${colName}`, cacheErr);
                        return [];
                    }
                }
            };

            for (const collectionName of COLLECTION_List) {
                const docs = await getWithFallback(collectionName);

                exportData[collectionName] = docs.map(doc => {
                    const data = doc.data();
                    // Firestore Timestamp to ISO String
                    Object.keys(data).forEach(key => {
                        if (data[key] && typeof data[key].toDate === 'function') {
                            data[key] = data[key].toDate().toISOString();
                        }
                    });

                    // Raw Export: Use doc.id as is
                    return { id: doc.id, ...data };
                });

                totalCount += exportData[collectionName].length;
                console.log(`Exported ${collectionName}: ${exportData[collectionName].length} docs`);
            }

            const dataStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LAPIS2_FullExport_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            alert(`エクスポート完了！\n合計 ${totalCount} 件のデータをダウンロードしました。`);

        } catch (err) {
            console.error('Export failed:', err);
            alert('エクスポートに失敗しました: ' + err.message);
        }
    }

    // --- Delete All Data (Local Only) ---
    const btnDeleteAll = document.getElementById('btn-delete-all');

    // Show delete button only on localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (btnDeleteAll) btnDeleteAll.style.display = 'inline-block';
    }

    async function deleteAllData() {
        if (!confirm('【警告】\nすべてのデータを削除します。\n本当によろしいですか？\n※この操作は取り消せません。')) return;
        const input = prompt('確認のため "delete" と入力してください');
        if (input !== 'delete') return;

        console.log('Deleting all data...');
        alert('削除を開始します。完了までそのままお待ちください...');

        try {
            for (const col of COLLECTION_List) {
                const snapshot = await db.collection(col).get();
                if (snapshot.empty) continue;

                const batchSize = 400;
                let batch = db.batch();
                let count = 0;
                let deletedTotal = 0;

                for (const doc of snapshot.docs) {
                    batch.delete(doc.ref);
                    count++;
                    deletedTotal++;
                    if (count >= batchSize) {
                        await batch.commit();
                        batch = db.batch();
                        count = 0;
                    }
                }
                if (count > 0) await batch.commit();
                console.log(`Deleted ${col}: ${deletedTotal} docs`);
            }
            alert('全データを削除しました。画面をリロードします。');
            window.location.reload();
        } catch (err) {
            console.error(err);
            alert('削除中にエラーが発生しました: ' + err.message);
        }
    }

    if (btnDeleteAll) btnDeleteAll.addEventListener('click', deleteAllData);


    function importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);

                // Calculate total counts for confirmation
                let countMsg = '';
                let totalDocs = 0;
                COLLECTION_List.forEach(col => {
                    if (data[col] && data[col].length > 0) {
                        countMsg += `${col}: ${data[col].length}件\n`;
                        totalDocs += data[col].length;
                    }
                });

                if (totalDocs === 0) {
                    alert('インポートするデータが見つかりませんでした。JSON形式を確認してください。');
                    return;
                }

                if (!confirm(`以下のデータをインポートしますか？\n\n${countMsg}\n※重複回避のため、事前に「データ全削除」を実行することを推奨します。`)) {
                    e.target.value = '';
                    return;
                }

                alert('インポートを開始します。完了メッセージが出るまで閉じないでください。');

                let totalImported = 0;
                let results = [];

                for (const colName of COLLECTION_List) {
                    if (!data[colName] || !Array.isArray(data[colName])) continue;

                    let batch = db.batch();
                    let batchCount = 0;
                    let colCount = 0;
                    const MAX_BATCH = 400;

                    for (const doc of data[colName]) {
                        const { id, ...docData } = doc;
                        if (!id) continue;

                        // Restore Timestamps
                        Object.keys(docData).forEach(key => {
                            if (typeof docData[key] === 'string' && docData[key].match(/^\d{4}-\d{2}-\d{2}T/)) {
                                docData[key] = firebase.firestore.Timestamp.fromDate(new Date(docData[key]));
                            }
                        });

                        // Raw Import: Use ID as is
                        batch.set(db.collection(colName).doc(String(id)), docData, { merge: true });
                        batchCount++;
                        colCount++;
                        totalImported++;

                        if (batchCount >= MAX_BATCH) {
                            await batch.commit();
                            batch = db.batch();
                            batchCount = 0;
                        }
                    }
                    if (batchCount > 0) {
                        await batch.commit();
                    }
                    results.push(`${colName}: ${colCount}件`);
                }

                alert(`インポートが完了しました。\n\n【内訳】\n${results.join('\n')}\n\n画面をリロードしてください。`);
                window.location.reload();

            } catch (err) {
                console.error('Import failed:', err);
                alert('インポート中にエラーが発生しました: ' + err.message);
            } finally {
                e.target.value = ''; // Reset input
            }
        };
        reader.readAsText(file);
    }

    // ==========================================
    // Sorting Logic
    // ==========================================




    // --- Listeners ---
    // Removed direct change listeners to prevent quota overuse
    const btnSearch = document.getElementById('btn-search-execute');
    if (btnSearch) btnSearch.addEventListener('click', executeSearch);

    if (btnResetFilters) btnResetFilters.addEventListener('click', () => {
        filterStatus.value = '';
        filterLicense.value = '';
        filterStaff.value = '';
        if (filterCustomer) filterCustomer.value = '';
        filterDeadlineNear.checked = false;
        if (filterDateType) filterDateType.value = '';
        if (filterDateStart) filterDateStart.value = '';
        if (filterDateEnd) filterDateEnd.value = '';
        activeCardId = null;
        updateCardStyles();
        init();
    });

    // --- Card Quick Filter Logic ---
    let activeCardId = null;

    function applyCardFilter(cardId) {
        console.group('【デバッグ】カードフィルタ実行');
        console.log(`全データ件数 (DB取得済の対象母数): ${cases.length}件`);
        console.log(`クリックされたカード: ${cardId}`);

        // Toggle: 同じカードを再クリック → 解除
        if (activeCardId === cardId) {
            console.log('=> フィルタ解除 (全件表示)');
            activeCardId = null;
            renderTable(cases);
            updateCardStyles();
            console.groupEnd();
            return;
        }

        let filtered;
        switch (cardId) {
            case 'card-total':
                filtered = cases.filter(c => ACTIVE_STATUSES.includes(c.status));
                break;
            case 'card-urgent':
                filtered = cases.filter(c => {
                    if (!ACTIVE_STATUSES.includes(c.status)) return false;
                    const d = calculateRemainingDays(c.application_scheduled_date);
                    return d !== null && d <= 7;
                });
                break;
            case 'card-ready':
                filtered = cases.filter(c => c.status === '申請準備完了');
                break;
            default:
                filtered = cases;
        }

        console.log(`=> フィルタリング結果: ${filtered.length}件`);
        console.groupEnd();

        activeCardId = cardId;
        renderTable(filtered);
        updateCardStyles();
    }

    function updateCardStyles() {
        document.querySelectorAll('.stat-card-modern').forEach(el => {
            el.classList.remove('selected');
        });
        if (activeCardId) {
            const el = document.getElementById(activeCardId);
            if (el) el.classList.add('selected');
        }
    }

    // Card click events
    ['card-total', 'card-urgent', 'card-ready'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => applyCardFilter(id));
    });

    if (btnExportTop) btnExportTop.addEventListener('click', exportData);
    if (btnImportTriggerTop) btnImportTriggerTop.addEventListener('click', () => inputImportTop.click());
    if (inputImportTop) inputImportTop.addEventListener('change', importData);

    if (btnExportBottom) btnExportBottom.addEventListener('click', exportData);
    if (btnImportTriggerBottom) btnImportTriggerBottom.addEventListener('click', () => inputImportBottom.click());
    if (inputImportBottom) inputImportBottom.addEventListener('change', importData);

    // Setup headers using common.js logic
    initSortHeaders('#case-table', currentSort, () => renderTable(cases));

    // Initial Start
    await init();

});
